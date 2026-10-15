#!/usr/bin/env bash
#
# Учебное восстановление: проверка, что копия пригодна.
#
# Непроверенная резервная копия — это не резервная копия. Скрипт делает
# копию, восстанавливает её в отдельную базу, сверяет количество строк по
# всем таблицам и контрольные суммы файлов, а затем убеждается, что
# повреждённая копия отвергается, а неверный пароль не проходит.
#
# Переменные окружения:
#   DATABASE_URL                 — рабочая база (читается)
#   VERIFY_DATABASE_URL          — база для восстановления (БУДЕТ ОЧИЩЕНА)
#   BACKUP_ENCRYPTION_PASSPHRASE — парольная фраза копии
#   STORAGE_DIR                  — каталог документов
#
# Запуск: npm run backup:verify

set -euo pipefail

fail() { echo "ПРОВАЛ: $*" >&2; exit 1; }
ok() { echo "  ок: $*"; }

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL не задан"
[ -n "${VERIFY_DATABASE_URL:-}" ] \
  || fail "VERIFY_DATABASE_URL не задан: нужна отдельная база, её содержимое будет затёрто"
[ "${VERIFY_DATABASE_URL}" != "${DATABASE_URL}" ] \
  || fail "VERIFY_DATABASE_URL совпадает с DATABASE_URL: учебное восстановление затёрло бы рабочую базу"
[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] || fail "BACKUP_ENCRYPTION_PASSPHRASE не задан"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

export BACKUP_DIR="$WORK/backups"
STORAGE_DIR="${STORAGE_DIR:-./storage}"

echo "1. Создание копии"
BACKUP_DIR="$BACKUP_DIR" STORAGE_DIR="$STORAGE_DIR" bash scripts/backup.sh > "$WORK/backup.log" 2>&1 \
  || { cat "$WORK/backup.log"; fail "резервное копирование завершилось с ошибкой"; }
SNAPSHOT="$(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d | sort | tail -1)"
[ -n "$SNAPSHOT" ] || fail "копия не создана"
ok "копия: $(basename "$SNAPSHOT")"

echo "2. Копия зашифрована"
head -c 8 "$SNAPSHOT/database.dump.enc" | grep -q 'Salted' \
  || fail "в начале файла нет метки шифрования OpenSSL"
grep -qa 'PGDMP' "$SNAPSHOT/database.dump.enc" \
  && fail "в зашифрованном файле видна сигнатура дампа PostgreSQL"
ok "дамп базы не читается без пароля"

echo "3. Восстановление в отдельную базу"
RESTORE_DATABASE_URL="$VERIFY_DATABASE_URL" \
RESTORE_STORAGE_DIR="$WORK/storage" \
  bash scripts/restore.sh "$SNAPSHOT" > "$WORK/restore.log" 2>&1 \
  || { cat "$WORK/restore.log"; fail "восстановление завершилось с ошибкой"; }
ok "восстановление прошло"

echo "4. Сверка количества строк по всем таблицам"
counts() {
  psql "$1" -tAF, -c "
    SELECT c.relname, (
      SELECT count(*) FROM pg_catalog.pg_class WHERE false
    ) FROM pg_class c WHERE false" > /dev/null
  # Количество строк считается запросом по каждой таблице: статистика
  # планировщика для сверки не годится, она приблизительная.
  psql "$1" -tA -c "
    SELECT string_agg(format('%s=%s', relname, cnt), E'\n' ORDER BY relname)
    FROM (
      SELECT c.relname,
             (xpath('/row/c/text()',
                    query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                                 false, true, '')))[1]::text::bigint AS cnt
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    ) t"
}
counts "$DATABASE_URL" > "$WORK/source.txt"
counts "$VERIFY_DATABASE_URL" > "$WORK/restored.txt"
if ! diff -u "$WORK/source.txt" "$WORK/restored.txt" > "$WORK/counts.diff"; then
  cat "$WORK/counts.diff" >&2
  fail "количество строк не совпадает"
fi
ok "совпало таблиц: $(grep -c '=' "$WORK/source.txt")"

echo "5. Политики изоляции восстановлены вместе со схемой"
policies="$(psql "$VERIFY_DATABASE_URL" -tAc "SELECT count(*) FROM pg_policy")"
[ "$policies" -ge 15 ] || fail "после восстановления политик RLS только $policies"
rls_off="$(psql "$VERIFY_DATABASE_URL" -tAc "
  SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_policy p ON p.polrelid = c.oid
  WHERE n.nspname = 'public' AND NOT c.relrowsecurity")"
[ "$rls_off" = "0" ] || fail "у $rls_off таблиц есть политика, но RLS выключен"
ok "политик: $policies, все таблицы с политиками имеют включённый RLS"

echo "6. Документы восстановлены побайтово"
if [ -d "$STORAGE_DIR" ] && [ -n "$(find "$STORAGE_DIR" -type f -print -quit)" ]; then
  (cd "$STORAGE_DIR" && find . -type f -exec sha256sum {} + | sort -k2) > "$WORK/files-source.txt"
  (cd "$WORK/storage" && find . -type f -exec sha256sum {} + | sort -k2) > "$WORK/files-restored.txt"
  diff -u "$WORK/files-source.txt" "$WORK/files-restored.txt" \
    || fail "содержимое файлов после восстановления отличается"
  ok "файлов сверено: $(wc -l < "$WORK/files-source.txt")"
else
  echo "  документов в $STORAGE_DIR нет — шаг пропущен"
fi

echo "7. Повреждённая копия отвергается"
cp -r "$SNAPSHOT" "$WORK/tampered"
# Меняем байт в середине шифротекста: HMAC должен это заметить.
size="$(stat -c%s "$WORK/tampered/database.dump.enc")"
printf '\xff' | dd of="$WORK/tampered/database.dump.enc" bs=1 \
  seek="$((size / 2))" count=1 conv=notrunc status=none
if RESTORE_DATABASE_URL="$VERIFY_DATABASE_URL" RESTORE_STORAGE_DIR="$WORK/storage2" \
     bash scripts/restore.sh "$WORK/tampered" > "$WORK/tampered.log" 2>&1; then
  fail "повреждённая копия была восстановлена"
fi
grep -q 'HMAC не совпал' "$WORK/tampered.log" \
  || { cat "$WORK/tampered.log" >&2; fail "повреждение обнаружено не проверкой HMAC"; }
ok "повреждение обнаружено до расшифровки"

echo "8. Неверный пароль не проходит"
if BACKUP_ENCRYPTION_PASSPHRASE="неверная-парольная-фраза-для-проверки" \
   RESTORE_DATABASE_URL="$VERIFY_DATABASE_URL" RESTORE_STORAGE_DIR="$WORK/storage3" \
     bash scripts/restore.sh "$SNAPSHOT" > "$WORK/wrong.log" 2>&1; then
  fail "копия восстановилась с неверным паролем"
fi
ok "неверный пароль отклонён"

echo
echo "Учебное восстановление пройдено полностью."

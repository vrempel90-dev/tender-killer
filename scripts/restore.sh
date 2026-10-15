#!/usr/bin/env bash
#
# Восстановление из резервной копии.
#
# Порядок: проверить HMAC → расшифровать → восстановить. HMAC проверяется
# ДО расшифровки: повреждённые или подменённые данные не должны попасть в
# расшифровщик и тем более в базу.
#
# Восстановление идёт в базу, указанную в RESTORE_DATABASE_URL. Это
# отдельная переменная, а не DATABASE_URL, намеренно: восстановление
# удаляет существующие объекты, и случайный запуск не должен затереть
# рабочую базу.
#
# Переменные окружения:
#   RESTORE_DATABASE_URL         — куда восстанавливать (обязательно)
#   RESTORE_STORAGE_DIR          — куда распаковать документы (обязательно
#                                  для восстановления файлов)
#   BACKUP_ENCRYPTION_PASSPHRASE — парольная фраза копии
#
# Запуск: npm run restore -- ./backups/20261015T190000Z
#
# После восстановления документы читаются ТОЛЬКО с тем же
# DOCUMENT_ENCRYPTION_KEY, что был при загрузке. Проверьте, что он доступен,
# прежде чем считать восстановление успешным.

set -euo pipefail

fail() { echo "ОШИБКА: $*" >&2; exit 1; }

SOURCE="${1:-}"
[ -n "$SOURCE" ] || fail "Укажите каталог копии: npm run restore -- ./backups/<метка>"
[ -d "$SOURCE" ] || fail "Каталог $SOURCE не найден"
[ -n "${RESTORE_DATABASE_URL:-}" ] \
  || fail "RESTORE_DATABASE_URL не задан (отдельно от DATABASE_URL, чтобы не затереть рабочую базу)"
[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] || fail "BACKUP_ENCRYPTION_PASSPHRASE не задан"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

# Проверка целостности до расшифровки.
unseal() {
  local sealed="$1" destination="$2"
  [ -f "$sealed" ] || fail "В копии нет файла $sealed"
  [ -f "$sealed.hmac" ] || fail "В копии нет HMAC для $sealed"
  local expected actual
  expected="$(cat "$sealed.hmac")"
  actual="$(openssl dgst -sha256 -hmac "$BACKUP_ENCRYPTION_PASSPHRASE" "$sealed")"
  [ "$expected" = "$actual" ] \
    || fail "HMAC не совпал для $sealed: копия повреждена, подменена или пароль неверный"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha512 \
    -in "$sealed" -out "$destination" \
    -pass env:BACKUP_ENCRYPTION_PASSPHRASE \
    || fail "Не удалось расшифровать $sealed"
}

if [ -f "$SOURCE/manifest.txt" ]; then
  echo "→ Опись копии"
  sed 's/^/  /' "$SOURCE/manifest.txt"
fi

echo "→ Проверка и расшифровка базы"
unseal "$SOURCE/database.dump.enc" "$WORK/database.dump"

echo "→ Восстановление базы в ${RESTORE_DATABASE_URL%%\?*}"
# --clean --if-exists: восстановление на непустую базу перезаписывает её.
# Код возврата pg_restore игнорировать нельзя, но предупреждения о
# отсутствующих объектах при --if-exists нормальны, поэтому разбираем
# вывод и падаем только на реальных ошибках.
set +e
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error \
  --dbname="$RESTORE_DATABASE_URL" "$WORK/database.dump" 2> "$WORK/restore.log"
status=$?
set -e
if [ "$status" -ne 0 ]; then
  grep -v 'does not exist, skipping' "$WORK/restore.log" >&2 || true
  fail "pg_restore завершился с кодом $status"
fi

if [ -f "$SOURCE/storage.tar.gz.enc" ]; then
  [ -n "${RESTORE_STORAGE_DIR:-}" ] \
    || fail "В копии есть документы, но RESTORE_STORAGE_DIR не задан"
  echo "→ Проверка и расшифровка документов"
  unseal "$SOURCE/storage.tar.gz.enc" "$WORK/storage.tar.gz"
  mkdir -p "$RESTORE_STORAGE_DIR"
  chmod 700 "$RESTORE_STORAGE_DIR"
  echo "→ Распаковка документов в $RESTORE_STORAGE_DIR"
  tar --extract --gzip --file="$WORK/storage.tar.gz" --directory="$RESTORE_STORAGE_DIR"
fi

echo "→ Сверка после восстановления"
psql "$RESTORE_DATABASE_URL" -tA -c "
  SELECT 'companies=' || (SELECT count(*) FROM companies)
      || ' users=' || (SELECT count(*) FROM users)
      || ' tenders=' || (SELECT count(*) FROM tenders)
      || ' documents=' || (SELECT count(*) FROM documents)
      || ' migrations=' || (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL)"

cat <<'NOTE'

Восстановление базы завершено. Что сделать дальше:
  1. Создать роль приложения: scripts/db-roles.sql (роли не входят в копию).
  2. Проверить, что DOCUMENT_ENCRYPTION_KEY — тот же, что при загрузке
     документов; иначе файлы не прочитаются.
  3. Проверить, что политики RLS на месте: они восстанавливаются вместе со
     схемой, но это стоит подтвердить (npm run test:e2e -- tests/rls.spec.ts).
NOTE

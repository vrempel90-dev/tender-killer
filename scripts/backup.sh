#!/usr/bin/env bash
#
# Резервная копия: база данных и каталог документов.
#
# Копия шифруется: в базе лежат хеши паролей, журнал операций и
# коммерческие данные компаний, а в каталоге документов — файлы клиентов.
# Незашифрованная копия на стороннем хранилище обесценивает всю остальную
# защиту.
#
# Схема: encrypt-then-MAC. Сначала AES-256-CBC с выводом ключа PBKDF2,
# затем HMAC-SHA256 по шифротексту в отдельный файл. Восстановление
# сначала проверяет HMAC и только потом расшифровывает — иначе
# повреждённые или подменённые данные попали бы в расшифровщик.
#
# ВАЖНО: ключ шифрования документов (DOCUMENT_ENCRYPTION_KEY) в копию НЕ
# входит. Без него восстановленные документы не прочитать. Храните его
# отдельно от резервных копий — иначе одна утечка хранилища отдаёт и
# файлы, и ключ.
#
# Переменные окружения:
#   DATABASE_URL                 — строка подключения (владелец схемы)
#   BACKUP_DIR                   — куда писать (по умолчанию ./backups)
#   BACKUP_ENCRYPTION_PASSPHRASE — парольная фраза, минимум 20 символов
#   STORAGE_DIR                  — каталог документов (по умолчанию ./storage)
#   BACKUP_KEEP                   — сколько копий хранить (по умолчанию 14)
#
# Запуск: npm run backup

set -euo pipefail

fail() { echo "ОШИБКА: $*" >&2; exit 1; }

[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL не задан"
[ -n "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ] \
  || fail "BACKUP_ENCRYPTION_PASSPHRASE не задан: незашифрованные копии запрещены"
[ "${#BACKUP_ENCRYPTION_PASSPHRASE}" -ge 20 ] \
  || fail "BACKUP_ENCRYPTION_PASSPHRASE короче 20 символов"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STORAGE_DIR="${STORAGE_DIR:-./storage}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/$STAMP"

mkdir -p "$TARGET"
chmod 700 "$BACKUP_DIR" "$TARGET"

# Шифрование и HMAC одним проходом по файлу.
seal() {
  local source="$1" destination="$2"
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha512 -salt \
    -in "$source" -out "$destination" \
    -pass env:BACKUP_ENCRYPTION_PASSPHRASE
  openssl dgst -sha256 -hmac "$BACKUP_ENCRYPTION_PASSPHRASE" \
    -out "$destination.hmac" "$destination"
  chmod 600 "$destination" "$destination.hmac"
}

echo "→ База данных"
# -Fc: формат, допускающий выборочное восстановление и параллельность.
# Схема и данные целиком: восстанавливать нужно на пустую базу.
pg_dump --format=custom --no-owner --no-privileges --compress=9 \
  --file="$TARGET/database.dump" "$DATABASE_URL"
seal "$TARGET/database.dump" "$TARGET/database.dump.enc"
rm -f "$TARGET/database.dump"

echo "→ Документы"
if [ -d "$STORAGE_DIR" ]; then
  # Файлы уже зашифрованы ключом документов; копия шифруется повторно,
  # потому что в именах путей есть идентификаторы компаний.
  tar --create --gzip --file="$TARGET/storage.tar.gz" \
    --directory="$STORAGE_DIR" .
  seal "$TARGET/storage.tar.gz" "$TARGET/storage.tar.gz.enc"
  rm -f "$TARGET/storage.tar.gz"
else
  echo "  каталог $STORAGE_DIR отсутствует — пропущено"
fi

echo "→ Опись"
{
  echo "created_at=$STAMP"
  echo "database_host=$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).host)')"
  echo "database_name=$(node -e 'process.stdout.write(new URL(process.env.DATABASE_URL).pathname.slice(1))')"
  echo "storage_dir=$STORAGE_DIR"
  echo "pg_dump_version=$(pg_dump --version | awk '{print $3}')"
  echo "schema_migrations=$(psql "$DATABASE_URL" -tAc 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL')"
  echo "latest_migration=$(psql "$DATABASE_URL" -tAc 'SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1')"
  echo "# DOCUMENT_ENCRYPTION_KEY в копию не входит и хранится отдельно."
} > "$TARGET/manifest.txt"
chmod 600 "$TARGET/manifest.txt"

echo "→ Удаление устаревших копий (храним $BACKUP_KEEP)"
# Копии названы по времени в UTC, поэтому сортировка по имени = по дате.
mapfile -t all < <(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -printf '%f\n' | sort)
total=${#all[@]}
if [ "$total" -gt "$BACKUP_KEEP" ]; then
  for old in "${all[@]:0:$((total - BACKUP_KEEP))}"; do
    echo "  удаляю $old"
    rm -rf "$BACKUP_DIR/$old"
  done
fi

echo "Готово: $TARGET"
ls -l "$TARGET"

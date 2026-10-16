-- Роль приложения с минимальными правами.
--
-- Зачем: сейчас приложение, миграции и сиды ходят в БД под одной ролью —
-- владельцем схемы. Владелец обходит Row Level Security и может менять
-- структуру БД, поэтому ошибка в запросе или внедрение SQL обходятся
-- дорого. Эта роль не может ни того, ни другого.
--
-- Запуск (однократно на кластер, под ролью с правом CREATEROLE):
--   psql "$ADMIN_DATABASE_URL" \
--     -v app_user="$APP_DB_USER" -v app_password="$APP_DB_PASSWORD" \
--     -f scripts/db-roles.sql
--
-- Скрипт идемпотентен: повторный запуск обновляет пароль и права.

\set ON_ERROR_STOP on

-- 0. Пароль обязателен и не короче 16 символов.
SELECT format(
  'DO $chk$ BEGIN IF %L IS NULL OR length(%L) < 16 THEN '
  'RAISE EXCEPTION ''Пароль роли приложения должен быть не короче 16 символов''; '
  'END IF; END $chk$;',
  :'app_password', :'app_password')
\gexec

-- 1. Группа прав. NOBYPASSRLS обязателен: иначе политики изоляции
--    не применяются к роли приложения.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tk_app') THEN
    CREATE ROLE tk_app NOLOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;
  ELSE
    ALTER ROLE tk_app NOLOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER;
  END IF;
END
$$;

-- 2. Доступ к данным, но не к структуре.
GRANT USAGE ON SCHEMA public TO tk_app;
-- Создание объектов в схеме приложению не нужно: DDL выполняют миграции.
REVOKE CREATE ON SCHEMA public FROM tk_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tk_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tk_app;

-- Таблицы будущих миграций получат те же права автоматически.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tk_app;

-- Журнал миграций Prisma приложению не нужен даже на чтение.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = '_prisma_migrations') THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM tk_app;
  END IF;
END
$$;

-- 3. Учётная запись, под которой подключается приложение.
SELECT format(
  'CREATE ROLE %I LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER PASSWORD %L',
  :'app_user', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format(
  'ALTER ROLE %I LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER PASSWORD %L',
  :'app_user', :'app_password')
\gexec

SELECT format('GRANT tk_app TO %I', :'app_user')
\gexec

-- 4. Проверка: ни роль приложения, ни её участники не обходят RLS.
DO $$
DECLARE
  bypassing text;
BEGIN
  SELECT string_agg(r.rolname, ', ') INTO bypassing
  FROM pg_roles r
  WHERE r.rolbypassrls
    AND NOT r.rolsuper
    AND (r.rolname = 'tk_app' OR pg_has_role(r.oid, 'tk_app', 'MEMBER'));
  IF bypassing IS NOT NULL THEN
    RAISE EXCEPTION 'Роль обходит RLS, изоляция не действует: %', bypassing;
  END IF;
END
$$;

\echo 'Роль приложения настроена. Подключайте приложение под ней, миграции — под владельцем схемы.'

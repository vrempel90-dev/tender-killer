/**
 * Изоляция компаний на уровне СУБД.
 *
 * Эти проверки идут в обход приложения: подключение выполняется напрямую
 * ролью приложения. Так видно, что изоляция держится даже если в запросе
 * забыли фильтр по companyId.
 *
 * APP_DATABASE_URL — строка подключения ограниченной роли (создаётся
 * scripts/db-roles.sql). DATABASE_URL — владелец схемы, им готовятся данные.
 */
import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const ownerUrl = process.env.DATABASE_URL ?? '';
const appUrl = process.env.APP_DATABASE_URL ?? '';

if (!ownerUrl || !['localhost', '127.0.0.1'].includes(new URL(ownerUrl).hostname)) {
  throw new Error('Isolated local test DB required');
}
if (!appUrl && process.env.CI) {
  // В CI отсутствие роли приложения означает, что проверка изоляции
  // не выполнялась. Это не повод её пропустить.
  throw new Error('APP_DATABASE_URL обязателен: без него RLS не проверяется');
}

const companyA = `rls-a-${randomUUID()}`;
const companyB = `rls-b-${randomUUID()}`;
const tenderA = `rls-tender-a-${randomUUID()}`;
const tenderB = `rls-tender-b-${randomUUID()}`;

let owner: Client;
let app: Client;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.skip(!appUrl, 'Задайте APP_DATABASE_URL: роль приложения из scripts/db-roles.sql');
  owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  for (const [id, name] of [[companyA, 'RLS A'], [companyB, 'RLS B']]) {
    await owner.query(
      'INSERT INTO companies (id, name, "taxRegime", "createdAt", "updatedAt") '
      + "VALUES ($1, $2, 'GENERAL_NO_VAT', now(), now())",
      [id, name],
    );
  }
  for (const [id, company] of [[tenderA, companyA], [tenderB, companyB]]) {
    await owner.query(
      'INSERT INTO tenders (id, "companyId", title, "createdAt", "updatedAt") '
      + 'VALUES ($1, $2, $3, now(), now())',
      [id, company, 'RLS fixture'],
    );
  }
  app = new Client({ connectionString: appUrl });
  await app.connect();
});

test.afterAll(async () => {
  await app?.end();
  if (owner) {
    await owner.query('DELETE FROM companies WHERE id = ANY($1)', [[companyA, companyB]]);
    await owner.end();
  }
});

test('без переменной сессии роль приложения не видит ни одной строки', async () => {
  const { rows } = await app.query('SELECT count(*)::int AS n FROM tenders');
  expect(rows[0].n).toBe(0);
});

test('с установленной компанией видны только её строки', async () => {
  await app.query('SELECT set_config($1, $2, false)', ['app.company_id', companyA]);
  const visible = await app.query('SELECT id FROM tenders WHERE id = ANY($1)', [[tenderA, tenderB]]);
  expect(visible.rows.map((r) => r.id)).toEqual([tenderA]);

  await app.query('SELECT set_config($1, $2, false)', ['app.company_id', companyB]);
  const other = await app.query('SELECT id FROM tenders WHERE id = ANY($1)', [[tenderA, tenderB]]);
  expect(other.rows.map((r) => r.id)).toEqual([tenderB]);
});

test('нельзя создать строку для другой компании', async () => {
  await app.query('SELECT set_config($1, $2, false)', ['app.company_id', companyA]);
  await expect(
    app.query(
      'INSERT INTO tenders (id, "companyId", title, "createdAt", "updatedAt") '
      + 'VALUES ($1, $2, $3, now(), now())',
      [`rls-forged-${randomUUID()}`, companyB, 'forged'],
    ),
  ).rejects.toThrow(/row-level security/i);
});

test('нельзя перенести свою строку в другую компанию', async () => {
  await app.query('SELECT set_config($1, $2, false)', ['app.company_id', companyA]);
  await expect(
    app.query('UPDATE tenders SET "companyId" = $1 WHERE id = $2', [companyB, tenderA]),
  ).rejects.toThrow(/row-level security/i);
  const check = await owner.query('SELECT "companyId" FROM tenders WHERE id = $1', [tenderA]);
  expect(check.rows[0].companyId).toBe(companyA);
});

test('нельзя удалить строку другой компании', async () => {
  await app.query('SELECT set_config($1, $2, false)', ['app.company_id', companyA]);
  const deleted = await app.query('DELETE FROM tenders WHERE id = $1', [tenderB]);
  // Строка не видна, поэтому DELETE никого не затрагивает.
  expect(deleted.rowCount).toBe(0);
  const still = await owner.query('SELECT count(*)::int AS n FROM tenders WHERE id = $1', [tenderB]);
  expect(still.rows[0].n).toBe(1);
});

test('дочерние записи наследуют видимость родителя', async () => {
  const documentB = `rls-doc-b-${randomUUID()}`;
  await owner.query(
    'INSERT INTO documents (id, "companyId", "tenderId", kind, "originalName", '
    + '"storagePath", "mimeType", "sizeBytes", sha256, "createdAt") '
    + "VALUES ($1, $2, $3, 'OTHER', 'f.pdf', 'x/f.pdf', 'application/pdf', 1, $4, now())",
    [documentB, companyB, tenderB, randomUUID().replace(/-/g, '')],
  );
  await owner.query(
    'INSERT INTO document_extractions (id, "documentId", status, "createdAt", "updatedAt") '
    + "VALUES ($1, $2, 'SUCCEEDED', now(), now())",
    [`rls-ext-${randomUUID()}`, documentB],
  );

  await app.query('SELECT set_config($1, $2, false)', ['app.company_id', companyA]);
  const hidden = await app.query(
    'SELECT count(*)::int AS n FROM document_extractions WHERE "documentId" = $1',
    [documentB],
  );
  expect(hidden.rows[0].n).toBe(0);

  await app.query('SELECT set_config($1, $2, false)', ['app.company_id', companyB]);
  const shown = await app.query(
    'SELECT count(*)::int AS n FROM document_extractions WHERE "documentId" = $1',
    [documentB],
  );
  expect(shown.rows[0].n).toBe(1);
});

test('роль приложения не обходит RLS, не меняет структуру и не читает журнал миграций', async () => {
  const flags = await app.query(
    'SELECT rolbypassrls, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user',
  );
  expect(flags.rows[0]).toMatchObject({
    rolbypassrls: false,
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
  });

  await expect(app.query('CREATE TABLE rls_probe (id int)')).rejects.toThrow(/permission denied/i);
  await expect(app.query('ALTER TABLE tenders DISABLE ROW LEVEL SECURITY')).rejects.toThrow(
    /must be owner|permission denied/i,
  );
  await expect(app.query('SELECT count(*) FROM "_prisma_migrations"')).rejects.toThrow(
    /permission denied/i,
  );
});

test('все таблицы с данными компаний защищены политикой', async () => {
  // Если миграция добавит таблицу компании без политики, тест об этом скажет.
  const expected = [
    'company_profiles', 'company_tax_rates', 'compliance_findings', 'compliance_runs',
    'contract_analyses', 'contract_risks', 'document_extractions', 'documents',
    'financial_models', 'historical_tenders', 'line_items', 'procurement_imports',
    'procurement_opportunities', 'reports', 'requirements', 'saved_searches',
    'supplier_quote_items', 'supplier_quotes', 'tenders',
  ];
  const { rows } = await owner.query(
    "SELECT c.relname AS table, c.relrowsecurity AS enabled, count(p.polname)::int AS policies "
    + 'FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace '
    + 'LEFT JOIN pg_policy p ON p.polrelid = c.oid '
    + "WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1) "
    + 'GROUP BY c.relname, c.relrowsecurity ORDER BY c.relname',
    [expected],
  );
  expect(rows.map((r) => r.table)).toEqual(expected);
  for (const row of rows) {
    expect(row.enabled, `RLS выключен: ${row.table}`).toBe(true);
    expect(row.policies, `нет политики: ${row.table}`).toBeGreaterThan(0);
  }
});

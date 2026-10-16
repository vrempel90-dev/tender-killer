// Synthetic compatibility fixture only. Never connects to a remote or populated DB.
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { URL } from 'node:url';

const url = new URL(process.env.UPGRADE_DATABASE_URL ?? 'invalid:');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  || url.pathname !== '/tender_killer_upgrade_test') throw new Error('An isolated local upgrade database is required');
const db = new pg.Client({ connectionString: url.toString() });
await db.connect();
try {
  const tables = await db.query("SELECT count(*) FROM pg_tables WHERE schemaname='public'");
  assert.equal(Number(tables.rows[0].count), 0, 'Upgrade test refuses an existing schema');
  const root = path.resolve('prisma/migrations');
  const migrations = (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort();
  await db.query(await readFile(path.join(root, migrations[0], 'migration.sql'), 'utf8'));
  await db.query(`
    INSERT INTO companies (id,name,"updatedAt") VALUES ('upgrade-company','Synthetic preserved company',now());
    INSERT INTO users (id,email,"passwordHash",name,"companyId","updatedAt") VALUES
      ('upgrade-user','upgrade@example.test','synthetic-preserved-hash','Synthetic user','upgrade-company',now());
    INSERT INTO sessions (id,"userId","tokenHash","expiresAt") VALUES
      ('upgrade-session','upgrade-user','synthetic-session-hash',now()+interval '1 day');
    INSERT INTO tenders (id,"companyId",title,"startPriceMinor","updatedAt") VALUES
      ('upgrade-tender','upgrade-company','Synthetic tender',123456789,now());
    INSERT INTO documents (id,"companyId","tenderId","originalName","storagePath","mimeType","sizeBytes",sha256) VALUES
      ('upgrade-document','upgrade-company','upgrade-tender','synthetic.pdf','synthetic/preserved.pdf','application/pdf',123,'synthetic-hash');
    INSERT INTO financial_models (id,"tenderId",inputs,result,"updatedAt") VALUES
      ('upgrade-finance','upgrade-tender','{"synthetic":true}','{"netProfitMinor":12345}',now());
  `);
  const snapshots = new Map();
  for (const table of ['companies', 'users', 'sessions', 'tenders', 'documents', 'financial_models']) {
    snapshots.set(table, (await db.query(`SELECT row_to_json(t) AS data FROM "${table}" t`)).rows[0].data);
  }
  for (const name of migrations.slice(1)) {
    await db.query('BEGIN');
    try {
      await db.query(await readFile(path.join(root, name, 'migration.sql'), 'utf8'));
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  }
  for (const [table, before] of snapshots) {
    const after = (await db.query(`SELECT row_to_json(t) AS data FROM "${table}" t`)).rows[0].data;
    for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key], `${table}.${key} changed`);
    assert.equal((await db.query(`SELECT count(*) FROM "${table}"`)).rows[0].count, '1');
  }
  assert.equal((await db.query('SELECT "authVersion" FROM users')).rows[0].authVersion, 0);
  assert.equal((await db.query('SELECT "authVersion" FROM sessions')).rows[0].authVersion, 0);
  assert.equal((await db.query('SELECT count(*) FROM password_reset_tokens')).rows[0].count, '0');
  console.log(`PASS: PostgreSQL upgrade through ${migrations.length} migrations preserves six synthetic tables, password hash and active session`);
} finally { await db.end(); }

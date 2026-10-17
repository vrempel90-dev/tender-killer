// One-time revocation explicitly authorized for this validation environment.
// This helper never prints identifiers, codes, secrets or connection strings.
import pg from 'pg';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
const project = '45a03a66-a491-4b95-a9af-98eb5220dbfd';
const environment = 'eecd91f8-a391-4b99-9e0c-908613dc8f6d';
if (process.env.RAILWAY_PROJECT_ID !== project || process.env.RAILWAY_ENVIRONMENT_ID !== environment) {
  throw new Error('TOTP revocation is restricted to the authorized validation environment');
}
const url = new URL(process.env.DATABASE_URL ?? 'invalid:');
if (url.hostname !== 'postgres.railway.internal') throw new Error('Unexpected validation database destination');
const marker = createHash('sha256').update('maintenance:validation:revoke-disclosed-totp:20261017').digest('hex');
const db = new pg.Client({ connectionString: url.href });
await db.connect();
try {
  await db.query('BEGIN');
  await db.query("SELECT pg_advisory_xact_lock(hashtext('tk-validation-totp-revocation'))");
  const exists = await db.query('SELECT key FROM request_quotas WHERE key=$1', [marker]);
  if (exists.rowCount) {
    await db.query('COMMIT');
    console.log('VALIDATION_TOTP_REVOCATION_ALREADY_COMPLETED');
  } else {
    const revoked = await db.query(`UPDATE users SET "totpSecret"=NULL,"totpConfirmedAt"=NULL,"totpLastCounter"=NULL,
      "authVersion"="authVersion"+1 WHERE "totpSecret" IS NOT NULL OR "totpConfirmedAt" IS NOT NULL RETURNING id`);
    const ids = revoked.rows.map(row => row.id);
    await db.query('DELETE FROM recovery_codes WHERE "userId"=ANY($1::text[])', [ids]);
    await db.query('DELETE FROM password_reset_tokens WHERE "userId"=ANY($1::text[])', [ids]);
    const sessions = await db.query('UPDATE sessions SET "revokedAt"=now(),"mfaVerifiedAt"=NULL,"mfaSteppedUpAt"=NULL WHERE "userId"=ANY($1::text[]) AND "revokedAt" IS NULL', [ids]);
    await db.query('UPDATE companies SET "requireMfaForAdmins"=false WHERE "requireMfaForAdmins"=true');
    await db.query("INSERT INTO request_quotas(key,count,\"expiresAt\") VALUES($1,1,'2100-01-01')", [marker]);
    await db.query('COMMIT');
    console.log(JSON.stringify({ event: 'VALIDATION_TOTP_REVOKED', affectedUsers: ids.length, revokedSessions: sessions.rowCount }));
  }
} catch {
  await db.query('ROLLBACK');
  throw new Error('Validation TOTP revocation failed; no credentials are logged');
} finally { await db.end(); }

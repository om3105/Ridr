import { readFile } from 'node:fs/promises';
import pg from 'pg';

if (!['roles', 'access'].includes(process.argv[2])) throw new Error('Choose roles or access.');
if (process.env.NODE_ENV === 'production') throw new Error('Local bootstrap is development-only.');
const admin = new pg.Client({
  host: '127.0.0.1',
  port: 55432,
  user: 'ridr_admin',
  database: 'ridr',
  password: process.env.POSTGRES_PASSWORD,
  connectionTimeoutMillis: 5000,
});
try {
  await admin.connect();
  await admin.query('BEGIN');
  if (process.argv[2] === 'roles') {
    // Upstream Auth migrations grant access to a conventional postgres role.
    // Our database administrator is ridr_admin; this compatibility role cannot log in.
    const postgresRole = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = 'postgres'");
    if (!postgresRole.rowCount) {
      await admin.query('CREATE ROLE postgres NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE');
    }
    for (const [role, password] of [
      ['supabase_auth_admin', process.env.LOCAL_AUTH_PASSWORD],
      ['ridr_auth_reader', process.env.LOCAL_AUTH_READER_PASSWORD],
    ]) {
      if (!/^[a-f0-9]{48}$/.test(password ?? '')) throw new Error('Run auth:setup first.');
      const exists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      if (!exists.rowCount) {
        // Both role names and passwords are constrained above; neither accepts arbitrary SQL.
        await admin.query(
          `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
      }
      await admin.query(`GRANT CONNECT ON DATABASE ridr TO ${role}`);
      await admin.query(`ALTER ROLE ${role} IN DATABASE ridr SET search_path = pg_catalog`);
    }
    await admin.query('CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin');
    await admin.query(
      'REVOKE ALL ON SCHEMA auth FROM PUBLIC, anon, authenticated, ridr_api, ridr_auth_reader',
    );
    await admin.query('GRANT USAGE ON SCHEMA public TO supabase_auth_admin');
    await admin.query(
      'ALTER ROLE supabase_auth_admin IN DATABASE ridr SET search_path = auth, public',
    );
  } else {
    await admin.query(
      await readFile(new URL('../auth/session-access.sql', import.meta.url), 'utf8'),
    );
  }
  await admin.query('COMMIT');
  console.log(`Local Auth ${process.argv[2]} configured.`);
} catch (error) {
  await admin.query('ROLLBACK').catch(() => {});
  console.error(`Local Auth setup failed (${error.code ?? 'configuration'}). See docs/day-05.`);
  process.exitCode = 1;
} finally {
  await admin.end();
}

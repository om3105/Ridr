import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const authUrl = new URL(process.env.EXPO_PUBLIC_SUPABASE_AUTH_URL ?? '');
if (authUrl.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(authUrl.hostname)) {
  throw new Error('Configure the hosted Supabase Auth URL in apps/mobile/.env first.');
}
const password = randomBytes(32).toString('hex');
const project = authUrl.hostname.split('.')[0];
const access = await readFile(new URL('../auth/session-access.sql', import.meta.url), 'utf8');
const sql = `-- Run once in this Supabase project's SQL Editor. Contains a newly generated password.
-- This login can SELECT only the two identifiers in ridr_auth.active_sessions.
BEGIN;
CREATE ROLE ridr_auth_reader LOGIN PASSWORD '${password}'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT CONNECT ON DATABASE postgres TO ridr_auth_reader;
ALTER ROLE ridr_auth_reader SET search_path = pg_catalog;
ALTER ROLE ridr_auth_reader SET default_transaction_read_only = on;
${access}
COMMIT;
`;
await mkdir(new URL('../tmp/day-05/', import.meta.url), { recursive: true });
// Never replace an existing password or a developer's hosted configuration.
await writeFile(
  new URL('../.env.hosted', import.meta.url),
  `SUPABASE_AUTH_URL=${authUrl.href}\nAUTH_DATABASE_URL=postgresql://ridr_auth_reader:${password}@db.${project}.supabase.co:5432/postgres?sslmode=verify-full\n`,
  { flag: 'wx', mode: 0o600 },
);
await writeFile(new URL('../tmp/day-05/supabase-session-access.sql', import.meta.url), sql, {
  flag: 'wx',
  mode: 0o600,
});
console.log('Prepared ignored tmp/day-05/supabase-session-access.sql and .env.hosted.');
console.log(
  'Run the SQL in your Supabase SQL Editor, then verify connectivity. No credentials were uploaded.',
);

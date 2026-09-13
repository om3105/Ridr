import { randomBytes, createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// A separate ignored file keeps the local test issuer apart from hosted credentials.
const path = new URL('../.env.auth', import.meta.url);
try {
  await readFile(path);
  console.log('Preserved existing local .env.auth.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const authPassword = randomBytes(24).toString('hex');
  const readerPassword = randomBytes(24).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const issuedAt = Math.floor(Date.now() / 1000);
  const jwtPart = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${jwtPart({ alg: 'HS256', typ: 'JWT' })}.${jwtPart({
    role: 'anon',
    iss: 'supabase',
    iat: issuedAt,
    exp: issuedAt + 365 * 86400,
  })}`;
  const anonKey = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
  const values = {
    LOCAL_AUTH_PASSWORD: authPassword,
    LOCAL_AUTH_READER_PASSWORD: readerPassword,
    SUPABASE_AUTH_URL: 'http://127.0.0.1:9999',
    SUPABASE_JWT_SECRET: secret,
    AUTH_DATABASE_URL: `postgresql://ridr_auth_reader:${readerPassword}@127.0.0.1:55432/ridr`,
    EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:9999',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  };
  await writeFile(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  console.log('Created isolated local Auth configuration with unique credentials.');
}

const configured = parseEnv(await readFile(path, 'utf8'));
if (!configured.LOCAL_AUTH_PASSWORD || !configured.LOCAL_AUTH_READER_PASSWORD) {
  throw new Error('Local Auth configuration is incomplete. See docs/day-05.');
}

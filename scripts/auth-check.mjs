import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { AuthClient } from '@supabase/auth-js';
import pg from 'pg';
import { createApp } from '../apps/api/dist/app.js';
import { readConfig } from '../apps/api/dist/config.js';

// This test sends email only to the isolated local inbox, never hosted Supabase.
if (process.env.NODE_ENV !== 'test' || process.env.SUPABASE_AUTH_URL !== 'http://127.0.0.1:9999') {
  throw new Error('Auth integration requires NODE_ENV=test and the local .env.auth issuer.');
}
const email = `day5-${randomUUID()}@ridr.test`;
const password = `Ridr5!${randomBytes(20).toString('hex')}`;
const auth = new AuthClient({
  url: process.env.SUPABASE_AUTH_URL,
  headers: { apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY },
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
});
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
const authOwner = new pg.Client({
  host: '127.0.0.1',
  port: 55432,
  database: 'ridr',
  user: 'supabase_auth_admin',
  password: process.env.LOCAL_AUTH_PASSWORD,
  connectionTimeoutMillis: 5000,
});
const reader = new pg.Client({
  connectionString: process.env.AUTH_DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
let app;
let profileId;
let origin;
async function request(token, options = {}) {
  const response = await fetch(`${origin}/v1/me`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
    signal: AbortSignal.timeout(5000),
  });
  return {
    status: response.status,
    body: await response.json(),
    etag: response.headers.get('etag'),
  };
}
const usedMessages = new Set();
async function codeFromInbox() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const inbox = await fetch('http://127.0.0.1:8025/api/v1/messages', {
      signal: AbortSignal.timeout(3000),
    }).then((r) => r.json());
    const message = inbox.messages.find(
      (item) => !usedMessages.has(item.ID) && item.To.some((to) => to.Address === email),
    );
    if (message) {
      usedMessages.add(message.ID);
      const content = await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`, {
        signal: AbortSignal.timeout(3000),
      }).then((r) => r.json());
      const code = content.HTML.match(/<strong>\s*(\d{6,10})\s*<\/strong>/)?.[1];
      assert.ok(code, 'Local email template must contain the verification code.');
      return code;
    }
    await delay(200);
  }
  throw new Error('Verification email did not arrive in the local inbox.');
}

try {
  await Promise.all([db.connect(), authOwner.connect(), reader.connect()]);
  await assert.rejects(reader.query('SELECT encrypted_password FROM auth.users LIMIT 1'), {
    code: '42501',
  });
  await assert.rejects(reader.query('SELECT * FROM ridr.profiles LIMIT 1'), { code: '42501' });
  const rights = await reader.query(
    "SELECT has_table_privilege(current_user, 'ridr_auth.active_sessions', 'INSERT,UPDATE,DELETE') AS writable",
  );
  assert.equal(rights.rows[0].writable, false);
  console.log('PASS: auth reader cannot read password hashes, domain profiles or mutate sessions.');
  app = await createApp(readConfig(process.env), { logSink: () => {} });
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
  const signup = await auth.signUp({
    email,
    password,
    options: { data: { display_name: 'Local test rider' } },
  });
  assert.equal(signup.error, null);
  assert.equal(signup.data.session, null);
  profileId = signup.data.user.id;
  const unverified = await auth.signInWithPassword({ email, password });
  assert.equal(unverified.error?.code, 'email_not_confirmed');
  const verified = await auth.verifyOtp({ email, token: await codeFromInbox(), type: 'signup' });
  assert.equal(verified.error, null);
  let token = verified.data.session.access_token;
  const me = await request(token);
  assert.equal(me.status, 200);
  assert.equal(me.body.data.id, profileId);
  assert.equal(me.body.data.displayName, 'Local test rider');
  assert.equal(me.body.data.activeMembership, null);
  const edit = {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': me.etag,
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({ displayName: 'Updated local rider' }),
  };
  const saved = await request(token, edit);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.revision, me.body.data.revision + 1);
  const replay = await request(token, edit);
  assert.deepEqual(replay.body.data, saved.body.data);
  const conflict = await request(token, {
    ...edit,
    body: JSON.stringify({ displayName: 'Different request' }),
  });
  assert.equal(conflict.status, 409);
  const stale = await request(token, {
    ...edit,
    headers: { ...edit.headers, 'Idempotency-Key': randomUUID() },
  });
  assert.equal(stale.status, 412);
  console.log(
    'PASS: email verification, profile creation/edit, revision conflict and idempotent replay.',
  );
  await db.query("UPDATE ridr.profiles SET account_state = 'deleting' WHERE id = $1", [profileId]);
  assert.equal((await request(token)).status, 403);
  await db.query("UPDATE ridr.profiles SET account_state = 'active' WHERE id = $1", [profileId]);
  assert.equal((await auth.signOut({ scope: 'local' })).error, null);
  assert.equal(
    (await request(token)).status,
    401,
    'A still-signed JWT cannot survive provider revocation.',
  );
  console.log('PASS: deleting accounts and revoked sessions lose access immediately.');
  assert.equal((await auth.resetPasswordForEmail(email)).error, null);
  const recovery = await auth.verifyOtp({ email, token: await codeFromInbox(), type: 'recovery' });
  assert.equal(recovery.error, null);
  const nextPassword = `Ridr5!${randomBytes(20).toString('hex')}`;
  assert.equal((await auth.updateUser({ password: nextPassword })).error, null);
  await auth.signOut({ scope: 'global' });
  assert.ok((await auth.signInWithPassword({ email, password })).error);
  const restored = await auth.signInWithPassword({ email, password: nextPassword });
  assert.equal(restored.error, null);
  token = restored.data.session.access_token;
  assert.equal((await request(token)).body.data.displayName, 'Updated local rider');
  const refreshed = await auth.refreshSession();
  assert.equal(refreshed.error, null);
  assert.equal((await request(refreshed.data.session.access_token)).status, 200);
  await auth.signOut({ scope: 'global' });
  console.log(
    'PASS: password recovery, changed-password sign-in, session refresh and persisted profile.',
  );
} finally {
  await app?.close();
  if (profileId) {
    await db.query('DELETE FROM ridr.command_receipts WHERE actor_id = $1', [profileId]);
    await db.query('DELETE FROM ridr.profiles WHERE id = $1', [profileId]);
    await authOwner.query('DELETE FROM auth.users WHERE id = $1 AND email = $2', [
      profileId,
      email,
    ]);
  }
  for (const id of usedMessages) {
    await fetch(`http://127.0.0.1:8025/api/v1/messages`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: [id] }),
    }).catch(() => {});
  }
  await Promise.all([db.end(), authOwner.end(), reader.end()]);
}

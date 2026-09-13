import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthClient } from '@supabase/auth-js';
import { createMemoryStorage } from '../src/auth/storage';
import { revokeSession } from '../src/auth/sign-out';

test('offline sign-out retains actual SDK credentials until a reconnect confirms revocation', async () => {
  const storage = createMemoryStorage();
  await storage.setItem(
    'logout-test',
    JSON.stringify({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {
        id: '48d6db19-8889-4a35-964a-d82e57fe36cb',
        email_confirmed_at: '2026-09-13T00:00:00Z',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: '2026-09-13T00:00:00Z',
      },
    }),
  );
  let connected = false;
  let failureStatus = 503;
  let revocations = 0;
  const client = new AuthClient({
    url: 'https://auth.example.test',
    storageKey: 'logout-test',
    storage,
    autoRefreshToken: false,
    persistSession: true,
    detectSessionInUrl: false,
    fetch: async (input, init) => {
      assert.equal(input, 'https://auth.example.test/logout?scope=local');
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer access-token');
      if (!connected) return Response.json({ message: 'Unavailable' }, { status: failureStatus });
      revocations++;
      return new Response(null, { status: 204 });
    },
  });
  try {
    await assert.rejects(revokeSession(client));
    assert.equal((await client.getSession()).data.session?.refresh_token, 'refresh-token');
    // A gateway refusal is not proof that the provider deleted the session.
    failureStatus = 403;
    await assert.rejects(revokeSession(client));
    assert.equal((await client.getSession()).data.session?.refresh_token, 'refresh-token');
    connected = true;
    await revokeSession(client);
    assert.ok(revocations >= 1);
    assert.equal((await client.getSession()).data.session, null);
    assert.equal(await storage.getItem('logout-test'), null);
  } finally {
    await client.dispose();
  }
});

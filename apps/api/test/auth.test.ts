import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';
import { SupabaseTokenVerifier } from '../src/auth.js';
import type { SessionAuthority } from '../src/auth.js';
import { ApiError, unauthenticated, unavailable } from '../src/api-errors.js';

const secret = 'local-test-signing-secret-at-least-32-characters';
const key = new TextEncoder().encode(secret);
const issuer = 'http://127.0.0.1:9999';
const id = randomUUID();
const sessionId = randomUUID();
const validClaims = (): JWTPayload => ({
  sub: id,
  session_id: sessionId,
  email: 'rider@example.test',
  role: 'authenticated',
  is_anonymous: false,
  aud: 'authenticated',
  iss: issuer,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 300,
  user_metadata: { display_name: '  Mira  ' },
});
const signed = (claims: JWTPayload, signingKey = key, algorithm = 'HS256') =>
  new SignJWT(claims).setProtectedHeader({ alg: algorithm }).sign(signingKey);
const isCode = (status: number, code: string) => (error: unknown) =>
  error instanceof ApiError && error.status === status && error.code === code;

test('valid JWTs require a fresh provider session and never trust editable verification metadata', async () => {
  let calls = 0;
  let active = true;
  const sessions: SessionAuthority = {
    assertActive: async (account) => {
      calls += 1;
      assert.equal(account.id, id);
      assert.equal(account.sessionId, sessionId);
      if (!active) throw unauthenticated();
    },
    close: async () => undefined,
  };
  const verifier = new SupabaseTokenVerifier(
    { url: issuer, databaseUrl: 'unused', jwtSecret: secret },
    sessions,
  );
  const token = await signed(validClaims());
  const account = await verifier.verify(`Bearer ${token}`);
  assert.equal(account.initialDisplayName, 'Mira');
  assert.equal(calls, 1);
  await verifier.verify(`Bearer ${token}`);
  assert.equal(calls, 2);
  active = false;
  await assert.rejects(verifier.verify(`Bearer ${token}`), isCode(401, 'UNAUTHENTICATED'));
  const selfVerified = await signed({ ...validClaims(), user_metadata: { email_verified: true } });
  await assert.rejects(verifier.verify(`Bearer ${selfVerified}`), isCode(401, 'UNAUTHENTICATED'));
  assert.equal(calls, 4);
});

test('invalid signatures, expired tokens, invalid identities and unexpected claims never reach session lookup', async () => {
  let calls = 0;
  const verifier = new SupabaseTokenVerifier(
    { url: issuer, databaseUrl: 'unused', jwtSecret: secret },
    {
      assertActive: async () => {
        calls += 1;
      },
      close: async () => undefined,
    },
  );
  const invalidClaims: JWTPayload[] = [
    { ...validClaims(), iss: 'https://another-provider.test/auth/v1' },
    { ...validClaims(), aud: 'anon' },
    { ...validClaims(), exp: Math.floor(Date.now() / 1000) - 1 },
    { ...validClaims(), exp: undefined },
    { ...validClaims(), iat: Math.floor(Date.now() / 1000) + 600 },
    { ...validClaims(), sub: 'not-a-uuid' },
    { ...validClaims(), session_id: 'not-a-session' },
    { ...validClaims(), session_id: undefined },
    { ...validClaims(), email: '' },
    { ...validClaims(), role: 'service_role' },
    { ...validClaims(), is_anonymous: true },
  ];
  for (const claims of invalidClaims) {
    await assert.rejects(
      verifier.verify(`Bearer ${await signed(claims)}`),
      isCode(401, 'UNAUTHENTICATED'),
    );
  }
  const wrongSignature = await signed(
    validClaims(),
    new TextEncoder().encode('another-secret-at-least-32-characters-long'),
  );
  await assert.rejects(verifier.verify(`Bearer ${wrongSignature}`), isCode(401, 'UNAUTHENTICATED'));
  const wrongAlgorithm = await signed(validClaims(), key, 'HS384');
  await assert.rejects(verifier.verify(`Bearer ${wrongAlgorithm}`), isCode(401, 'UNAUTHENTICATED'));
  for (const header of [
    undefined,
    '',
    'Bearer no-token',
    'Basic password',
    'Bearer one.two.three',
    `Bearer ${'x'.repeat(17000)}.b.c`,
  ]) {
    await assert.rejects(verifier.verify(header), isCode(401, 'UNAUTHENTICATED'));
  }
  assert.equal(calls, 0);
});

test('session outages fail closed and expiry is checked again before a pending command commits', async () => {
  const verifier = new SupabaseTokenVerifier(
    { url: issuer, databaseUrl: 'unused', jwtSecret: secret },
    {
      assertActive: async () => {
        throw unavailable();
      },
      close: async () => undefined,
    },
  );
  await assert.rejects(
    verifier.verify(`Bearer ${await signed(validClaims())}`),
    isCode(503, 'TEMPORARILY_UNAVAILABLE'),
  );
  await assert.rejects(
    verifier.assertActive({ id, sessionId, initialDisplayName: 'Mira', expiresAt: 1 }),
    isCode(401, 'UNAUTHENTICATED'),
  );
});

test('asymmetric tokens use the configured JWKS endpoint and reject shared-secret tokens', async (t) => {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url!);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/auth/v1`;
  const verifier = new SupabaseTokenVerifier(
    { url, databaseUrl: 'unused' },
    {
      assertActive: async () => undefined,
      close: async () => undefined,
    },
  );
  const token = await new SignJWT({ ...validClaims(), iss: url })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .sign(privateKey);
  assert.equal((await verifier.verify(`Bearer ${token}`)).id, id);
  assert.deepEqual(paths, ['/auth/v1/.well-known/jwks.json']);
  await assert.rejects(
    verifier.verify(`Bearer ${await signed({ ...validClaims(), iss: url })}`),
    isCode(401, 'UNAUTHENTICATED'),
  );
});

test('key-provider outages and malformed key sets preserve retryable service errors', async (t) => {
  const { privateKey } = await generateKeyPair('ES256');
  let mode = 'unavailable';
  const server = createServer((_request, response) => {
    response.writeHead(mode === 'unavailable' ? 503 : 200, { 'Content-Type': 'application/json' });
    response.end(
      mode === 'malformed' ? 'not-json' : mode === 'invalid-keys' ? '{"keys":false}' : '{}',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/auth/v1`;
  const token = await new SignJWT({ ...validClaims(), iss: url })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .sign(privateKey);
  for (mode of ['unavailable', 'malformed', 'invalid-keys']) {
    const verifier = new SupabaseTokenVerifier(
      { url, databaseUrl: 'unused' },
      {
        assertActive: async () => {
          assert.fail('Unverified tokens cannot reach the session lookup.');
        },
        close: async () => undefined,
      },
    );
    await assert.rejects(
      verifier.verify(`Bearer ${token}`),
      isCode(503, 'TEMPORARILY_UNAVAILABLE'),
    );
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config.js';

const valid = { DATABASE_URL: 'postgresql://ridr_api:local@127.0.0.1:5432/ridr' };

test('configuration uses bounded local defaults', () => {
  assert.deepEqual(readConfig(valid), {
    environment: 'development',
    host: '127.0.0.1',
    port: 3000,
    databaseUrl: valid.DATABASE_URL,
    corsOrigins: [],
    rideLimits: { accountPerMinute: 30, ipPerMinute: 120 },
  });
});

test('accepts explicit runtime settings and deduplicates exact origins', () => {
  const config = readConfig({
    ...valid,
    NODE_ENV: 'test',
    API_HOST: '0.0.0.0',
    API_PORT: '3001',
    CORS_ORIGINS: 'http://localhost:8081, https://test.example,http://localhost:8081',
  });
  assert.equal(config.port, 3001);
  assert.equal(config.host, '0.0.0.0');
  assert.deepEqual(config.corsOrigins, ['http://localhost:8081', 'https://test.example']);
});

test('rejects invalid ports, wildcard origins, and ambiguous configuration', () => {
  for (const port of ['0', '65536', '-1', '3000.5', '1e3', '']) {
    assert.throws(() => readConfig({ ...valid, API_PORT: port }), /API_PORT/);
  }
  for (const origin of ['*', 'http://localhost:8081/', 'https://site.test/path', 'null']) {
    assert.throws(() => readConfig({ ...valid, CORS_ORIGINS: origin }), /CORS_ORIGINS/);
  }
  assert.throws(() => readConfig({ ...valid, NODE_ENV: 'staging' }), /NODE_ENV/);
  assert.throws(() => readConfig({ ...valid, API_HOST: 'localhost/path' }), /API_HOST/);
  for (const limit of ['0', '-1', '1.5', '1e3', '10001', '']) {
    assert.throws(
      () => readConfig({ ...valid, INVITE_ACCOUNT_PER_MINUTE: limit }),
      /INVITE_ACCOUNT_PER_MINUTE/,
    );
    assert.throws(
      () => readConfig({ ...valid, INVITE_IP_PER_MINUTE: limit }),
      /INVITE_IP_PER_MINUTE/,
    );
  }
});

test('rejects missing or invalid database URLs without including secrets in errors', () => {
  for (const url of [undefined, '', 'https://secret@example.test/ridr', 'postgres://host/ridr']) {
    assert.throws(
      () => readConfig({ DATABASE_URL: url }),
      (error: unknown) =>
        error instanceof Error &&
        /DATABASE_URL/.test(error.message) &&
        !error.message.includes('secret'),
    );
  }
});

test('auth configuration is optional but complete when enabled, with shared secrets forbidden in production', () => {
  const local = {
    ...valid,
    SUPABASE_AUTH_URL: 'http://127.0.0.1:9999',
    AUTH_DATABASE_URL: 'postgresql://ridr_sessions:local@127.0.0.1:5432/ridr',
    SUPABASE_JWT_SECRET: 'test-secret-containing-at-least-32-characters',
  };
  assert.deepEqual(readConfig(local).auth, {
    url: local.SUPABASE_AUTH_URL,
    databaseUrl: local.AUTH_DATABASE_URL,
    jwtSecret: local.SUPABASE_JWT_SECRET,
  });
  assert.deepEqual(
    readConfig({
      ...valid,
      NODE_ENV: 'production',
      SUPABASE_AUTH_URL: 'https://example.supabase.co/auth/v1',
      AUTH_DATABASE_URL: local.AUTH_DATABASE_URL,
    }).auth,
    { url: 'https://example.supabase.co/auth/v1', databaseUrl: local.AUTH_DATABASE_URL },
  );
  assert.throws(() => readConfig({ ...local, NODE_ENV: 'production' }), /SUPABASE_AUTH_URL/);
  assert.throws(
    () =>
      readConfig({
        ...local,
        SUPABASE_AUTH_URL: 'https://example.supabase.co/auth/v1',
        NODE_ENV: 'production',
      }),
    /SUPABASE_JWT_SECRET/,
  );
  assert.throws(
    () => readConfig({ ...local, SUPABASE_JWT_SECRET: 'short' }),
    /SUPABASE_JWT_SECRET/,
  );
  assert.throws(() => readConfig({ ...local, AUTH_DATABASE_URL: undefined }), /AUTH_DATABASE_URL/);
  assert.throws(() => readConfig({ ...local, SUPABASE_AUTH_URL: undefined }), /SUPABASE_AUTH_URL/);
  for (const url of [
    'http://remote.test/auth/v1',
    'https://example.test/auth/v1/',
    'https://secret@example.test/auth/v1',
    'https://example.test/auth/v1?key=secret',
  ]) {
    assert.throws(() => readConfig({ ...local, SUPABASE_AUTH_URL: url }), /SUPABASE_AUTH_URL/);
  }
});

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

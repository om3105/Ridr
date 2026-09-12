import assert from 'node:assert/strict';
import { test } from 'node:test';
import { io } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { PostgresHealth } from '../src/database-health.js';
import type { DatabaseHealth, Readiness } from '../src/database-health.js';
import { OperationalLogger } from '../src/logging.js';

const config = readConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://ridr_api:test@127.0.0.1:1/ridr',
  CORS_ORIGINS: 'http://localhost:8081',
});

const healthy: Readiness = {
  status: 'ok',
  service: 'ridr-api',
  checks: { database: 'up', schema: 'up', postgis: 'up' },
};

test('HTTP health, CORS, safe request logs, and real-time transport work together', async (t) => {
  const lines: string[] = [];
  let readiness = healthy;
  let closed = false;
  const database: DatabaseHealth = {
    check: async () => readiness,
    close: async () => {
      closed = true;
    },
  };
  const app = await createApp(config, { database, logSink: (line) => lines.push(line) });
  t.after(async () => {
    await app.close();
    assert.equal(closed, true);
  });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();

  const live = await fetch(`${url}/v1/health/live?token=private-query`, {
    headers: { Authorization: 'Bearer private-token', Origin: 'http://localhost:8081' },
  });
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: 'ok', service: 'ridr-api' });
  assert.equal(live.headers.get('access-control-allow-origin'), 'http://localhost:8081');
  assert.equal(live.headers.get('cache-control'), 'no-store');
  assert.match(live.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);

  const ready = await fetch(`${url}/v1/health/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), healthy);

  readiness = {
    status: 'unavailable',
    service: 'ridr-api',
    checks: { database: 'down', schema: 'unknown', postgis: 'unknown' },
  };
  const unavailable = await fetch(`${url}/v1/health/ready`);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), readiness);
  assert.equal((await fetch(`${url}/v1/health/live`)).status, 200);

  const deniedOrigin = await fetch(`${url}/v1/health/live`, {
    headers: { Origin: 'https://unknown.test' },
  });
  assert.equal(deniedOrigin.headers.get('access-control-allow-origin'), null);
  assert.equal((await fetch(`${url}/v1/private-token`)).status, 404);
  assert.ok(lines.some((line) => line.includes('http_request')));
  assert.ok(
    lines.every((line) => !line.includes('private-token') && !line.includes('private-query')),
  );

  const socket = io(`${url}/health`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 2000,
  });
  t.after(() => socket.close());
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const reply: unknown = await socket.timeout(2000).emitWithAck('health.ping');
  assert.deepEqual(reply, { status: 'ok', service: 'ridr-api' });
  socket.close();
});

test('a refused PostgreSQL connection makes readiness unavailable without leaking credentials', async () => {
  const lines: string[] = [];
  const health = new PostgresHealth(
    config.databaseUrl,
    new OperationalLogger((line) => lines.push(line)),
  );
  try {
    assert.deepEqual(await health.check(), {
      status: 'unavailable',
      service: 'ridr-api',
      checks: { database: 'down', schema: 'unknown', postgis: 'unknown' },
    });
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]!).event, 'database_readiness_failed');
    assert.ok(!lines[0]!.includes(config.databaseUrl));
  } finally {
    await health.close();
  }
});

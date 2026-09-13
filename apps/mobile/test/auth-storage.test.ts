import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChunkedStorage, createMemoryStorage, type StringStorage } from '../src/auth/storage';

function secureFixture() {
  const values = new Map<string, string>();
  let failChunkWrite = false;
  let generation = 0;
  const underlying: StringStorage = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      if (failChunkWrite && key.endsWith('.1')) throw new Error('Keychain unavailable');
      assert.ok(Buffer.byteLength(value, 'utf8') <= 1500);
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
  return {
    values,
    store: createChunkedStorage(underlying, () => `generation-${++generation}`),
    failWrite: () => {
      failChunkWrite = true;
    },
  };
}

test('large sessions with multibyte names round-trip through bounded secure items and replace old chunks', async () => {
  const fixture = secureFixture();
  const session = JSON.stringify({ token: 'x'.repeat(6500), name: 'किरण🚲'.repeat(300) });
  await fixture.store.setItem('session', session);
  assert.equal(await fixture.store.getItem('session'), session);
  await fixture.store.setItem('session', 'new-token');
  assert.equal(await fixture.store.getItem('session'), 'new-token');
  assert.equal(fixture.values.size, 2);
  await fixture.store.removeItem('session');
  assert.equal(await fixture.store.getItem('session'), null);
  assert.equal(fixture.values.size, 0);
});

test('failed secure writes and missing parts cannot restore old or partial credentials', async () => {
  const fixture = secureFixture();
  await fixture.store.setItem('session', 'old-token');
  fixture.failWrite();
  await assert.rejects(
    fixture.store.setItem('session', 'x'.repeat(4000)),
    /could not be saved securely/,
  );
  assert.equal(await fixture.store.getItem('session'), null);
  assert.equal(fixture.values.size, 0);
  const missing = secureFixture();
  await missing.store.setItem('session', 'x'.repeat(4000));
  missing.values.delete('session.generation-1.1');
  assert.equal(await missing.store.getItem('session'), null);
  assert.equal(missing.values.size, 0);
});

test('concurrent refresh then logout leaves no session; browser storage is not durable', async () => {
  const fixture = secureFixture();
  await Promise.all([
    fixture.store.setItem('session', 'a'.repeat(4000)),
    fixture.store.setItem('session', 'new'),
    fixture.store.removeItem('session'),
  ]);
  assert.equal(await fixture.store.getItem('session'), null);
  const firstTab = createMemoryStorage();
  await firstTab.setItem('session', 'secret');
  assert.equal(await firstTab.getItem('session'), 'secret');
  assert.equal(await createMemoryStorage().getItem('session'), null);
});

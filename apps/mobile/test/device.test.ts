import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canCollect,
  DIAGNOSTIC_DURATION_MS,
  mapTilerStyle,
  permissionLabel,
  sampleEvidence,
} from '../src/device/policy';
import { proveEncryptedDatabase, type ProofDatabase } from '../src/device/encryption-proof';
import { sampleMapStyle } from '../src/device/sample-map';

const consent = { startedAt: 1_000, expiresAt: 1_000 + DIAGNOSTIC_DURATION_MS, background: false };

test('location requires current explicit consent, a bounded window and the applicable permissions', () => {
  assert.equal(canCollect(null, 2_000, true, true), false);
  assert.equal(canCollect(consent, 2_000, false, true), false);
  assert.equal(canCollect(consent, 2_000, true, false), true);
  assert.equal(canCollect({ ...consent, background: true }, 2_000, true, false), false);
  assert.equal(canCollect({ ...consent, background: true }, 2_000, true, true), true);
  assert.equal(canCollect(consent, consent.expiresAt, true, true), false);
  assert.equal(canCollect(consent, consent.startedAt - 1, true, true), false);
  assert.equal(
    canCollect({ ...consent, expiresAt: consent.expiresAt + 1 }, 2_000, true, true),
    false,
  );
});

test('diagnostic evidence excludes coordinates and rejects stale, future and expired batches', () => {
  const sample = {
    timestamp: 2_000,
    coords: { latitude: 18.52, longitude: 73.85, accuracy: 5.1, altitude: 600, speed: 4 },
  };
  assert.deepEqual(sampleEvidence(sample, consent, 2_100, true), {
    capturedAt: 2_000,
    receivedAt: 2_100,
    inBackground: true,
    accuracyMetres: 5,
  });
  assert.equal(sampleEvidence({ ...sample, timestamp: 900 }, consent, 2_100, false), null);
  assert.equal(sampleEvidence({ ...sample, timestamp: 2_101 }, consent, 2_100, false), null);
  assert.equal(sampleEvidence(sample, consent, consent.expiresAt, false), null);
  assert.equal(sampleEvidence({ ...sample, timestamp: Number.NaN }, consent, 2_100, false), null);
  assert.equal(
    sampleEvidence({ timestamp: 2_000, coords: { accuracy: -1 } }, consent, 2_100, false)
      ?.accuracyMetres,
    null,
  );
});

test('denied permissions point to settings without claiming access and map keys cannot inject a URL', () => {
  assert.equal(
    permissionLabel({ granted: false, status: 'denied', canAskAgain: false }),
    'Enable in phone settings',
  );
  assert.equal(
    permissionLabel({ granted: false, status: 'undetermined', canAskAgain: true }),
    'Not requested',
  );
  assert.equal(mapTilerStyle(undefined), null);
  assert.equal(mapTilerStyle('your-maptiler-key'), null);
  assert.equal(mapTilerStyle('key&redirect=https://example.com'), null);
  assert.equal(
    mapTilerStyle('abcDEF1234567890'),
    'https://api.maptiler.com/maps/streets-v2/style.json?key=abcDEF1234567890',
  );
  const serialized = JSON.stringify(sampleMapStyle);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('http://'), false);
  assert.equal(sampleMapStyle.layers.length > 0, true);
});

function proofHarness({ cipher = true, wrongKeyReadable = false, reopenValue = 5 } = {}) {
  let opens = 0;
  let closes = 0;
  const writes: string[] = [];
  const key = 'a'.repeat(64);
  const open = async (): Promise<ProofDatabase> => {
    const connection = ++opens;
    let suppliedKey = '';
    return {
      async execAsync(sql) {
        if (sql.startsWith('PRAGMA key')) suppliedKey = sql;
        else writes.push(sql);
      },
      async getFirstAsync<T>(sql: string): Promise<T | null> {
        if (sql === 'PRAGMA cipher_version')
          return (cipher ? { cipher_version: '4.7.0' } : null) as T | null;
        if (!suppliedKey.includes(key) && !wrongKeyReadable)
          throw new Error('file is not a database');
        return { value: connection === 3 ? reopenValue : 5 } as T;
      },
      async closeAsync() {
        closes += 1;
      },
    };
  };
  return { open, key, writes, connections: () => ({ opens, closes }) };
}

test('encryption proof requires SQLCipher before writing and closes failed connections', async () => {
  const harness = proofHarness({ cipher: false });
  await assert.rejects(
    proveEncryptedDatabase(harness.open, harness.key),
    /Encrypted storage is unavailable/,
  );
  assert.deepEqual(harness.writes, []);
  assert.deepEqual(harness.connections(), { opens: 1, closes: 1 });
});

test('encryption proof fails closed when an incorrect key reads data', async () => {
  const harness = proofHarness({ wrongKeyReadable: true });
  await assert.rejects(proveEncryptedDatabase(harness.open, harness.key), /did not reject/);
  assert.deepEqual(harness.connections(), { opens: 2, closes: 2 });
});

test('encryption proof requires durable reopen and three isolated connections', async () => {
  const success = proofHarness();
  await proveEncryptedDatabase(success.open, success.key);
  assert.deepEqual(success.connections(), { opens: 3, closes: 3 });
  const failure = proofHarness({ reopenValue: 0 });
  await assert.rejects(proveEncryptedDatabase(failure.open, failure.key), /could not be reopened/);
  assert.deepEqual(failure.connections(), { opens: 3, closes: 3 });
});

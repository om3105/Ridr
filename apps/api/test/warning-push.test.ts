import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { openPush, sealPush, validPushToken, pushMessage } from '../src/warning-push.js';
import { sosPushMessage } from '../src/sos-push.js';
test('push registration encryption authenticates its device and ciphertext', () => {
  const key = randomBytes(32),
    device = randomUUID(),
    registration = {
      token: 'ExpoPushToken[abcdefghijklmnopqrstuv]',
      account: {
        id: randomUUID(),
        sessionId: randomUUID(),
        initialDisplayName: 'Private name',
        expiresAt: 2000000000,
      },
    };
  const sealed = sealPush(registration, key, device);
  assert.deepEqual(openPush(sealed, key, device), registration);
  assert.equal(sealed.includes(Buffer.from(registration.token)), false);
  assert.throws(() => openPush(sealed, key, randomUUID()));
  assert.throws(() => openPush(sealed, randomBytes(32), device));
  sealed[sealed.length - 1]! ^= 1;
  assert.throws(() => openPush(sealed, key, device));
});
test('push tokens are bounded and previews contain no member names or positions', () => {
  assert.equal(validPushToken('ExpoPushToken[abcdefghijklmnopqrstuv]'), true);
  assert.equal(validPushToken('not-a-token'), false);
  assert.equal(validPushToken('ExpoPushToken[' + 'x'.repeat(201) + ']'), false);
  assert.deepEqual(Object.keys(pushMessage('token', 'ride', 'warning').data), [
    'rideId',
    'warningId',
  ]);
  assert.equal(pushMessage('token', 'ride', 'warning').ttl, 30);
});
test('SOS push carries only a ride and event pointer, not member identity or location', () => {
  const message = sosPushMessage('token', randomUUID(), randomUUID());
  assert.deepEqual(Object.keys(message.data), ['kind', 'rideId', 'sosId']);
  assert.equal(message.channelId, 'ride-sos');
  assert.equal(JSON.stringify(message).includes('Private name'), false);
});

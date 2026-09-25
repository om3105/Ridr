import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { getMessageReceipts, parseChatMessage, type Draft } from '../src/chat/api';
import { draftRecovery } from '../src/chat/recovery';

const rideId = randomUUID();
const now = new Date().toISOString();
test('chat parser preserves pin coordinates and original capture time', () => {
  const message = {
    id: randomUUID(),
    rideId,
    sequence: 10,
    authorMemberId: randomUUID(),
    authorName: 'Rider',
    kind: 'pin',
    text: 'At this turn',
    preset: null,
    mediaId: null,
    durationSeconds: null,
    coordinate: { lat: 18.52, lon: 73.85 },
    capturedAt: now,
    acceptedAt: new Date(Date.parse(now) + 1000).toISOString(),
  };
  assert.deepEqual(parseChatMessage(message, rideId), message);
  assert.throws(() => parseChatMessage(message, randomUUID()));
  assert.throws(() =>
    parseChatMessage({ ...message, coordinate: { lat: 91, lon: 73.85 } }, rideId),
  );
  assert.throws(() => parseChatMessage({ ...message, sequence: -1 }, rideId));
});
test('preset messages parse with a named code and no coordinate', () => {
  const message = {
    id: randomUUID(),
    rideId,
    sequence: 11,
    authorMemberId: randomUUID(),
    authorName: 'Pillion',
    kind: 'preset',
    text: 'Need a stop',
    preset: 'need_stop',
    mediaId: null,
    durationSeconds: null,
    coordinate: null,
    capturedAt: now,
    acceptedAt: now,
  };
  assert.deepEqual(parseChatMessage(message, rideId), message);
  assert.throws(() => parseChatMessage({ ...message, preset: 'unknown' }, rideId));
});
test('voice messages require a private media identity and bounded duration', () => {
  const voice = {
    id: randomUUID(),
    rideId,
    sequence: 12,
    authorMemberId: randomUUID(),
    authorName: 'Rider',
    kind: 'voice',
    text: 'Voice note',
    preset: null,
    mediaId: randomUUID(),
    durationSeconds: 4.2,
    coordinate: null,
    capturedAt: now,
    acceptedAt: now,
  };
  assert.deepEqual(parseChatMessage(voice, rideId), voice);
  assert.throws(() => parseChatMessage({ ...voice, durationSeconds: 31 }, rideId));
  assert.throws(() => parseChatMessage({ ...voice, mediaId: null }, rideId));
});
test('pending drafts retry only during an active ride and within 24 hours', () => {
  const draft: Draft = {
    v: 1,
    type: 'message.text',
    id: randomUUID(),
    rideId,
    capturedAt: now,
    payload: { text: 'Meet here', motion: { state: 'stopped', source: 'speed', observedAt: now } },
  };
  assert.equal(draftRecovery(draft, true, Date.parse(now) + 1000), 'retry');
  assert.equal(draftRecovery(draft, false, Date.parse(now) + 1000), 'unsent');
  assert.equal(draftRecovery(draft, true, Date.parse(now) + 86400001), 'unsent');
  assert.equal(draftRecovery({ ...draft, capturedAt: 'invalid' }, true, Date.now()), 'unsent');
});
test('receipt lookup keeps stable IDs and rejects unexpected acceptance', async () => {
  const acceptedId = randomUUID();
  const missingId = randomUUID();
  const options = {
    apiUrl: 'https://api.example.test',
    accessToken: 'test-token',
    userId: randomUUID(),
    fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
      assert.equal(init?.method, 'POST');
      assert.equal(init?.headers && (init.headers as Record<string, string>)['Idempotency-Key'], undefined);
      assert.deepEqual(JSON.parse(String(init?.body)), { ids: [acceptedId, missingId] });
      return Response.json({ data: { accepted: [acceptedId] }, requestId: randomUUID() });
    },
  };
  assert.deepEqual(await getMessageReceipts(options, rideId, [acceptedId, missingId]), [acceptedId]);
  assert.throws(() => getMessageReceipts(options, rideId, ['bad-id']));
  assert.throws(() => getMessageReceipts(options, 'bad-ride', [acceptedId]));
  await assert.rejects(
    getMessageReceipts(
      { ...options, fetcher: async () => Response.json({ data: { accepted: [randomUUID()] }, requestId: randomUUID() }) },
      rideId,
      [acceptedId, missingId],
    ),
  );
});

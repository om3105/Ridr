import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { parseChatMessage, type Draft } from '../src/chat/api';
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

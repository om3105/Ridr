import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { parseMessage } from '../src/messages.js';

const now = new Date().toISOString();
const base = () => ({
  v: 1,
  type: 'message.text',
  id: randomUUID(),
  rideId: randomUUID(),
  capturedAt: now,
  payload: {
    text: '  Meeting at the stop  ',
    motion: { state: 'stopped', source: 'speed', observedAt: now },
  },
});
test('message parser preserves original text and canonical identity', () => {
  const value = base();
  assert.equal(parseMessage(value).payload.text, value.payload.text);
  assert.equal(parseMessage(value).id, value.id);
  assert.equal(
    parseMessage({
      ...value,
      type: 'message.pin',
      payload: { ...value.payload, coordinate: { lat: 18.52, lon: 73.85 } },
    }).payload.coordinate?.lat,
    18.52,
  );
});
test('message parser rejects moving, oversized, malformed and extra fields', () => {
  const value = base();
  for (const changed of [
    { ...value, payload: { ...value.payload, text: ' ' } },
    { ...value, payload: { ...value.payload, text: 'x'.repeat(1001) } },
    {
      ...value,
      payload: { ...value.payload, motion: { ...value.payload.motion, state: 'moving' } },
    },
    { ...value, payload: { ...value.payload, coordinate: { lat: 18.52, lon: 73.85 } } },
    {
      ...value,
      type: 'message.pin',
      payload: { ...value.payload, coordinate: { lat: 91, lon: 73 } },
    },
    { ...value, senderMemberId: randomUUID() },
  ])
    assert.throws(() => parseMessage(changed));
});

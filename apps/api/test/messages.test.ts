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
  const parsed = parseMessage(value);
  assert.equal(parsed.type, 'message.text');
  if (parsed.type !== 'message.text') throw new Error('Wrong message type');
  assert.equal(parsed.payload.text, value.payload.text);
  assert.equal(parseMessage(value).id, value.id);
  const pin = parseMessage({
    ...value,
    type: 'message.pin',
    payload: { ...value.payload, coordinate: { lat: 18.52, lon: 73.85 } },
  });
  assert.equal(pin.type, 'message.pin');
  if (pin.type !== 'message.pin') throw new Error('Wrong message type');
  assert.equal(pin.payload.coordinate?.lat, 18.52);
});
test('preset parser accepts only named one-tap codes and no motion payload', () => {
  const value = { ...base(), type: 'message.preset', payload: { preset: 'car_back' } };
  const parsed = parseMessage(value);
  assert.equal(parsed.type, 'message.preset');
  if (parsed.type !== 'message.preset') throw new Error('Wrong message type');
  assert.equal(parsed.payload.preset, 'car_back');
  assert.throws(() => parseMessage({ ...value, payload: { preset: 'custom' } }));
  assert.throws(() => parseMessage({ ...value, payload: { preset: 'car_back', motion: {} } }));
});
test('voice event ID must match its private media ID', () => {
  const value = base();
  const voice = {
    ...value,
    type: 'message.voice',
    payload: { mediaId: value.id, motion: value.payload.motion },
  };
  assert.equal(parseMessage(voice).type, 'message.voice');
  assert.throws(() =>
    parseMessage({ ...voice, payload: { ...voice.payload, mediaId: randomUUID() } }),
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

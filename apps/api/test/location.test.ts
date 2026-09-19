import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { parseSample } from '../src/location.js';
const at = new Date().toISOString();
const sample = {
  v: 1,
  type: 'location.sample',
  id: randomUUID(),
  rideId: randomUUID(),
  capturedAt: at,
  payload: {
    consentEpoch: 1,
    position: { lat: 18.5, lon: 73.8, accuracyM: 10, recordedAt: at },
    speedKph: null,
    headingDegrees: null,
    batteryPercent: null,
  },
};
test('location samples reject identity injection, invalid numbers, dates and mismatched timestamps', () => {
  assert.deepEqual(parseSample(sample), sample);
  for (const changed of [
    null,
    { ...sample, userId: randomUUID() },
    { ...sample, capturedAt: '2026-02-30T00:00:00.000Z' },
    { ...sample, payload: { ...sample.payload, consentEpoch: 0 } },
    { ...sample, payload: { ...sample.payload, headingDegrees: 360 } },
    { ...sample, payload: { ...sample.payload, speedKph: NaN } },
    {
      ...sample,
      payload: {
        ...sample.payload,
        position: { ...sample.payload.position, recordedAt: '2020-01-01T00:00:00.000Z' },
      },
    },
    {
      ...sample,
      payload: { ...sample.payload, position: { ...sample.payload.position, lat: 91 } },
    },
  ])
    assert.throws(() => parseSample(changed));
});

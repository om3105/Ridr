import assert from 'node:assert/strict';
import { test } from 'node:test';
import { battery, straggler, type Detector, type Warning } from '../src/alert-machine.js';
const warning = (): Warning => ({
  id: 'test',
  kind: 'straggler',
  memberId: 'member',
  createdAt: new Date().toISOString(),
  position: { lat: 0, lon: 0, recordedAt: new Date().toISOString() },
  value: 500,
});
test('straggler persistence, threshold, recovery hysteresis and cooldown', () => {
  const state: Detector = { armed: true };
  let emitted = 0;
  const create = () => {
    emitted++;
    return warning();
  };
  straggler(state, 0, 499, 500, create);
  straggler(state, 1000, 500, 500, create);
  straggler(state, 30000, 500, 500, create);
  assert.equal(emitted, 0);
  straggler(state, 31000, 500, 500, create);
  assert.equal(emitted, 1);
  straggler(state, 40000, 700, 500, create);
  assert.equal(emitted, 1);
  straggler(state, 45000, 400, 500, create);
  straggler(state, 70000, 400, 500, create);
  assert.equal(state.armed, false);
  straggler(state, 75000, 400, 500, create);
  assert.equal(state.armed, true);
  straggler(state, 80000, 600, 500, create);
  straggler(state, 110000, 600, 500, create);
  assert.equal(emitted, 1);
  straggler(state, 140000, 600, 500, create);
  straggler(state, 151000, 600, 500, create);
  assert.equal(emitted, 2);
});
test('invalid data and missed observations break persistence and hide warnings', () => {
  const state: Detector = { armed: true };
  straggler(state, 0, 600, 500, warning);
  straggler(state, 20000, null, 500, warning);
  straggler(state, 30000, 600, 500, warning);
  straggler(state, 59000, 600, 500, warning);
  assert.equal(state.warning, undefined);
  straggler(state, 91000, 600, 500, warning);
  assert.equal(state.warning, undefined);
  straggler(state, 121000, 600, 500, warning);
  assert.ok(state.warning);
  straggler(state, 122000, null, 500, warning);
  assert.equal(state.warning, undefined);
  assert.equal(state.armed, false);
});
test('battery needs a real crossing, ignores unknown/old data and re-arms above threshold plus five', () => {
  const state: Detector = { armed: true };
  let emitted = 0;
  const create = () => {
    emitted++;
    return warning();
  };
  battery(state, 0, null, 20, create);
  battery(state, 1000, 19, 20, create);
  assert.equal(emitted, 0);
  battery(state, 2000, 20, 20, create);
  battery(state, 3000, 19, 20, create);
  assert.equal(emitted, 1);
  battery(state, 3000, 18, 20, create);
  battery(state, 4000, 25, 20, create);
  battery(state, 5000, 19, 20, create);
  assert.equal(emitted, 1);
  battery(state, 6000, 26, 20, create);
  battery(state, 7000, 19, 20, create);
  assert.equal(emitted, 2);
  battery(state, 8000, null, 20, create);
  assert.equal(state.warning, undefined);
});
test('serialized detector state survives restart without duplicate emissions', () => {
  const state: Detector = { armed: true };
  straggler(state, 0, 600, 500, warning);
  straggler(state, 30000, 600, 500, warning);
  const restored = JSON.parse(JSON.stringify(state)) as Detector;
  straggler(restored, 35000, 700, 500, () => {
    throw Error('duplicate');
  });
  assert.equal(restored.warning?.id, 'test');
});

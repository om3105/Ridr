import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { projectGroup, newerSnapshot } from '../src/group-map/model';
import { parseSnapshot } from '../src/location/api';
import type { LocationSnapshot } from '../src/location/types';
function fixture(count = 3): LocationSnapshot {
  const members = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    displayName: `Person ${i}`,
    role: i === 1 ? ('pillion' as const) : ('rider' as const),
    sharingEnabled: true,
  }));
  const time = new Date().toISOString();
  return {
    rideId: randomUUID(),
    ownMemberId: members[0]!.id,
    members,
    pairs: [],
    serverTime: time,
    sequence: 10,
    items: members.map((member, i) => ({
      memberId: member.id,
      sampleId: randomUUID(),
      position: { lat: 18.52 + i * 0.001, lon: 73.85, accuracyM: 10, recordedAt: time },
      speedKph: null,
      headingDegrees: null,
      freshness: 'fresh',
    })),
  };
}
test('50-member snapshots validate and project without losing names or positions', (t) => {
  const snapshot = fixture(50),
    timings: number[] = [];
  for (let i = 0; i < 500; i++) {
    snapshot.items[49]!.position.lat = 18.52 + i * 0.00001;
    const start = performance.now();
    const group = projectGroup(
      parseSnapshot(snapshot, snapshot.rideId),
      Date.parse(snapshot.serverTime),
    );
    timings.push(performance.now() - start);
    assert.equal(group.data.features.length, 50);
    assert.equal(group.members.length, 50);
    assert.equal(group.data.features[49]!.properties.label, 'Person 49');
    assert.equal(
      group.data.features[49]!.geometry.coordinates[1],
      snapshot.items[49]!.position.lat,
    );
  }
  timings.sort((a, b) => a - b);
  t.diagnostic(
    `50-member parse + projection p95: ${timings[474]!.toFixed(3)} ms (Node only; not device rendering)`,
  );
});
test('paired marker never substitutes the pillion position for a missing or stale rider', () => {
  const snapshot = fixture();
  snapshot.pairs = [
    {
      id: randomUUID(),
      riderMemberId: snapshot.members[0]!.id,
      pillionMemberId: snapshot.members[1]!.id,
    },
  ];
  snapshot.items[0]!.freshness = 'stale';
  let group = projectGroup(snapshot, Date.parse(snapshot.serverTime));
  assert.equal(group.data.features.length, 2);
  assert.equal(group.data.features[0]!.properties.state, 'stale');
  assert.deepEqual(group.data.features[0]!.geometry.coordinates, [73.85, 18.52]);
  assert.match(group.data.features[0]!.properties.label, /pillion/);
  snapshot.members[0]!.sharingEnabled = false;
  group = projectGroup(snapshot, Date.parse(snapshot.serverTime));
  assert.equal(group.data.features.length, 1);
  assert.equal(group.members[0]!.state, 'sharing off');
  assert.ok(group.members[1]!.sample);
  snapshot.pairs = [];
  assert.equal(projectGroup(snapshot, Date.parse(snapshot.serverTime)).data.features.length, 2);
});
test('missing movement stays unknown; low accuracy, waiting, future and ageing states are explicit', () => {
  const snapshot = fixture();
  snapshot.items[0]!.speedKph = 0;
  snapshot.items[0]!.headingDegrees = 0;
  snapshot.items[1]!.position.accuracyM = 90;
  snapshot.items.pop();
  const now = Date.parse(snapshot.serverTime);
  const group = projectGroup(snapshot, now);
  assert.equal(group.members[0]!.speed, 0);
  assert.equal(group.members[0]!.heading, 0);
  assert.equal(group.members[1]!.state, 'low accuracy');
  assert.equal(group.members[1]!.speed, null);
  assert.equal(group.members[2]!.state, 'waiting for location');
  assert.equal(projectGroup(snapshot, now + 31000).members[0]!.speed, null);
  assert.equal(projectGroup(snapshot, now - 6000).members[0]!.state, 'stale');
});
test('parser rejects cross-ride, duplicate and hidden positions and normalizes invalid movement', () => {
  const snapshot = fixture();
  assert.throws(() => parseSnapshot(snapshot, randomUUID()));
  assert.throws(() =>
    parseSnapshot({ ...snapshot, members: [...snapshot.members, snapshot.members[0]] }),
  );
  assert.throws(() =>
    parseSnapshot({ ...snapshot, items: [...snapshot.items, snapshot.items[0]] }),
  );
  snapshot.items[0]!.speedKph = -1;
  snapshot.items[0]!.headingDegrees = 360;
  const parsed = parseSnapshot(snapshot);
  assert.equal(parsed.items[0]!.speedKph, null);
  assert.equal(parsed.items[0]!.headingDegrees, null);
  snapshot.members[0]!.sharingEnabled = false;
  assert.throws(() => parseSnapshot(snapshot));
});
test('new snapshots replace removed positions and delayed responses cannot restore them', () => {
  const old = fixture();
  const next = {
    ...old,
    items: [],
    sequence: 11,
    serverTime: new Date(Date.parse(old.serverTime) + 1000).toISOString(),
  };
  assert.equal(newerSnapshot(old, next), next);
  assert.equal(newerSnapshot(next, old), next);
  assert.equal(newerSnapshot(next, { ...old, rideId: randomUUID() }), next);
  assert.equal(newerSnapshot(null, next), next);
  assert.equal(projectGroup(next, Date.parse(next.serverTime)).data.features.length, 0);
});

test('warnings require an eligible member, unique ID and valid thresholds', () => {
  const snapshot = fixture();
  snapshot.alertSettings = { stragglerDistanceM: 500, batteryThreshold: 20 };
  snapshot.alerts = [
    {
      id: randomUUID(),
      memberId: snapshot.members[0]!.id,
      kind: 'battery',
      value: 19,
      createdAt: snapshot.serverTime,
      position: snapshot.items[0]!.position,
    },
  ];
  assert.equal(parseSnapshot(snapshot).alerts?.length, 1);
  assert.throws(() =>
    parseSnapshot({ ...snapshot, alerts: [...snapshot.alerts!, ...snapshot.alerts!] }),
  );
  assert.throws(() =>
    parseSnapshot({ ...snapshot, alerts: [{ ...snapshot.alerts![0], memberId: randomUUID() }] }),
  );
  assert.throws(() =>
    parseSnapshot({ ...snapshot, alerts: [{ ...snapshot.alerts![0], value: 101 }] }),
  );
  assert.throws(() =>
    parseSnapshot({
      ...snapshot,
      alertSettings: { stragglerDistanceM: 199, batteryThreshold: 20 },
    }),
  );
  assert.throws(() =>
    parseSnapshot({
      ...snapshot,
      alertSettings: { stragglerDistanceM: 500, batteryThreshold: 15 },
    }),
  );
});

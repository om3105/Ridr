import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { RouteProgress, distance, geographicCentre, groupGaps } from '../src/group-map/geometry';
import { parseTrail, trailGeometry, type TrailPoint } from '../src/group-map/trails';
import type { LocationSnapshot } from '../src/location/types';
const start = Date.parse('2026-09-20T00:00:00Z');
const point = (lat: number, lon: number) => ({ lat, lon });
function sample(lat: number, lon: number, seconds = 0): LocationSnapshot['items'][number] {
  return {
    memberId: randomUUID(),
    sampleId: randomUUID(),
    position: {
      lat,
      lon,
      accuracyM: 5,
      recordedAt: new Date(start + seconds * 1000).toISOString(),
    },
    speedKph: null,
    headingDegrees: null,
    freshness: 'fresh',
  };
}
test('ordered route progress produces signed along-route gaps and excludes a paired pillion', () => {
  const samples = [sample(0, 0.004), sample(0, 0.006), sample(1, 1), sample(0, 0.01)];
  const snapshot: LocationSnapshot = {
    rideId: randomUUID(),
    ownMemberId: samples[0]!.memberId,
    serverTime: new Date(start).toISOString(),
    sequence: 1,
    members: samples.map((s, i) => ({
      id: s.memberId,
      displayName: `Person ${i}`,
      role: i === 2 ? 'pillion' : 'rider',
      sharingEnabled: true,
    })),
    pairs: [],
    items: samples,
  };
  snapshot.pairs = [
    {
      id: randomUUID(),
      riderMemberId: samples[0]!.memberId,
      pillionMemberId: samples[2]!.memberId,
    },
  ];
  samples[3]!.freshness = 'stale';
  const result = groupGaps(
    snapshot,
    start,
    new RouteProgress([point(0, 0), point(0, 0.02)], start),
  );
  assert.equal(result.freshUnits, 2);
  assert.equal(result.excludedUnits, 1);
  assert.ok(Math.abs(result.details[0]!.routeGapM! + 111.2) < 1);
  assert.ok(Math.abs(result.details[1]!.routeGapM! - 111.2) < 1);
  assert.equal(result.details[2]!.routeGapM, result.details[0]!.routeGapM);
  assert.equal(result.details[3]!.centreDistanceM, null);
  samples[1]!.position.accuracyM = 51;
  assert.equal(groupGaps(snapshot, start, null).details[0]!.centreDistanceM, null);
  assert.equal(groupGaps(snapshot, start + 31000, null).freshUnits, 0);
});
test('loop progress preserves observed lap across origin; missing continuity never invents laps', () => {
  const route = new RouteProgress(
    [point(0, 0), point(0, 0.002), point(0.002, 0.002), point(0.002, 0), point(0, 0)],
    start,
  );
  assert.equal(route.loop, true);
  const id = randomUUID();
  const positions = [
    [0, 0],
    [0, 0.002],
    [0.002, 0.002],
    [0.002, 0],
    [0, 0],
    [0, 0.0002],
  ];
  let progress = 0;
  positions.forEach(([lat, lon], i) => {
    const next = route.update(id, sample(lat!, lon!, i * 5));
    assert.notEqual(next, null);
    assert.ok(next! >= progress);
    progress = next!;
  });
  assert.ok(progress > route.length);
  assert.equal(route.update(id, sample(0, 0.0003, 90)), null);
  assert.equal(
    new RouteProgress(
      [point(0, 0), point(0, 0.002), point(0.002, 0.002), point(0.002, 0), point(0, 0)],
      start,
    ).update(id, sample(0, 0.001, 100)),
    null,
  );
});
test('ambiguous crossings and off-route locations are unavailable; old observations cannot reset progress', () => {
  const route = new RouteProgress(
    [point(0, 0), point(0.002, 0.002), point(0, 0.002), point(0.002, 0)],
    start,
  );
  assert.equal(route.update('a', sample(0.001, 0.001)), null);
  assert.equal(route.update('a', sample(1, 1)), null);
  const line = new RouteProgress([point(0, 0), point(0, 0.02)], start);
  assert.ok(line.update('a', sample(0, 0.005, 10))! > 0);
  assert.equal(line.update('a', sample(0, 0.001, 5)), null);
});
test('geographic centroid handles longitude wrap and rejects antipodal ambiguity', () => {
  const centre = geographicCentre([point(0, 179.9), point(0, -179.9)])!;
  assert.ok(Math.abs(centre.lon) > 179.99);
  assert.ok(distance(centre, point(0, 179.9)) < 12000);
  assert.equal(geographicCentre([point(0, 0), point(0, 180)]), null);
});
function trailPoint(seconds: number, lon: number, epoch = 1, accuracyM = 5): TrailPoint {
  return {
    id: randomUUID(),
    capturedAt: new Date(start + seconds * 1000).toISOString(),
    lat: 0,
    lon,
    accuracyM,
    consentEpoch: epoch,
  };
}
test('trails sort late uploads, deduplicate IDs and never connect across outages or consent epochs', () => {
  const a = trailPoint(0, 0),
    b = trailPoint(5, 0.0001),
    c = trailPoint(60, 0.0002),
    d = trailPoint(65, 0.0003),
    e = trailPoint(70, 0.0004, 2),
    f = trailPoint(75, 0.0005, 2);
  const result = trailGeometry([d, b, a, c, b, f, e]);
  assert.equal(result.count, 6);
  assert.equal(result.breaks, 2);
  const lines = result.data.features.filter((feature) => feature.geometry.type === 'LineString');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0]!.geometry.coordinates, [
    [0, 0],
    [0.0001, 0],
  ]);
});
test('poor accuracy, equal-time observations and impossible jumps interrupt trails', () => {
  const points = [
    trailPoint(0, 0),
    trailPoint(5, 0.0001),
    trailPoint(10, 0.0002, 1, 100),
    trailPoint(15, 0.0003),
    trailPoint(20, 1),
    trailPoint(20, 2),
  ];
  const result = trailGeometry(points);
  assert.equal(result.breaks, 3);
  assert.equal(
    result.data.features.filter((feature) => feature.geometry.type === 'LineString').length,
    1,
  );
});
test('trail parsing rejects other members, excessive pages, duplicate samples and invalid coordinates', () => {
  const rideId = randomUUID(),
    memberId = randomUUID(),
    p = trailPoint(0, 0);
  const page = { rideId, memberId, points: [p], nextCursor: null };
  assert.equal(parseTrail(page, rideId, memberId), page);
  assert.throws(() => parseTrail(page, rideId, randomUUID()));
  assert.throws(() => parseTrail({ ...page, points: [p, p] }, rideId, memberId));
  assert.throws(() => parseTrail({ ...page, points: [{ ...p, lat: NaN }] }, rideId, memberId));
  assert.throws(() => parseTrail({ ...page, points: Array(201).fill(p) }, rideId, memberId));
});

test('an isolated valid observation remains visible without inventing a line', () => {
  const result = trailGeometry([trailPoint(0, 0)]);
  assert.equal(result.data.features.length, 1);
  assert.equal(result.data.features[0]!.geometry.type, 'Point');
  assert.equal(result.data.features[0]!.properties.kind, 'observation');
  assert.equal(result.breaks, 0);
});

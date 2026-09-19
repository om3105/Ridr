import assert from 'node:assert/strict';

for (const [profile, port] of [
  ['driving', 5001],
  ['cycling', 5002],
]) {
  const response = await fetch(
    `http://127.0.0.1:${port}/route/v1/driving/73.8553,18.5196;73.8730,18.5289?overview=full&geometries=geojson&radiuses=100;100`,
    { signal: AbortSignal.timeout(10000) },
  );
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.code, 'Ok');
  assert.equal(data.routes[0].geometry.type, 'LineString');
  assert.ok(data.routes[0].geometry.coordinates.length > 2);
  assert.ok(data.routes[0].distance > 1000);
  assert.ok(data.waypoints.every((point) => point.distance <= 100));
  const outside = await fetch(
    `http://127.0.0.1:${port}/route/v1/driving/0,0;0.01,0.01?radiuses=100;100`,
    { signal: AbortSignal.timeout(10000) },
  );
  assert.notEqual((await outside.json()).code, 'Ok');
  console.log(
    `Pune ${profile}: ${data.routes[0].distance} m, ${data.routes[0].geometry.coordinates.length} points; out-of-area request rejected.`,
  );
}

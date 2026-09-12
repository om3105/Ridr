import assert from 'node:assert/strict';

async function route(port) {
  const response = await fetch(
    `http://127.0.0.1:${port}/route/v1/driving/0,0;0.01,0.01?overview=false`,
    {
      signal: AbortSignal.timeout(5000),
    },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.code, 'Ok');
  assert.ok(body.routes[0].distance > 0);
  return body.routes[0];
}
const [driving, cycling] = await Promise.all([route(5001), route(5002)]);
assert.ok(driving.distance > cycling.distance * 1.2, 'Only cycling may use the diagonal shortcut');
console.log(
  `Routing profiles verified: driving ${driving.distance}m, cycling ${cycling.distance}m.`,
);

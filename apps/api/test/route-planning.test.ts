import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGpx, validatePoints, osrmRouter } from '../src/route-planning.js';
const gpx = (content: string) =>
  Buffer.from(
    `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${content}</trkseg></trk></gpx>`,
  );
const valid = '<trkpt lat="18" lon="73"/><trkpt lat="19" lon="74"/>';
test('GPX preserves point order and validates coordinates and continuous segments', () => {
  assert.deepEqual(parseGpx(gpx(valid), 'ride.GPX'), [
    { lat: 18, lon: 73 },
    { lat: 19, lon: 74 },
  ]);
  for (const text of [
    '',
    '<gpx>',
    '<gpx><rte/></gpx>',
    '<!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx>&x;</gpx>',
    '<gpx><rte><rtept lat="NaN" lon="0"/></rte></gpx>',
  ])
    assert.throws(() => parseGpx(Buffer.from(text), 'ride.gpx'));
  for (const text of [
    valid.replace('18', '91'),
    valid.replace('18', ''),
    valid + '</trkseg><trkseg>' + valid,
  ])
    assert.throws(() => parseGpx(gpx(text), 'ride.gpx'));
  assert.throws(() => parseGpx(gpx(valid), 'ride.xml'));
  assert.throws(() => parseGpx(Buffer.alloc(5 * 1024 * 1024 + 1), 'ride.gpx'));
  assert.throws(() => parseGpx(gpx(valid.repeat(5001)), 'ride.gpx'));
  assert.throws(() =>
    validatePoints([
      { lat: 1, lon: 2 },
      { lat: 1, lon: 2 },
    ]),
  );
  assert.throws(() =>
    validatePoints([
      { lat: 1, lon: 2 },
      { lat: Infinity, lon: 2 },
    ]),
  );
});
test('routing selects the prepared transport service and never falls back to straight lines', async () => {
  const urls: string[] = [];
  const router = osrmRouter(
    { driving: 'http://localhost:5001', cycling: 'http://localhost:5002' },
    async (input) => {
      urls.push(String(input));
      return Response.json({
        code: 'Ok',
        routes: [
          {
            geometry: {
              type: 'LineString',
              coordinates: [
                [73, 18],
                [74, 19],
              ],
            },
          },
        ],
      });
    },
  );
  const points = [
    { lat: 18, lon: 73 },
    { lat: 19, lon: 74 },
  ];
  assert.deepEqual(await router(points, 'cycling'), points);
  await router(points, 'driving');
  assert.ok(urls[0]!.startsWith('http://localhost:5002/'));
  assert.ok(urls[1]!.startsWith('http://localhost:5001/'));
  for (const response of [
    Response.json({ code: 'NoRoute' }),
    new Response('bad'),
    Response.json({
      code: 'Ok',
      routes: [
        {
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [181, 1],
            ],
          },
        },
      ],
    }),
  ]) {
    await assert.rejects(
      osrmRouter({ driving: 'http://localhost:5001' }, async () => response)(points, 'driving'),
    );
  }
  await assert.rejects(osrmRouter({})(points, 'cycling'));
});

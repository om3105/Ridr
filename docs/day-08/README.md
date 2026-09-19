# Day 8 — Route planning

## Plan

1. Validate GPX (5 MB, 2–10,000 points, no DTD/entities or disconnected segments).
2. Add authorized route reads and atomic, revision-checked Lobby saves; use the existing stationary guard.
3. Resolve drawn waypoints through separate cycling/driving OSRM services outside database transactions, then recheck authority before saving.
4. Add native map drawing, GPX file selection, route direction and member viewing.
5. Test parsing, provider failures, authorization, stale revisions and lifecycle races; run builds and document evidence.

Existing physical-device and simulator checks remain waived. This milestone does not implement live tracking or navigation.

## Implemented behavior

Open **Your rides → a ride → View or plan the route**. While stopped, the Lobby
leader can select one UTF-8 GPX file or tap 2–25 map waypoints in travel order.
The native map shows saved geometry, start/finish labels and direction arrows.
Waypoints are a draft; the old route stays visible until the replacement succeeds.
Cycling uses the bicycle profile; car and motorcycle use the driving profile.
GPX geometry is preserved, not snapped to roads or represented as recorded travel.

GPX supports one `rte` or one `trk/trkseg`, 2–10,000 points and at most 5 MiB.
Multiple/disconnected segments are rejected with export guidance, rather than
fabricating connections. Empty, malformed XML, DTDs/entities, invalid coordinates,
over-limit inputs and wrong extensions are rejected. The raw file is not retained
on the server. The app removes its selected cache copy when discarded, saved or
unmounted; the original document is unchanged.

Only a current stationary leader may save in Lobby. Drafts retain the revision seen when editing began; background refresh cannot silently rebase a replacement. Route revisions use
`If-None-Match: *` for creation or `If-Match` for replacement, with command receipts
for exact retries. Routing is outside the database transaction; the final save
rechecks membership, leadership, state, stopped evidence and revision under the
same ride lock used for starting and transferring leadership. A save increments
the ride revision too. Failed routing/validation never replaces the saved route.

Current members read the route in Lobby or Active. The screen refreshes every five
seconds while foregrounded and clears inaccessible content. Historical access is
part of the later history milestone. Web has a labelled route diagram; interactive
street-map drawing remains native, and its motion checks fail closed where device
speed is unavailable. Unconfirmed saves can be retried with their original command;
this in-screen draft is not a durable offline queue.

## Pune routing setup

Pune coverage is the rectangle **73.68–74.05° E, 18.38–18.70° N**, including nearby
suburbs. This is not all of Pune district. Roads crossing its boundary and necessary
restriction references are retained. Routes outside the extract fail; there is no
straight-line fallback. Map tiles still need internet. These local routing services
do not provide live traffic, navigation instructions or a claim that roads are safe.

The source is [Geofabrik's Western Zone](https://download.geofabrik.de/asia/india/western-zone.html),
using [OpenStreetMap data](https://www.openstreetmap.org/copyright). The optional
Python crop tool requires `osmium==4.2.0`; use an isolated environment. Generated
extracts and provenance are ignored under `data/routing/pune/`.

```sh
mkdir -p data/routing/pune
python3 -m venv tmp/routing-python
tmp/routing-python/bin/pip install osmium==4.2.0
curl -fL https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf \
  -o data/routing/pune/western-zone.osm.pbf
tmp/routing-python/bin/python scripts/crop-pune.py \
  data/routing/pune/western-zone.osm.pbf data/routing/pune/pune.osm.pbf
docker compose -f compose.yaml -f compose.pune.yaml --profile routing stop routing-driving routing-cycling
npm run routing:pune:prepare
npm run routing:pune:up
npm run test:routing:pune
```

Stop the two routing containers before rebuilding an existing dataset. Preparation
uses separate OSRM `car.lua` and `bicycle.lua` profiles. Both services use OSRM's
`/route/v1/driving` URL segment because routing mode is established by the prepared
dataset, not by that URL label. The API explicitly selects the appropriate service.

Add the following to the root `.env`, then restart the API:

```dotenv
ROUTING_DRIVING_URL=http://127.0.0.1:5001
ROUTING_CYCLING_URL=http://127.0.0.1:5002
```

`npm run routing:prepare`, `routing:up` and `test:routing` still refer to the original
synthetic fixture. Use the Pune commands for real roads. Do not run the synthetic
routing check against the Pune services.

The mobile app now includes a native document picker, so an old installed APK
must be rebuilt before using GPX selection. This milestone exports bundles; it does
not claim that the previous Day 7 APK contains Day 8 features.

## Verification

September 19, 2026:

- API: 23 tests passed, including multipart imports, oversize rejection, malformed
  GPX, missing revision headers, profile selection and provider failures.
- Mobile: 60 tests passed, including multipart boundaries, preserved retry identity,
  route response validation and actionable errors.
- PostgreSQL management suite: 14 scenarios plus parent passed (15 tests), including
  route permissions, unchanged geometry after failures, competing saves and a ride
  start while routing is pending.
- Pune extract prepared successfully: 97,096 road ways and 141 turn restrictions.
  The local smoke journey returned driving 2,587.8 m / 93 geometry points and cycling
  2,706.2 m / 128 geometry points; both profiles rejected an out-of-area request.
- Workspace lint/type checks and API build passed; Android, iOS and web exports passed.
- Physical-device/simulator UI, picker and map execution remain unverified under
  the owner's waiver. Hosted Auth/deployment and later-day features remain deferred.

The first integration attempt found the local database stopped; after starting it,
the suite passed. The upload HTTP test found an overly tight multipart part limit;
the corrected limit now accepts the three legitimate parts and still rejects
extra fields/files. Public Overpass downloads returned HTTP 406 and 429, so setup
uses the downloadable regional extract instead.

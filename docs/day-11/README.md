# Day 11 — gap indicators and breadcrumb trails

Implementation covers FR-LOC-03 and FR-LOC-05. Day 12 straggler alerts are not included. The owner's physical-device/simulator waiver remains in effect; automated checks do not establish native rendering or production latency.

## Using it

Open an active ride to see each person's route gap relative to the median of matched reporting units, and their separately labelled straight-line distance to the geographic group centre. The header reports fresh, excluded and route-matched unit counts. A rider/pillion pair counts once using the rider's position; the pillion's gap details explicitly refer to that unit.

Choose **View this person's recorded trail** in member details. The native map shows blue recorded segments, isolated blue observations and amber interruption points. Each person, including a paired pillion, has a separate trail. Use **Fit group**, **Refresh latest trail** or **Load older samples**. Own trails remain available through ride controls after leaving or ending a ride. No new location permission or sharing consent is requested by these views.

The endpoint returns the latest 200 observations per page. Older pages load on demand up to 2,000 displayed observations. Live sample notifications trigger a refresh, and a 15-second fallback refresh replaces loaded pages to remove deleted/private data and include late uploads. Older pages are therefore temporary, as explained on screen. Empty, denied and failed requests have visible states; background, blur and live access loss clear private cached trail data. The web build provides a native-map notice; Android/iOS provide interactive maps.

## Calculation rules

- GPS eligibility: accuracy at most 50 m, sample age at most 30 seconds, and no timestamp more than five seconds ahead of server time. Stale, inaccurate and non-sharing units are excluded. With fewer than two eligible units, group-centre distance is unavailable; fewer than two reliably matched units means route ordering is unavailable.
- Centroid: average unit positions on the unit sphere, then convert back to latitude/longitude. This handles longitude wrap. A geographically ambiguous antipodal centre is unavailable. Distances use a spherical Earth approximation and are labelled straight-line, never used to invent route order.
- Route matching: project onto saved, directed route segments inside a 50 m corridor; cumulative segment length supplies along-route progress. Competing branches within GPS uncertainty and substantially different progress are ambiguous unless prior continuous observations eliminate them. Heading alone never establishes route order.
- Loop continuity: a route ending within 20 m of its origin, with length over 100 m, is treated as a loop. An initial lap anchor requires an observation near the origin within 30 seconds of ride start. Subsequent observations unwrap progress across the origin. Gaps over 30 seconds, impossible movement, ambiguous branches or enough time for an unobserved half-loop invalidate continuity. A screen reopened mid-loop or after connection loss shows order unavailable instead of assuming a lap. No persistent or server-authoritative lap count is claimed.
- Movement continuity uses a conservative maximum 60 m/s plus reported positional uncertainty. This is a rejection bound, not inferred speed for display.
- Breadcrumbs: deduplicate sample IDs and order by capture timestamp plus ID. Join only accurate observations in the same consent epoch, separated by at most 30 seconds and plausible distance. Equal-time observations, poor GPS, consent changes, long gaps and jumps interrupt the line. There is no smoothing across missing data. New late samples can legitimately fill a prior gap on refresh.

## Trail API and privacy

`GET /v1/rides/:rideId/members/:memberId/trail?cursor=...` returns the standard envelope containing:

- `rideId`, `memberId`;
- `points`: at most 200 `{id,capturedAt,lat,lon,accuracyM,consentEpoch}` values, newest first;
- `nextCursor`: opaque continuation or `null`.

The cursor is bound to the requesting account, ride, member and applicable consent epoch. Ordering uses capture time with database microsecond precision plus sample ID, backed by the existing `sample_trail` index. This follows PostgreSQL's requirement for a [unique ordering when paginating](https://www.postgresql.org/docs/current/queries-limit.html).

Every page rechecks the provider session, account and membership in the existing transaction/lock order. Active viewers may read current sharing members' current consent epoch. A stopped member's trail is hidden from other live viewers. Own reads can include earlier consent epochs and earlier memberships belonging to that account. Ended rides and departed viewers permit only own-person trails. Outsiders, cross-ride/member identities, invalid cursors and unexpected query parameters are rejected.

Read-time filtering excludes expired samples, contributions from unavailable/deleted profiles, physically deleted samples, and all precise trails more than 90 days after ride end. This implements access and retention boundaries for this read path; it does not claim the later account-deletion workflow, scheduled erasure sweep or backup expiry work is complete. No migration, new dependency or hosted Supabase change is needed. Deploy the updated API before using the new trail UI.

## Verification — 2026-09-21

- API unit/HTTP/socket suite: 27 passed, including trail authentication and query validation.
- Mobile suite: 82 passed, including eight new gap/trail cases: paired centroid counting, signed route gaps, loop crossing and lost continuity, ambiguous crossing/off-route points, out-of-order observations, longitude wrap, interrupted/deduplicated trails, isolated observations and response validation.
- Local PostgreSQL management suite: 17 passed. New integration coverage spans 205 equal-timestamp samples across pages without duplicates; cursor account/member isolation; outsider, stopped, departed and ended-ride restrictions; revoked sessions; expired/deleted samples; and the 90-day read boundary.
- Lint, API/mobile type checks, API compilation and Android/iOS/web JavaScript exports passed. No fresh APK or native device/simulator run was performed.

Native map interactions, actual GPS route matching, live latency and the 50-member device frame/memory gate remain unverified under the owner's waiver. Field validation should exercise narrow parallel roads, intersections and loops; uncertain results remain unavailable. These are coordination estimates, not navigation or safety guarantees.

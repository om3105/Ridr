# Day 15 — integration and offline recovery

The Day 15 checkpoint covers multi-member location/chat and persistent offline
recovery. The implementation keeps the existing native encrypted queues and
adds two reconciliation safeguards:

- A restarted location queue confirms current server ride state after any
  pending privacy stop and before uploading saved history. If that check fails,
  samples remain queued. Historical samples never become current live position.
- Chat and quick presets check their stable pending IDs against a sender-only
  server receipt lookup before retry or before marking a draft **Unsent** when a
  ride has ended. This resolves a lost acknowledgement without reopening full
  chat access after an end or leave. A failed lookup leaves the local draft
  intact for the next attempt.
- A temporary account-service failure stops native location collection without
  erasing encrypted samples. The active ride map can reopen from an
  account-scoped, in-memory ride summary during an outage, with an explicit
  unconfirmed-state notice and access to saved quick messages. A cold start
  still requires account verification before ride tools open.

`POST /v1/rides/:rideId/message-receipts` takes `{ "ids": ["uuid", ...] }` with
at most 50 IDs. It requires a verified actor with a membership in that ride and
returns `{ "accepted": ["uuid", ...] }` only for messages authored by that
membership. It works after that member leaves or the ride ends. It never returns
message content or another sender's acceptance. Invalid shapes and IDs are
rejected. The private database schema and public Data API grants did not change.

## Verification — 2026-09-25

- Mobile tests: 89 passed. They include a virtual 10-minute, 120-sample outage
  with app-state restoration; privacy stop before replay; authoritative state
  before history; queue retention while the state check is offline; duplicate
  sample IDs, stale-position protection, capacity failure, and receipt response
  validation.
- API tests: 39 passed. HTTP checks reject malformed or oversized receipt
  lookups and unauthenticated requests.
- Local PostgreSQL management integration: 21 passed. Three current members
  share locations and ordered presets; delayed history cannot replace a newer
  live position, retries remain single events, and the receipt lookup reveals
  only the author's accepted IDs. Separate lifecycle checks cover remote end,
  former-member access, stale consent, and lost message acknowledgements.
- API and mobile type checks, API build, Android/iOS/web Expo export, and ESLint
  passed. These commands use the local development configuration. No hosted
  database was changed.

An Android phone and two verified local test accounts were used with an active
two-member ride. The phone sent live positions visible to the other member,
and displayed that member's accepted preset. A forced local API outage lasted
from 10:05:00 to 10:15:15 UTC. Restarting the app during that outage exposed
the temporary-profile-failure queue deletion fixed above; the first run did
not recover outage samples. Reopening a cached ride while offline also hid its
quick-message controls, which prompted the in-memory ride-summary fix.

A repeat outage began at 10:29:57 UTC. The phone saved one preset offline, but
the user asked to stop testing before the ten-minute window finished. The API
was restored at 10:35:58 UTC, and test location sharing was disabled on the
server and phone. The repeat was not used as evidence of timing or durable
recovery after restart.

The **device timing gate remains open** at the user's request. The corrected
build still needs a full uninterrupted ten-minute phone outage with an app
restart, followed by measured live-position, saved-history, and message
recovery. The Day 1 limits are 10 seconds for fresh position and 60 seconds
for saved history/text after a stable reconnect. Remote ride end, network
switching, and queue-capacity messaging also remain unmeasured on a device.

# Day 7 ride lifecycle and role permissions

Status: complete for the authorized Day 7 scope, with the device/simulator checks
skipped by the owner and later features preserved below. The plan was prepared
before implementation. Day 6 is the baseline; existing icon edits are unrelated
and remain outside this milestone.

## Implementation plan

1. Add transactional start, end, leave and stop-sharing controls. A start checks
   all participants and existing pair readiness before claiming Active membership.
   End, leave and stop never depend on a motion check.
2. Add five-minute role and leadership proposals, visible only to proposer and
   target. The target explicitly accepts. Recheck roles, membership, revisions
   and expiry in the acceptance transaction.
3. Add app controls and a brief foreground motion check using permitted speed
   observations. Never infer stationary state from a tap, a missing speed, or a
   denied permission. Preserve same-request retries after an uncertain response.
4. Test permissions, expiration, retry behavior, concurrent starts/joins and
   transfer/end races. Run final lint, type checks and builds after integration;
   review, make meaningful commits and push the completed milestone.

## Boundaries and acceptance

- Exactly one leader; former leaders lose authority after accepted transfer.
- Only Riders may accept leadership. A Pillion first accepts a Rider role change.
- Physical role changes invalidate affected pairing/readiness; Rider leadership
  transfer preserves a valid pair. No role change creates a pair.
- Fifty members maximum, one Active ride per account, atomic start with no partial
  claims, and no implicit location sharing.
- Stop sharing preserves membership and Active membership claims. Leave revokes
  access. A leader transfers authority or ends before leaving.
- End is authoritative and idempotent. It closes sharing/pairing, revokes invites
  and links, and records one event for later delivery and summary processing.
- Restricted actions use fresh sensor context. End/leave/stop remain available
  when motion is unknown or the device is moving.
- A minimal participant-only management response supports ended/departed status
  reconciliation without reopening private live member data.

Pairing/check-in screens, live location/socket delivery, durable offline queues
and summaries retain their later milestones. Day 7 validates existing pair
records and creates the necessary transactional events; it does not claim those
later features delivered. Hosted Supabase setup remains deferred. Device and
simulator checks remain skipped by owner instruction.

## Verification

Verification on September 16–17, 2026:

- Mobile: 56 tests passed, covering request validation, same-command retries,
  session boundaries, motion hysteresis and privacy-state reconciliation.
- API: 20 unit/HTTP tests passed, including all Day 7 routes and strict request
  parsing. The API build passed.
- Real PostgreSQL lifecycle suite: 12 scenarios plus the parent test passed
  (13 tests), covering atomic start/end, permissions, proposal expiry/cancellation,
  pair readiness and cleanup, contrary motion telemetry, consent epochs, competing
  starts, start/join capacity races, transfer/end races and revoked-session rollback.
- Existing ride integration suite: 8 scenarios plus the parent test passed
  (9 tests). Active invitation replacement now expects a motion restriction when
  context is absent, replacing Day 6's temporary state restriction.
- Workspace lint and type checks passed. iOS, Android and web bundle exports
  passed; these exports are not native device execution.
- Existing Day 3 reference-schema checks passed all 24 integrity cases; event and
  public-response examples, schema references and document-link checks passed.

Run the database suites with the local database started and migrated:

```sh
NODE_ENV=test npm run test:management --workspace @ridr/api
NODE_ENV=test npm run test:rides --workspace @ridr/api
```

The lifecycle suite is included in CI. Its fixtures use random identities and
remove only their own records. The initial database run required starting Docker.
A stop-time assertion was corrected to use the database clock so host/VM clock
skew does not mistakenly test the server's future-time cap. The final results
above include that correction.

Review fixed immediate local stopping during another request and pending-state
reconciliation after a lost or delayed response. Sensor behavior, native layout,
physical devices and simulator flows remain unverified under the owner's waiver.

## App behavior

Open a ride from **Your rides**. The leader can start a Lobby ride or cancel/end
the ride for everyone. Other members can leave. Everyone can stop their own
sharing without leaving, surrendering their role or breaking a pair. Start never
enables sharing; explicit location opt-in belongs to a later milestone.

**Check that I'm stopped** starts a bounded foreground speed observation after
location permission. Ten consecutive seconds below 3 km/h establish stopped;
five seconds above 6 km/h establish moving. Missing, stale or inaccurate readings
remain unknown. The check discards coordinates, expires shortly, and stops on
screen exit/backgrounding. Start, role proposals and acceptance require a fresh
check. Replacing an Active invitation performs its own check. End, leave, stop,
proposal cancellation and invitation revocation have no motion gate.

The leader can request a member's Rider/Pillion change or offer leadership to a
Rider. The named member accepts or declines; the proposer may cancel. Requests
expire after five minutes and become invalid when their ride/member revisions
change. A new request of the same kind for the same target replaces the previous
pending request. Sharing consent never transfers with a role.

The open ride screen refreshes management every five seconds while foregrounded.
It also refreshes on focus and after a command. Ended/departed status removes the
member list and invitation, stops local diagnostics, and reconciles pending
privacy actions. These are foreground reads, not a live location/socket system.

Stop, leave and end stop local collection immediately, even if another network
request is in progress. The screen reports pending confirmation honestly. A retry
retains the original command identity, consent epoch and capture time. Pending
privacy requests survive navigation in account-scoped memory, but not application
termination or account locking. Durable offline queues remain assigned to
Days 9–15 and 27; background global end delivery is not claimed here.

## API and data boundaries

The existing Day 3 tables support this milestone; no new migration or dependency
is needed. The [API contract](../day-03/api-contracts.md#ride-and-membership-operations)
records the management response and implemented sharing subset. Mutations
serialize the ride and participant records and recheck the account before commit.
Accepted end/leave/stop retries can reconcile after live access closes; start and
proposal retries still require current membership in a live ride.

Pairing/readiness fixtures verify the start guard and cleanup rules without
introducing pairing screens. Internal transactional events record lifecycle
changes for later delivery. No summary worker, push delivery or production
deployment is included.

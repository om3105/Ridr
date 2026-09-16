# Day 7 ride lifecycle and role permissions

Status: implementation in progress. This plan was prepared before implementation
and authorized by the owner. Day 6 is the baseline; existing icon edits are
unrelated and remain outside this milestone.

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

Results will be recorded here after the checks run.

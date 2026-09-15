# Day 6 ride creation and joining

Status: complete for the authorized Day 6 scope. The owner authorized this milestone after explicitly
skipping the remaining Day 5 simulator checks. Hosted Supabase configuration
remains deferred; development uses the verified local Auth service described in
the [Day 5 handoff](../day-05/README.md).

## Scope

Day 6 implements [FR-GRP-01 and FR-GRP-02](../day-01/backlog.md#ride-group-management):

- Create a named Lobby ride with transport, one leader and an invitation.
- Preview an invitation from a code, link or camera QR before explicit join.
- Choose Rider or Pillion; pillions are available only for motorcycle rides.
- Enforce invitation validity, duplicate protection, the 50-person limit and
  the one-active-ride rule in server transactions.
- Show current rides and lobby members; allow the leader to replace invitations.
- Keep location sharing off when creating, opening or joining a ride.

Ride start/end, role changes and leadership transfer remain Day 7. Live location,
pairing and readiness retain their later milestones. Simulator and physical
checks are skipped by owner instruction; they are not recorded as passing.

## App flow

After signing in, Home offers **Your rides**, **Create a ride** and **Join with
code, link or QR**. Creation opens a Lobby with the creator as Leader/Rider.
Invitation entry opens a preview, then requires an explicit Rider/Pillion choice
and a separate Join action. Existing members keep their current role and sharing
state when joining again; joining is not a role-change or consent operation.

The Lobby lists current members and shows the leader's new invitation as a code
and QR, with a native share action. Replacing or revoking an invitation leaves
existing members in the group. Your rides is paginated and refreshes on focus;
the Lobby refreshes on focus or on request. Live member updates remain a later
real-time milestone.

Codes accept case differences, spaces and hyphens. Links use `ridr://join?token=…`
or `ridr-dev://join?token=…` for a development build. Native incoming links are
stripped of credentials before entering navigation state. Browser users can paste
a code or link; camera scanning is native-only. Opening the scanner requests
camera access explicitly and does not request microphone access. Denial keeps
code/link entry available.

Invitations expire after 24 hours, or earlier on replacement, revocation or ride
end. Only hashes are stored in the database. Raw codes/links stay in app memory
and are sent in authenticated POST bodies, never request URLs or logs. Sign-out,
account change or loss of verified account access clears private ride state.
An app restart loses the raw invitation; the leader can explicitly replace it.

Creation/join/replacement/revocation preserve their request key after an
unconfirmed result, including when the screen loses focus. Retry recovers the
accepted result without repeating the change. Secret-creation receipts contain
only invitation metadata, so a lost creation/replacement response may require a
new explicit replacement to recover a shareable code.

## Implemented API

All paths below use `/v1`, verified bearer sessions and the existing response/error
envelopes. Every mutation uses a UUID `Idempotency-Key`. Preview is read-only.

| Method/path | Result |
| --- | --- |
| `POST /rides` | Named Lobby, leader membership and initial invitation |
| `POST /invites/preview` | Ride ID/name, transport, Lobby/Active state, roles and expiry |
| `POST /rides/{id}/join` | Current membership after invitation and capacity checks |
| `GET /rides` | Caller-only current Lobby/Active ride collection |
| `GET /rides/{id}` | Member-only `{ride,membership,members}` snapshot |
| `POST /rides/{id}/invites` | Lobby leader replaces invitation with `If-Match` revision |
| `DELETE /rides/{id}/invites/current` | Leader revokes invitations; no motion/revision gate |

The [Day 3 clarification](../day-03/api-contracts.md#ride-and-membership-operations)
records the implemented response additions and preserves later snapshot and
Active-ride motion requirements. Ride start/end, role changes, pairing, tracking
and chat have not been implemented by this milestone.

Transactions serialize same-key commands and joins, enforce the 50-person limit
and one Active ride per account, and recheck provider-session validity before
commit. Lobby membership does not claim an Active-ride slot. Tests create Active
fixtures directly to verify joining rules without implementing Day 7 start/end.
Nonmembers cannot read the Lobby; invitation preview reveals no member records.
Malformed, unknown, expired, revoked and ended invitations share one 404 error.

Creation, preview, join and replacement share configurable per-process limits:
30 attempts per account/minute and 120 per IP/minute. Revocation is exempt.
Responses include `Retry-After`. Express does not trust forwarded IP headers;
hosting behind a proxy or across replicas requires a reviewed proxy configuration
and a shared limiter before deployment.

## Run and verify

Use the existing [local Auth setup](../day-05/README.md#run-the-full-flow-locally),
then restart the API and mobile development server. Day 6 uses the existing
database schema; it introduces no migration. The new camera/SVG dependencies
require a rebuilt native development app when testing on a device. Expo Go does
not replace the project's custom native build.

```sh
npm ci
npm run lint
npm run typecheck
npm test
NODE_ENV=test npm run test:rides --workspace @ridr/api
npm run build
```

The ride integration suite requires the dedicated local database, running and
migrated. It creates uniquely identified fixtures, removes only those fixtures,
uses a test session verifier, and sends no provider requests or email. CI runs
it alongside the existing database, profile and Auth checks.

## Verification record

- API unit/HTTP suite: **19 passed**.
- Mobile unit suite: **40 passed**, including 19 new invitation/client/privacy checks.
- Real PostgreSQL ride suite: **8 scenarios passed** (9 Node tests including the parent).
  Covers creation/duplicate joins, role rules, concurrent cap/Active-ride claims,
  expiration/rotation/revocation, private reads, cursor boundaries, redacted
  receipts and session-revoked transaction rollback.
- Workspace lint and type checks: passed after fixing choice-input types and
  refreshing Expo's generated route declarations. The final affected-screen lint
  check also passed.
- API build and iOS/Android/web bundle exports: passed. Native compilation and
  device execution are separate from bundle export.

The initial sandboxed test attempt could not open local test sockets. Re-running
with local socket access passed. Review also corrected invitation error
consistency, invalid calendar dates in cursors, and loading/retry state after
screen changes. The verification results above reflect those fixes.

These checks do not establish camera scanning, native link delivery, share-sheet
behavior or device layout correctness. Physical-device and simulator checks were
skipped at the owner's request. Hosted Supabase setup remains deferred under
the Day 5 handoff; no production deployment was performed.

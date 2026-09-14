# Day 6 ride creation and joining

Status: in progress. The owner authorized this milestone after explicitly
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
checks are skipped by owner instruction; automated verification will be recorded
here as it is performed.

# Day 22 — ride history

1. Add a participant-only, keyset-paginated `GET /v1/history` index ordered by authoritative ride end time and ride ID. Bind cursors to the signed-in account, enforce the same 90-day retention for every account, and project each ride's own Day 21 metrics without group distance totals.
2. Make expired history distinguishable to its former participant without revealing ride existence to outsiders. Deleted or otherwise unavailable rides remain a generic not-found state. Keep the server as the source of truth; do not add a persistent device history cache.
3. Add a Home → History → Summary path with clear loading, empty, offline, expired and unavailable states. Keep in-memory rows scoped to the current account and clear them when a fresh request fails or the account changes.
4. Test ordering, pagination, cursor tampering/cross-account reuse, member isolation, late metrics, retention boundaries and client state. Run relevant API/mobile checks and build, review the diff, commit the server and app work separately, and document unmeasured device behavior.

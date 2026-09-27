# Day 20 — private status sharing

1. Implement owner-only creation, listing and revocation of bounded status links. Generate the bearer secret on the server, store only its hash, return it once, and make retries safe without recreating a lost URL.
2. Serve a minimal public projection through a bearer-token read. Recheck link expiry, revocation, active ride, current membership, location-sharing consent and account state on every request. Never include another member's data. Cap each no-cache display lease at 15 seconds.
3. Add an account-free browser viewer that keeps the token in memory, removes the URL fragment, renews before lease expiry and clears sensitive content on expiry, rejection, visibility changes or network failure. Add owner controls in the active ride for lifetime, sharing and revocation, including an explicit offline-pending state.
4. Exercise token tampering, cross-user access, repeat creation, expiry, stop-sharing, leave/end, revocation and viewer lease behavior. Run relevant database, API, mobile, lint, type and build checks; document any device or hosted-environment evidence not actually measured.

The conditional crash detector remains disabled. Day 20 does not assert a device/sensor gate or release decision scheduled for Day 33.

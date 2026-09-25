# Day 18 — rest-stop and pillion tools

1. Implement an active-ride headcount round for the stationary leader. Each current pair shows pending or confirmed; each round starts fresh, and pairing or leadership changes invalidate affected confirmations.
2. Extend the existing QR challenge and receipt flow so a pair member can show a round-specific QR and only the current leader can scan it. Complete a round only after every current pair has a fresh server-confirmed scan.
3. Add a simple rest-stop screen with pair QR, leader scanner, progress, and explicit completion. Keep offline and stale results pending.
4. Foreground the existing pillion presets on the active map. Keep text, pin, and voice composition subject to existing stationary restrictions. Manual SOS remains Day 19 work.
5. Add a separately owned, encrypted emergency-contact record with strict name/phone validation, revision checks, owner-only read/write/delete, and a profile screen. No contact information enters ride/member responses or messages.
6. Test the critical database, HTTP, client, privacy and retry paths; run lint, type checks, and builds; review and commit the Day 18 work.

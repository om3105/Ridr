# Day 17 — pillion readiness

1. Add a current-pair readiness read that shows each member only their own pair and gives the leader the current ready/pending pair list.
2. Add single-use, five-minute pair scan challenges and receipts for readiness. Validate current pair membership, roles, motion, pair identity, and receipt ownership without exposing raw tokens in storage or URLs.
3. Let the pillion attest their own helmet and readiness from a valid receipt. Preserve the existing start gate and invalidate confirmation on unpair, leave, or role change.
4. Add mobile QR scan and attestation controls, test the API and client against local PostgreSQL, run lint/type/build checks, review and commit only Day 17 files, then push.

Rest-stop headcount rounds remain Day 18 work. A QR scan records human confirmation; it does not verify helmet use automatically.

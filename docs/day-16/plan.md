# Day 16 — rider and pillion pairing

1. Add the short-lived, single-use QR invitation, preview, pair, and stationary unpair API using the existing consent and pair tables. Lock ride members and pair guards in one transaction; reject stale consent and conflicting roles without partial writes.
2. Add a mobile flow to show and scan the QR, preview the other rider, ask for explicit consent, and unpair. Keep tokens out of URLs and logs.
3. Show one rider-position marker with a passenger indicator and both names to current ride members. Preserve stale-position labeling and restore individual markers after unpairing.
4. Run relevant API/mobile tests, lint, type checks and builds; review the diff, document any device or service limits, then commit and push the verified milestone.

Day 17 readiness and Day 18 headcounts remain separate milestones. NFC is deferred by the requirements baseline.

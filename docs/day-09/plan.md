# Day 9 — live location sharing

Scope: FR-LOC-01 and the location portion of SUP-04. Day 10's group map and later messaging, proximity, SOS and history UI are not included.

1. Implement explicit sharing enable, device ownership, strict samples, consent interval checks, idempotent acknowledgements, chronological latest positions and authorized live delivery.
2. Add native location capture with foreground/background permission choices, default five-second cadence, encrypted durable queue, bounded retry and privacy-first recovery.
3. Add a sharing/status screen and connect local stop to stop sharing, leave, end and sign-out.
4. Exercise server authorization, consent, duplicate/reordered samples and recovery; run repository checks and builds; document limitations and commit verified changes.

Reuse existing location, consent, receipt and outbox tables. Keep GPS/provider calls outside database transactions. Device/simulator checks remain explicitly waived by the owner; builds and automated tests do not establish real-device background reliability.

# Day 10 — group map

Scope: FR-LOC-02 and the Day 10 portion of SUP-08. Reuse Day 9's consent and delivery services and the existing MapLibre/MapTiler setup.

1. Extend authorized location snapshots with ride identity, current member names/sharing states and existing pair relationships. Test outsider and departed access.
2. Build a pure map projection: individual/combined rider-pillion units, rider-only combined position, valid speed/heading, stale/low-accuracy/non-sharing/waiting states and chronological snapshot handling.
3. Make the active ride open on the group map. Include member details, fit group, refresh/retry and links to sharing and ride controls. Keep the map usable without GPS consent; never start tracking implicitly.
4. Exercise 50-member update processing, paired states, access loss/reconnect and data validation; run lint, type checks, tests and platform exports. Review, commit and push verified changes.

Pair creation, gap calculation, breadcrumb trails and straggler alerts stay in their scheduled milestones. Existing pair records can already render correctly.

The owner's physical-device/simulator waiver remains in effect. Automated 50-member projection timings are not a substitute for the physical 60-second pan/zoom, frame-time, control-latency and 30-minute memory gate in the Day 1 acceptance contract. Record that gate as unverified, not passed.

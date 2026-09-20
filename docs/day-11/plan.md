# Day 11 — gaps and breadcrumb trails

Scope: FR-LOC-03 and FR-LOC-05. Reuse Day 9's stored per-person samples and Day 10's authorized group map. Do not implement Day 12 alerts.

1. Add bounded, deterministic trail pages with membership checks, own-only ended/left access, 90-day ended-ride retention and deleted/expired-data exclusion. Current live viewers can inspect current sharing members; pillions retain their own samples.
2. Add tested geometry for route matching, ambiguous intersections, continuous loop progress, paired-unit geographic centroid and separately labelled straight-line distances. Exclude stale/low-accuracy/non-sharing units. Unproven loop laps or interrupted matching produce unavailable order.
3. Add gap details and a selected-member breadcrumb overlay, interrupted at missing data, poor GPS, implausible jumps or consent changes. Include refresh, older-page loading, empty/error states and own trail access after end/leave.
4. Verify geometry and access/privacy regressions, lint, types and platform exports; review incremental commits and push. Preserve unrelated local edits and the owner's physical-device/simulator waiver.

Conservative defaults: route-match corridor 50 m, ambiguous branches within GPS uncertainty are unavailable, continuity at most 30 seconds, and a 60 m/s maximum inferred travel rate. Loop lap counts require an observed start near the route origin within 30 seconds of ride start, then continuous evidence; reopening mid-loop cannot invent a lap count. Breadcrumbs join only valid observations at most 30 seconds apart within one consent epoch. No smoothing or interpolation across gaps.

# Day 12 — straggler and low-battery alerts

Scope: FR-LOC-04, FR-SAF-05 and their SUP-05 delivery support. Preserve Day 11 confidence gates and pair counting. Verify native behavior on an Android phone, Android emulator and iPhone 16 Pro iOS 18 simulator as requested for this milestone.

1. Reuse the tested route geometry on the server. Persist route continuity and alert state under the existing ride transaction lock, so retries, reconnects and API restarts do not manufacture new warnings.
2. Straggler: default 500 m behind matched group median continuously for 30 seconds; recovery within 80% for 30 seconds re-arms; minimum 120 seconds between alerts. Invalid/stale observations interrupt evidence. Current leader may set 200–2,000 m after a stationary check; changes invalidate pending/current warnings.
3. Battery: collect a known native battery percentage only with sharing; own threshold 10/20/30%, default20. Downward crossings emit once; above threshold+5 re-arms. Unknown or historical/replayed telemetry does not create live warnings.
4. Deliver current warnings with authenticated snapshots, stable event IDs and per-device acknowledgements. Configure opt-in generic push notifications where Expo project credentials are available; expose unavailable/denied/failed delivery honestly. No precise positions or names in lock-screen previews.
5. Add controls and warning views, test timing, privacy, restart/retry and boundary cases, run checks/builds and native device/simulator checks, review incremental commits and push. Record any required provider configuration and checks that could not be completed.

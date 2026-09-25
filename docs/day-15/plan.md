# Day 15 plan — multi-member location/chat and offline recovery

Day 15 is the integration gate in the Day 1 release plan. It covers existing
location and communication features, not the later safety or pairing milestones.

1. Recheck the Day 1 offline and multi-member acceptance rules against the
   current mobile queues and server behavior. Record reproducible gaps.
2. Add a bounded, sender-only acceptance lookup for queued chat IDs. Reconcile
   those IDs before classifying drafts after a ride ends or membership changes,
   while keeping full chat closed. Keep genuinely unsent drafts visible.
3. Exercise a 10-minute outage and app restart with multiple members, queued
   location and chat, retries, ordering, and remote ride end. Use deterministic
   client tests and the local database integration suite where each provides
   meaningful evidence.
4. Run mobile tests/typecheck/export and API tests/typecheck/build, inspect the
   changes, and commit only Day 15 work. Record any physical-device or timing
   evidence still missing without calling the gate passed prematurely.

The target from `docs/day-01/acceptance-and-release.md` is authoritative ride
state before replay, current position within 10 seconds and queued history/text
within 60 seconds after a stable reconnect, with no duplicates or position
regression. A deterministic test can verify ordering and identity, but cannot
establish radio/network latency or native background behavior.

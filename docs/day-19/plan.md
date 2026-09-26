# Day 19 — manual SOS

1. Add a durable, ride-scoped SOS API using the existing event ID and device registration. An active member may send without a motion, map, tracking, or notification prerequisite. Capture the reporter, device, permitted last position, and pair at the original event time; keep both reporters' events when a pair sends twice.
2. Make acceptance idempotent and queryable by event ID. Keep unaccepted requests distinct from accepted ones, and require reconciliation and an explicit fresh decision after the 60-second send window. Preserve an accepted event even when the ride or pairing changes.
3. Add authorized current-member SOS reads, per-device receipt recording, reporter-only “I'm okay,” and leader-only coordination closure. Resolution must remain visible and must not erase or claim human safety. Reuse the ride sequence signal for foreground refresh, with a separate minimal background push hint.
4. Add an always-reachable one-tap SOS action to the active map and chat, an immediate local status screen, encrypted pending-event persistence, and reconnect/retry handling. Show paired names, reporting source, last permitted location and age, server acceptance, and device acknowledgements without claiming everyone saw the alert.
5. Verify API authorization, idempotency, privacy, pairing changes, concurrent reporters, offline and lost-ACK recovery, resolution, client state, and the existing checks. Review, commit coherent backend and mobile changes, and hand over any physical-device delivery measurements still needed.

Automatic crash detection and external status sharing remain later milestones.

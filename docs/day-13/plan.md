# Day 13 — text and pinned ride messages

Scope: FR-COM-01 and FR-COM-03. Quick presets and voice notes remain Day 14.

1. Add an authoritative, ordered active-ride message write/read path using the existing private `ridr.messages` table, ride transaction lock, event receipts and outbox. Validate text length, coordinates, original timestamp and a fresh stationary motion check. Exclude former members and ended rides from live access.
2. Add a bounded chat history API and a realtime invalidation signal. Keep capture time separate from server acceptance/sequence, and make retries with the same event ID idempotent.
3. Add the native ride chat screen. All roles can read; pillions open composition via an explicit secondary action. Text and pinned-message composition require a stationary check. Pin coordinates are selected deliberately and shown distinctly from rider positions on the group map.
4. Persist pending sends in encrypted local storage, reconcile on reconnect, show pending/accepted/failed/unsent states, and never replay an ended-ride draft as live chat.
5. Test parser, authorization, retry, ordering, lifecycle, queue recovery and UI data handling. Run repository checks/builds, review the diff and commit coherent steps. Record native-device limitations truthfully.

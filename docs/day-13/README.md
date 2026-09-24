# Day 13 — ride chat and message pins

Day 13 implements FR-COM-01 and FR-COM-03 for active rides. Current members can read ordered text and pin messages with the author's name, original capture time and server acceptance time. A sender must complete a fresh stationary check before opening a 1–1,000-character send. Pillions use the separate **Write a message** action. The API validates the same stationary proof and rejects contradictory movement telemetry; a UI shortcut cannot bypass it.

Messages use one stable ID for network retries. The server commits a message, ride sequence and outbox event together. Members who leave, outsiders and ended rides cannot access live chat. On Android and iOS, pending drafts live in a bounded SQLCipher queue keyed through SecureStore. Reconnection retries only while the ride is active and the original capture is within 24 hours. An ended or expired draft is marked **Unsent**, never posted as live chat. Failed sends remain visible for manual review and retry. Signing out or switching accounts erases the local queue. The web preview keeps drafts only in memory.

Tap a coordinate on the active group map and choose **Write at this pin**. Accepted message pins appear as purple markers, distinct from rider status markers. A message's **View pin on group map** link centres that exact coordinate. Pins retain their original chosen coordinate and capture time through retry. Map and chat fetch accepted messages with sequence pagination; the socket sequence signal prompts a refresh, with polling as a fallback.

## Verification — 2026-09-25

- API tests and mobile tests passed. The management integration suite passed against local PostgreSQL in `NODE_ENV=test`, including idempotent retries, pagination, outsider/former-member denial and ended-ride denial.
- Type checks, lint and Android/iOS/web JavaScript export passed. These verify compiled code and bundles, not native UI interaction.
- A Day 13 phone or simulator chat interaction was not completed in this session. The Android phone was not connected, and the iOS simulator service was unavailable to the sandbox. A field check with two accounts and a real stationary/moving transition remains advisable before beta release.

Quick presets and voice notes remain Day 14. Chat remains a coordination feature, not an emergency channel.

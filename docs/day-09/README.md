# Day 9 — live location sharing

Day 9 implements explicit location sharing for active members, including Pillions, with native foreground/background capture, encrypted recovery and authorized delivery. The group map remains Day 10. See the [implementation plan](plan.md).

## Try it

1. Run the existing local database, Auth and API setup from the root README. Use a native development build on a phone that can reach the API/Auth addresses; Expo Go and the browser cannot capture background locations or use this encrypted queue.
2. Create/join a ride and start it using the Day 7 controls.
3. Open **Location sharing & live status** from the ride. Choose foreground sharing or enable **Keep sharing when the screen is locked**, then press **I agree — start sharing** and grant the requested permission.
4. The default target interval is five seconds (the capture engine also respects ride settings of 10 or 15 seconds). The screen shows the encrypted queue count, last capture, last acknowledgement and freshness of authorized members' positions.
5. **Stop sharing now**, stop sharing from the ride, leave, end, or sign out stops local collection. Foreground-only sharing also stops when the app leaves the foreground. Stops do not depend on a stationary check.

No map markers are added by this milestone. Use another signed-in active member's sharing screen to see updates arrive. The revised permission descriptions require a new native build. A native APK was not rebuilt for this milestone; previous APKs do not contain these changes unless using the updated development bundle.

## Privacy and recovery

- Enable requires an active membership and its current revision. Consent epochs increase on enable/stop. Join/start never enables capture.
- The native queue uses SQLCipher with a SecureStore key, including a wrong-key/reopen check before use. Session tokens are refreshed through the existing auth client before recovery requests. The queue stores samples and pending enable/stop metadata; it does not store bearer tokens. Account switches rotate/erase local storage; sign-out confirms a pending stop before session revocation and clears the local queue.
- Samples are timestamped and rate-limited at capture. Missing/invalid fixes are not saved. Accuracy over 50 m is degraded; age over 30 seconds is stale. Unknown speed/heading is sent as null.
- Stop invalidates collection synchronously, including callbacks waiting on storage/network operations. The original cutoff and command ID survive retry. If enable is uncertain, recover its original receipt and then stop; never silently resume it.
- Restart retains the encrypted queue but stops the old consent before replay. The user must opt in again. A headless callback after OS termination stops the native task; it does not reconstruct an authenticated tracking session or silently renew consent.
- On reconnect, pending privacy requests precede location replay. Only the newest fresh sample can update the live position. Older queued samples go through the historical path, constrained to their original membership and consent interval, and never replace live positions.
- Queue retention is at most 24 hours, with a conservative 50 MB serialized-size ceiling and visible capacity failure. Retries use exponential jitter bounded at 30 seconds. Rejected historical samples are removed with a visible notice. Later history/retention administration remains in its planned milestone.
- Mobile OS scheduling is not a five-second guarantee. Missing callbacks become stale; server authorization failures stop capture. Offline capture can continue within existing consent until this phone learns of remote ride termination; post-termination samples are rejected by the server.

## Transport and database

No migration is needed: the existing private schema already has devices, sharing periods, samples, latest positions, command receipts and outbox events.

| Interface | Behavior |
| --- | --- |
| `PUT /v1/me/devices/:id` | Registers an owned iOS/Android device; `{platform}`; 204 response. Push tokens remain later scope. |
| `PUT /v1/rides/:id/sharing` | `{enabled:true}`, Idempotency-Key and If-Match membership revision; existing stop form remains supported. |
| `GET /v1/rides/:id/location-status` | Own current active/sharing/epoch state for recovery, including ended/left reconciliation. |
| `GET /v1/rides/:id/locations` | Active-member-only latest snapshot with server time, sequence and freshness. |
| `POST /v1/rides/:id/events` | `{event: location.sample}`, with `X-Device-Id`; ACK after transaction commit. |
| `POST /v1/history/:id/samples` | `{samples:[...]}`, 1–200 strict envelopes, `X-Device-Id`; per-item accepted/duplicate/rejected IDs. Own historical consent only. |
| Socket.IO `/v1/rides` | `auth.token` bearer value; subscribe with `{rideId,afterSequence}`; `location.snapshot` replaces the entire cached location list. Writes use `command` with `{event}` and `auth.deviceId`. |

The beta implementation uses complete authorized snapshots on subscribe/reconnect and at one-second server intervals, with HTTP refresh as fallback. It does not implement generic outbox replay or multi-instance fan-out in this milestone. A snapshot explicitly includes removals and recalculates freshness. Session expiry/revocation and membership are rechecked before every delivery; failures disconnect the stream. Deploy behind TLS. The mobile client uploads through the HTTP fallback and receives Socket.IO snapshots.

Sample identity, its request digest, sample row, latest ordering, sequence and outbox record commit together. A changed payload under the same ID conflicts; exact retries return the original sequence. Live ordering uses `(captured_at,id)`, and historical uploads never update `location_latest`. Outbox payloads hold IDs rather than coordinates. Location requests have a separate 120/minute account budget so GPS traffic cannot consume invitation controls' budget.

## Verification

Verified on 2026-09-20:

| Check | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed for API and mobile |
| API unit/HTTP/socket suite | 25 passed |
| Mobile suite | 69 passed, including 9 location recovery tests |
| Local PostgreSQL management integration | 16 passed |
| `npm run build` | API compiled; Android, iOS and web bundles exported |
| `git diff --check` | Passed |

Physical-device and simulator checks remain waived by the owner. Those waivers do not establish battery consumption, locked-screen cadence, native permission prompts, on-device SQLCipher behavior or 50-person production latency.

- API input and live socket tests: strict payloads, authorized delivery and disconnection after session revocation.
- PostgreSQL lifecycle/location integration: opt-in only after start, device ownership, Pillions, outsider isolation, duplicate/conflicting IDs, chronological latest position, future-clock rejection, stop/re-enable epochs, historical-only replay and remote end.
- Mobile queue tests: capture gating/cadence, stop during enable and registration, uncertain enables, lost ACK, ten-minute outage/restart, stale replay, remote end, storage failure, queue capacity and retry bounds.
- Repository lint, TypeScript checks, API compilation and Android/iOS/web JavaScript exports.

Auth restoration preserves the queue for the same initial account; actual account switches still erase it. This follows the distinction between initial restoration and later session events in [Supabase's auth event documentation](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).

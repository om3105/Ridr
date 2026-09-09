# Ridr prioritized implementation backlog

All items are **Planned**, not implemented or tested. Original `FR-*` IDs and titles are retained from the SRS. `SUP-*` items cover unnumbered requirements and necessary support. Delivery days refer to the existing 35-day plan; acceptance is checked during implementation and repeated in the release suite.

## Priorities and ownership

- **P0:** core ride/safety/access/recovery requirement; failure blocks the beta.
- **P1:** committed beta functionality; an unfinished item requires an explicit scope change and disclosure, not silent omission.
- **P2:** conditional or deferred functionality; its absence is documented and is not counted as SRS completion.
- **M:** mobile developer; **B:** backend developer; **Q:** QA; **P:** product owner. These are role assignments, not named staffing commitments. Q verifies every acceptance criterion; P owns release scope changes.

Dependency lists name prerequisite capabilities, not a requirement to finish every test before work can start. Shared contract/model work begins on Day 3. Criteria use the defaults and permissions in [scope and decisions](scope-and-decisions.md) and the measurements in [acceptance and release](acceptance-and-release.md).

## Ride group management

### FR-GRP-01 — Create ride group

**P0 · Included · Day 6 · M+B · Depends on SUP-01, SUP-02**

- A verified member creates a named ride with a transport type; the server returns a stable ride ID and shareable code/link with the creator as its single leader.
- Retrying the same creation request does not create duplicate rides. Invalid input returns field errors and no partial ride.
- Creation yields Lobby state and does not start location sharing. Invite rotation invalidates the previous invite.

### FR-GRP-02 — Join ride group

**P0 · Included · Day 6 · M+B · Depends on FR-GRP-01**

- Code entry, deep link, and camera QR each lead to a ride preview and explicit join action; all resolve to the same membership rules.
- Invalid, expired, revoked, ended-ride, and over-capacity invites fail without disclosing private ride data. Rejoining an existing membership is idempotent.
- Concurrent joins cannot exceed 50 members, including pillions. Joining another active ride is rejected until the current membership ends/leaves.
- Role selection is explicit on Lobby or Active join. Solo late riders do not need pillion check-in; late pairs must confirm readiness while stopped without restarting the group ride.

### FR-GRP-03 — Assign roles

**P0 · Included · Day 7 · M+B · Depends on FR-GRP-02, SUP-03**

- The server enforces leader/rider/pillion permissions on requests, real-time joins, and event writes; direct unauthorized API calls fail.
- Exactly one leader exists. Transfer requires acceptance and changes authority atomically; the old leader cannot keep leader privileges.
- Transfer targets an accepting Rider and changes the former leader to Rider, preserving valid rider pairing. A Pillion must first explicitly switch to Rider while stationary, clearing the former pairing/readiness.
- A role change cannot silently pair users, expose emergency contacts, or keep readiness from an invalidated pair. Moving restrictions apply.

### FR-GRP-04 — Route import/draw

**P1 · Included · Day 8 · M+B · Depends on FR-GRP-03, SUP-14**

- The leader can import a valid GPX or draw a route before start; every member sees the saved route and its direction.
- Oversized, malformed, empty, or invalid-coordinate files fail with an actionable error and do not replace a valid saved route.
- Non-leaders and active/ended-session route changes are rejected. Routing uses the selected cycling/driving profile; failed routing does not fabricate a route.

### FR-GRP-05 — End ride for group

**P0 · Included · Days 7 and 21 · M+B · Depends on FR-GRP-03, SUP-03, SUP-04**

- An authorized end request makes one authoritative server transition to Ended; repeating it is safe. All connected members receive that state and stop active sharing.
- Offline end shows pending state and stops local tracking without claiming group-wide completion. Reconnecting clients reconcile before queue replay.
- After acknowledged end, live writes and status-link reads fail; summaries are generated once with idempotent retries. Eligible historical uploads cannot reopen the session.

## Live location synchronization

### FR-LOC-01 — Live position broadcast

**P0 · Included · Day 9 · M+B · Depends on SUP-02, SUP-03, SUP-04**

- Each consenting active member, including a paired pillion, captures timestamped position/accuracy/speed/heading and broadcasts at the configured target interval, default 5 seconds.
- Updates reach authorized receivers within the online latency gate. Background/locked-screen, denied permission, and OS termination scenarios show accurate freshness/degraded states.
- Retry uses sample IDs and timestamps; old samples can extend a trail but cannot overwrite a newer live position. No samples are collected after local stop.

### FR-LOC-02 — Group map view

**P0 · Included · Day 10 · M+B · Depends on FR-LOC-01, SUP-14**

- The active screen defaults to a map showing every reporting member or combined paired unit, with speed/heading only when valid.
- Stale, low-accuracy, and non-sharing members have explicit states. Missing/invalid speed is not rendered as a confident zero.
- Fifty-member tests pass the map responsiveness gate; outsiders cannot fetch or subscribe to coordinates.

### FR-LOC-03 — Gap indicator

**P1 · Included · Day 11 · M+B · Depends on FR-GRP-04, FR-LOC-02**

- On a valid matched route, ahead/behind uses route progress and displays the corresponding along-route gap; a loop crossing preserves lap continuity.
- Distance to the centroid uses fresh reporting units and counts each paired unit once. The interface states when members are excluded.
- Missing route/match, stale samples, and a single reporting unit produce “unavailable” where appropriate, not misleading ordering. Straight-line distances are labelled separately.

### FR-LOC-04 — Straggler alert

**P1 · Included · Day 12 · M+B · Depends on FR-LOC-03, SUP-05**

- Falling behind the configured reference/threshold for the persistence period emits one group alert identifying the member/unit and latest eligible position.
- Tests cover threshold boundary, recovery, re-arming, cooldown, and one paired unit counted once. Invalid/stale GPS never triggers a confident straggler alert.
- Leader changes to the threshold while stationary propagate to members; reconnect does not replay an obsolete straggler warning as current.

### FR-LOC-05 — Breadcrumb trail

**P1 · Included · Day 11 · M+B · Depends on FR-LOC-01, SUP-04**

- Ordered valid samples produce a travelled path for each member, including separate pair-member trails in details.
- Missing-data spans are visibly interrupted or marked uncertain; smoothing cannot fabricate recorded travel across a gap.
- Duplicate/out-of-order uploads do not duplicate path segments. Ended-ride history obeys participant access, retention, and deletion.

## Communication

### FR-COM-01 — Group text chat

**P0 · Included · Day 13 · M+B · Depends on FR-GRP-03, SUP-04**

- Authorized members can send/receive text with author, original timestamp, and pending/accepted/failed delivery state; the stationary composer accepts at most 1,000 characters.
- Retries are deduplicated and chat history is ordered deterministically. Ended-session queued messages are marked unsent rather than replayed as live.
- Pillion composition is available through the secondary stationary action. Moving/unknown-speed restrictions cannot be bypassed through another composer entry point.

### FR-COM-02 — Quick preset alerts

**P0 · Included · Day 14 · M+B · Depends on FR-COM-01, SUP-06**

- “Stopping,” “Flat tire,” “Regrouping,” “Turn missed,” and “Car back” send with one tap from the active screen; pillion equivalents are available as specified in FR-PIL-05.
- Each tap immediately shows pending/accepted/offline status; retry cannot produce duplicate alerts. Presets remain reachable while moving.
- Icons have text labels and accessible names. No ad or keyboard obscures the preset/SOS controls.

### FR-COM-03 — Location-pinned messages

**P1 · Included · Day 13 · M+B · Depends on FR-COM-01, FR-LOC-02**

- A stationary member chooses a coordinate and attaches text; recipients can open the same coordinate in group map context.
- Invalid coordinates, unauthorized rides, and moving composition are rejected/blocked. Label message pins separately from live rider positions.
- Queued pins preserve their chosen coordinates and original timestamps without appearing as new live alerts after ride end.

### FR-COM-04 — Async voice notes

**P1 · Included · Day 14 · M+B · Depends on FR-COM-01, SUP-12**

- A stationary member grants microphone access and can record, preview, cancel, send, and play a voice note up to 30 seconds.
- Denied permission, interrupted recording, failed upload, and unavailable audio show clear recovery; canceled recording is not uploaded.
- Voice files are private to authorized participants, and retries do not duplicate messages. Recording controls are unavailable while moving.

## Pillion role and scanner

### FR-PIL-01 — Pillion pairing scanner

**P1 · Included via QR; NFC deferred · Day 16 · M+B · Depends on FR-GRP-03, SUP-06**

- A same-ride motorcycle rider and pillion scan a short-lived QR and both consent; one active pairing per person is enforced transactionally.
- Expired/reused QR, wrong-ride participants, non-motorcycle roles, self-pairing, and already-paired users are rejected without partial pairing.
- Either participant can unpair while stopped; leave/end invalidates the pair. Re-pairing requires fresh consent and resets readiness.

### FR-PIL-02 — Combined map marker

**P1 · Included · Day 16 · M+B · Depends on FR-PIL-01, FR-LOC-02**

- A pair appears as one rider-position marker with a passenger indicator and both identities inside authorized group details.
- A stale rider position remains visibly stale; a pillion position is never silently relabelled as the rider's position.
- Unpair restores two markers without dropping either history; pairing snapshots remain available for earlier emergency events.

### FR-PIL-03 — Pre-ride safety check-in

**P1 · Included · Day 17 · M+B · Depends on FR-PIL-01, SUP-03**

- Scan-based confirmation records pair ID, confirming person, time, helmet attestation, and readiness. The leader sees current ready/pending status for all pairs.
- Changing the pair/role invalidates the relevant confirmation. Only the participant can attest their readiness; a leader cannot silently set another member ready.
- The start action identifies outstanding paired check-ins and requires resolution, unpairing, or leaving. Late pairs complete their own stationary check-in without restarting the ride or invalidating others. Copy describes a member confirmation, not sensor-verified safety.

### FR-PIL-04 — Rest-stop headcount scanner

**P1 · Included · Day 18 · M+B · Depends on FR-PIL-03**

- A stationary leader starts a fresh headcount round and scans/confirms each current pair; progress shows ready/total pairs.
- Duplicate scans count once. Prior-round confirmations do not satisfy the new round; pairing changes invalidate affected readiness.
- Incomplete, stale, and offline results remain pending; the round cannot be marked complete until all current pairs are confirmed.

### FR-PIL-05 — Pillion preset access

**P1 · Included · Days 14 and 18 · M+B · Depends on FR-COM-02, FR-GRP-03**

- Pillion view foregrounds reading and one-tap “Need a stop,” “Uncomfortable pace,” and “Cold/Tired.” Stationary freeform composition remains available.
- Presets and SOS remain reachable in moving mode with a one-handed layout. Text/pin/voice composition follows the shared restrictions.
- A pillion cannot use their role to edit leader routes/settings or another member's emergency contact.

### FR-PIL-06 — Pillion emergency contact

**P1 · Included · Day 18 · M+B · Depends on SUP-01, SUP-07**

- A pillion can add/edit/remove a separately owned emergency-contact name and phone; international-format validation reports errors without saving partial data.
- Pairing does not copy, overwrite, or reveal the record to the rider, leader, group, or status-link viewer.
- Saving a contact sends no message or invitation. Account deletion removes the record under the deletion policy.

## Safety features

### FR-SAF-01 — Manual SOS

**P0 · Included · Day 19 · M+B · Depends on FR-GRP-03, SUP-04, SUP-05, SUP-06**

- Every active member can trigger SOS with one tap and immediate local feedback. The durable event identifies the sender, current pairing snapshot, location accuracy, and sample age.
- Authorized online members receive it within the SOS latency gate; background delivery is tested separately. Sender UI distinguishes server acceptance from member acknowledgements.
- Distinguish never-transmitted offline events from transmission with missing acknowledgement (“Delivery unconfirmed”). Reconcile by event ID before retry or aged-event reconfirmation; never duplicate an accepted event. Resolution is a visible update rather than deletion.

### FR-SAF-02 — Automatic crash detection

**P2 · Conditional experimental feature · Days 20 and 33 · M+Q+P · Depends on FR-SAF-01, SUP-06, SUP-13**

- With the experimental flag enabled, a qualifying sensor event opens an “I'm okay” / “Send group SOS” prompt; a single okay tap dismisses that event.
- Sending follows FR-SAF-01; non-response does not automatically dispatch or send SOS in this beta. Tests identify supported sensor/background states.
- The detector remains off for general beta users unless the crash gate passes. If off, mark this FR unmet and explain the limitation in release notes; passing scripted triggers is not proof of real-world crash-detection reliability.

### FR-SAF-03 — Combined rider/pillion alert

**P0 for manual paired identity; P2 for automatic-crash path · Days 19–20 and 33 · M+B · Depends on FR-SAF-01, FR-PIL-01; crash path also FR-SAF-02**

- A SOS originating from a current paired unit identifies both names as potentially involved, the reporting person/device, and pairing state at event time.
- A user-escalated probable-crash prompt uses the same identity rules and labels the event unconfirmed/assistance requested, not a medically confirmed crash.
- Paired-device simultaneous requests remain traceable and linked; no distinct person's request is silently discarded. If the detector is disabled, its dependent crash path remains unmet.

### FR-SAF-04 — External status sharing

**P0 · Included · Day 20 · M+B · Depends on FR-LOC-01, FR-GRP-05, SUP-07, SUP-15**

- A member explicitly creates a read-only link to their own limited status; browser visitors need no Ridr account. No other member or paired person's private data is exposed.
- Expiry/revocation is server enforced on every read and live subscription. Offline owner revocation is visibly pending until acknowledged. Viewers clear live content on rejection, absolute expiry, or failure to renew the maximum 15-second display lease.
- UI accurately describes bearer-link access and its chosen lifetime. Tests cover guessing/tampering, cross-user data requests, leave/stop-sharing/end, and manual revocation.

### FR-SAF-05 — Low-battery broadcast

**P1 · Included · Day 12 · M+B · Depends on FR-LOC-01, SUP-05**

- Crossing the selected battery threshold emits a labelled member warning once; rising above the re-arm threshold permits a future downward-crossing alert.
- Unknown battery values do not trigger false low-battery claims. Reconnect cannot repeatedly replay the same threshold event.
- Alert communicates possible tracking loss; it does not classify low battery as SOS.

## Ride summary and history

### FR-SUM-01 — Post-ride summary

**P1 · Included · Day 21 · M+B · Depends on FR-GRP-05, FR-LOC-05**

- Server end generates a summary with recorded distance, pace, route map, member departures/sharing stops, and separately marked tracking gaps.
- Primary metrics belong to the viewing member; per-member details are separately labelled and distances are never summed across the group. Distance uses that member's validated recorded segments, excluding discontinuities. Participation duration runs from the later of ride start or member join until their leave or ride end, including stops; sharing outages are disclosed as tracking gaps.
- “Elapsed pace” is participation duration divided by recorded distance, displayed in min/km; zero distance shows unavailable. A separately displayed average speed uses km/h and is labelled accordingly. Never substitute a planned route for recorded distance.
- Late eligible historical uploads recompute the summary idempotently and display an updated timestamp. Missing data is disclosed rather than interpolated into confident stats.

### FR-SUM-02 — Photo sharing

**P1 · Included · Day 23 · M+B · Depends on FR-SUM-01, SUP-12**

- A participant attaches a validated photo to a selected point on a completed route; authorized participants can view it and its author.
- Size/format checks, EXIF stripping, compression, retry, and canceled uploads follow the media contract. Duplicate retries produce one attachment.
- Nonparticipants cannot view/download; another member cannot edit/delete the author's contribution. Owner/account deletion removes the media and revokes access.

### FR-SUM-03 — Ride history

**P1 · Included · Day 22 · M+B · Depends on FR-SUM-01, SUP-07**

- Home opens a paginated history of participated rides with dates and available metrics; opening one shows its summary and permitted shared data.
- Empty, unavailable-network, deleted, and expired-history states are readable. Cached data obeys account isolation and logout/deletion cleanup.
- Ninety-day beta retention applies consistently to free and provisioned ad-free accounts; no extended-history upsell promises an unavailable product.

## Advertising module

### FR-ADV-01 — Restricted ad placement

**P1 · Included · Day 24 · M+B · Depends on SUP-03, FR-SUM-03**

- Native sponsored cards can render only on home, history, and completed summaries when the user has no active ride and no ad-free entitlement.
- The central eligibility function rejects every other surface. No-fill/network failure leaves the screen usable without an obstructing placeholder.

### FR-ADV-02 — Active-ride exclusion

**P0 · Included · Day 24 · M+B · Depends on FR-ADV-01, FR-GRP-05**

- Starting or restoring an active ride hides/cancels pending ads; navigating back to home during that ride still shows none.
- Map, chat, alert, SOS, and check-in surfaces never render advertising. Deep links, slow ad responses, state restoration, and cached ads cannot bypass the rule.
- Unknown/restoring session or entitlement state fails closed: no ad until eligibility is known.

### FR-ADV-03 — Native ad styling

**P1 · Included · Day 24 · M · Depends on FR-ADV-01, SUP-06**

- Every displayed ad uses the app's card/type scale, a readable “Sponsored” label, an accessible action, and a clearly separate visual identity from rider messages.
- Both display modes preserve text contrast; cards cannot impersonate SOS, safety check-ins, or system alerts.

### FR-ADV-04 — Contextual relevance

**P2 · Conditional · Day 25 · B+M+P · Depends on FR-ADV-01, SUP-07**

- Only explicit opt-in permits coarse-area targeting; declining/revoking consent uses a non-personalized card or no ad.
- No raw trail, exact position, paired identity, or contact record is exposed to ad providers. Selection is limited to permitted screens and never changes safety behavior.
- If a suitable provider/content source or consent flow is unavailable, disable contextual targeting and document that this optional “where possible” behavior is absent.

### FR-ADV-05 — Opt-in rewarded ads

**P2 · Conditional; no enabled reward flow by default · Day 25 · M+B+P · Depends on FR-ADV-01, FR-ADV-06**

- No reward flow starts without an explicit offer and user action. Dismissal, no-fill, or refusal preserves all core ride/history functions.
- Before enabling a flow, P defines its non-core benefit and B validates completion server-side with idempotent reward grants. Until then, hide the offer and record it as not shipped.
- Active rides, safety screens, moving state, and ad-free accounts are ineligible; no forced full-screen interruption is permitted.

### FR-ADV-06 — Ad-free tier

**P1 entitlement portion; P2 paid purchasing · Day 25 / v1.1 · B+M · Depends on SUP-01, FR-ADV-01**

- Server-provisioned test entitlements suppress all ad requests and placements. Client tampering cannot grant entitlements; cached/slow callbacks cannot show ads after entitlement activation.
- Unknown entitlement state shows no ads. Account changes clear cached entitlement state and refresh authorization.
- No beta purchase UI or actual payment processing exists. Track the paid subscription requirement as partially satisfied until v1.1 checkout is delivered.

## Supporting requirements and non-functional coverage

### SUP-01 — Accounts and session security

**P0 · Days 4–5 · M+B · Source: SRS sections 4.4 and 5.3; Day 1 email-login decision**

- Verified email/password users can sign in/out and recover access. Secrets/tokens use platform secure storage; no provider service key is shipped in the app.
- Revoked/expired sessions cannot read or write rides, media, or real-time events. Account switching clears private cached data.
- Requests identify the authenticated actor independently of client-submitted user IDs.

### SUP-02 — Permissions and device support

**P0 · Days 5 and 27 · M+Q · Source: sections 2.4, 4.2, 5.4**

- Verify iOS 16+ and Android 11+ support against chosen SDKs before version lock; if incompatible, record and resolve the conflict before proceeding.
- Test foreground/background location, camera, microphone, and notification permission grants, refusals, and revocations on physical devices.
- Locked-screen/background tracking and returning after OS termination report actual freshness. No unsupported always-running guarantee is made.

### SUP-03 — Authoritative ride lifecycle

**P0 · Days 3 and 7 · B+M · Source: FR-GRP-01/03/05 and section 2; added start/transfer defaults**

- Implement Lobby/Active/Ended transitions, one leader, one active ride per person, readiness-gated start, explicit leave, and independent stop sharing.
- Reject impossible, unauthorized, or repeated conflicting transitions without partial state; retry valid operations idempotently.
- Concurrent start/end/join/transfer tests preserve membership caps and access rules.

### SUP-04 — Durable offline recovery

**P0 · Days 9–15 and 27 · M+B · Source: sections 2.5, 4.4, 5.4**

- An encrypted durable queue survives app restart, retries with bounded backoff, and deduplicates acknowledged events by ID.
- Test a 10-minute outage, network switching, queued app restart, capacity exhaustion, and reconnect after remote end. Reconcile state before replay.
- No stale alert is presented as current; no old position overwrites new; queues do not silently lose unacknowledged text at capacity. SOS uses its separate freshness rule.

### SUP-05 — Notifications and delivery state

**P0 · Days 12 and 19 · B+M · Source: sections 4.3, 5.4**

- Authorized group alerts use live delivery plus push where applicable. Maintain per-device acknowledgement and accurate pending/failed states.
- Denied push permission, invalid device token, background/locked app, duplicate push/live delivery, and removed membership are covered.
- Hide precise coordinates/contact data from lock-screen previews by default. Delivery cannot be guaranteed during OS/network suppression.

### SUP-06 — Glanceability and accessible controls

**P0 · Days 2, 14, 17 and 30 · M+Q · Source: sections 2.5, 4.1, 5.2, 5.5**

- Map is default in an active ride; presets, SOS, and returning to map require no more than one tap. Chat retains map context.
- Use at least 48 logical-pixel tap targets, explicit accessible labels, and text contrast target 4.5:1 for normal text in light/high-visibility modes. These are Day 1 quality targets, not a claim of certified accessibility compliance.
- Validate moving-state hysteresis and unknown-speed restrictions, larger text, screen reader names, and physical sunlight readability. Dismissing a false crash prompt is one tap.

### SUP-07 — Privacy encryption retention and deletion

**P0 · Days 3, 22, 25 and 29 · B+M · Source: sections 5.3 and 6.1; Day 1 policy defaults**

- Enforce group/owner authorization for every route, message, media file, contact, and subscription. Test cross-ride, former-member live access, and forged-actor requests.
- Configure TLS for transport, encryption at rest for backend data/backups and retained device location, plus documented key handling; verify provider configuration rather than assume it.
- Implement sharing consent, retention expiry, account/data deletion, token revocation, and cache cleanup against the stated deadlines. Verify backup limits before public release.

### SUP-08 — Location latency and group capacity

**P0 · Days 10 and 28 · M+B+Q · Source: section 5.1**

- Execute the 50-member, 30-minute controlled test in the release document, preserving five-second sampling and measuring transmission-to-display separately.
- Every eligible location sample in the controlled run must update the receiver's per-member state/trail within 3 seconds; unpaired and paired-rider samples must also update the corresponding marker. Paired-pillion samples update their separately inspectable state/trail rather than moving the rider marker. Record p50/p95/p99/max and missing updates. A percentile alone cannot pass the SRS's absolute wording.
- Map responsiveness, paired counting, trails, pan/zoom, memory, and reconnect behavior meet the defined beta gate on named physical devices.

### SUP-09 — Availability monitoring and recovery

**P1 · Days 4 and 34 · B+Q · Source: section 5.4**

- Configure synthetic checks of authenticated REST and real-time round-trip health, alerting, logs without sensitive payloads, backups, and a rollback/restore runbook.
- Define 99.5% as the rolling 30-day availability target, with failed round-trips and maintenance counted as unavailable. Store sufficient measurements to calculate it.
- Demonstrate a restore and rollout rollback in staging. A short beta test is not described as proof of 30-day availability.

### SUP-10 — Architecture scaling path

**P1 · Days 3 and 28 · B · Source: section 5.6**

- Document how real-time workers, database indexes/partitioning, media, and tile/routing services grow independently without replacing client contracts.
- Record load assumptions and measured beta fan-out; identify when a shared event broker, more workers, or database capacity is needed.
- The 50-member test is not evidence of support for hundreds of thousands of MAU. Larger capacity remains a measured future scaling target.

### SUP-11 — Product disclosures and release-market review

**P1 · Days 25, 29 and 34 · P+M+B · Source: sections 6.1 and 6.2**

- Display a readable coordination-aid/safe-riding disclaimer and accurate permission, crash-detection, status-link, retention, and advertising explanations.
- Name intended markets and deployment regions and record an appropriate privacy/store/advertising review before public release; do not claim GDPR/DPDP compliance from this planning document alone.
- Store listing and onboarding cannot promise emergency dispatch, guaranteed connectivity, verified helmet safety, paid features, or detector reliability beyond tested behavior.

### SUP-12 — Private media pipeline

**P1 · Days 14 and 23 · M+B · Source: FR-COM-04, FR-SUM-02, section 5.3**

- Validate allowed formats and real file content, apply size/duration limits, use private storage with authorized short-lived access, and remove canceled/orphaned uploads.
- Strip photo EXIF location metadata; route attachment comes only from the user's chosen point. Unauthorized files and invalid uploads cannot become publicly readable.
- Test interrupted uploads, duplicate completions, playback errors, account deletion, and expired access URLs.

### SUP-13 — Controlled field and sensor validation

**P0 field/manual-safety gate; P2 detector gate · Days 5 and 31–33 · M+Q+P · Source: sections 5.2, 5.4; added validation plan**

- Cover mounted devices, background/locked screens, weak signal, stopping, pillion workflow, and battery use in controlled rides; do not induce real crashes.
- Run the detector-specific prompt/cancellation/paired-event cases and ordinary-motion negative cases; record false positives and tested state coverage.
- Resolve field/manual-SOS blockers. Disable failed detector behavior and disclose unmet FRs instead of lowering the safety gate to meet a date.

### SUP-14 — Mapping and routing services

**P1 · Days 3, 5 and 8 · B+M · Source: sections 2.4–2.6 and 4.3**

- Choose and document MapLibre/OSM tile delivery and OSRM hosting with attribution, credentials, cost limits, and cycling/driving profiles; do not rely on unverified free-tier claims in the SRS.
- Test tile/routing failure, credentials restricted to intended usage, route imports, and native platform compatibility. A blank/failed map leaves presets/SOS accessible.
- Offline message/location queuing does not imply downloadable offline map packs. Map downloads and other unspecified route formats are outside the beta baseline.

### SUP-15 — External viewer and API contracts

**P0 · Days 3 and 20 · B+M · Source: sections 2.3, 4.4, FR-SAF-04**

- Document REST contracts for accounts/groups/history and authorized real-time contracts for locations/chat/alerts; validation failures and versioned event schemas are explicit.
- Provide a mobile-friendly browser page for status links with no account requirement and no write controls; verify accessible expiry/offline/stale states.
- The viewer receives only the link owner's allowlisted fields, and revalidates authorization before each update. No bearer token is exposed in telemetry.

## Source coverage and explicit deferrals

| SRS area | Backlog coverage |
|---|---|
| 3.1 Groups | FR-GRP-01 through FR-GRP-05; SUP-01/03 |
| 3.2 Location | FR-LOC-01 through FR-LOC-05; SUP-02/04/08 |
| 3.3 Communication | FR-COM-01 through FR-COM-04; SUP-04/06/12 |
| 3.4 Pillion | FR-PIL-01 through FR-PIL-06; SUP-06/07 |
| 3.5 Safety | FR-SAF-01 through FR-SAF-05; SUP-05/13/15 |
| 3.6 Summary/history | FR-SUM-01 through FR-SUM-03; SUP-07/12 |
| 3.7 Advertising | FR-ADV-01 through FR-ADV-06; SUP-11 |
| 4.1 UI | SUP-06 |
| 4.2 Hardware and 2.4 minimum OS | SUP-02/13; FR-PIL-01; NFC deferred |
| 4.3 Software interfaces and 2.5 low-cost mapping | SUP-05/14; selected-provider costs must be verified |
| 4.4 REST, real-time, and offline interfaces | SUP-01/04/15 |
| 5.1 Performance | SUP-08 |
| 5.2 Safety | SUP-06/13; FR-SAF-02 |
| 5.3 Security/privacy | SUP-07/12/15; FR-SAF-04 |
| 5.4 Reliability/availability | SUP-02/04/05/09 |
| 5.5 Usability | SUP-06 |
| 5.6 Scalability | SUP-10 |
| 6.1 Disclosures and compliance | SUP-07/11 |
| 6.2 Monetization | FR-ADV-01 through FR-ADV-06; paid extended history/advanced routes and sponsored rides deferred |

Persistent groups and automatic stationary-member alerts from section 1.2 are explicitly deferred; “Stopping” presets remain included. QR satisfies the source's QR-or-NFC option. GPX is the declared route-file format. Live voice, voice navigation, payments, and wearables retain their original deferred status. A future scope revision must list any newly omitted P0/P1 item and its effect on SRS completion.

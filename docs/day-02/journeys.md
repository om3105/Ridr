# Ridr Day 2 user journeys and navigation

These journeys translate the [Day 1 scope](../day-01/scope-and-decisions.md) and [backlog](../day-01/backlog.md) into screen behavior. They define design intent, not implemented application behavior or passed device tests. Requirement IDs refer to that baseline; Day 1 decisions remain authoritative.

## Navigation model

Signed-out users begin at `signin`. Signed-in users without an active ride begin at `home`; restoring an active membership opens `map` after session reconciliation. Ride creation leads to `lobby`, while explicit joining opens `lobby` or `map` according to the authoritative ride state. The lifecycle remains **Lobby → Active → Ended**.

During an active ride, the map is the default destination. Text-labelled presets send directly from `map`; SOS initiates sending in one tap; `chat` preserves map context and provides a one-tap map return. Secondary functions appear in contextual panels. `end` is leader-only; participants use separate leave and stop-sharing actions. A stopped location broadcast does not remove group membership.

The design review uses canonical screen keys below. Scenario controls outside the phone simulate role, movement, connectivity, display mode, and exceptional states. They are review tools, not proposed rider-facing controls. No simulated action contacts a server, starts GPS, sends an alert, or accesses a real camera.

## Screen inventory

| Key | Purpose | Main entry | Main exit |
|---|---|---|---|
| `signin` | Verified email/password access and recovery | Launch without session | `home` or restored `map` |
| `home` | Create/join entry, resume ride, history | Sign-in or completed ride | `create`, `join`, `map`, `history` |
| `create` | Ride name and transport | `home` | `lobby` after accepted creation |
| `join` | Code/link/QR preview and role choice | `home` or invite | `lobby` or `map` after explicit join |
| `lobby` | Members, roles, invites, readiness, start | Create or lobby join | `route`, `pair`, `checkin`, `map` |
| `route` | View route; leader import/draw before start | `lobby` | `lobby` |
| `pair` | Consent-based motorcycle/pillion QR pairing | `lobby` or stopped `map` | `checkin`, `lobby`, `map` |
| `checkin` | Own helmet/readiness attestation | `pair` or `lobby` | `lobby` or late-join `map` |
| `map` | Live group view, gaps, presets, SOS | Start, active join, resume | `chat`, `sos`, `share`, `headcount`, `end` |
| `chat` | Messages, presets, stationary composition | `map` | `map` or `sos` |
| `sos` | Sending status, acknowledgements, resolution | One-tap SOS; accepted crash action | `map` while event remains visible |
| `share` | Own status-link creation and revocation | `map` | `map`; explicit viewer preview |
| `headcount` | Fresh rest-stop pair confirmation round | Stopped leader on `map` | `map` |
| `end` | Leader end action and pending outcome | Leader on `map` | `summary` after server acknowledgement |
| `summary` | Recorded metrics, gaps, route photos | Acknowledged end or `history` | `history` or `home` |
| `history` | Participated rides within retention | `home` | `summary` or `home` |
| `contacts` | Owner-only emergency-contact editing | Personal account action | Previous screen |
| `external` | Limited owner status for link holders | Explicit status link | Expired/revoked/offline-cleared state |
| `crash` | Conditional possible-impact prompt | Enabled experimental detector | `map` or immediate SOS send |
| `permissions` | Contextual permission explanation/recovery | Relevant feature or account action | Requesting screen |

## J01 — Access and contextual permissions

**Sources:** SUP-01/02/06/11; D03.

At `signin`, email/password, verification, and recovery states use specific field errors and keep failed requests retryable. An expired session returns to authentication without exposing the previous account's cached rides. Successful sign-in resolves membership before choosing `home` or `map`.

Request location when the member chooses active tracking, camera when scanning, microphone when recording, and notifications with a clear delivery explanation. `permissions` explains the benefit and provides the appropriate retry/settings route after denial. Denying camera leaves invite-code entry available; pairing cannot falsely complete without its required scan. Denying microphone leaves text and presets usable. Missing maps, GPS, or push permission never removes manual SOS or presets.

Permission revocation immediately stops that user's affected collection and displays actual availability. Onboarding remains usable outside an active ride when movement is unknown. In an active ride, unknown/stale speed uses restricted controls; it is never rendered as confidently stationary or zero speed.

## J02 — Create, plan, and start

**Sources:** FR-GRP-01/03/04; FR-PIL-03; SUP-03/14; D04.

`home → create → lobby`. Enter a ride name and transport type. Invalid input stays beside its field; an accepted request creates one lobby with the creator as leader. Retry preserves the original operation rather than creating another group. Neither creation nor opening an invitation starts tracking.

The leader shares/rotates invites and opens `route` to import GPX or draw before start. GPX errors identify format, size, or coordinate problems and preserve the previous saved route. All members can inspect the route; only the leader edits it. Map/routing failure reports unavailability without inventing a path.

The lobby distinguishes solo riders from paired units awaiting check-in. Start identifies unresolved pairs; each must confirm, unpair, or leave. The leader cannot attest for a pillion. An accepted start opens `map` for connected members, with tracking subject to each person's permission and consent. A pending request never presents a confirmed global start. Route editing closes once Active.

## J03 — Join and manage membership

**Sources:** FR-GRP-02/03; SUP-03; D04/05.

`home/invite → join → lobby/map`. Code, deep link, and QR converge on a preview with explicit Rider/Pillion selection and a Join action. Invalid, expired, revoked, ended, full, or conflicting-active-ride states explain why joining failed without exposing private group data. Retrying an accepted membership opens that same membership.

Active joins land on `map`. Late solo riders do not need pillion check-in; a newly formed late pair completes its stationary pairing/readiness flow without restarting the ride. A role change while stopped resets affected pairing/readiness. Leadership transfer names an accepting Rider, then changes authority together; a Pillion must first become Rider and clear their previous pairing. Disconnection never transfers leadership.

Stop sharing acts immediately, preserves map/chat/presets/SOS access, and marks the member “Not sharing.” Leave removes live access and pairing after reconciliation. A leader must transfer leadership or end before leaving, but can always stop their own tracking. These actions remain visibly distinct.

## J04 — Follow the ride and communicate

**Sources:** FR-LOC-01–05; FR-COM-01–04; FR-PIL-02/05; FR-SAF-05; SUP-04/06; D03/05.

`map ↔ chat`. Show sample age and quality beside relevant location details. A paired marker uses the rider's position with a passenger indicator; details label each person's trail and last position separately. A stale rider marker never silently moves to the pillion's coordinates.

Along-route gaps require reliable route matching. Otherwise show “Order unavailable” and label any straight-line distance. Exclude stale/non-sharing units from the centroid and show the excluded count. Straggler and battery warnings identify the affected unit and remain separate from SOS; tracking gaps do not imply departure or crash.

Riders get direct Stopping, Flat tire, Regrouping, Turn missed, and Car back presets. Pillion presets foreground Need a stop, Uncomfortable pace, and Cold/Tired. Each tap shows pending/accepted/offline status. Pillion `chat` emphasizes reading, with a secondary “Write message” action while stationary. All roles need stationary state for text, pins, voice recording, scans, route edits, and photos. Moving or unknown active-ride speed disables those inputs with an explanation while preserving presets and SOS.

Stationary composition supports up to 1,000 characters, chosen map pins, and preview/cancel/send of voice notes up to 30 seconds. Permission, recording, upload, and playback failures retain clear recovery paths. Offline messages keep original timestamps and visible queued states; reconnect reconciles session state before replay. If the ride ended, unsent text/presets offer local copy and never reappear as new live messages. Queue-capacity warnings do not silently discard pending text.

## J05 — Pair, check readiness, and count at stops

**Sources:** FR-PIL-01–04/06; FR-GRP-03; D04/05.

`lobby/map → pair → checkin → lobby/map`. A stationary motorcycle rider and same-ride pillion scan a single-use QR, inspect the named counterpart, and both consent. Expired/reused QR, wrong ride/transport, self-pairing, or existing pairing produces no partial pair. Five-minute QR expiry offers a fresh code. Either participant can unpair while stopped; re-pairing requires new consent and readiness.

`checkin` records the participant's own helmet/readiness attestation and scan outcome. Copy says “Confirmed by member,” not verified helmet safety. The leader sees all pairs; others see their own pair only. Pending/offline confirmation stays pending. Pair/role changes invalidate affected readiness.

At a stop, the leader opens `headcount` and starts a new round. Scan/confirm each current pair, show confirmed/total, and keep completion unavailable until every current pair confirms. Duplicate scans count once; previous-round results do not carry forward. Offline/stale results cannot complete a round.

`contacts` edits only the owner's separately saved name and international-format phone number. Field validation precedes save; removal is explicit. Pairing does not reveal or copy contacts. Saving sends no call, message, or invitation.

## J06 — Request assistance and resolve an alert

**Sources:** FR-SAF-01/03; SUP-04/05/06; D02/04.

One SOS tap on `map` or `chat` creates the local event, starts sending, and opens `sos`; there is no pre-send confirmation. Show reporter, pairing snapshot, available position with age/accuracy, and status. Stopped sharing does not silently restart GPS; use explicitly available last-known position or “Location unavailable.”

Distinguish “Sending,” “Accepted by server,” and individual device acknowledgements. Acceptance never becomes “everyone notified.” If no transmission occurred, show “Not sent — offline”; if a response was lost after transmission, show “Delivery unconfirmed.” Reconnect queries the same event before retry. Retry an unaccepted event for up to 60 seconds while the ride remains active; afterward reconcile first and ask whether help is still needed before sending an unaccepted request. Never duplicate an already accepted event.

“I'm okay” after sending publishes a resolution without erasing the original event. Leader coordination closure records the actor/reason and does not declare the affected member safe. Returning to `map` leaves the event visible. Paired requests identify both potentially involved members while preserving each reporter; simultaneous requests remain linked and traceable. No action promises external emergency dispatch.

## J07 — Conditional possible-impact prompt

**Sources:** FR-SAF-02/03; SUP-13; D02.

With the experimental detector enabled, `crash` reads “Possible impact detected — Are you okay?” “I'm okay” dismisses in one tap; “Send group SOS” immediately follows J06 with “Possible crash — assistance requested.” Non-response does not automatically escalate. The screen is available as a labelled design-review scenario; it is excluded from the ordinary beta flow until the detector release gate passes. Manual SOS is independent.

## J08 — Share limited personal status

**Sources:** FR-SAF-04; SUP-07/15; D06.

`map → share`. Sharing is off by default. The owner explicitly chooses a lifetime of 1, 4, 8, or 24 hours (default 4) and creates their link. Show “Anyone with this link can view your status until it expires.” `external` exposes only that owner's display name, ride state, last position/timestamp, and own SOS state; no group, paired identity, chat, photos, history, or contacts.

Revoke is owner-only. Offline revoke/leave/stop shows “Revocation pending — your previous status may remain visible until connected or the link expires.” Server end also revokes. The viewer clears live content on rejection, absolute expiry, or expiry of its at-most-15-second display lease; renewals occur every five seconds. An offline viewer cannot indefinitely retain a convincing live status. Expired/unavailable views offer no private cached details.

## J09 — End, summarize, and revisit

**Sources:** FR-GRP-05; FR-SUM-01–03; FR-ADV-01–06; SUP-04/07; D04/07.

Leader `map → end → summary`. The end review explains group-wide impact. An offline attempt stops local tracking and shows “End pending — other members may still be active.” Only server acknowledgement presents Ended and closes links. Reconnecting clients reconcile before queue replay; eligible earlier samples may update history, while post-end samples are discarded.

`summary` shows the viewer's recorded distance, elapsed pace, route, departures/sharing stops, and separately labelled tracking gaps. Missing or zero-distance metrics show unavailable; late history updates show an updated timestamp. Stationary photo attachment selects a completed-route point and exposes validation/upload recovery plus author attribution.

`home → history → summary` opens participated rides, with empty, offline, deleted, and expired states. The beta retention is 90 days for all accounts. Sponsored cards are eligible only on `home`, `history`, and completed `summary`, with no active ride and known non-entitled status; unknown eligibility shows none. Purchase, rewarded-ad, and unavailable paid-feature offers do not enter these core journeys.

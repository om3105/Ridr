# Ridr beta scope and product decisions

This is the working product baseline for the 35-working-day beta. “SRS” identifies source obligations; “Decision” identifies a resolution or new default chosen for implementation. A conditional or deferred item is not counted as implemented or SRS-complete.

## Release boundaries

| Scope | Commitment |
|---|---|
| Included | Accounts, ride creation/joining, role enforcement, GPX import and route drawing, live maps and location, gaps/trails/stragglers, chat/presets/pins/voice notes, offline recovery, QR pillion pairing and readiness/headcount, manual SOS, external status links, battery alerts, summaries/history/photos, native ad placement and ad-free entitlements |
| Conditional | Automatic crash detector and its dependent paired crash behavior, released only after the defined validation gate; geo-contextual ads if consent and a suitable content source are available; rewarded ads if an integration and product benefit are ready |
| Deferred to v1.1 or later | Subscription checkout, paid extended history and advanced route features, NFC, persistent reusable groups, automatic stationary-member alerts, sponsored group rides, live voice/walkie-talkie, voice navigation, wearables |

Conditional geo-contextual and rewarded ads must fall back to ordinary permitted sponsored cards or no ads. They cannot delay or restrict core ride functions. Day 25 is the checkpoint for resolving their release status; Day 33 is the crash-detector checkpoint.

### D01 Subscription conflict

**SRS:** FR-ADV-06 asks for a paid ad-free tier, while sections 1.2 and 6.3 defer payment processing to v1.1. Section 6.2 also mentions paid extended history and advanced route planning without detailed FRs.

**Decision:** implement a server-controlled ad-free entitlement and test it using provisioned test accounts. Every beta participant retains core ride functions. Do not show a purchase flow, charge users, or advertise unavailable paid features. Payment integration, paid extended retention, and advanced route planning are explicit deferrals. FR-ADV-06 is only partially satisfied by the beta entitlement mechanism.

### D02 Crash check-in and SOS

**SRS:** FR-SAF-02 requires probable-crash detection and an okay prompt; section 5.2 requires one-tap dismissal. FR-SAF-03 requires paired crash alerts to identify both people. The glossary permits automatic SOS, but no escalation timing or external dispatch behavior is specified.

**Decision:** the experimental detector opens a local **“Possible impact detected — Are you okay?”** prompt with **“I'm okay”** and **“Send group SOS.”** Dismissal is one tap. Choosing SOS creates a durable group alert labelled **“Possible crash — assistance requested”** with the reporting device, location freshness, and rider/pillion pairing snapshot. If the user never responds, the beta does not automatically escalate. This intentionally narrows the glossary's possible automatic-SOS behavior and requires an explicit later decision before unattended escalation is added.

- Manual SOS is a P0 beta requirement and must function independently of the detector.
- A single tap on SOS immediately creates the local alert and starts delivery; no confirmation step delays the initial send.
- “Sending,” “Accepted by server,” and per-device acknowledgements are distinct. Never say “everyone notified” based only on server acceptance.
- A paired manual SOS identifies both paired members as potentially involved, while preserving who actually requested help. Simultaneous paired alerts are linked, not discarded.
- The sender can report “I'm okay” after sending; this publishes a resolution update without erasing the original event. The leader can close coordination with a visible actor/reason, without asserting that the affected person is safe.
- If no transmission occurred, offline SOS shows **“Not sent — offline.”** If transmission occurred but its acknowledgement was lost, show **“Delivery unconfirmed.”** Query that same event ID on reconnect and retry idempotently; server acceptance must not be mistaken for failure merely because the response was lost.
- Retry an unaccepted SOS for up to 60 seconds while the same ride is active. After 60 seconds, reconcile its server status and ask the user to reconfirm if help is still needed before sending an unaccepted event. Reconfirmation must not duplicate an already accepted event; display its original status instead. This 60-second freshness limit is a Day 1 default.
- There are no automatic phone calls, messages to saved contacts, or emergency-service dispatch. An explicitly opened external status link is a separate feature.
- Automatic detection is off by default until the gate in [acceptance and release](acceptance-and-release.md) passes. If it remains off, FR-SAF-02 and the automatic-crash portion of FR-SAF-03 remain unmet; the beta is not described as full SRS completion.

### D03 Roles and moving interactions

**SRS:** all members can exchange text (FR-COM-01); pillion chat is read-mostly by default (FR-PIL-05).

**Decision:** read-mostly describes the pillion interface. Reading and presets appear first; an explicit “Write message” action reveals stationary composition. This preserves the text capability without adding a leader-controlled messaging permission. Text entry, recording voice, placing pins, route editing, scanning, and photo attachment require a stationary device for every role, including pillions.

## Per-ride permissions

“Member” includes leader, rider, and pillion. All permissions must be checked on the server for REST operations, media access, real-time subscriptions, and event writes. A role in another ride grants no access to this ride.

| Action | Leader | Rider | Pillion | External link viewer |
|---|---|---|---|---|
| View group map, members, chat and alerts | Yes | Yes | Yes | No |
| Broadcast own location during active ride | Yes | Yes | Yes; paired display rules apply | No |
| Send presets and own manual SOS | Yes | Yes | Yes; pillion presets prominent | No |
| Compose text/pins/voice while stationary | Yes | Yes | Yes; composer secondary | No |
| Compose/record/scan while moving | No | No | No | Not applicable |
| Edit route before start | Yes | No | No | No |
| Change group alert thresholds while stationary, including Active | Yes | No | No | No |
| Start/end ride for everyone | Yes | No | No | No |
| Assign roles or transfer leadership | Yes; affected member consents | No self-promotion | No self-promotion | No |
| Pair with both participants' consent | As motorcycle rider | Motorcycle rider | As pillion | No |
| Unpair while stationary without counterpart approval | Own pair | Own pair | Own pair | No |
| Confirm own helmet/readiness | Own pair review | Own pair review | Own attestation | No |
| View full readiness/headcount and scan at stops | Yes | Own pair only | Own pair only | No |
| Leave ride | Transfer leadership or end first | Yes | Yes | Not applicable |
| Immediately stop own location sharing | Yes | Yes | Yes | Not applicable |
| Create/revoke external status link | Own status only | Own status only | Own status only | No |
| Read completed ride / add own route photos | Participated rides | Participated rides | Participated rides | No |
| View/edit personal emergency-contact record | Own record only | Own record only | Own record only | No |
| Read explicitly shared status | Own generated link | Own generated link | Own generated link | Token holder, until expiry |

The leader cannot require another person to continue sharing, reveal their private contact record, or bypass stationary restrictions. Ownership checks still apply to photos and profile edits. Moderation tools and forced member removal are outside the beta; a reported access concern is handled by ending the ride and rotating its invites.

### D04 Lifecycle and membership

- States: **Lobby → Active → Ended**. A persistent group is separate future work; the beta creates a new group/session for each ride. This is an explicit narrowing of the temporary-or-persistent scope in SRS section 1.2.
- One active ride per person and one leader per ride. Fifty members includes pillions, even when fewer than 50 map markers are displayed. Simultaneous joins must not exceed the cap.
- Code, link, and QR invites work in Lobby and Active until revoked or ended. The leader can revoke/rotate invites. A join is an explicit user action; a deep link never silently starts tracking.
- Choose the member role during explicit join, in Lobby or Active. Changing role during an active ride requires a stationary device and resets affected pairing/readiness. Only a motorcycle rider (including a leader riding a motorcycle) can pair with a pillion.
- A late-joining motorcycle rider/pillion pair starts unready and completes the stationary scan/check-in before being marked ready. This does not restart the ride or invalidate other pairs. Solo riders do not require pillion readiness. New members are not automatically paired by joining.
- The leader starts after readiness checks; an unready paired unit is identified and must confirm or leave/unpair before start. Scans record human attestations, not verification that a helmet is correctly worn.
- A rest-stop headcount is a new confirmation round. All current pairs must confirm before the leader marks the round complete; earlier confirmations do not carry forward.
- Leadership transfers atomically to an accepting Rider; the previous leader becomes Rider. Rider/Leader transfer preserves valid motorcycle pairing because the physical role is unchanged. A Pillion must explicitly change to Rider while stationary, clearing the former pairing/readiness, before accepting leadership. Disconnecting is not leaving and never automatically transfers leadership.
- Any member may stop their own location sharing immediately, including through OS permission settings. Show them as not sharing. A leader who wants to leave must transfer leadership or end the ride; this must never prevent stopping their own tracking.
- Stopping location sharing retains membership, role, pairing, map/chat access, presets, and manual SOS, and does not allow a second active ride. Leaving revokes active-group access and clears pairing. SOS sent while sharing is stopped contains only an explicitly available last-known position with its age, or “Location unavailable”; it never silently restarts tracking.
- End is authoritative on the server and idempotent. Connected clients stop and show Ended when notified; offline clients cannot be promised simultaneous receipt.
- An offline leader end attempt stops local tracking and shows **“End pending — other members may still be active.”** Reconcile with server state before retrying. Until server acknowledgement, other devices and existing status links may still be active within their ordinary expiry.
- After server end, reject new live events and revoke links. On reconnect, fetch session state before any queue replay. Historical samples captured at/before the authoritative end can be uploaded to history with their original timestamps; samples captured after end are discarded. Neither path restarts a ride.

### D05 Pairing and location display

- One motorcycle rider pairs with one pillion in the same ride, using a short-lived QR and consent from both accounts. Already-paired users must unpair before pairing again. NFC is explicitly deferred.
- Pairing lasts until either participant unpairs/leaves or the ride ends; a network gap alone does not unpair anyone. Unpairing resets readiness and restores individual markers. Emergency actions and stopping location sharing remain available without unpairing.
- The combined marker uses the rider's position and a passenger indicator. If the rider position becomes stale, retain its timestamp and label it stale; do not silently claim the pillion position is the rider's current position. A detail panel may display the pillion's separately labelled last position.
- Both members retain separate samples and trails for FR-LOC-01/05. A paired unit counts once for centroid/gap calculations using the rider position; the detail panel can reveal each member's own trail.
- Ahead/behind uses progress along the planned route with lap continuity for loops. Without a reliable route match, show **“Order unavailable”** and separately labelled straight-line distances. Do not infer rider ordering solely from compass heading.
- Group centroid is the geographic centroid of fresh reporting units, counting each pair once. Exclude stale/non-sharing units and display how many units were excluded.
- A drop-off point means a deliberate leave or sharing stop, with event time and available position. Connection loss is shown separately as a tracking gap, never as a confirmed departure or crash.

### D06 External links and privacy

- Sharing is off by default. Only the person whose status is shared can create/revoke their link. The link exposes that person's display name, ride state, last position, timestamp, and their own SOS state. It does not expose other members, chat, history, photos, contact details, or the pillion's identity through a paired marker.
- The beta uses an unguessable bearer link with at least 128 bits of randomness. Anyone holding the link can open it; the interface must say **“Anyone with this link can view your status until it expires.”** Do not claim verified recipient-only access. Store a hash of the token and exclude the token from analytics/logs.
- Default lifetime is 4 hours; choices are 1, 4, 8, or 24 hours. Server access expires at the earliest of the lifetime limit, server ride end, or server receipt of owner leave, stop-sharing, or explicit revocation. Every request enforces current authorization/expiry.
- An offline stop/leave/revoke stops local tracking as applicable immediately, but server revocation is pending until acknowledged. Show **“Revocation pending — your previous status may remain visible until connected or the link expires.”** Reconcile these privacy actions before replaying location samples. The original link lifetime remains an upper bound.
- Each viewer response grants a display lease of at most 15 seconds, renewed every 5 seconds and capped by absolute link expiry. A disconnected viewer clears live content when its lease expires; a connected viewer clears it on rejection/revocation notification. No read is authorized after server revocation. Previously delivered cached content may remain on screen only until its current short lease ends. These lease values are Day 1 defaults.
- Completed ride routes and shared media remain accessible only to members who participated, subject to retention and deletion. A shared item does not disclose private emergency-contact records.
- Beta retention default: 90 days after ride end for precise location, chat/voice, and photos; the same limit applies to free and test-entitled users. Account records and separately saved emergency contacts remain until edited/deleted or account deletion. Paid extended retention is future work.
- Users can delete their account and own contributed location/media/contact data. Deletion revokes sessions/links immediately, removes active-store data within 7 days, and expires applicable backups within 30 days. Records belonging to other participants may remain with the deleted member anonymized. These are implementation targets, not assertions about a provider's present configuration; verify them before enabling the relevant storage/backup service.
- Collect only the permissions needed by the action. Use encrypted local storage for retained location/history, platform secure storage for tokens/keys, and encrypted network/backend storage. Pairing is not consent to share contact data or to advertising targeting.

### D07 Advertising

- Implement one central allowlist: home/dashboard, ride history, and completed summary. Suppress ads everywhere while the user has an active ride, including if they navigate to home. Never show ads in maps, chat, readiness, SOS, or other safety flows.
- Clearly label every card “Sponsored”; no forced interstitials. Ad-free entitlements suppress all ad requests/rendering, including rewarded ads.
- Contextual advertising is conditional, opt-in, and limited to coarse area derived on-device or server-side with consent. Do not send raw ride trails, precise location, or contact records to an ad provider. Without consent, show a non-personalized card or nothing.
- Rewarded advertising is conditional and only available while stationary with no active ride. The benefit is unselected, so the beta reward offer remains disabled unless a non-core benefit is explicitly scoped and scheduled at the Day 25 checkpoint. No core safety function or normal history access is paywalled. Reward verification is server-controlled and repeated callbacks cannot grant duplicates.
- A missing ad provider or failed ad request never blocks navigation, ride creation, history, or SOS. Sponsored group rides are deferred; they never override active-ride exclusion.

## Operational defaults

These values are Day 1 decisions except for the SRS's five-second broadcast default and 50-member limit. They are configurable within validated bounds and must be visible in tests.

| Setting | Beta default and interpretation |
|---|---|
| Location broadcast | 5 seconds; options 5, 10, or 15 seconds. Mobile OS scheduling can vary; actual freshness is shown. |
| GPS sample eligible for proximity calculations | Accuracy ≤50 m and sample age ≤30 seconds; otherwise display degraded quality and omit from ordering/straggler decisions. |
| Stale marker | After 30 seconds without an eligible update; retain timestamp rather than implying live movement. |
| Straggler | 500 m behind median route progress of fresh units for 30 seconds; leader may set 200–2,000 m while stopped. Re-arm after 30 seconds within 80% of threshold; at least 120 seconds between alerts for the same unit. With fewer than 2 comparable units, disable calculation. |
| Automatic stop alerts | Deferred because section 1.2 mentions them without a detailed FR. “Stopping” presets remain included; stationary status alone is not an emergency. |
| Battery alert | Below 20%; user-selectable 10%, 20%, or 30%. Alert on downward crossing; re-arm above threshold +5 percentage points. |
| Moving state | Eligible speed >6 km/h for 5 seconds. Exit after eligible speed <3 km/h for 10 seconds. Unknown/stale speed remains restricted during an active ride; outside an active ride, permissions onboarding remains usable. Validate behavior on devices. |
| Text / voice / photos | Text ≤1,000 characters; voice ≤30 seconds; photo input ≤10 MB each, recompressed to ≤2 MB upload and stripped of EXIF location metadata. |
| Route import | GPX only; ≤5 MB and ≤10,000 points; reject empty/non-finite/out-of-range coordinates. Route drawing remains available before start. |
| Pair QR / invite | Pair QR single-use, 5-minute lifetime. Ride invite valid until rotation, end, or 24 hours after creation, whichever is first. |
| Offline event storage | Durable queue capped at 24 hours/50 MB, with visible capacity warning and no silent loss of unacknowledged messages. Prioritize safety events. Do not collect after local stop/end. |
| Retry behavior | Immediate attempt then exponential backoff with jitter, capped at 30 seconds; reconnect triggers state reconciliation. Only fresh, current-session alerts are replayed. |
| Normal chat retry | Same ID, original timestamp, same active ride. If the ride has ended, mark unsent text/presets as not delivered and offer local copy; never inject them into an ended live chat. |

## Assumptions and scheduled decisions

| Item | Working treatment | Owner role and checkpoint |
|---|---|---|
| Team capacity | Two developers plus part-time QA/design; one developer needs re-planning | Product owner before implementation |
| Technology | Proposed React Native/Expo/TypeScript, NestJS/Socket.IO, PostgreSQL/PostGIS, Supabase Auth/Storage, MapLibre/OSRM; versions are not yet pinned | Developers, Days 3–5 |
| Minimum OS | SRS requires iOS 16+ and Android 11+; verify chosen SDK/library support before committing to versions. Do not silently raise minimums | Mobile developer, Day 5 |
| Login | Email/password with verified email for the controlled beta; no phone OTP or social-login requirement | Backend/mobile developers, Day 5 |
| Maps and routing | Tile and OSRM hosting capacity/cost are not guaranteed by open-source licensing; select a provider/deployment and test cycling/driving profiles | Backend developer, Day 3; device proof Day 5 |
| Initial deployment | Controlled invited beta; launch market, hosting region, and public store availability remain release prerequisites, not inferred from Pune sample screens | Product owner, Day 25 |
| Privacy and advertising obligations | Prepare permission, deletion, retention, and advertising controls; obtain appropriate market/store review before public release. Encryption alone is not compliance | Product owner with qualified reviewer, Day 29 |
| Conditional features | Record included/disabled/deferred state and reason; do not count disabled features as completed requirements | Product owner and QA, Days 25 and 33 |

The dates above are work checkpoints, not evidence of external approvals. Day 1 is complete without purchasing services, contacting anyone, deploying code, or changing the source SRS.

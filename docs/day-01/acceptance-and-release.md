# Ridr acceptance criteria and release gates

This document defines how the Day 1 requirements will be assessed. No app acceptance tests have run yet. Test names, limits, and fixtures below are planned evidence requirements, not measured results.

## Definition of ready and done

A backlog item is ready for implementation when its source/decision, role permissions, expected states, and dependencies are understood, with API/UI contracts prepared on Days 2–3. A provider, safety, or privacy uncertainty must have a named role and checkpoint rather than an implicit promise.

An implemented item is done when its acceptance criteria pass with recorded evidence, its error/offline/unauthorized states are exercised where applicable, and the relevant docs and contracts match the shipped behavior. Passing a mock does not prove device GPS, sensor, background, or push behavior.

Every beta release requires all included P0 and P1 items to pass. Any removal needs an explicit recorded scope change. Conditional features may remain disabled, but their missing FRs must appear in release notes. A beta with a disabled detector or without paid checkout is not full SRS v1.0 completion.

## Test environment and measurement contract

These thresholds operationalize imprecise SRS language. Apart from 3-second propagation, 50 members, 5-second default updates, and 99.5% uptime, they are Day 1 beta acceptance targets.

| Area | Planned measurement and pass condition |
|---|---|
| Normal network | Controlled link with round-trip latency ≤150 ms to backend, jitter ≤50 ms, packet loss <1%, sufficient bandwidth, active permissions, and stable GPS. Also report an ordinary-cellular run separately. |
| Location latency | Start at sender transmission attempt of an eligible live sample; end when the receiver's per-member state/trail reflects its sample ID. For unpaired members and paired riders, also measure the rendered marker update. Paired pillion samples update separately inspectable state/trails, without moving the rider marker. Synchronize test clocks, record clock error (target ≤50 ms), and include error bounds. Every eligible sample meets the 3-second bound, not just p95. Count missing samples as failures. Record GPS/sample age separately. |
| Sampling versus propagation | Default capture/broadcast target is every 5 seconds. The 3-second delivery limit starts at transmission and does not mean the map always contains a position less than 3 seconds old. Measure actual device sampling delays as a separate result. |
| Connected SOS | Sender displays local pending state within 250 ms of the tap; every connected authorized foreground recipient displays the event within 3 seconds in the normal-network test. Report server-acceptance and per-device acknowledgement times separately. This quantifies “instantly” for the beta; background push delivery is separately recorded and not promised within this bound. |
| Group capacity | 50 concurrent authenticated members, including pillions, using 5-second updates for 30 minutes. Cover 50 separate markers and paired-marker mode, trails enabled, chat bursts, and one SOS. Use generated peers for load plus actual iOS/Android clients for display. |
| Map responsiveness | On named physical reference devices, p95 frame time ≤33.3 ms during a scripted 60-second pan/zoom with live updates, p95 control response ≤250 ms, no freeze >1 second, no crash, and no sustained upward retained-memory trend over the 30-minute run. Report baseline and loaded results. |
| Devices | At least one physical device at the declared minimum OS and one current supported OS per platform, including a lower/mid-range Android device. Record model, OS, app build, permission state, battery settings, and network. Minimum-version compatibility must first pass Day 5. |
| Offline recovery | 10-minute forced disconnect with continued eligible sampling and queued messages; restart the app during the outage. On stable reconnect, fetch authoritative ride state first; current live position resumes within 10 seconds and queued history/text for an active ride reconciles within 60 seconds in the bounded test. No duplicates or position regression. |
| Ride end | One server end event rejects new live writes immediately. Connected clients stop tracking within 3 seconds of receiving that event; separately measure end-event propagation against the normal-network 3-second target. Offline clients stop locally when requested and reconcile on reconnect. Do not promise simultaneous offline receipt. |
| Availability | Rolling 30-day availability ≥99.5%, measured by one-minute synthetic REST and real-time round-trip checks; a check fails if either path fails/times out. Include maintenance in unavailability. Configure the monitoring before release; measure over time rather than asserting a completed 30-day result. |
| Battery | Measure a repeatable 60-minute mounted-device ride with background/locked and screen-on segments. Record start/end percentage, thermal state, sampling intervals, and settings. Investigate OS termination, thermal warnings, or unexpectedly high drain. No numerical drain promise exists in the SRS; establish a baseline before a later product target is claimed. |

## Scenario matrix

| Test ID | Scenario | Expected evidence | Covers |
|---|---|---|---|
| AT-01 | Create once, retry create, join by code/link/QR, join twice, race the 50th/51st joins | One creation per idempotency key; valid membership; no duplicate/cap breach; invalid invites denied | FR-GRP-01/02; SUP-01/03 |
| AT-02 | Nonleader calls leader APIs; cross-ride subscription; role transfer race; transfer proposed to a paired pillion; expired login | Requests denied without data leak; one leader; former leader becomes Rider; pillion must explicitly change role/unpair first; revoked sessions disconnected | FR-GRP-03; SUP-01/07/15 |
| AT-03 | Import valid/invalid/oversized GPX, draw route, wrong-role edit, edit after start | Correct route and profile; preserved prior route on failure; unauthorized/state-invalid edits denied | FR-GRP-04; SUP-14 |
| AT-04 | Start with unready pair; pair confirmation; solo and paired active joins; leave; stop sharing | Readiness enforced for pairs; late pair confirms while stationary without restart; solo late rider exempt; stop-sharing retains membership/role/pairing/chat/SOS and blocks second active ride; leaving clears pairing/access | SUP-03; FR-PIL-03 |
| AT-05 | Foreground, background, locked screen, revoked location permission, force-quit/relaunch | Timestamped sample logs and actual OS behavior; honest stale/unavailable state; no fabricated continuity | FR-LOC-01/02; SUP-02 |
| AT-06 | Ordered route, loop boundary, crossing route, off-route points, poor GPS, stale rider, paired centroid | Correct order where match is reliable; unavailable where ambiguous; fresh units counted once | FR-LOC-03/04/05 |
| AT-07 | Straggler boundary/persistence/recovery, battery crossing/re-arm, reconnect | Single timely alert, correct cooldown, no repeated or stale warning; no SOS from low battery | FR-LOC-04; FR-SAF-05 |
| AT-08 | Stationary text/pin/voice, pillion secondary composer, moving/unknown-speed restrictions | All stationary member capabilities preserved; one-tap presets available; sustained composition blocked in motion | FR-COM-01/02/03/04; FR-PIL-05; SUP-06 |
| AT-09 | Ten-minute outage and queued app restart; old GPS arrives after new; queue full | Durable queue; explicit capacity status; deduplicated timestamps; latest live position never moves backward | SUP-04; FR-LOC-01/05; FR-COM-01 |
| AT-10 | Leader ends during another member's outage; offline leader requests end | Server-authoritative state; pending UI while offline; no live/old-alert replay after end; valid historical samples only | FR-GRP-05; SUP-03/04 |
| AT-11 | Pair consent, expired/reused/wrong-ride QR, concurrent pairing, either participant unpairs, reconnect | One valid pair, no silent consent, unilateral stationary unpair works without counterpart approval, correct marker/staleness, pairing survives mere disconnect | FR-PIL-01/02 |
| AT-12 | Pre-ride readiness, new headcount round, duplicate scan, pair change, pending offline scan | Timestamped attestations; fresh-round counts; invalidated affected readiness; accurate leader view | FR-PIL-03/04 |
| AT-13 | Pillion contact CRUD, access as paired rider/leader/external viewer | Independently owned record; unauthorized access denied; no outbound message on save | FR-PIL-06; SUP-07 |
| AT-14 | Manual SOS foreground/background, denied push, never transmitted offline, acknowledgement lost after server accept, 60-second retry expiry, duplicate sends | Immediate local state; measured connected delivery; “Delivery unconfirmed” for lost acknowledgement; event reconciliation before retry/reconfirmation; no duplicated accepted SOS | FR-SAF-01; SUP-05 |
| AT-15 | Paired SOS from both devices, pairing changes after alert, sender reports okay | Both people identified with reporting source; requests linked/traceable; historical pair retained; visible resolution | FR-SAF-03 |
| AT-16 | Detector-positive replay, ordinary motion, dismiss, choose SOS, never respond | Prompt state correct; one-tap dismissal; no unattended/external escalation; disclosed sensor limits | FR-SAF-02/03; SUP-13 |
| AT-17 | Create/read/revoke/expire status link; online/offline leave/stop/revoke; end; tampered token; connected/disconnected viewer | Only owner fields; token checked every read; offline revocation visibly pending; viewer clears on rejection/absolute expiry or display-lease timeout; no authorized read after server revocation | FR-SAF-04; SUP-07/15 |
| AT-18 | Completed ride with zero distance, late join/early leave, different member paths, lost tracking, stopped time, late valid samples | Viewer-specific distance and participation duration including stops; no summed group distance; separate departure/gap states; unavailable values for absent data; idempotent recompute | FR-SUM-01/03 |
| AT-19 | Photo size/format/EXIF, voice length, interrupted/duplicate upload, private file access | Valid private media; stripped EXIF; no duplicate/orphan files; access denied outside membership | FR-SUM-02; FR-COM-04; SUP-12 |
| AT-20 | Ad arrives after ride starts; home during active ride; deep link to SOS; entitlement activates mid-request | No ad rendered/requested where ineligible, no safety obstruction, fail closed on unknown state | FR-ADV-01/02/03/06 |
| AT-21 | Context opt-out, reward refusal/no-fill/duplicate completion if enabled | No precise-location targeting, no forced reward, no duplicate grant, core functionality unaffected | FR-ADV-04/05 |
| AT-22 | Account switch, delete, retention sweep, status tokens, media URLs, backup lifecycle | Private cache isolation; active deletion/revocation deadlines; documented backup expiry configuration | SUP-01/07; FR-SUM-03 |
| AT-23 | Fifty-member controlled performance run and capacity report | Latency/frame/memory logs against measurement contract; no discarded tail-latency failures | SUP-08/10 |
| AT-24 | Tile/routing outage, backend restart, staging restore and rollback | Safety controls remain accessible; accurate offline state; successful documented recovery and health alerts | SUP-09/14 |
| AT-25 | Full controlled field ride and accessibility review on both platforms | Role workflows, sunlight/readability, one-tap actions, background/lock behavior, battery baseline, issue list | SUP-06/13; FR-GRP-05 |

## Experimental crash detector gate

The beta must remain useful with the detector disabled. The following gate permits only an explicitly experimental opt-in release; it does not establish medically or statistically validated crash detection.

1. Document the supported devices, sensor sampling/state behavior, detector thresholds, and limitations. Do not invent a sensitivity claim without representative labelled crash data.
2. For each supported platform/device class, execute at least 20 controlled positive sensor-replay cases and 20 negative ordinary-motion cases. Include handheld movement, mounting/removal, braking, bumps, and a phone drop without a rider crash. Positive cases exercise the configured trigger; they do not estimate real-crash recall.
3. Pass 100% of prompt, one-tap dismissal, explicit SOS, paired identity, duplicate handling, and no-response/no-dispatch state-transition checks.
4. Collect at least 10 participant-hours of ordinary mounted-device riding across supported platforms with screen/background conditions recorded. Target no more than one unwanted prompt per 10 participant-hours as a provisional beta usability gate. This small sample is not a safety-reliability estimate.
5. Do not enable a background mode whose sensor availability or prompt delivery has not been demonstrated. If supported behavior cannot meet the intended ride conditions, leave automatic detection off and record FR-SAF-02 and its dependent FR-SAF-03 path as unmet.
6. P and Q record the Day 33 go/no-go decision and accurate release wording. Never induce a real crash to satisfy testing.

## Release checkpoints

| Day | Gate | Owner role | Consequence of failure |
|---|---|---|---|
| 5 | Minimum OS/library compatibility; physical map/background-location proof | M+B | Resolve native/SDK conflict or revise schedule/scope explicitly before feature build proceeds |
| 15 | Multi-member location/chat and persistent offline recovery | M+B+Q | Fix core data/recovery issues before layering safety behavior |
| 20 | QR pairing, check-in, manual SOS, and private status sharing | M+B+Q | Block dependent safety release work; detector remains experimental |
| 25 | Included feature implementation; ad entitlement/exclusion; contextual/reward decision; target-market/deployment prerequisites | M+B+P | Record conditional deferrals; unfinished P0/P1 features need remediation or explicit scope revision |
| 30 | Integrated feature acceptance; field, recovery, and final-release gates remain scheduled for Days 31–35 | Q+P | Produce prioritized blocker list; do not label unfinished work release-ready |
| 33 | Field defect closure and detector release decision | Q+M+P | Disable failed conditional detector; unresolved core safety/access defects block beta |
| 35 | Final regression, install/update, staging recovery evidence, accurate notes and handover | Q+B+P | No release while blockers remain; date alone is not a pass |

Product-owner entries are future review checkpoints, not an assertion that anyone has already signed off or been contacted. Store approval timelines remain external to the work plan.

### Day 5 scope amendment: 14 September 2026

The owner explicitly instructed: “skip the physical iOS and Android map/background-location checks.” The owner subsequently also skipped the simulator checks (including iPhone 16 Pro/iOS 18 and Android emulator account, profile, session, sign-out, map, permissions and encrypted-storage observations) and authorized moving to Day 6. This supersedes the device/simulator portion of the original Day 5 checkpoint above, including its first-pass hardware deadline. Record these checks as skipped, not passed. Hosted account setup remains deferred; the [Day 5 handoff](../day-05/README.md) retains its outstanding configuration and verification requirements.

The beta device matrix and field-release requirements remain unchanged. The Day 5 waiver does not establish minimum-OS runtime compatibility, real background-location continuity, battery performance or OEM behavior on physical phones.

## Evidence and release blocker rules

Record results as `test ID | build | device/OS | dataset/network | expected | observed | pass/fail | evidence link | issue ID`. Attach screenshots for UI states, event/latency logs for sync, and configuration evidence for storage/access. Redact private locations, tokens, and contact data from shared evidence.

A release blocker includes any unauthorized location/contact/media exposure, SOS falsely marked delivered, loss of a fresh SOS, tracking continuing after a received stop/end, stale location presented as fresh, ad shown in an active/safety flow, repeatable core-flow crash, unresolved P0/P1 acceptance failure, or a claim of unsupported safety behavior. Conditional detector failure is handled by disabling it and disclosing the unmet requirements; disabling it cannot hide a defect in manual SOS.

## Day 1 document verification

The planning package must pass these checks before Day 1 is marked complete:

- Exactly 34 unique FR headings match the source's 34 IDs, with no missing or invented FRs.
- Every FR includes priority, scope disposition, delivery checkpoint, ownership, dependency information, and acceptance criteria.
- All 15 SUP entries and all internal document/dependency links resolve.
- Subscription, pillion composition, crash escalation, external-link access, and offline-end language agree across all three documents.
- No planning acceptance target is presented as a test result, and no conditional/partial FR is claimed complete.

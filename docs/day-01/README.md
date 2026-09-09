# Ridr Day 1 requirements baseline

Completed on 9 September 2026. This package completes the Day 1 planning work: review the SRS, prioritize its requirements, define acceptance criteria, and resolve subscription scope, crash-alert behavior, and role permissions.

The delivery target is a **35-working-day iOS and Android beta**, with implementation and acceptance testing through Day 30 and field validation and release preparation on Days 31–35. Staffing remains a planning assumption: two developers with part-time design and QA support. Store approval is outside this duration.

These are the working decisions adopted for planning under the Day 1 task. They are not a claim of separate stakeholder approval, implemented functionality, or completed app testing. The original SRS remains unchanged.

## Deliverables

| File | Purpose |
|---|---|
| [Scope and decisions](scope-and-decisions.md) | Release boundaries, product defaults, role permissions, lifecycle, and conflict resolutions |
| [Prioritized backlog](backlog.md) | All 34 original FR IDs, additional supporting requirements, dependencies, delivery days, and acceptance criteria |
| [Acceptance and release gates](acceptance-and-release.md) | Measurement definitions, test scenarios, release blockers, and evidence requirements |

## Decisions now established

- Core group coordination, location, communication, QR pillion workflows, manual SOS, external sharing, and ride history are in the beta baseline.
- Ads are allowed only on the specified non-active screens; the beta suppresses all advertising while the user has an active ride.
- Ad-free entitlements are included. Subscription purchases, extended paid history, and advanced paid route planning are deferred to v1.1.
- Automatic crash detection is an experimental, conditional feature. A probable impact opens an okay/SOS prompt. There is no unattended escalation timer or automatic contact/emergency-service dispatch in this beta.
- Pillions have the same stationary message capabilities as other members, with a read-mostly default interface and prominent presets. Moving restrictions apply to every role.
- QR is the pairing method; optional NFC is deferred. Only GPX route files are supported in the beta.
- One leader and one active ride per user are the baseline. Server state controls start, end, access, and retry behavior.

## Completion checklist

- [x] Read every section and all requirement tables in the supplied SRS.
- [x] Account for all 34 unique FR IDs without silently dropping conditional or deferred work.
- [x] Assign priorities, target implementation days, dependencies, and observable acceptance criteria.
- [x] Convert non-functional and interface requirements into supporting backlog items and release checks.
- [x] Resolve the three Day 1 scope/behavior decisions and document a role matrix.
- [x] Record assumptions, explicit departures from the SRS, and the remaining delivery risks.
- [x] Validate requirement coverage and local document links.

Day 2 can use this package to design the actual user journeys, permission-denied states, offline states, and role-specific screens. Existing generated screen images are illustrative; conflicting UI copy must follow this baseline.

## Source and provenance

- Source: `Ridr_SRS.docx`, Software Requirements Specification, version 1.0, September 2026, status “Draft for Review.”
- Source location: `/Users/omchandrakantdeo/Downloads/Ridr_SRS.docx`.
- Source SHA-256: `ae7c1a60e1a37cc6344027514a7da146c5b2d84194ab4e8ab24541ff192b4215`.
- The source provides 34 `FR-*` identifiers. `SUP-*` identifiers in this package are new planning identifiers for unnumbered source requirements or necessary implementation support. They are not presented as original SRS IDs.
- Numerical defaults and acceptance thresholds not present in the SRS are identified as Day 1 decisions. They can be changed through an explicit update to this baseline before the affected work begins.

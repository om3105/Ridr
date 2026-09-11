# Ridr Day 2 design handoff

Day 2 is complete as a design milestone, reviewed on 11 September 2026. The deliverables are a 20-screen clickable wireframe, nine documented user journeys, light and high-visibility design tokens, and representative interaction checks. Day 3 architecture and application initialization have not started.

## Open the design

Open [wireframes.html](wireframes.html) in a browser. It works directly from the filesystem without a server, network connection, account, or build step. Keep [wireframes.css](wireframes.css) and [wireframes.js](wireframes.js) beside it.

- Select a screen in the left navigation; each selection loads that screen's sample starting state.
- Choose Ride leader, Rider, or Pillion to inspect the role-specific layout.
- Switch Light / High visibility above the phone.
- Use Connection, Movement, and Screen state on the right to inspect exceptional states.
- Click inside the phone to follow the represented navigation. Reset restores the selected fixture.

The review controls are outside the proposed app. All people, routes, codes, coordinates, and events are illustrative. The wireframe makes no network requests, does not store entered information, and never opens a camera, microphone, GPS session, or emergency call.

## Deliverables

| Deliverable | Coverage |
|---|---|
| [User journeys](journeys.md) | J01–J09: access/permissions, create/start, join/membership, ride/chat, pillion checks, SOS, conditional crash prompt, external sharing, completion/history |
| [Design specification](design-spec.md) | Color and typography tokens, touch targets, component layout, focus/scroll behavior, reduced motion, and Day 1 policy constraints |
| [Clickable wireframe](wireframes.html) | 20 screens; 57 selectable screen states; role, movement, connection, and display-mode controls |
| [Browser checks](check-wireframes.cjs) | Repeatable design-behavior, layout, contrast, focus, and isolation checks |

## Suggested walkthroughs

1. **Create and start:** Home → Create ride → Lobby. Inspect pending readiness, then use the reviewer state selector to choose Ready. Start opens permission review; explicitly allow sharing or continue without location. Both reach the active map.
2. **Join:** Join a group → choose Rider/Pillion → Join. The Active state demonstrates a late join with location off until explicitly enabled. Expired and Full demonstrate failures.
3. **Pair and confirm:** Pair a pillion → select Consented to represent the counterpart's scan/consent → Confirm my pairing. As Pillion, attest helmet and readiness. As leader/rider, inspect the member-confirmation state without a control to attest for someone else.
4. **Ride and communicate:** Live ride → use a direct preset → Chat → Map. As Pillion, open the secondary Write message action while stopped. Moving and unknown-speed fixtures preserve presets and SOS while removing composition.
5. **Request help:** Live ride → SOS. Compare Online, Offline, and Acknowledgement lost. Return to Map and reopen the outstanding event. An offline okay update stays pending. The Aged state represents reconfirmation after retry freshness expires.
6. **Share and end:** Share my status → choose lifetime → Create link → Preview status link. The viewer has no private app navigation. Revoke offline to see pending copy; stop location sharing to preserve membership while disabling new live links. As leader, end offline then retry online to reach the summary.
7. **Conditional crash:** Possible impact defaults to Disabled. Select Default to inspect the experimental prompt. I'm okay dismisses in one tap; Send group SOS uses the existing explicit alert flow. No countdown or automatic escalation exists.

## What is interactive and what remains specified

The artifact demonstrates screen transitions, simple sample form validation, role/movement gating, readiness and pairing fixtures, status-link lifetime selection, SOS state persistence, pending end/revocation, and permission opt-in/out presentation. Named fixtures represent server outcomes; they do not execute a real sync protocol.

GPX import/drawing, camera scans, voice recording, photo attachment, real authentication, storage, sensor processing, notification delivery, leadership-transfer acceptance, queue replay, and link-lease timers remain **documented design intent**, not implemented features. Their entry controls explain the preview boundary. Group lists and metrics are representative sample content rather than a complete member-management simulation. Sample form data is not persisted across navigation. There is no beta purchase flow or enabled rewarded-ad flow.

## Verification completed

The checks ran with a temporary headless Chromium profile, browser version `152.0.7977.84`. Node.js and Playwright came from the existing workspace runtime; the application has no installed dependencies or build/test framework yet.

| Check | Result |
|---|---|
| JavaScript syntax | Passed for the wireframe and browser-check script |
| Screen/mode/viewport layouts | 80 combinations: 20 screens × 2 modes × desktop/320px viewport; no horizontal overflow; phone fits viewport |
| Control sizes | At least 48px targets in the rendered default combinations; checkbox label rows counted as their full target |
| Named states | All 57 selectable states rendered without script errors |
| Text contrast | 16 core token pairs passed 4.5:1; lowest measured ratio 5.49:1 |
| Role/movement behavior | Leader-only actions; secondary pillion composer; composition unavailable while moving/unknown |
| Critical flows | Explicit location consent, one-tap preset sets, persistent SOS/offline/unconfirmed states, pending okay, pairing/headcount acknowledgements, link expiry/revocation, pending end, conditional crash dismissal |
| External status viewer | No private navigation or group data; no map in expired/offline-cleared states |
| Focus and reduced motion | New-screen title receives focus; Tab reaches SOS on active map; reduced motion removes pressed scaling |
| Network and console | No external requests and no page errors during the check run |
| Visual inspection | Both mode overview sheets and full-size critical Map, Chat, SOS, Home, and external layouts inspected; chat context-row crowding corrected |

These are browser design checks, not native iOS/Android, physical sunlight, GPS, real-network, or crash-detector acceptance. Native safe areas, keyboards, large system text, OS permissions, screen readers, and field testing remain part of the implementation/release plan.

### Review corrections

| Before | After | Why |
|---|---|---|
| External viewer inherited an app back button | Public header with no private-app controls | Shared links must not expose group navigation |
| Only two presets were directly on Map | Full role-specific preset set appears on Map | Preserve one-tap core communication |
| SOS status was lost on screen navigation | Outstanding status persists and can be reopened | Returning to Map must not hide an unresolved request |
| Declining location retained the sample sharing state | Location remains off until explicit opt-in | Match permission and late-join consent rules |
| Pair/headcount could look accepted while offline | Pending copy or disabled completion | Do not present unacknowledged state as confirmed |
| Chat Map button squeezed its context label | Bounded action width and flexible text region | Keep map context readable at narrow widths |

## Re-run the design checks

Open the HTML for manual review. Automated checks require Node.js, Playwright, and a Chromium browser already available on the machine:

```sh
node --check docs/day-02/wireframes.js
node --check docs/day-02/check-wireframes.cjs
node docs/day-02/check-wireframes.cjs
```

If Playwright or the browser is supplied outside normal package resolution, set `RIDR_PLAYWRIGHT_MODULE` to the absolute Playwright module directory and `RIDR_CHROME_EXECUTABLE` to the browser executable before running the last command. Optional `RIDR_SCREENSHOT_DIR=tmp/day-02/screens` writes local screenshots. No account credentials are required. Do not add a project framework solely to run this design artifact.

The authored files were formatted with a temporary Prettier 3.6.2 tool; no formatter dependency was added to the project. Source requirement references and Markdown/file links were checked. Generated screenshots and temporary tools remain under ignored `tmp/`.

## Handoff boundary

Use these screens and journeys with the [Day 1 baseline](../day-01/README.md) when implementation is authorized. Review completion here means the design and representative states were checked; it is not a claim of separate stakeholder approval, completed native functionality, or full SRS acceptance.

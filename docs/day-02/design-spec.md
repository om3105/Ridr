# Ridr Day 2 screen design specification

This specification describes the proposed interface in [wireframes.html](wireframes.html) and [wireframes.css](wireframes.css). The [journey inventory](journeys.md#screen-inventory) names all 20 screens and their entry/exit paths. It is a planning artifact for the mobile implementation; browser simulations do not establish device behavior, accessibility conformance, or release acceptance.

## Visual direction and layout

Use a white interface with forest-green actions, clearly separated content, and a persistent relationship to the ride map. Reserve red for SOS and its status; use labelled amber notices for degraded conditions. Status meaning always appears in text, not color alone. The interface should remain readable when glanced at while stationary or mounted.

The reference phone is **390 × 844 CSS pixels**, with a 36-pixel illustrative status bar and a 786-pixel screen region. These are design dimensions, not a fixed native-device resolution. The browser fixture reduces phone width to 370 pixels at its intermediate desktop breakpoint, restores 390 pixels for its tablet arrangement, and uses the smaller of 390 pixels or viewport width minus 24 pixels on narrow screens. Native implementation must adapt to safe areas, supported device sizes, keyboards, and text scaling.

The header uses at least 76 pixels of height. Ordinary content has 20-pixel horizontal padding, reduced to 16 pixels in the narrow fixture. Cards use 16-pixel padding and corner radius; buttons use an 11-pixel radius. Stack gaps are generally 10 pixels. Content grouping, labels, and spacing carry hierarchy without adding decoration to every element.

## Color and typography tokens

| Token | Light | High visibility | Intended use |
|---|---|---|---|
| Paper | `#ffffff` | `#ffffff` | Main surfaces |
| Ink | `#172c24` | `#000000` | Primary text |
| Muted | `#54655b` | `#252525` | Secondary text and timestamps |
| Primary | `#164d38` | `#003e24` | Main actions and selected states |
| Soft | `#edf3e9` | `#ffffff` | Supporting cards and selected groups |
| Border | `#c9d3c9` | `#202020` | Surface separation |
| Alert | `#a6242f` | `#970017` | SOS and alert text/actions |
| Alert background | `#fff0f0` | `#ffffff` | Alert notice surface |
| Warning | `#70510b` | `#503600` | Degraded-state text |
| Warning background | `#fff5d9` | `#ffef9c` | Warning notices |

Primary and danger buttons use white text. Day 1's normal-text contrast target is **at least 4.5:1** in both modes. These selected tokens must be assessed in their actual text/background combinations; pale borders are not a substitute for readable text or explicit focus. High visibility gives buttons, cards, notices, and chips two-pixel borders and simplifies soft/map surfaces to white. It is a proposed sunlight-readable mode, subject to physical sunlight checks later.

The fixture uses Arial/Helvetica/system sans-serif. Base phone text is 15 pixels in Light and 17 in High visibility, with ordinary paragraph line-height 1.5. Screen titles are 20 pixels; major content headings and metrics are approximately 24; card headings are 21; form inputs are 16; button labels are 14. Supporting labels have explicit sizes, commonly 10–13 pixels, and do not all enlarge when the base token changes. Preserve this distinction when reviewing the wireframes. Larger text support and the legibility of compact labels need native-device verification before release.

## Components and interaction

Primary actions have a **52-pixel minimum height**. Icon actions and section links provide at least **48 × 48 pixels** of target space where applicable; bottom navigation uses at least 54 pixels of height. Form fields are at least 50 pixels high. Checkbox labels form rows at least 56 pixels high around their 24-pixel checkbox; the whole label is the intended target. Chips and status text are informational unless explicitly represented as a control.

Use visible labels for presets, navigation, input fields, and state changes. Icon-only actions require an accessible name. Disabled actions keep explanatory context and use a dashed border where the component defines one. A disabled state must not imply that the user lacks the underlying role permanently when the actual reason is movement, missing permission, or a pending request.

Map markers, message pins, and recorded trails need distinct appearances and explicit labels. Combined rider/pillion markers retain the rider-position rule and separate person details. Metric cards label units, unavailable values, and sample freshness. Chat bubbles retain author, timestamp, and delivery state. Notices distinguish pending, failed, and unconfirmed outcomes instead of presenting one generic success message.

## Navigation, focus, scrolling, and motion

The 20 screens cover access (`signin`, `permissions`, `home`), preparation (`create`, `join`, `lobby`, `route`, `pair`, `checkin`, `contacts`), the active ride (`map`, `chat`, `share`, `headcount`, `sos`, `crash`), and completion/sharing (`end`, `summary`, `history`, `external`). Detailed state intent remains in J01–J09 of [journeys.md](journeys.md), avoiding a second competing flow definition.

Navigation should establish the new screen's title and context, with keyboard focus handled deliberately. The fixture includes a skip link, visible three-pixel blue focus outlines for controls, labelled navigation, selected-state attributes, and a polite announcement region. These structures support review; actual focus order, announcements, and native screen-reader behavior require verification. Scenario changes should leave the reviewer oriented to the selected control instead of unexpectedly moving focus.

Ordinary phone content scrolls within the available body region; the header and bottom navigation remain separate. The map body keeps the map and action tray together. Overflowing notices have bounded scrolling rather than covering primary controls. Screen navigation starts the new content at a useful position; back navigation and retained form state must follow the journey context.

There are no animated screen transitions in this fixture. Pressed buttons scale to 0.98 and icon buttons to 0.97 only when reduced motion is not requested. Hover feedback applies only to fine-pointer devices. No animation conveys delivery, safety, or location truth.

## Review boundaries and source precedence

Role, connectivity, movement, display mode, and exceptional-state selectors outside the phone are **design-review fixtures**. Selecting “Acknowledgement lost” demonstrates copy; it does not simulate a real delivery protocol. Maps, people, codes, metrics, and events are sample data. Native authentication, scans, GPS, files, permissions, network calls, and notifications belong to later milestones.

Earlier raster mockups are visual references. They must not override these Day 1 rules:

- SOS sends immediately in one tap; server acceptance and device acknowledgement remain distinct. Conditional crash detection never auto-escalates on non-response.
- All roles use stationary composition/scanning; unknown active-ride speed remains restricted. Pillion text composition stays available through its secondary action.
- Pairing requires both members' consent; readiness is a human attestation. The leader cannot mark someone safe or disclose private contacts.
- Local tracking stop is independent of membership. Offline end/revocation stays visibly pending until acknowledged.
- Status links expose only their owner's allowlisted data and expire; paired identity and private group content stay private.
- Active-ride and safety screens have no ads. Beta purchasing is deferred, and conditional rewards/crash features are not promised as shipped.

This milestone proposes screen behavior and visual tokens. Implementation and release checks remain governed by the [Day 1 acceptance plan](../day-01/acceptance-and-release.md).

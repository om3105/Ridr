# Ridr

Ridr is an iOS and Android app in development for group ride coordination: shared live location, group messages and presets, pillion pairing/check-ins, and group safety alerts.

## Current milestone

Days 1–3 establish the requirements, wireframes and architecture. Day 4 adds the Expo app, NestJS backend, private PostgreSQL/PostGIS database and local routing services. Day 5 implements verified email accounts, secure session restoration, editable profiles, a native map and explicit location permission checks. [Day 6](docs/day-06/README.md) adds ride creation, invitation preview/join by code, link or QR, current rides, Lobby members and leader invitation controls. [Day 7](docs/day-07/README.md) adds start/end, leave, independent stop sharing, accepted role/leadership changes and brief stationary checks. [Day 8](docs/day-08/README.md) adds validated GPX import, stationary leader route drawing, shared route direction and local Pune road routing. [Day 9](docs/day-09/README.md) adds explicit live location sharing, encrypted offline recovery and authorized location updates. [Day 10](docs/day-10/README.md) adds the active group map, named and paired markers, movement details and explicit location states. [Day 11](docs/day-11/README.md) adds route-based gap indicators, paired-unit group-centre distances and individual breadcrumb trails. [Day 12](docs/day-12/README.md) adds straggler and low-battery warnings, acknowledgement and opt-in background push. The Day 12 handoff records physical-device and simulator results separately from earlier waived checks. Hosted account setup remains deferred in the [Day 5 handoff](docs/day-05/README.md); local Auth supports continued development.

The plan targets a 35-working-day beta, assuming two developers and part-time design/QA support. Subscription checkout is deferred to v1.1. Automatic crash detection is conditional on device and field validation and is not a promised production safety capability.

## Planning documents

- [Day 1 overview](docs/day-01/README.md)
- [Scope, product decisions, and role permissions](docs/day-01/scope-and-decisions.md)
- [Prioritized backlog and per-requirement acceptance criteria](docs/day-01/backlog.md)
- [Acceptance scenarios and release gates](docs/day-01/acceptance-and-release.md)
- [Day 2 design handoff and verification](docs/day-02/README.md)
- [Clickable UI wireframes](docs/day-02/wireframes.html)
- [User journeys and screen navigation](docs/day-02/journeys.md)
- [Day 3 architecture handoff and verification](docs/day-03/README.md)
- [Database model and reference schema](docs/day-03/data-model.md)
- [API and real-time contracts](docs/day-03/api-contracts.md)
- [Day 4 setup, verification and device checklist](docs/day-04/README.md)
- [Day 5 accounts, native checks and remaining prerequisites](docs/day-05/README.md)
- [Day 6 ride creation and joining](docs/day-06/README.md)
- [Day 7 lifecycle, role permissions and verification](docs/day-07/README.md)
- [Day 8 route planning and Pune routing setup](docs/day-08/README.md)
- [Day 9 live location sharing and recovery](docs/day-09/README.md)
- [Day 10 live group map](docs/day-10/README.md)
- [Day 11 gap indicators and breadcrumb trails](docs/day-11/README.md)
- [Day 12 ride warnings and device verification](docs/day-12/README.md)

These documents cover all 34 source functional requirements, 15 supporting items, and 25 planned acceptance scenarios. Planned checks are not represented as completed app tests.

## Selected technology

The workspace pins Expo 55 / React Native 0.83, TypeScript, NestJS 11 and PostgreSQL 18 / PostGIS 3.6. Day 5 uses Supabase Auth, SecureStore, MapLibre 11 and SQLCipher. The supplied MapTiler key is configured locally and its style/source requests succeed; without a key the preview uses an authored sample. Socket.IO and Supabase Storage remain selected for later features. Regional OSRM services run locally. Native configuration preserves iOS 16+ and Android 11+; physical minimum-OS and background-location evidence remains required before beta release.

## Run locally

Use Node 24.19.0, npm 11.19.1 and Docker. From the repository root:

```sh
npm ci
npm run setup
npm run db:up
npm run db:migrate
npm run dev:api
```

In another terminal, run `npm run dev:web` for the preview or `npm run dev:mobile` for an installed Expo development build. The [Day 4 guide](docs/day-04/README.md) covers native builds, phone addresses, routing and monitoring. Follow the [Day 5 account setup](docs/day-05/README.md#run-the-full-flow-locally) to enable signup and profiles using local Supabase Auth and captured test email. No hosted service or paid resource is required for this local setup.

## Development workflow

Follow [AGENTS.md](AGENTS.md). Implement one logical milestone at a time, verify the actual change, inspect staged content, and create a specific truthful commit. Use real timestamps and preserve actual authorship. Do not manufacture work or history.

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. With the dedicated test database running and migrated, run `NODE_ENV=test npm run test:database`, `NODE_ENV=test npm run test:profiles --workspace @ridr/api`, `NODE_ENV=test npm run test:rides --workspace @ridr/api` and `NODE_ENV=test npm run test:management --workspace @ridr/api`. After local Auth setup, run `NODE_ENV=test npm run test:auth` for actual email verification, password recovery and session revocation. The build compiles the API and exports mobile/web bundles; native compilation is separate. The Day 2 and Day 3 standalone design/contract checks remain available in their handoffs. See the [Day 12 verification record](docs/day-12/README.md#verification--2026-09-24) for current results and limitations.

## Local artifacts

`output/` contains local exported PDFs and generated UI concepts; `tmp/` contains generation and inspection intermediates. Both are intentionally excluded from version control, as are macOS metadata and local environment secrets. The authoritative versioned requirements are in `docs/day-01/`.

The supplied SRS remains outside this repository; its name, original local location, version, and content hash are recorded in the Day 1 overview. A collaborator needs their own copy to rerun source-level coverage verification.

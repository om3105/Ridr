# Ridr

Ridr is a planned iOS and Android app for group ride coordination: shared live location, group messages and presets, pillion pairing/check-ins, and group safety alerts.

## Current milestone

Days 1–3 are complete: requirements, journey/wireframe design, and architecture/database/API contracts. The repository contains the product baseline, a clickable browser design artifact, reference database schema, contract checks, and development workflow. Application and environment initialization is Day 4.

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

These documents cover all 34 source functional requirements, 15 supporting items, and 25 planned acceptance scenarios. Planned checks are not represented as completed app tests.

## Selected technology

The [Day 3 architecture](docs/day-03/architecture.md) selects React Native with Expo development builds and TypeScript; NestJS/Socket.IO; PostgreSQL/PostGIS with Supabase Auth/Storage; and MapLibre with MapTiler tiles and separate OSRM driving/cycling services. Pin compatible versions during Day 4 setup and verify iOS 16+/Android 11+ on Day 5. These are design decisions, not installed application services.

## Development workflow

Follow [AGENTS.md](AGENTS.md). Implement one logical milestone at a time, verify the actual change, inspect staged content, and create a specific truthful commit. Use real timestamps and preserve actual authorship. Do not manufacture work or history.

There are currently no application `npm test`, lint, or build scripts. Run standalone checks as described in the [Day 2 design handoff](docs/day-02/README.md#re-run-the-design-checks) and [Day 3 architecture handoff](docs/day-03/README.md#re-run-the-checks). They validate design artifacts, reference database constraints and event shapes, not native app behavior or deployed access controls. Add application setup and test instructions with Day 4 tooling.

## Local artifacts

`output/` contains local exported PDFs and generated UI concepts; `tmp/` contains generation and inspection intermediates. Both are intentionally excluded from version control, as are macOS metadata and local environment secrets. The authoritative versioned requirements are in `docs/day-01/`.

The supplied SRS remains outside this repository; its name, original local location, version, and content hash are recorded in the Day 1 overview. A collaborator needs their own copy to rerun source-level coverage verification.

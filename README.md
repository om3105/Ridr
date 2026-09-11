# Ridr

Ridr is a planned iOS and Android app for group ride coordination: shared live location, group messages and presets, pillion pairing/check-ins, and group safety alerts.

## Current milestone

Day 1 requirements planning and Day 2 journey/wireframe design are complete. The repository contains the product baseline, a clickable browser design artifact, design checks, and the development workflow. Day 3 architecture and application initialization remain later milestones.

The plan targets a 35-working-day beta, assuming two developers and part-time design/QA support. Subscription checkout is deferred to v1.1. Automatic crash detection is conditional on device and field validation and is not a promised production safety capability.

## Planning documents

- [Day 1 overview](docs/day-01/README.md)
- [Scope, product decisions, and role permissions](docs/day-01/scope-and-decisions.md)
- [Prioritized backlog and per-requirement acceptance criteria](docs/day-01/backlog.md)
- [Acceptance scenarios and release gates](docs/day-01/acceptance-and-release.md)
- [Day 2 design handoff and verification](docs/day-02/README.md)
- [Clickable UI wireframes](docs/day-02/wireframes.html)
- [User journeys and screen navigation](docs/day-02/journeys.md)

These documents cover all 34 source functional requirements, 15 supporting items, and 25 planned acceptance scenarios. Planned checks are not represented as completed app tests.

## Proposed technology

The working proposal is React Native with Expo and TypeScript for mobile; NestJS and Socket.IO for the backend; PostgreSQL/PostGIS with Supabase Auth/Storage; and MapLibre/OSRM for maps and routing. Versions, service providers, and minimum-OS compatibility must be verified during the foundation milestone before installation. This repository does not yet contain those implementations.

## Development workflow

Follow [AGENTS.md](AGENTS.md). Implement one logical milestone at a time, verify the actual change, inspect staged content, and create a specific truthful commit. Use real timestamps and preserve actual authorship. Do not manufacture work or history.

There are currently no application `npm test`, lint, or build scripts. The standalone Day 2 browser checks are documented in the [design handoff](docs/day-02/README.md#re-run-the-design-checks). They validate the design artifact, not native app behavior. For documentation changes, verify source requirement coverage, internal references/links, consistency, and Git whitespace checks. Add application setup and test instructions when the corresponding tools are introduced.

## Local artifacts

`output/` contains local exported PDFs and generated UI concepts; `tmp/` contains generation and inspection intermediates. Both are intentionally excluded from version control, as are macOS metadata and local environment secrets. The authoritative versioned requirements are in `docs/day-01/`.

The supplied SRS remains outside this repository; its name, original local location, version, and content hash are recorded in the Day 1 overview. A collaborator needs their own copy to rerun source-level coverage verification.

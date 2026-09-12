# Ridr Day 3 architecture handoff

Day 3 is complete as an architecture and contract milestone. The original 35-day plan assigns Day 3 to data models, APIs, real-time events, access rules, ride states, retention and status-link expiry, with architecture/database schema as its deliverable. Application/environment initialization is Day 4.

## Deliverables

| File | What it establishes |
|---|---|
| [Architecture](architecture.md) | System diagram, module boundaries, selected stack, native build constraints, mapping/routing selection, durable delivery and scaling assumptions |
| [Access and lifecycle](access-and-lifecycle.md) | Authorization matrix, ride transitions, concurrency/consent rules, public-link privacy, retention and deletion |
| [Data model](data-model.md) | Entity diagram, data dictionary, database versus service invariants, transaction sketches and wire/storage mapping |
| [Reference SQL](schema.sql) | 29 tables with relationships, uniqueness, value bounds and read-path indexes; intended as input to Day 4 migrations |
| [API contracts](api-contracts.md) | REST methods, payloads, responses, roles, state/revision checks, errors and idempotency; reconnect and SOS protocols |
| [Event schema](events.schema.json) | Draft 2020-12 JSON Schema for v1 location/messages/SOS, server events/acknowledgements and the restricted public-status projection |
| [Database checker](check-schema.py) / [cases](schema-checks.sql) | Repeatable DDL/constraint verification in an automatically removed disposable PostgreSQL cluster |
| [Contract checker](check-contracts.py) | Event/public projection examples, invalid payloads, real timestamp validation, schema references and document links |

## Decisions ready for implementation

- Keep the selected Expo/React Native/TypeScript, NestJS/Socket.IO, PostgreSQL/PostGIS and Supabase Auth/Storage stack. Use development builds for native MapLibre; version compatibility and iOS 16+/Android 11+ still need proof during setup/device checks.
- Keep domain data private behind NestJS. Derive identity from verified sessions; current membership/ownership gates HTTP, real-time delivery and private media.
- Use one leader pointer and one active membership claim per account. Apply the 50-member cap, pair consent and fresh headcount under transactions. A sharing stop retains membership and invalidates older live consent epochs.
- Commit durable events with their domain changes. Server acceptance and recipient processing are separate. Reconcile state/privacy actions before replay; retain original capture times and manual SOS IDs.
- Share only the owner's allowlisted status through a hashed bearer token and bounded display lease. Preserve the Day 1 four-hour default, 1/4/8/24-hour choices, 15-second maximum lease, 90-day ride-data retention, and 7/30-day deletion/backup deadlines.
- Select MapTiler for tile delivery and separate self-hosted OSRM driving/cycling datasets. Provider credentials, exact SDK versions and paid hosting are not configured today; no paid resources were purchased.

Additional Day 3 implementation defaults are explicit in the contracts: 256-bit status secrets; metadata-only retry after a lost one-time token response; five-minute role/leadership proposals; 30-second movement-context age at capture; rejection of capture timestamps over five seconds in the server future; bounded pagination. These are technical defaults to verify during implementation, not new evidence of device behavior. Account deletion ends all non-ended rides led by that account, including lobbies, before anonymizing references.

## Verification actually performed

| Check | Observed result |
|---|---|
| Reference DDL | Created all 29 tables on local PostgreSQL 18.3 using an isolated Unix socket; server stopped and temporary cluster removed afterward |
| Database integrity | 24 cases passed, including valid deferred leader creation and fresh-round scans plus rejected cross-ride leaders, duplicate active claims, pair/scan duplication, invalid coordinates, oversized expiry and invalid deletion deadlines |
| Event contract | 18 accepted and 21 rejected examples passed with Draft 2020-12 and format assertions |
| Public response contract | 2 valid owner projections and 8 rejected private-field/ended-ride cases passed |
| Schema integrity | 90 internal schema references resolved; no external schema retrieval needed |
| Documentation/source | Local links, Python syntax and Git whitespace checked; role/transport/coordinate/lifecycle vocabulary reviewed against Day 1/Day 2 |
| Review correction | Found missing optional RFC 3339 validation in the temporary checker environment; added it and verified that invalid calendar dates fail |

These checks validate the design files and reference database constraints. They do **not** establish running endpoints, transactional concurrency behavior, deployed access policies, PostGIS functions, mobile builds, physical-device GPS, real delivery latency, provider backup settings or release acceptance. The model explicitly names the remaining service invariants so the DDL is not mistaken for a finished backend. Day 2 files were unchanged, so its browser suite was not unnecessarily repeated.

## Re-run the checks

Use Python 3 and PostgreSQL executables (`initdb`, `pg_ctl`, `psql`) on PATH. The database checker creates a private temporary cluster, does not connect to an existing database, and closes/removes its cluster. Run as an ordinary user, not root.

```sh
python3 docs/day-03/check-schema.py
```

For the JSON Schema checker, provide `jsonschema==4.25.1` and `rfc3339-validator==0.1.4` in a disposable Python environment. For example, from the repository root:

```sh
python3 -m venv tmp/day-03/check-env
tmp/day-03/check-env/bin/python -m pip install jsonschema==4.25.1 rfc3339-validator==0.1.4
tmp/day-03/check-env/bin/python docs/day-03/check-contracts.py
git diff --check
```

The completed run used the existing workspace Python runtime and temporary packages under ignored `tmp/day-03/python-tools`; it installed no application dependencies. The scripts are not substitutes for the future app lint/type/build/integration suites.

## Coverage and next milestone

| Day 3 scope / backlog | Completed design evidence |
|---|---|
| Data models and database schema | Entity/data dictionary, reference DDL, actual constraint checks |
| APIs and real-time events; SUP-15 | HTTP operation tables, error/ack/replay rules, strict event/public schemas |
| Access and ride states; SUP-03 | Role matrix, lifecycle diagram, locks/claims/readiness/consent transaction rules |
| Retention, deletion and link expiry; SUP-07 | Privacy rules, read-time authorization, purge/backup requirements and token lease contract |
| Scaling path; SUP-10 | Derived 50-member fan-out estimate, module boundaries, index/partition/broker checkpoints |
| Mapping/routing choice; SUP-14 | MapTiler + private dual-profile OSRM, attribution/credential/cost limits and failure behavior |

Day 4 can initialize the mobile/backend workspace, database migrations, test environments, builds and monitoring from this package. It must verify actual runtime versions, private grants, service configuration and PostGIS availability. Day 5 retains physical-device/minimum-OS/background-location proof. Hosting region, launch market and paid spending approval remain scheduled prerequisites; they do not prevent this design handoff.

No Day 4 application setup or later feature implementation is claimed complete. The [Day 1 baseline](../day-01/README.md) remains authoritative, including conditional crash/advertising and deferred payment scope.

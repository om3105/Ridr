# Ridr Day 4 development environment

Day 4 adds the first runnable app and backend, a private local database, build
automation and readiness monitoring. The app is a development preview with a
connection check and environment guide. Accounts, maps and ride features remain
in their planned milestones; the [Day 1 baseline](../day-01/README.md) still applies.

## Workspace and versions

| Part | Implementation |
|---|---|
| Runtime | Node 24.19.0, npm 11.19.1; npm workspaces and a committed lockfile |
| Mobile | Expo 55.0.31, React Native 0.83.10, React 19.2.0, Expo Router and TypeScript |
| API | NestJS 11.2.3, Socket.IO 4.8.3, PostgreSQL client; TypeScript compiled before execution |
| Database | Local PostgreSQL 18 / PostGIS 3.6 container; 29 domain tables plus migration ledger |
| Routing | OSRM 26.9.0 with separate driving and cycling datasets built from a synthetic fixture |
| Checks | ESLint, TypeScript, Node tests, database integration checks, bundle export and GitHub Actions |

The database container uses an AMD64 image, including on Apple Silicon. Docker
must be running with support for that image. Native development additionally
needs Xcode/CocoaPods for iOS, or Java 17 and Android SDK tooling for Android.
Use Expo development builds; Expo Go is not the selected native environment.

## First local run

Run these commands from the repository root with the pinned Node/npm versions
and Docker available. If using nvm, `nvm use` selects the version in `.nvmrc`.

```sh
npm ci
npm run setup
npm run db:up
npm run db:migrate
npm run dev:api
```

`setup` creates ignored root and mobile `.env` files, generates unique local
database passwords and preserves existing configuration. It never replaces an
existing file. Database initialization runs only for a fresh volume; changing
passwords in `.env` does not rotate credentials in an existing database.

The API listens at `http://127.0.0.1:3000`. Its development command recompiles
TypeScript changes and restarts the compiled service. Keep it running, then use a
second terminal for the browser preview:

```sh
npm run dev:web
```

Open the address printed by Expo and choose **Test connection**. A successful
check requires the API, migration ledger and PostGIS to be ready. Failure and
retry states distinguish unavailable service, network failure, timeout and an
unexpected response. The displayed time records the last successful check;
it is not continuous monitoring.

For an installed native development build, start Metro with:

```sh
npm run dev:mobile
```

Build/install the appropriate native development app when platform tooling and a
simulator, emulator or connected device are available:

```sh
npm run ios --workspace @ridr/mobile
npm run android --workspace @ridr/mobile
```

Generated `ios/` and `android/` projects are ignored. Make persistent native
configuration changes in `apps/mobile/app.config.ts` or a config plugin. These
commands are development builds, not signed store releases.

## Connect a physical phone

1. Put the phone and computer on the same trusted local network. Set
   `API_HOST=0.0.0.0` in the root `.env`, then restart the API. The database remains
   bound to the computer's loopback address.
2. Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` using the table below, then
   restart Metro/the preview. Use an origin without credentials, query strings
   or a path.
3. Install/open the development build and select **Test connection**. If it cannot
   connect, confirm the API is running, the address matches the computer and the
   network/firewall allows the connection.

| Test surface | API origin |
|---|---|
| Browser or iOS simulator on this computer | `http://127.0.0.1:3000` |
| Standard Android emulator | `http://10.0.2.2:3000` |
| Physical iOS or Android phone | Computer's LAN address, for example `http://192.168.1.10:3000` |

The example LAN address must be replaced with the computer's actual address.
Native requests do not need browser CORS. If opening the web preview through a
different origin or port, add that exact browser origin to root `CORS_ORIGINS`.
Development builds permit local HTTP. `APP_VARIANT=production` disables that
native allowance; production service endpoints must use HTTPS. Public Expo
configuration must never contain a database password or backend key.

Device discovery began during Day 4; no connected physical phone was found.
Configuration preserves iOS 16.0 and Android 11/API 30 minimums. Installation and
behavior on those minimum OS versions remain physical-device evidence to collect
on Day 5, alongside permission, map and background-location feasibility checks.

## Database, routing and monitoring

The [database guide](../../database/README.md) explains migration ownership,
checksum verification, rollback and runtime grants. The API role can perform
domain CRUD but cannot alter tables or write migration history. `PUBLIC`, `anon`
and `authenticated` cannot access the private schema. The last two are local
stand-in roles; this does not establish hosted Supabase policies.

Prepare and run the optional local routing services:

```sh
npm run routing:prepare
npm run routing:up
npm run test:routing
```

Driving listens on port 5001 and cycling on 5002. The tiny synthetic network proves
that the prepared profiles differ: only cycling can use its diagonal shortcut.
It is not a usable road map, a downloaded regional dataset or a live navigation
service. Generated routing data stays in ignored `data/`.

```sh
npm run monitor
```

This performs one readiness request and prints one JSON record. It exits zero for
healthy readiness and one for unavailable/unreachable service; it does not start
a recurring monitor or notify anyone. `/v1/health/live` reports process liveness;
`/v1/health/ready` returns HTTP 503 when dependencies are not ready. The public
Socket.IO `/health` namespace responds to `health.ping` without domain data.
HTTP logs record a generated request ID, known route, response status and duration,
excluding authorization headers, query strings and arbitrary request paths.

Stop the API/Metro with Ctrl-C. `docker compose --profile routing down` stops the
local containers and preserves the database volume.

## Verification and automation

Re-run the application checks from the repository root. Database checks require
the dedicated local test database to be running and migrated.

```sh
npm run lint
npm run typecheck
npm test
NODE_ENV=test npm run test:database
npm run build
npm exec --workspace @ridr/mobile -- expo install --check
```

`build` compiles the API and exports iOS, Android and web JavaScript bundles. A
successful export is separate from compiling or launching a native application.

| Check | Observed result |
|---|---|
| Application tests | 12 tests passed across API configuration/health/transport/logging and mobile connection behavior |
| Static checks | ESLint and TypeScript checks passed; lockfile dry-run install passed |
| Bundles and dependency alignment | API compilation and all three Expo platform exports passed; Expo dependency compatibility check passed |
| Database integration | 29 domain tables plus ledger; migration rerun, checksum/missing-history rejection, failed migration rollback, runtime CRUD, private permissions and a real PostGIS geography calculation passed |
| Database constraints | All 24 Day 3 integrity cases passed against the migrated database |
| Routing | Separate live OSRM services returned driving 2218.9 m and cycling 1569 m on the synthetic fixture |
| Browser preview | Real readiness connection, offline state, retry and environment navigation verified without browser errors |
| Development reload | Touching TypeScript source recompiled and restarted the API; restarted service answered HTTP |
| Native iOS compilation | Unsigned arm64 simulator Debug build succeeded with Xcode 26.6; app target minimum iOS 16.0 |
| iOS simulator launch | Installed and launched `com.ridr.app.dev` on iPhone SE (3rd generation), iOS 17.5; Expo development launcher displayed; native connection flow verification pending |
| Native Android compilation | GitHub's Android job compiled the debug APK and uploaded its artifact; installation/launch on a device is not yet verified |
| Monitor exit behavior | Healthy live API returned exit 0; refused connection returned exit 1 |
| Hosted automation | Both jobs passed on [run 34706108442](https://github.com/om3105/Ridr/actions/runs/34706108442) for commit `07144a5`: foundation checks, fresh database, all bundles, Android debug APK and artifact uploads |
| Dependency audit | Multer 2.3.0 and UUID 11.1.1 verified installed; zero high/critical findings; 8 moderate package findings from one decoder advisory remain |

The [GitHub Actions workflow](../../.github/workflows/checks.yml) runs foundation
checks, a fresh database, API readiness, routing validation and bundle export. A
separate Android job generates the native project and builds a debug APK. Outputs
are retained for seven days. Both jobs have been verified on GitHub. The Android
build result does not establish device behavior. Neither job deploys an app or
service.

## Remaining setup and scope

Supabase project configuration and MapTiler credentials are not available yet.
Authentication, map integration and their access policies begin on Day 5. No
paid resources were purchased and no hosted environment was deployed. The local
service contains health endpoints, not authenticated ride operations.

The dependency review selected scoped overrides for Multer 2.3.0 under Nest's
Express adapter and UUID 11.1.1 under Xcode tooling. Both patched versions were verified in the installed tree; application tests and
all-platform bundle export passed afterward. The moderate
[decode-uri-component advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)
remains in the router's dependency chain. Its fixed 0.5.0 release is ESM-only,
while the installed query-string consumer expects CommonJS. A direct override
would break that interface. Track a compatible upstream fix or tested backport;
do not force the audit tool's suggested Expo downgrade. This preview is not a
production release, and the unresolved advisory must be revisited before release.

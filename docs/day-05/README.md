# Day 5 accounts and native feasibility

Day 5 implements the authenticated app shell, editable profiles, permission
recovery and a bounded native map/location/storage check. Ride creation, joining,
live group location and the offline ride queue remain later milestones.
Implementation is delivered; hosted setup and simulator observations listed
below still need verification before Day 5 can close. On 14 September 2026 the
project owner explicitly skipped the physical iOS/Android map and
background-location checks for Day 5. Those checks are not reported as passed;
the beta's physical-device release requirements remain in place.

## Account flow

Supabase Auth owns email/password signup, email verification, sign-in, password
recovery, refresh and sign-out. The app accepts verification/recovery codes, so
configure the corresponding Supabase email templates to include `{{ .Token }}`.
The templates in [auth/templates](../../auth/templates/) work with the local
service. For hosted Auth, first confirm that the project permits template
customization. Supabase's [3 June 2026 policy change](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)
restricts new free-tier projects using default SMTP to the default templates;
custom SMTP permits customization, and older projects and paid plans are
unaffected. Do not assume a public API key enables email delivery or editable
templates. Keep email confirmation enabled and configure a minimum password
length of 12; the local service and signup form use this baseline.

Native sessions are split into bounded encrypted SecureStore entries; failed or
partial writes do not restore an older session. The browser preview uses memory
only and requires sign-in after a page reload. No password is stored by Ridr.
The home screen opens only after a verified session and successful `GET /v1/me`.
Session loss, account blocking and sign-out stop the local location check.

The backend validates JWT signature, issuer, audience, expiry, subject and session
ID, then queries current provider-session state on every private request and
again before committing profile work. It checks the private account block in the
same transaction as profile access. A signed token alone is insufficient after
sign-out. [Supabase session behavior](https://supabase.com/docs/guides/auth/sessions)
explains why the extra lookup is necessary.

`GET /v1/me` creates a first profile using a validated signup name (or the neutral
default `Ridr rider`), returns its
revision and current account projection, and never exposes passwords or private
contacts. `PATCH /v1/me` requires a quoted `If-Match` revision and UUID
`Idempotency-Key`. Accepted retries return the original result; conflicting edits
return 412, and a reused key with different content returns 409. Existing database
tables support this milestone; migration `001_initial` was not rewritten.

## Run the full flow locally

Start the Day 4 database and migrations, then:

```sh
npm run auth:setup
npm run auth:roles
npm run auth:up
npm run auth:access
npm run build --workspace @ridr/api
NODE_ENV=test npm run test:auth
node --env-file=.env --env-file=.env.auth apps/api/dist/main.js
```

The local Supabase Auth endpoint is `http://127.0.0.1:9999`; Mailpit captures test
email at `http://127.0.0.1:8025`. It has no external SMTP relay. Templates are served
only inside the Docker network. Auth, inbox and database host ports bind to
loopback. `.env.auth` contains generated local-only secrets and is ignored. Setup
preserves existing values; it does not rotate an existing database password.

For local browser/iOS development, launch Expo with `.env.auth` loaded into the
process (it overrides the mobile file without replacing hosted configuration):

```sh
node --env-file=.env.auth node_modules/expo/bin/cli start apps/mobile --web --port 8081
```

For an installed native development build, omit `--web` and add `--dev-client`.
If Metro selects IPv6 localhost while the simulator needs IPv4, prefix that
command with `NODE_OPTIONS=--dns-result-order=ipv4first` and add `--localhost`.

For Android, forward the host ports before using these loopback URLs:
`adb reverse tcp:3000 tcp:3000` and `adb reverse tcp:9999 tcp:9999`.
Physical phones need an explicitly configured trusted-network endpoint or a
hosted service; do not expose the database or test inbox publicly.

Stop local services with `docker compose --profile auth --profile routing down`.
This preserves the database volume. Integration tests create their own random
local account and remove their profile, receipts, Auth user and captured messages.

## Connect hosted Supabase

Set the public Auth URL (`https://<project>.supabase.co/auth/v1`) and publishable
or legacy anon key in ignored `apps/mobile/.env`. These are public app settings;
never put a service-role key, JWT signing secret or database password there.

Run `npm run auth:hosted:prepare` once. It generates an ignored SQL setup file at
`tmp/day-05/supabase-session-access.sql` and matching `.env.hosted`. The SQL creates
a restricted `ridr_auth_reader` login and a two-column active-session view. It
does not alter existing Auth users. Review and run it in that project's SQL
Editor. Both generated files contain a password; keep them private and out of
Git. The generator refuses to overwrite existing files.

The view excludes unconfirmed, anonymous, banned and deleted users, and expired
or removed sessions. The reader has no direct permission on password hashes,
Auth user rows or private Ridr domain tables. Keep `ridr_auth` and `ridr` out of
the Supabase Data API's exposed schemas; do not grant client roles schema access.
The [view definition](../../auth/session-access.sql) is versioned without secrets.

The generated connection URL uses Supabase's direct database endpoint and TLS
certificate verification. Download the project's CA certificate from Supabase
**Database Settings → SSL Configuration**, save it locally, and append
`&sslrootcert=/absolute/path/to/prod-supabase.cer` to `AUTH_DATABASE_URL` in
`.env.hosted` (URL-encode spaces in the path). Keep `sslmode=verify-full`.
This machine's initial connection returned `SELF_SIGNED_CERT_IN_CHAIN`; the
project CA must be supplied before testing the restricted login. Do not disable
certificate verification. See [Supabase's SSL instructions](https://supabase.com/docs/guides/platform/ssl-enforcement).

If this network cannot reach its IPv6 endpoint, use the
project's **Connect → Session pooler** host/port and the username
`ridr_auth_reader.<project-ref>` in `.env.hosted`, preserving the password and TLS.
Start the backend with:

```sh
node --env-file=.env --env-file=.env.hosted apps/api/dist/main.js
```

Only the Auth authority is hosted in this setup; Ridr domain data stays in the
private local PostgreSQL database. Production needs a reachable backend, hosted
private domain database and separately verified deployment settings. The backend
accepts ES256/RS256 through the provider JWKS; the local HS256 secret is rejected
when `NODE_ENV=production`. Missing Auth configuration leaves health checks
available and private account routes unavailable rather than bypassing checks.

## Maps, permission and encrypted-storage checks

MapLibre 11.3.10 is compiled into the Expo development build. Set
`EXPO_PUBLIC_MAPTILER_KEY` to use MapTiler's streets style. Without it, the map
renders an authored GeoJSON sample with no remote tile dependency, clearly
labelled as a sample. Map rendering never requests location or shows a fabricated
current position. A map-provider request reveals the viewed area to the provider;
the screen explains this while browsing the provider map.

Foreground and background location permission are separate explicit actions.
Denied permission does not block sign-in or browsing the map; recovery opens
phone settings and refreshes the permission state on return. No camera,
microphone, contact or notification prompt is triggered by onboarding.

The **Start check** action tests SecureStore key readback and SQLCipher: it writes
an encrypted probe, rejects a wrong key on a separate connection, and reopens the
probe using the original key. It then records only timestamps, accuracy and
whether callbacks arrived in the background. Coordinates are neither saved nor
uploaded. The local database is removed with its key on stop/sign-out/new launch.
The check accepts evidence for at most two minutes and a bounded sample count.
Mobile OSs can suspend timers: a delayed stop runs on the next callback/resume,
and samples after expiry are rejected. A cold/headless relaunch stops the test;
it never resumes location automatically. This is feasibility evidence, not the
Day 9 live sharing/queue implementation.

Use `npm run ios --workspace @ridr/mobile` or the corresponding Android command
after native generation. Expo Go cannot run MapLibre or SQLCipher. Web displays
an explicit native-only explanation for these checks. Background configuration
preserves iOS 16 and Android API 30 minimums. A simulator success does not prove
battery, lock-screen, OEM power management or minimum-OS behavior on a phone.

## Verification record

Checks performed on 13 September 2026:

| Check | Result |
| --- | --- |
| Lint and TypeScript checks | Passed for API and mobile. |
| Unit/HTTP checks | 15 API and 21 mobile tests passed. Mobile cases include partial secure writes, offline sign-out, international names, permission denial and encrypted-storage failure handling. |
| Real PostgreSQL profile integration | Passed, including conflicting concurrent edits, idempotent retry and rollback when a session is revoked before commit. |
| Database regression | Passed: 29 domain tables, runtime grants, PostGIS and 24 integrity cases. |
| Local Supabase Auth and Mailpit | Passed actual signup, unverified-login rejection, email-code verification, profile persistence, sign-out rejection of the old JWT, password recovery and session refresh. Test fixtures were cleaned up. |
| API and app bundles | API compiled; iOS, Android and all eight browser routes exported successfully. |
| iOS native build | Debug arm64 simulator build succeeded with MapLibre, SecureStore, location and SQLCipher; built minimum OS is 16.0. Installed on iPhone SE (3rd generation), iOS 17.5 simulator. |
| Android native build | Debug arm64 APK built successfully with the same native modules; merged manifest minimum SDK is 30 (Android 11). |
| Dependency audit | No high or critical findings; eight moderate findings remain in the dependency tree. See the Day 4 audit explanation before changing transitive packages. |
| Hosted public Auth settings | Project settings and JWKS endpoints returned HTTP 200; email enabled, confirmation required, ES256 key available. This does not establish a working hosted account flow. |
| Native interactive checks | Pending. See the 14 September continuation record below for the current blocker. No visual map, permission-prompt, SecureStore restore or SQLCipher runtime result is claimed. |
| Physical phones | Not run. The owner subsequently skipped these Day 5 checks; see the dated scope amendment below. Minimum-OS, lock-screen, background callback and battery/OEM behavior remain unverified. |

Continuation verified on 14 September 2026:

| Check | Result |
| --- | --- |
| GitHub checks | [Run 34773778631](https://github.com/om3105/Ridr/actions/runs/34773778631) passed for pushed commit `b68be039f4b6a81d1ef2b4c731e7018692732f17`. This does not include subsequent local edits. |
| MapTiler configuration | Supplied key saved in ignored `apps/mobile/.env` with owner-only file permissions. The streets style and vector-source TileJSON returned HTTP 200, with 90 style layers and attribution present. Actual tile payloads and native rendering remain unverified. |
| Hosted management authentication | Auth configuration and SSL configuration reads returned HTTP 200 after correcting the existing Authorization header format. This verifies management access, not a hosted user session or an available MCP connection. |
| Hosted account prerequisites | Saved Auth configuration has confirmation enabled, password minimum 6, no custom SMTP host, and no code token in confirmation/recovery templates. The required minimum is 12. Template-customization eligibility and delivery must be resolved before the app's code flow can be verified. |
| Simulator access | iPhone SE (3rd generation), iOS 17.5 booted and Simulator control became available. Ridr opened to a development-server connection error because the local preview server had stopped. Restart was rejected by automatic approval review because the account usage limit was reached. No runtime pass is claimed. |
| Physical-device scope amendment | Owner instruction: “skip the physical iOS and Android map/background-location checks.” These observations are removed from the Day 5 completion gate, with their results recorded as skipped. They remain required evidence before applicable beta behavior is claimed. |

Remaining prerequisites and acceptance observations:

1. Run the privately generated session-reader SQL in the supplied Supabase
   project and configure the project CA certificate. Add verification/recovery
   codes through a supported hosted email configuration and set the minimum
   password length to 12. Then verify signup, profile access and revoked-session
   rejection against hosted Auth; local tests do not substitute for this check.
2. Resume the local preview once command approval is available. On the iOS
   simulator and Android emulator, sign in to the local test service, save a
   profile, relaunch and verify secure restoration, sign out and verify private
   screens close. Observe map rendering without a location prompt; deny
   permission and verify settings recovery. Exercise the encrypted probe and
   bounded check cleanup where supported, recording emulator limitations.
3. Verify actual provider tiles, native map rendering and visible attribution
   using the configured MapTiler key. A successful style/TileJSON response alone
   does not establish a rendered map.

Physical iOS/Android map and background-location observations are skipped for
Day 5 by owner instruction. Before beta release, the original hardware matrix
still requires physical minimum/current OS coverage, encrypted-storage behavior,
background callbacks, stop/sign-out/expiry/relaunch cleanup and battery/OEM
observations. See the [acceptance scope amendment](../day-01/acceptance-and-release.md#day-5-scope-amendment-14-september-2026).

Native build logs and artifacts remain ignored under `tmp/day-05-*` and
`apps/mobile/android/app/build/`; environment files and the private SQL are not
committed. Successful compilation is not evidence of completed device behavior.

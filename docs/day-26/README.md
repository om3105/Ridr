# Day 26 — standalone Android build preparation

Day 26's [exit condition](../days-26-35-standalone-android-plan.md) requires a signed APK that reads an online ride from a hosted API with the Mac off. **It has not passed.** The user requires no cost, no payment card and production reliability. No card-free, zero-cost service has been verified to provide production availability for Ridr's live location and SOS workloads. Do not treat a free-tier beta or local server as a production substitute.

## Completed preparation

- Added a separate EAS `standalone` internal APK profile for the stable `com.ridr.app` identifier, version code 1, bundled production-style JavaScript and Expo-managed signing. The production config omits the development launcher and disables cleartext traffic.
- The build config rejects localhost, LAN, reserved test domains and missing hosted Auth/map settings. It cannot accidentally package the current Mac API address as a standalone candidate.
- Generated Expo-managed Android signing credentials for `com.ridr.app`. Stored the hosted Supabase Auth URL, publishable key and public MapTiler key in the EAS `preview` environment; no private database or service-role credential was stored there. `EXPO_PUBLIC_API_URL` remains unset because no working hosted API exists.
- Built the existing API and an ARM PostGIS image locally as a feasibility check. An isolated fresh database initialized all six migrations and passed the existing private-role, PostGIS and integrity checks. The temporary test database was removed. This does not constitute a hosted deployment.
- Added a production API container with an authenticated-session startup requirement and a readiness health check. The image builds, and a local container returned HTTP 200 for live and ready health checks against the local PostGIS database. API tests (51) and mobile tests (113) passed; both workspaces passed type checking.
- Created a Voroa free workspace and configured its direct HTTPS MCP endpoint in Codex. Voroa's MCP tool discovery succeeded, but the workspace has no deployed services yet. The local workspace token is ignored by Git and expires after 30 days.

## Remaining Day 26 gate

Ridr's NestJS API, Socket.IO transport, PostgreSQL/PostGIS, two Pune OSRM routing services and private media currently depend on an always-on server. Supabase can host Auth, PostGIS, Realtime, Storage and Edge Functions, but moving the current server to those products is a substantial migration. Its hosted Edge Functions have finite memory/CPU/runtime limits; they cannot simply run both OSRM processes. A separate routing provider or another host is necessary. The free Supabase project can pause for low activity, so it does not meet a strict production-availability requirement.

The revised architecture therefore needs an owner decision: permit a limited free beta with explicit availability and quota limits, or supply a production-grade hosting budget/existing reliable infrastructure. Until then, do not build an APK using a placeholder endpoint or mark Day 26 complete. No phone cellular acceptance or offline cold-start check has run for a standalone APK.

For the Voroa beta candidate, the next checks are repository access, a reachable PostGIS database with the required private roles and migrations, a hosted API that passes `/v1/health/ready`, a routing solution, and a standalone build with its real HTTPS API URL. A Voroa service proposal requires the owner's separate dashboard approval. Free-tier availability and capacity still need measured acceptance; a healthy local container does not establish production reliability.

Current references: [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits), [free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [Supabase free usage limits](https://supabase.com/docs/guides/platform/billing-on-supabase), [Expo internal Android builds](https://docs.expo.dev/build/internal-distribution/).

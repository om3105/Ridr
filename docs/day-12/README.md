# Day 12 — ride warnings

Day 12 adds low-battery and route-based behind-group warnings to active rides. These are coordination cues, not emergency detection or navigation advice. A warning requires current, eligible sharing data; uncertain route order and stale or inaccurate positions produce no behind-group alert.

The default behind-group threshold is 500 m for 30 continuous seconds. Only the current leader can change it (200–2,000 m) after a stationary check. Recovery inside 80% for 30 seconds re-arms the detector; alerts have a two-minute minimum separation. Each member can select a 10%, 20% or 30% battery threshold. A known native battery reading must cross below the threshold while sharing; it re-arms above threshold plus five percentage points. Historical uploads and duplicate readings do not create new live alerts.

The group map shows current warnings with the latest shared position and a per-device acknowledgement. Android/iOS users may separately enable background notifications. The server stores encrypted push registration, sends a generic lock-screen message through Expo, records delivery state and checks receipts later. A notification deliberately contains no rider name or coordinates. Delivery needs a working Expo project and platform push credentials; an accepted Expo ticket is not proof that the phone displayed it. Foreground warnings remain visible without push.

## Local setup

Apply migrations with `npm run db:migrate`. Generate a private base64-encoded 32-byte `PUSH_TOKEN_KEY` for the API environment and do not commit it. Configure an Expo project ID in the mobile app and install a native development build; Expo Go is not sufficient for this push flow. Android also needs the local `google-services.json` and EAS/Firebase push credentials. Keep that JSON ignored and private. Open an active ride, start sharing, open its group map, then enable background warnings in the map controls and grant OS permission.

## Verification — 2026-09-24

- Lint, type checks, API/mobile unit tests (33/83), API management integration tests (18), database tests (24), migrations and Android/iOS/web JavaScript exports passed.
- Android native build succeeded and was installed on a connected Motorola edge 60 fusion (Android 16) and an Android emulator. The phone loaded Ridr, reached the local API/Auth services, signed in and registered an Expo push token after OS permission was granted. The owner then asked to skip further Android emulator checks; no emulator interaction pass is claimed.
- An isolated local test ride with synthetic battery readings crossing 20% produced one server warning and one Expo-accepted push. The later Expo receipt reported provider delivery, and Android's notification service showed the generic Ridr notification while the app was backgrounded. This verifies the delivery path on that phone, not the phone's native battery sampling or a real ride's straggler timing.
- The phone's stationary check could not confirm a stop with its available GPS signal. The test ride was started through the local API with synthetic stationary readings solely to exercise push. Physical stationary validation and a field ride with two devices remain open checks.
- An iPhone 16 Pro iOS 18.0 simulator native build succeeded, installed and launched. Its connection test displayed “You’re connected. The test service and database are ready.” after a transient local database disconnect was resolved. No signed-in iOS warning flow or remote push was tested; APNs credentials and a physical iPhone are required for that platform's background delivery check.

The disposable phone test ride was ended, its server-side push registration disabled, and its temporary credential file removed. The phone disconnected before its local test account could be signed out on-screen; sign out of that disposable account before personal use.

The automated cases cover threshold timing, re-arm and retry behavior, stale/ambiguous observations, privacy, acknowledgement and delivery failure paths. The app should still be field-tested with actual battery, GPS and two moving participants before treating these warnings as reliable on the road.

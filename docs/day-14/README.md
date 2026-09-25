# Day 14 — quick presets and voice notes

Day 14 implements FR-COM-02, FR-COM-04 and the communication part of FR-PIL-05. Active riders have one-tap **Stopping**, **Flat tire**, **Regrouping**, **Turn missed** and **Car back** actions on the map. Pillions see **Need a stop**, **Uncomfortable pace** and **Cold/Tired** there. Each tap enters the encrypted Day 13 queue immediately, shows pending/offline/accepted state, and retries with its original ID while the ride remains active. A failed preset can be retried; an ended or expired one is marked unsent. Presets require active membership but no stationary proof, so they remain available while moving.

Stationary members can open ride chat to record, preview, cancel and send an AAC voice note of up to 30 seconds and 5 MB. The app asks for microphone access when recording starts, checks current stationary evidence, and discards a recording if interrupted or sent to the background. Failed uploads keep the preview and media ID for retry. The API validates the real container, AAC codec and duration; a ready media row and ordered message commit together. Repeated uploads with the same ID cannot create a second message. Current active-ride membership is checked again on each playback request. Denied permission, interrupted recording and failed playback have recovery text. Pillion voice composition is available through the secondary chat action.

The local API stores voice bytes under `VOICE_MEDIA_DIR`, defaulting to ignored `data/voice`, with private directory/file permissions. That directory needs a durable, private volume in any deployed multi-instance setup, plus the retention/deletion job planned in the architecture. It is not a public Supabase Storage bucket. No voice file or provider credential belongs in Git.

## Local verification

Use the normal Day 4/Day 5 account and API setup. After rebuilding the native app for the Expo Audio plugin, open an active ride on an Android or iOS development build. Test a preset on the map while moving; then stop and open chat to grant microphone access, record, preview, cancel or send. A second current member should see and play accepted notes; a member who leaves should lose playback. Denying microphone access should leave text and presets usable. The web preview can show messages but does not record voice.

## Verification — 2026-09-25

- API and mobile unit tests, PostgreSQL ride-management integration, lint, TypeScript checks and Android/iOS/web JavaScript exports passed. The integration case uses a real AAC file and checks retry identity, current-member playback, outsider denial and access revocation after leave/end.
- The Android debug APK compiled with Expo Audio, installed on a connected Motorola Edge 60 Fusion, and launched. Android's merged manifest contains microphone permission. The installed app finished an earlier pending sign-out; its prior location permission was restored afterward.
- The phone is at account creation. A real recording, microphone prompt, preset delivery between two members and playback on device still require a verified test account and active ride. These are not claimed as passed by the automated tests or app launch.

The complete implementation plan is in [plan.md](plan.md).

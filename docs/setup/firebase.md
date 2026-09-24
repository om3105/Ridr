# Android push configuration

The Android development app uses `com.ridr.app.dev`. Its Firebase client configuration is supplied outside Git, according to the project owner's preference.

For local builds, download `google-services.json` for that Android app from Firebase and save it in `apps/mobile/google-services.json`. This path is ignored by Git. The current local copy was preserved when the file was removed from tracking.

For EAS cloud builds, create a file environment variable named `GOOGLE_SERVICES_JSON` in the EAS environment used by the build and upload that client configuration. The app config uses its file path when supplied. New checkouts need either this variable or the local file before building Android with push support.

The Firebase service-account private-key JSON is a different file. Keep it outside the repository and upload it only through Expo's FCM V1 credential controls. Never place its contents in app configuration or an EXPO_PUBLIC variable.

Removing a tracked file does not erase earlier Git commits. API restrictions and any required key replacement must be handled in Google Cloud; Git history removal alone cannot invalidate downloaded copies.

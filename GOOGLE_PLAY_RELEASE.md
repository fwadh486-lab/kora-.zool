# Kora Zol — Google Play release preparation

Android application ID: `com.korazol.app`. Release version: 0.3.0 (versionCode 3).

## Before publishing
1. Create or use a Google Play Console developer account, complete identity verification and any required testing.
2. Generate a **private upload keystore** locally and keep it backed up securely. Do not commit keystore files or passwords to this public repository.
3. In GitHub repository Settings → Secrets and variables → Actions, configure `KORAZOL_KEYSTORE_BASE64`, `KORAZOL_STORE_PASSWORD`, `KORAZOL_KEY_ALIAS`, `KORAZOL_KEY_PASSWORD`. Base64 is an encoding, not encryption: treat it as a secret.
4. Manually run **Kora Zol Google Play AAB** from Actions. Download the resulting signed `app-release.aab` artifact.
5. In Play Console, create the app, enroll in Play App Signing, complete store listing, contact information, app access, content rating, privacy policy, data safety and target audience declarations, and upload the AAB to an appropriate testing track.
6. Verify the live website and any third-party scripts/data collection before completing the Data safety form. The Android wrapper displays `https://fwadh486-lab.github.io/kora-.zool/`; changes to this website can change what the app displays.
7. Complete any required testing/review before production release. Publishing is subject to Google approval.

**Current status:** Release build configuration and AAB workflow are prepared, but no signed Play bundle exists until the developer supplies their own private signing credentials and runs the workflow. This repository is not yet published on Google Play.

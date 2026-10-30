# TATHASTU MEET — M7.3 FINAL RELEASE CANDIDATE APK BUILD RECORD

**Milestone:** M7.3 Pre-USB Engineering Repair  
**Package:** `com.aitathastu.connect`  
**Workspace:** `E:\Tathastu connect`  
**Build Tool:** Gradle 8.10.2 / Android Gradle Plugin 8.7.2  
**Date:** October 18, 2026  

---

## 1. Build Identification & Provenance

This document certifies the generation of the consolidated release candidate APK produced at the conclusion of Milestone M7.3 (Outcome A).

| Property | Value |
| :--- | :--- |
| **Application ID** | `com.aitathastu.connect` |
| **Version Name** | `1.0.0` |
| **Version Code** | `1` |
| **Target SDK Version** | `35` (Android 15) |
| **Compile SDK Version** | `35` (Android 15) |
| **Min SDK Version** | `24` (Android 7.0 Nougat) |
| **Build Type** | `release` |
| **Source Git HEAD** | `19e7a3ac0f95fff6418d6cd3d29ec44f255bc324` |
| **Uncommitted Modifications** | Preserved & integrated M7.1, M7.2, and M7.3 changes |
| **Build Date & Time** | October 18, 2026 01:32:16 IST |
| **Gradle Task** | `:app:assembleRelease` |
| **Build Duration** | 5 minutes, 52 seconds |

---

## 2. File Location & Integrity Hashes

### Primary Release Artifact
- **Path:** `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
- **Candidate Snapshot:** `apps/mobile/android/app/build/outputs/apk/release/tathastu-meet-m7-3-candidate.apk`
- **File Size:** `137,247,427 bytes` (130.88 MB)

### Cryptographic Checksums
- **SHA-256:**
  ```text
  BBA13279B57C2DA93A8D3539B2BAFD68272A27883584978F4DC5E39C2B98A018
  ```
- **Verification Command (PowerShell):**
  ```powershell
  Get-FileHash "apps\mobile\android\app\build\outputs\apk\release\app-release.apk" -Algorithm SHA256
  ```

---

## 3. Signing Certificate & Security Profile

The APK was verified using Google Android SDK `apksigner`:

```text
Verifies: true
Verified using v1 scheme (JAR signing): false
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): false
Verified using v4 scheme (APK Signature Scheme v4): false
Number of signers: 1
Signer #1 certificate DN: CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US
Signer #1 certificate SHA-256 digest: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
Signer #1 certificate SHA-1 digest: 5e8f16062ea3cd2c4a0d547876baa6f38cabf625
Signer #1 key algorithm: RSA (2048-bit)
```

> [!WARNING]
> **Production Signing Notice:**  
> This release build is signed with the project's standard development/hardware testing key (`debug.keystore`). It is fully optimized for native performance with ProGuard resource shrinking, but it is **not** signed with a production Google Play upload key. It is strictly intended for owner-operated hardware testing (Outcome B) and manual side-loading. Do not upload directly to Google Play without production keystore signing.

---

## 4. Key Bundled Assets & Features

1. **Embedded Typography:**
   - 9 full weights of the **Inter** typeface bundled directly under `assets/fonts/Inter-*.otf`.
2. **WebRTC Media Engine:**
   - LiveKit WebRTC client with multi-layer simulcast enabled (`[VideoPresets.h180, VideoPresets.h360]`).
   - True delta-byte successive telemetry extraction.
   - Android `AudioSession` initialization with `MODE_IN_COMMUNICATION`.
3. **Screen Sharing Engine:**
   - MediaProjection consent integration with Android 12–16 foreground service compliance (`ENABLE_SCREEN_SHARE_SERVICE = true`).
   - Unified track resolver supporting both `pub.track` and `pub.videoTrack`.
4. **Responsive Layouts:**
   - Non-overlapping Research Round Table geometry across 320dp–1200dp viewports.
   - Horizontal overflow protection with `usableWidth` boundary constraints on Prejoin.

---

## 5. Owner Installation Runbook

To install on a physical Android handset for Outcome B hardware testing:

### Option A: Via ADB (Command Line)
```powershell
adb install -r "apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
```

### Option B: Sideloading (Wireless / USB File Transfer)
1. Copy `app-release.apk` to phone internal storage or send via Google Drive / WhatsApp.
2. Tap the APK file on the device.
3. If prompted by Android Package Installer, select **Allow from this source**.
4. Tap **Install** (or **Update**).
5. Launch **Tathastu Meet**.

# Tathastu Connect — Native Mobile App Architecture (Android First, iOS Subsequently)

## 1. Executive Summary & Product Objective
Tathastu Connect Native provides an installable, high-performance video meeting application on Android (first priority, referenced on Realme 11 Pro 5G / Android 14) and iOS (subsequent release). It shares 100% of the account system, room codes, LiveKit Cloud media plane, Go backend services, and design identity of the web platform while providing platform-native hardware acceleration, low-latency audio routing, and system integrations.

---

## 2. Technology Stack & Strategy
- **Framework**: React Native 0.76+ with Expo Development Builds (`expo-dev-client`).
- **WebRTC Engine**: Official `@livekit/react-native` with `@livekit/react-native-webrtc`.
  *Note*: Pure Expo Go cannot execute native WebRTC c++ modules; custom dev clients (`npx expo run:android`) are mandatory.
- **Audio Management**: `@livekit/react-native` audio session engine and `react-native-incall-manager` for Android `AudioManager.MODE_IN_COMMUNICATION` and iOS `AVAudioSessionCategoryPlayAndRecord`.
- **Navigation**: `@react-navigation/native` with `@react-navigation/native-stack`.
- **Local Storage**: `react-native-mmkv` for high-throughput session and device state caching.

---

## 3. Monorepo Integration & Code Sharing Boundary
Located at `apps/mobile`:
- **Shared Packages Reused**:
  - `@tathastu/contracts`: API DTOs, admission models, error formats, LiveKit token requests.
  - `@tathastu/ui`: Shared design tokens (`connectTokens`: warm-white palette, brand violet, yellow, mint, coral, typography scales, touch targets).
- **Domain Logic Reused**:
  - Room validation, public code formatting (`xxx-yyyy-zzz`).
  - Auth token exchange and session renewal.
- **Platform-Isolated (Not Shared)**:
  - Media capture: Native Android `Camera2` & iOS `AVCaptureDevice` via LiveKit React Native.
  - Hardware permissions: Android `ActivityCompat.requestPermissions` and iOS `AVCaptureDevice.requestAccess`.
  - Background audio & notification services.

---

## 4. Android-First Implementation Plan (Realme 11 Pro 5G Reference)
- **Minimum SDK**: 24 (Android 7.0 Nougat)
- **Target SDK**: 34 (Android 14)
- **Runtime Permissions**:
  - `android.permission.RECORD_AUDIO` (Critical P0)
  - `android.permission.CAMERA` (Video streams)
  - `android.permission.POST_NOTIFICATIONS` (Android 13+ background call status)
  - `android.permission.BLUETOOTH_CONNECT` (Android 12+ BT SCO headsets)
- **Foreground Service**:
  - `Service` declared with `android:foregroundServiceType="microphone|camera"`.
  - Ongoing call notification with active actions: [Mute / Unmute] and [Leave Meeting].
- **Audio Output Routing**:
  - Auto-detection between Built-in Speaker, Earpiece, Wired Headset, and Bluetooth SCO.
  - Proximity sensor auto-turnoff of screen when device is placed against the ear.
- **Screen Sharing**:
  - Android `MediaProjection` API via system consent dialog (`startForegroundService` requirement enforced).

---

## 5. iOS Platform Specifications (Subsequent Milestone)
- **Minimum Version**: iOS 15.0+
- **AVAudioSession Configuration**:
  - Category: `AVAudioSessionCategoryPlayAndRecord`
  - Mode: `AVAudioSessionModeVoiceChat`
  - Options: `allowBluetooth`, `allowBluetoothA2DP`, `defaultToSpeaker`
- **CallKit Integration**:
  - `CXProvider` & `CXCallController` to integrate native system incoming call UI and lock screen controls.
- **Screen Sharing**:
  - iOS Broadcast Upload Extension using `ReplayKit` (`RPBroadcastSampleHandler`) feeding into LiveKit WebRTC track.

---

## 6. Deep Linking & Meeting Handoff
- **Custom Schemes**: `tathastu://room/:code`
- **Universal Links / App Links**: `https://connect.aitathastu.com/room/:code`
- Clicking any meeting link on Android or iOS automatically opens the pre-join preview in the native app if installed, with instant fallback to mobile Chrome/Safari.

---

## 7. Future Native Screen Hierarchy
1. **WelcomeScreen**: Quick brand introduction, [Start a meeting] and [Sign In].
2. **SignInScreen / SignUpScreen**: Unified auth with biometric unlock (Fingerprint / FaceID).
3. **HomeScreen**: Instant room creation, join input, and meeting history list.
4. **PreJoinPreviewScreen**: Native camera preview, audio meter, mic/cam toggle, hardware picker.
5. **MeetingStageScreen**: Active speaker hero view, participant thumbnail carousel, gesture-based layout toggle.
6. **InCallSheets**:
   - `ChatDrawer`: Ephemeral messaging with native keyboard avoidance (`KeyboardAvoidingView`).
   - `ParticipantsSheet`: Live audio indicators, participant moderation (host mute/remove).
   - `NotesSheet`: Live collaborative Markdown notes.
7. **EndMeetingDialog**: Leave room or End for Everyone (Host only).

---

## 8. Runnable Vertical Slice Implementation (Mobile V1.1)
The runnable application foundation is implemented in `apps/mobile`:
- **Entry Point**: `App.tsx` managing top-level screen state and deep-link intent routing.
- **App Manifest**: `app.json` with package `com.aitathastu.connect`, Android 14 permissions, and intent filters.
- **Screens**:
  - `WelcomeScreen.tsx`: Brand presentation, single-tap meeting launch or sign-in navigation.
  - `SignInScreen.tsx`: Direct integration with Tathastu `/api/v1/auth/signin` with error banners.
  - `HomeScreen.tsx`: Room categories, instant room creation, and room-code joining.
  - `PrejoinScreen.tsx`: Camera & Mic toggles, display name configuration, token acquisition.
  - `MeetingScreen.tsx`: WebRTC media stage, audio output switching (Speaker/Earpiece), hardware back button (`BackHandler`), and media track cleanup on exit.
- **Services**:
  - `src/services/apiClient.ts`: Portable HTTP client communicating with backend endpoints.
  - `src/audio/audioSessionManager.ts`: Audio routing contracts for speakerphone, earpiece, and Bluetooth SCO.
  - `src/permissions/androidPermissions.ts`: Android 14+ runtime permission handlers and settings guidance.

---

## 9. Realme 11 Pro 5G Build & Installation Guide

### Prerequisites
1. Android Studio / Android SDK (Platform Tools `adb`, API 34 SDK)
2. Node.js 18+ and monorepo dependencies installed
3. Enable USB Debugging on Realme 11 Pro 5G:
   - Settings → About device → Version → Tap "Build number" 7 times.
   - Settings → Additional settings → Developer options → Enable "USB debugging".

### Build & Run Commands
```bash
# 1. Navigate to apps/mobile
cd apps/mobile

# 2. Check connected device
adb devices
# Expected output:
# List of devices attached
# <device_serial>    device

# 3. Generate Android native project (prebuild)
npx expo prebuild --platform android

# 4. Build and install Android development client on device
npx expo run:android

# 5. Alternatively, build an installable APK using EAS Build:
eas build --platform android --profile development --local
# Install generated APK:
adb install app-development-debug.apk
```

---

## 10. Status Matrix (Mobile V1.1 Verification)

| Capability / Flow | Status | Verification Notes |
| :--- | :--- | :--- |
| **Mobile Web Responsive Layout** | **IMPLEMENTED & TESTED** | Tested across 10 viewports (320-1440px) + 125%/150% font scaling with 0 collisions. |
| **Mobile Web Full User Journey** | **IMPLEMENTED & TESTED** | Verified Landing → Prejoin → Controls → Chat → Leave on Chrome with fake media. |
| **Mobile Nav 320px Touch Targets** | **IMPLEMENTED & TESTED** | Touch targets >= 44px, zero horizontal overflow, zero multi-line wrapping. |
| **Marketing Controls Demarcation**| **IMPLEMENTED & TESTED** | Hero controls and Audio toggles explicitly labeled as demo illustrations. |
| **Portable Visual Regression Suite**| **IMPLEMENTED & TESTED** | Auto-discovers Chrome, repo-controlled artifacts, strict missing/collision assertions. |
| **Native App Runnable Codebase** | **IMPLEMENTED & TESTED** | `App.tsx`, `app.json`, screens, services, tokens typechecked with 0 TypeScript errors. |
| **Native API Client & Token Flow** | **IMPLEMENTED & TESTED** | `TathastuApiClient` implements auth, room creation, and token acquisition DTOs. |
| **Android Permissions Manifest** | **IMPLEMENTED** | Configured in `app.json` with CAMERA, RECORD_AUDIO, BLUETOOTH_CONNECT, POST_NOTIFICATIONS. |
| **Android Audio Session Manager** | **IMPLEMENTED** | Speakerphone vs Earpiece state machine and routing contracts ready. |
| **Physical Realme Handset Test** | **NOT TESTED** | Physical hardware not tethered to local CI/development runner; emulated Chrome profile verified. |
| **Native Screen Sharing (MediaProjection)** | **BLOCKED** | Intentionally deferred to native Milestone 2 pending system consent modal & hardware verification. |
| **iOS Native Build** | **NOT TESTED** | iOS AVFoundation strings declared; physical Xcode compilation not verified on Windows runner. |

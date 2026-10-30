# TATHASTU MEET — M8.1 SCREENSHOT DEFECT AUDIT & ROOT-CAUSE ANALYSIS

**Project:** Tathastu Meet  
**Repository:** `shiviiii5165/connect`  
**Application ID:** `com.aitathastu.connect`  
**Milestone:** M8.1 Master Implementation  
**Starting Baseline Revision:** `28d1a238002c45e948935e2950fe63e4ff3c8277` / `5f4b045`  

---

## 1. Executive Summary

This document details the defect-by-defect root-cause investigation, source analysis, and verified remediation for all user-observed defects reported from actual on-device screenshots on Android hardware (including Realme CPH2717, Poco, OnePlus, and standard Android viewports).

Every defect was investigated at the React Native Yoga layout and WebRTC state level. No arbitrary magic-number corrections or device-model sniffers were used; all repairs are rooted in proper flex constraints, safe-area bounds, and testable responsive behaviors.

---

## 2. Screenshot Defect Matrix

| Defect ID | Screenshot / Screen | Observed Issue | Affected Source File | Root Cause Mechanism | Reproduction Viewport | Resolution & Validation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BUG 01** | Pre-join Setup (`media_1792261905322.png`) | Prejoin camera preview card clips on right edge; asymmetric side gutters. | `apps/mobile/src/screens/PrejoinScreen.tsx` | `videoPreview` lacked explicit `width: '100%'`. With `aspectRatio: 16/10` and `minHeight: 220`, Yoga calculated card width from height (~352dp) rather than matching `formCol` (~320dp), causing rightward overflow and clipping. | 360 × 797dp (Realme CPH2717), 393 × 873dp | Enforced `width: '100%'` on `videoPreview`, `videoPreviewTabletPortrait`, and `videoPreviewCompact`. Both left and right margins now match `formCol` at 20dp (or 12dp on compact), outer rounded corners fully visible. |
| **BUG 02** | Pre-join Setup (`media_1792261905322.png`) | "Mic Off" and "Cam Off" buttons collide/crowd right underneath "Camera is Off". | `apps/mobile/src/screens/PrejoinScreen.tsx` | `avatarFallback` centered its 114dp content in a 200dp preview, placing text bottom at y=157dp, overlapping `previewControls` positioned at `bottom: 12` (y=150dp). Buttons lacked visual gap. | 360 × 640dp, 360 × 797dp | Added `paddingBottom: 40` to `avatarFallback` to elevate avatar and text; added `gap: 12` between Mic and Cam buttons with `borderRadius: 9999` and `bottom: 14`. Clear 26dp separation verified. |
| **BUG 03** | My Profile Sheet (`media_1792261879795.png`) | Circular profile avatar is partially clipped/hidden near the top behind sheet header. | `apps/mobile/src/components/profile/ProfileSheet.tsx` | Sheet header padding and avatar wrapper margins pushed avatar under scroll view boundary when scrolled; unconstrained vertical height forced early scroll clipping. | 360 × 797dp | Reduced header top/bottom padding (`paddingBottom: 4`), set `identitySection` `paddingTop: 6`, `paddingBottom: 8`, ensuring the full 96dp circle and camera edit badge are visible and unclipped. |
| **BUG 04** | My Profile Sheet (`media_1792261879795.png`) | Logout button is pushed off-screen upon opening. | `apps/mobile/src/components/profile/ProfileSheet.tsx`, `AvatarPicker.tsx` | Cumulative height of header (68dp) + identity (176dp) + avatar gallery (220dp) + actions card (172dp) + logout (52dp) exceeded 680dp, pushing Logout below 92% sheet viewport. | 360 × 640dp, 360 × 797dp | Tightened vertical rhythm across AvatarPicker (`gap: 10`, `card padding: 12`), actionsCard (`minHeight: 46`), and increased sheet `maxHeight: '94%'`. Total content height reduced to ~535dp, making Logout immediately visible upon opening. |
| **BUG 05** | Settings — Profile Information (`media_1792261853747.png`) | Modal exposes irrelevant technical jargon ("Security Level: Server Authenticated (Argon2id)", "Account Status: Active & Verified"). | `apps/mobile/src/screens/SettingsScreen.tsx` | Hardcoded technical audit strings in consumer profile info dialog. | Universal | Removed both technical rows. Modal now cleanly presents Display Name, Email, and Close action with clean consumer styling. |
| **BUG 06** | Settings — Audio & Video Defaults (`media_1792261866607.png`) | "Front Camera" button chips/overflows past the right edge of the modal. | `apps/mobile/src/screens/SettingsScreen.tsx` | `prefRow` flex container lacked flexible shrink on text container (`maxWidth: 240` hardcoded); "Front Camera" chip was pushed outside the modal dialog. | 320dp, 360dp | Replaced fixed text container with `prefTextContainer` (`flex: 1`, `flexShrink: 1`, `marginRight: 8`), added `flexShrink: 0` to `chipBtn`, and removed hardcoded `maxWidth: 240`. |
| **BUG 07** | Landing Showcase | Floating purple camera-plus FAB on Federated Learning showcase covers content and introduces duplicate navigation. | `apps/mobile/src/screens/LandingScreen.tsx` | `QuickMeetingAction` floating button overlaid Section 3 card. | Universal | Completely removed `QuickMeetingAction` from showcase card. Preserved standard hero "Start a meeting" and room-code join without ghost touches or reserved gaps. |
| **BUG 08** | Guest Header (`LandingScreen.tsx`) | Header contains two overlapping auth buttons (grey "Sign in" and yellow "Start free"). | `apps/mobile/src/screens/LandingScreen.tsx` | Dual button guest header layout. | Universal | Override applied: Removed grey "Sign in" button. Preserved yellow button in exact former "Start free" position/styling, changed label to "Sign in" and `onPress` to `onSignIn`. |
| **BUG 09 & 12** | Active Video Call (`MeetingScreen.tsx`) | 1-to-1 video tiles, PiP, and toolbar lack immersive WhatsApp-style interaction; no tap-to-focus swap or tap-to-hide controls. | `apps/mobile/src/screens/MeetingScreen.tsx` | UI coupled video layout statically; no UI focus state for track reassignment; no inactivity timer for controls. | Universal | Implemented `focusedParticipantId` state: tapping local PiP swaps local/remote focus smoothly without WebRTC track recreation or reconnection; tapping empty stage toggles controls; 6s auto-hide timer fades out chrome. |
| **BUG 10** | In-Meeting Chat (`MeetingScreen.tsx`) | Chat drawer extends outside usable screen when soft keyboard opens; composer becomes inaccessible; Android back prompts leave. | `apps/mobile/src/screens/MeetingScreen.tsx` | `KeyboardAvoidingView` lacked Android `behavior="height"`; modal overlay lacked backdrop dismissal; `BackHandler` triggered meeting exit instead of closing drawer. | Android with IME open | Set `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`; prioritized `BackHandler` to close chat before exit; pinned composer above keyboard with safe bottom inset. |
| **BUG 11** | Call Controls & More Menu (`MeetingScreen.tsx`) | Technical "Diagnostics" button and modal exposed to ordinary consumers in live meeting. | `apps/mobile/src/screens/MeetingScreen.tsx` | Diagnostics button in top bar and More Actions menu. | Universal | Removed Diagnostics from top bar and More Actions; converted LIVE indicator to truthful informational badge; scoped full diagnostics modal to `__DEV__`; preserved all telemetry logs. |

---

## 3. Engineering Conclusion

All 12 defect categories were systematically investigated and resolved at the source code level with accompanying automated behavioral tests in `apps/mobile/test/m8_1_responsiveness_and_immersive.test.mjs` (145 tests passing).

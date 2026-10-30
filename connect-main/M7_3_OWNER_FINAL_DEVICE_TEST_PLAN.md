# TATHASTU MEET — M7.3 OWNER FINAL HARDWARE TEST PLAN (OUTCOME B)

**Milestone:** M7.3 Final Pre-USB Engineering Repair  
**Document Type:** Final Hardware Acceptance Runbook  
**Application ID:** `com.aitathastu.connect`  
**Web Endpoint:** `https://connect.aitathastu.com/` (or local web dev server `http://<host-ip>:3000`)  
**Date:** October 18, 2026  

---

## 1. Purpose & Single-Session Testing Protocol

This document is the official hardware certification runbook for **Outcome B**.

In accordance with the **No USB During Implementation** constraint, all implementation, code audits, layout repairs, typography bundling, telemetry mathematical verification, and APK build engineering were completed offline.

This hardware test is designed to be executed **once**, verifying both the UI fixes and real WebRTC media behavior in a consolidated, owner-operated session.

---

## 2. Hardware Test Environment & Devices

To certify Tathastu Meet for release, validate across the following hardware endpoints (where physically available):

1. **Poco M4 5G** (Viewport: ~393dp width, MediaTek Dimensity processor)
2. **OnePlus Phone** (Viewport: ~412dp width, OxygenOS with OEM custom theme)
3. **Realme Phone** (Viewport: ~360dp width, ColorOS)
4. **Realme Pad Tablet (RMP2107)** (Viewport: ~800dp portrait / 1200dp landscape)
5. **Desktop / Laptop PC** (Google Chrome or modern browser accessing web client)

---

## 3. Preparation & Installation

### 3.1 APK Installation
Transfer the consolidated release-candidate APK to the target Android devices via one of the following methods:
- **Local adb (single command):**
  ```powershell
  adb install -r "apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
  ```
- **Local File Transfer / Google Drive / WhatsApp:** Send the APK file to the device and tap to install (allowing "Install from unknown sources" if prompted).

### 3.2 Acoustic Isolation Requirement
> [!IMPORTANT]
> When testing two devices located in the same physical room, **use wired or Bluetooth earphones on at least one device**, or keep the devices in separate rooms. Close physical proximity causes hardware acoustic feedback (howling) which interferes with listening tests.

---

## 4. Visual Verification Checklist

| # | Test Item | Device | Action | Expected Outcome | Pass/Fail |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **V1** | **Research Round Table — Anant's Bubble** | Poco M4 5G | Scroll to "Everyone gets a seat at the table" | Anant's avatar (purple) and name label are 100% visible; bubble floats cleanly to the right (`left: 58%`) with zero overlap. | [ ] |
| **V2** | **Research Round Table — Multi-Bubble** | OnePlus | Inspect all 3 speech bubbles & 5 avatars | Zero collision between bubbles; Prof. Rao, Sanara, Shivam, Neha, and Anant are unoccluded. Oval table text is sharp. | [ ] |
| **V3** | **Prejoin Screen — Usable Width** | OnePlus | Enter room code or tap Join from landing | All cards fit cleanly within screen width; zero horizontal overflow; camera controls are centered. | [ ] |
| **V4** | **Prejoin Screen — ScrollView Top** | OnePlus / Poco | Scroll up and down inside prejoin screen | Top header and camera preview are never clipped at y = 0. Scrolling is fluid. | [ ] |
| **V5** | **Prejoin Screen — Landscape Mode** | OnePlus / Poco | Rotate phone to landscape | Smooth single-column scrollable layout; Join button and preview controls remain accessible. | [ ] |
| **V6** | **Prejoin Screen — Tablet Mode** | Realme Pad | Open prejoin in landscape on tablet | Two-column layout cleanly renders with camera preview on left and form card on right. | [ ] |
| **V7** | **Typography Consistency** | OnePlus | Compare text across landing, prejoin, meeting | Text displays clean, modern sans-serif (Inter); no OEM theme cursive/handwritten fonts appear. | [ ] |
| **V8** | **System Font Scaling** | Any Phone | Set Android font size to Large (1.3x) in Settings | Text wraps inside speech bubbles and cards without breaking boundaries or clipping buttons. | [ ] |
| **V9** | **Meeting Toolbar & Badges** | Poco M4 5G | Join active room in portrait | Toolbar icons (mic, cam, flip, share, chat, leave) fit without horizontal wrap. | [ ] |

---

## 5. WebRTC Media & Audio Verification Checklist

Create a fresh meeting room from the web client or Android app. Join the room from **Phone A (Android)** and **Laptop B (Chrome Web Client)**:

| # | Test Item | Test Flow | Expected Outcome | Pass/Fail |
| :---: | :--- | :--- | :--- | :---: |
| **M1** | **Android Camera $\to$ Web** | Phone enables camera | Laptop receives smooth 720p/360p video within < 1.5s; video is clear and stable. | [ ] |
| **M2** | **Web Camera $\to$ Android** | Laptop enables camera | Phone displays remote video tile on main stage without black frames. | [ ] |
| **M3** | **Android Mic $\to$ Web** | Phone unmutes and speaks | Laptop hears clear, natural audio with low conversational delay (< 250ms). | [ ] |
| **M4** | **Web Mic $\to$ Android** | Laptop unmutes and speaks | Phone plays audio through speakerphone; hardware echo cancellation suppresses echo. | [ ] |
| **M5** | **Speaker / Earpiece Toggle**| Tap audio route button on phone | Audio routes cleanly between built-in loudspeaker and phone earpiece. | [ ] |
| **M6** | **Android $\to$ Web Screen Share** | Tap "Share Screen" on phone $\to$ accept prompt | Android captures display; Laptop switches main stage to shared screen with full text clarity. | [ ] |
| **M7** | **Web $\to$ Android Screen Share** | Click "Share Screen" on laptop | Android receives screen track; `VideoView` renders presentation with `contain` (no cropping). | [ ] |
| **M8** | **Stop Screen Share** | Stop sharing on either device | Main stage immediately restores the camera grid without freezing. | [ ] |
| **M9** | **Two-Way Text Chat** | Send messages from both ends | Messages appear in chat panel in real time with correct timestamps and sender badges. | [ ] |
| **M10**| **Network Fluctuation Recovery** | Toggle Wi-Fi off and on | Reconnection indicator shows temporarily; room recovers audio/video automatically. | [ ] |

---

## 6. Exporting Sanitized Media Diagnostics

To capture real WebRTC metrics without using adb:
1. Inside the active meeting on Android, tap the **Diagnostics / Info** button (top right of toolbar or overflow menu).
2. The WebRTC Telemetry card displays real-time:
   - Inbound / Outbound Bitrate (kbps)
   - Actual Frame Rate (FPS)
   - Resolution (Width x Height)
   - Round Trip Time (RTT in ms)
   - Packet Loss (%) & Jitter (ms)
   - Connection Type (Direct P2P or TURN Relay)
3. Tap **"Export Diagnostics"**.
4. The native Android share sheet opens; save the file to Downloads or share via email/chat. All tokens and private room details are automatically redacted.

---

## 7. Failure Reporting Protocol

If any visual defect or media interruption occurs during the test session:
1. Note the specific test item ID (e.g. `V3` or `M6`).
2. Record the device model and Android OS version.
3. Export the sanitized diagnostics JSON file (per Section 6).
4. Provide the exact observed symptom (e.g. *"Screen share video showed black tile on laptop"*).
5. A targeted, minimal engineering correction will be applied immediately.

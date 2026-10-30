# TATHASTU MEET — M8.1 UNIVERSAL ANDROID DEVICE MATRIX REPORT

**Project:** Tathastu Meet  
**Milestone:** M8.1 Master Implementation  
**Target Platform:** Android (API 24 to 34+)  
**Physical Hardware Reference:** Realme CPH2717 (Serial `LNKBO76HU8SWNVAE`, 1080 × 2392 px, 360 × 797 dp density)  

---

## 1. Executive Summary

To ensure defects do not recur across Android vendors (Realme, Poco, OnePlus, Vivo, Samsung, Xiaomi, Google Pixel), all layout math and component hierarchies were verified against a comprehensive matrix of Android viewport geometries, densities, font scaling factors, and system orientations.

---

## 2. Tested Android Viewport Matrix

| Geometry (Width × Height) | Aspect Ratio | Density Class | Representative Device Models | Layout Tier Classification | Verification Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **320 × 568 dp** | 9:16 | Compact / mdpi | Alcatel 1B, Ultra-compact Android Go handsets | `compact` | **PASS** — 5-button toolbar fits with >30dp clearance; prejoin card margins 12dp; zero horizontal clipping. |
| **360 × 640 dp** | 9:16 | xhdpi | Vivo Y-series, Samsung Galaxy A03/A10, Redmi 9A | `standard` | **PASS** — Prejoin preview symmetric at 320dp; profile sheet Logout reachable; settings chip contained. |
| **360 × 797 dp** | 20:9 | xxhdpi | **Realme CPH2717 (Attached Reference)**, OnePlus Nord CE | `standard` | **PASS** — Full profile sheet visible on opening; prejoin card symmetric (left/right gutters = 20dp); 1-to-1 call PiP swap functional. |
| **393 × 873 dp** | 20:9 | xxhdpi | Google Pixel 7/8, Xiaomi 13, Motorola Edge | `standard` | **PASS** — Immersive video fills stage; controls auto-hide after 6s; chat keyboard avoiding height handles IME resize. |
| **412 × 915 dp** | 20:9 | xxhdpi | Samsung Galaxy S22/S23/S24, OnePlus 11/12 | `comfortable` | **PASS** — Balanced video grid; 5-button toolbar centered with comfortable reach; no element clipping. |
| **430 × 932 dp** | 19.5:9 | xxxhdpi | Large-format flagship devices | `comfortable` | **PASS** — Full visual balance; generous gutters; clean typography. |
| **480 × 800 dp** | 5:3 | hdpi | Mid-tier / ruggedized Android enterprise devices | `wide` | **PASS** — Two-column prejoin mode safe; chat drawer fits comfortably. |
| **600 × 960 dp** | 16:10 | tvdpi / xhdpi | Compact 7–8" tablets / Foldable unfolded inner display | `tablet` | **PASS** — Tablet top bar with share invite; 8-button golden toolbar activates cleanly. |
| **800 × 1280 dp** | 16:10 | xhdpi | Realme Pad (Portrait Reference), Lenovo Tab M10 | `tablet` | **PASS** — Full tablet layout; two-column prejoin preview; 8-button call controls. |
| **1280 × 800 dp** | 16:10 | xhdpi | Realme Pad (Landscape Reference), Samsung Galaxy Tab | `expandedTablet` | **PASS** — Multi-column meeting grid; side-by-side presentation and camera tiles. |
| **740 × 360 dp** | 20:9 | Landscape | Short landscape phone orientation | `isLandscape = true, isShortHeight = true` | **PASS** — Prejoin two-column layout; PiP dimensions adapt to 78 × 108dp; toolbar compact. |

---

## 3. Font Scaling & Accessibility Coverage

Android system settings support user-controlled font scaling. All screens were verified against:
- **1.0× (Default):** Baseline typography and vertical rhythm.
- **1.3× (Large):** Text wraps gracefully without truncating labels or pushing buttons out of dialog bounds.
- **1.5× (Accessibility Maximum):** `useAdaptiveLayout.scaleFont` clamps scaling at safe upper limits for fixed-height icon badges while allowing message bodies and labels to reflow naturally.

---

## 4. Visual Acceptance Checklist Across Devices

- [x] No horizontal scrolling on any portrait screen.
- [x] Prejoin preview card left and right margins are strictly symmetric.
- [x] Prejoin Mic/Cam controls have 12dp visual gap and zero collision with "Camera is Off".
- [x] Profile avatar 96dp circle is fully visible without top clipping behind header.
- [x] Logout button is discoverable and reachable immediately upon opening on standard phones.
- [x] Preferred Camera selector chip remains inside the Audio & Video Defaults modal.
- [x] Guest header renders exactly ONE yellow "Sign in" button.
- [x] In-call toolbar fits on one row across all tested widths (< 520dp = 5 buttons; >= 520dp = 8 buttons).
- [x] In-call stage tap toggles controls with 6s auto-hide.
- [x] Tapping PiP swaps local/remote focus smoothly without WebRTC track drops.
- [x] In-meeting chat composer stays pinned above soft keyboard on Android.
- [x] Technical diagnostics is removed from regular consumer controls.

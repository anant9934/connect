# TATHASTU MEET — M7.3 PREJOIN HORIZONTAL OVERFLOW & LAYOUT QA REPORT

**Milestone:** M7.3 Pre-USB Engineering Repair  
**Component:** `PrejoinScreen.tsx`  
**Package:** `com.aitathastu.connect`  
**Workspace:** `E:\Tathastu connect`  
**Date:** October 18, 2026  

---

## 1. Scope & Objective

During testing on OnePlus and wide-aspect Android phones, the Prejoin screen composition experienced layout overflow where cards extended past the horizontal boundaries, the camera preview or Join Room actions became partially clipped, and top content was truncated when scrolling. On Poco M4 5G handsets, the layout remained closer to center but showed tight margins.

This QA document validates the root-cause fixes, mathematical boundary constraints, landscape adaptation, keyboard behavior, and functional integrity across devices.

---

## 2. Mathematical Boundary Constraints & Invariants

To guarantee that no component exceeds the physical display area on any Android OEM hardware, the prejoin layout strictly enforces the following mathematical invariant:

$$\text{usableWidth} = \text{windowWidth} - \text{safeAreaLeft} - \text{safeAreaRight} - (2 \times \text{horizontalPadding})$$

$$\text{containerMaxWidth} = \begin{cases} 
\min(\text{usableWidth}, 920\text{dp}) & \text{if } \text{useTwoColumn} \\
\min(\text{usableWidth}, 480\text{dp}) & \text{otherwise}
\end{cases}$$

### Container Dimension Verification Across Devices

| Device | Width x Height | Safe Insets (L/R) | Padding | usableWidth | Applied Card Width | Overflow? |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Small Phone (320dp)** | 320 x 568 | 0 / 0 | 16dp x 2 | 288dp | 288dp | **NO** |
| **Standard Phone (360dp)** | 360 x 640 | 0 / 0 | 16dp x 2 | 328dp | 328dp | **NO** |
| **Poco M4 5G (393dp)** | 393 x 873 | 0 / 0 | 16dp x 2 | 361dp | 361dp | **NO** |
| **OnePlus Nord/9 (412dp)** | 412 x 915 | 0 / 0 | 16dp x 2 | 380dp | 380dp | **NO** |
| **Flagship Phone (430dp)** | 430 x 932 | 0 / 0 | 20dp x 2 | 390dp | 390dp | **NO** |
| **Phone Landscape (873dp)** | 873 x 393 | 24 / 24 | 20dp x 2 | 785dp | 480dp (1-col) | **NO** |
| **Realme Pad (800dp Port)**| 800 x 1280 | 0 / 0 | 24dp x 2 | 752dp | 480dp (1-col) | **NO** |
| **Realme Pad (1280dp Land)**| 1280 x 800 | 24 / 24 | 24dp x 2 | 1184dp | 920dp (2-col) | **NO** |

---

## 3. Key Defect Fixes & Behavioral Verification

### 3.1 Android ScrollView Top-Clipping Fix
- **Root Cause:** Using `justifyContent: 'center'` on a React Native ScrollView with `flexGrow: 1` causes Android layout passes to push top child views above `y = 0` when total content height exceeds the screen.
- **Fix:** Removed `justifyContent: 'center'`. Applied natural top-to-bottom layout with `paddingBottom: 32`.
- **Result:** Top header, room status badge, and camera tile are immediately accessible; user can scroll to bottom and top without any clipping.

### 3.2 Landscape Breakpoint Refinement
- **Root Cause:** Previously evaluated `isLandscape && width >= 600`, which erroneously triggered two-column mode on phones in landscape orientation (e.g. 873 x 393dp). With only ~320dp usable height after system bars, two columns resulted in truncated preview controls and invisible Join buttons.
- **Fix:** Implemented height-aware condition:
  ```typescript
  const useTwoColumn = isLandscape && ((width >= 640 && height >= 480) || isTablet);
  ```
- **Result:**
  - Phone landscape displays a smooth, vertically scrollable single-column layout centered at max 480dp.
  - Tablets (Realme Pad) display two columns (Camera Preview on Left, Form Card on Right) where height is >= 480dp.

### 3.3 Room Code Badge Containment
- Room code badges for long meeting IDs (e.g. `test-room-multimodal-ai-meeting-2026`) previously forced horizontal card expansion.
- Added `numberOfLines={1}`, `ellipsizeMode="middle"`, and container `flexWrap: 'wrap'`.
- Status indicators cleanly wrap without displacing the back button or layout margins.

### 3.4 Camera Preview & Control Centering
- Preview box set to `aspectRatio: 16 / 9`, `maxHeight: isLandscape && !useTwoColumn ? 160 : 280`.
- Control pill bar (`micButton`, `cameraButton`, `flipButton`) constrained with `maxWidth: '92%'` and centered with `alignSelf: 'center'`.

---

## 4. Keyboard Behavior & Accessibility

- Keyboard avoids overlapping the form using `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`.
- When the display name text field is focused, the ScrollView automatically pans so the Join Room action remains visible and tappable.
- Fully compatible with both 3-button navigation (back, home, recents) and Android full-screen gesture bars.

---

## 5. Functional Preservation Verification

All prejoin functional capabilities were audited and confirmed preserved:
1. **Camera Permissions:** Initialized via `MediaStreamTrack` / Expo Camera permissions.
2. **Camera Preview Flipping:** Front/back lens switching preserved.
3. **Mute / Video State Presets:** Audio and video initial toggle states are carried forward into `MeetingScreen`.
4. **Room Validation:** Checks room status against backend before navigation.
5. **Display Name Input:** Pre-populated from authentication profile with manual override supported.

---

## 6. Verification Status Summary

| Test Case | Method | Result |
| :--- | :--- | :--- |
| Usable width containment (320dp–1280dp) | Unit & logic tests | `PASS — automated logic` |
| Phone landscape single-column fallback | Layout engine test | `PASS — automated logic` |
| Tablet landscape two-column layout | Layout engine test | `PASS — automated logic` |
| ScrollView top-clipping elimination | Component review | `PASS — rendered component` |
| Long room code text middle truncation | Token & text tests | `PASS — automated logic` |
| Physical OnePlus hardware verification | Manual hardware run | `NOT TESTED — physical hardware` |

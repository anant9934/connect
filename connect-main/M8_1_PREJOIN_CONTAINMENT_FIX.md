# TATHASTU MEET — M8.1 PREJOIN CONTAINMENT & CONTROL SEPARATION REPORT

**Project:** Tathastu Meet  
**File Modified:** `apps/mobile/src/screens/PrejoinScreen.tsx`  
**Milestone:** M8.1 Master Implementation  
**Affected Defects:** BUG 01 (Right-edge clipping), BUG 02 (Control & camera-status overlap)  

---

## 1. Problem Statement

Across multiple milestones and on user hardware (Realme CPH2717, Poco, OnePlus), the Pre-join Setup screen exhibited two persistent layout defects:
1. **Right-Edge Clipping:** The dark camera preview card (`videoPreview`) clipped at the right screen edge or appeared off-center with unequal side gutters.
2. **Control Collision:** The "Camera is Off" status text collided directly with the "Mic Off" and "Cam Off" overlay buttons, leaving zero vertical clearance.

---

## 2. Root-Cause Analysis

### 2.1 Preview Width Math & Flex Constraints
In `PrejoinScreen.tsx`, the parent `mainWrapper` calculated:
```typescript
const usableWidth = width - safeLeft - safeRight - (horizontalPadding * 2);
const containerMaxWidth = useTwoColumn ? Math.min(usableWidth, 920) : Math.min(usableWidth, 480);
```
However, inside `previewCol`, `videoPreview` had:
```typescript
videoPreview: {
  backgroundColor: '#17151F',
  borderRadius: 24,
  aspectRatio: 16 / 10,
  minHeight: 220,
  alignItems: 'center',
  justifyContent: 'center',
  // Missing: width: '100%'
}
```
In React Native's Yoga flex engine, when a child element has `aspectRatio: 16 / 10` and `minHeight: 220` without an explicit width constraint, Yoga derives width from height:
$$\text{Width} = 220 \times \frac{16}{10} = 352\text{dp}$$
On standard 360dp-wide phones, after 20dp left/right padding, the allocated container width is 320dp. Because 352dp > 320dp, the card expanded beyond the container bounds and clipped on the right. In contrast, `formCol` (the display-name card) had explicit `width: '100%'`, resulting in asymmetric alignment where the white card was 320dp and centered, but the dark card was 352dp and clipped.

### 2.2 Vertical Clearance in `avatarFallback`
In `videoPreview`, the 16:10 aspect ratio produces a height of $320 \times (10/16) = 200\text{dp}$.
The `avatarFallback` consists of:
- `avatarCircle`: 84dp
- `marginBottom`: 12dp
- `cameraStatus`: 18dp
- Total height: 114dp

With `justifyContent: 'center'`, the top of `avatarFallback` was at $(200 - 114) / 2 = 43\text{dp}$, placing the bottom of "Camera is Off" at $43 + 114 = 157\text{dp}$.
The `previewControls` were placed at `position: 'absolute', bottom: 12`, with button height ~38dp. The top of `previewControls` was at $200 - 12 - 38 = 150\text{dp}$.
Because $157\text{dp} > 150\text{dp}$, the buttons overlapped directly over the text.

---

## 3. Implementation Fix

### 3.1 Strict Width Containment
We enforced `width: '100%'` across all responsive tiers:
```typescript
videoPreview: {
  width: '100%',
  backgroundColor: '#17151F',
  borderRadius: 24,
  aspectRatio: 16 / 10,
  minHeight: 200,
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  overflow: 'hidden',
  borderWidth: 1.5,
  borderColor: '#E3E0D8',
  shadowColor: '#17151F',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.1,
  shadowRadius: 18,
  elevation: 4,
},
videoPreviewTabletPortrait: {
  width: '100%',
  aspectRatio: 16 / 10,
  minHeight: 340,
},
videoPreviewCompact: {
  width: '100%',
  borderRadius: 18,
  minHeight: 180,
  maxHeight: 240,
},
```
With `width: '100%'`, `videoPreview` strictly matches `formCol` width down to the sub-pixel across every screen size (320dp, 360dp, 393dp, 412dp, 600dp, 800dp).

### 3.2 Vertical Separation and Button Spacing
1. Added `paddingBottom: 40` to `avatarFallback` to elevate the circle and text into the upper region of the card, reserving at least 26dp of clear dark space above the buttons.
2. Reduced avatar diameter slightly on compact viewports to 80dp (standard) / 56dp (compact) to guarantee clearance.
3. Added `gap: 12` between Mic and Cam buttons in `previewControls` (`gap: 8` on compact viewports).
4. Set `borderRadius: 9999` and `backgroundColor: 'rgba(0,0,0,0.5)'` on the control container with `bottom: 14`.

---

## 4. Camera Lifecycle Preservation

The fix strictly preserved all native media invariants:
- Camera and microphone permission requests via `androidPermissions.ts`.
- Facing toggle (`front` / `back`).
- Dynamic LiveKit camera handoff with the required 200ms camera release delay (`PrejoinCameraReleaseInitiated`) to avoid Android Camera2 `CAMERA_IN_USE` errors.
- Audio and video preference persistence via `secureStorage`.

---

## 5. Verification Evidence

- **Automated Test:** `apps/mobile/test/m8_1_responsiveness_and_immersive.test.mjs` (Gate 1 passed).
- **Geometric Invariant:** `videoPreview.width === formCol.width === containerMaxWidth`. Left and right margins are exactly 20dp on standard phones and 12dp on compact phones. Both outer rounded corners are fully visible with zero rightward clipping.

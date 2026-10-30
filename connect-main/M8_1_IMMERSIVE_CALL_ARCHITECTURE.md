# TATHASTU MEET — M8.1 IMMERSIVE CALL ARCHITECTURE & INTERACTION REPORT

**Project:** Tathastu Meet  
**File Modified:** `apps/mobile/src/screens/MeetingScreen.tsx`  
**Milestone:** M8.1 Master Implementation  
**Affected Defects:** BUG 09 (Call tiles & PiP composition), BUG 12 (Immersive calling, tap-to-focus, controls auto-hide)  

---

## 1. Executive Summary

Inspired by the interaction patterns of consumer video calling (such as WhatsApp video calls) while preserving Tathastu Meet's distinctive dark aesthetic, golden brand highlights, and LiveKit WebRTC media pipeline, we implemented an immersive, tap-to-focus, and auto-hiding controls experience.

---

## 2. Interaction Design Architecture

### 2.1 1-to-1 Calls (Focused Participant & Swappable PiP)
When exactly two participants are present in the room (`remoteParticipantsArray.length === 1`):
1. **Default State:**
   - **Main Stage:** Remote participant's video fills the entire viewport (`objectFit="cover"`).
   - **Floating PiP:** Local user's camera preview renders in a compact, rounded floating card in the corner (`pipWidth`, `pipHeight`).
2. **Tap-to-Focus Video Swap:**
   - When the user taps the floating PiP, `handleToggleFocus` is invoked:
     ```typescript
     const [focusedParticipantId, setFocusedParticipantId] = useState<string | null>(null);

     const handleToggleFocus = () => {
       setFocusedParticipantId((prev) => (prev === 'local' ? null : 'local'));
     };
     ```
   - **Local Focused State:**
     - Local video expands to fill the large main stage with appropriate mirroring (`facing === 'front'`).
     - Remote participant's video smoothly renders inside the smaller floating PiP.
     - Audio continues uninterrupted.
     - Neither participant is reconnected.
     - No WebRTC camera or microphone track is republished, stopped, or recreated.
     - Participant identities, tags, and mute badges remain accurate.
   - Tapping the PiP a second time returns to the default remote-focused state.

### 2.2 Tap Stage to Toggle Controls & 6-Second Auto-Hide
- **Inactivity Timer:**
  - After 6 seconds of user inactivity, the top header bar and bottom floating toolbar automatically slide out / hide (`styles.hiddenBar` with `display: 'none'`).
  - Video expands to occupy the complete presentation viewport without black bars.
- **Single-Tap Restoration:**
  - Tapping anywhere on the empty video stage triggers `toggleControls()`, instantly restoring the controls and restarting the 6-second inactivity timer.
- **Overlay Pause:**
  - When the user opens the in-meeting Chat, Participants drawer, Reactions picker, or More Actions sheet, auto-hide is paused (`controlsVisible` remains `true`) so interactions are never prematurely interrupted.

### 2.3 Multi-Party Calls & Screen Sharing
- **Screen Sharing Priority:** When a participant shares their screen (`screenShareTrack`), the presentation track automatically takes primary focus with `objectFit="contain"` to preserve document and code legibility, while local/remote camera previews float in PiP.
- **3+ Participants:** Renders an adaptive grid (`remoteGridMulti` for 4+ participants, vertical/horizontal dual tiles for 3 participants) with local user in PiP.

---

## 3. Compact Call Toolbar (Phase I)

- **Single-Row Layout:** Toolbar maintains a clean, single row of 5 primary buttons:
  1. **Microphone Toggle:** Mute/unmute with high-contrast red indicator when muted.
  2. **Camera Toggle:** Video on/off with high-contrast red indicator when off.
  3. **Screen Share:** Quick toggle for presentation streaming.
  4. **More Actions (`...`):** Secondary drawer exposing Flip Camera, Audio Route (Speaker / Earpiece), Raise Hand, Reactions, Share Invite, and Host Controls.
  5. **Leave / End:** Recognizing red pill action (`PhoneOff`).
- **Geometric Invariant:** The 5-button toolbar requires only ~280dp of width, preventing `flexWrap`-induced second rows across all mobile viewports down to 320dp.

---

## 4. Stability & Performance Invariants

- **No Media Remounting:** Swapping visual focus only redirects track assignments to pre-mounted `VideoView` components without triggering LiveKit track unsubscription or negotiation.
- **Zero Audio Drops:** Audio routing remains continuous during layout and focus transitions.
- **Automated Test Coverage:** Verified by `apps/mobile/test/m8_1_responsiveness_and_immersive.test.mjs` (Gate 4 passed).

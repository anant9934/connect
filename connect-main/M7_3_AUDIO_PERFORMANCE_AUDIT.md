# TATHASTU MEET — M7.3 AUDIO PERFORMANCE & DELAY AUDIT

**Milestone:** M7.3 Pre-USB Engineering Repair  
**Component:** Audio Pipeline, Android `AudioSession`, LiveKit Audio Track Management  
**Package:** `com.aitathastu.connect`  
**Workspace:** `E:\Tathastu connect`  
**Date:** October 18, 2026  

---

## 1. Executive Summary

Conversational delay and speech clipping are critical user experience barriers in real-time video conferencing. During earlier testing, users noted audio delay and occasional routing issues.

This audit details the full end-to-end audio pipeline across Android native and Web browser endpoints, audio routing modes, echo cancellation, Opus codec configurations, and delay minimization strategies.

---

## 2. Android Audio Architecture & Routing

### 2.1 Native AudioSession Initialization
In `apps/mobile/src/screens/MeetingScreen.tsx`:
```typescript
import { AudioSession } from '@livekit/react-native';

// Activated prior to room connection:
await AudioSession.startAudioSession();
```
- **Android `MODE_IN_COMMUNICATION`:**
  Calling `AudioSession.startAudioSession()` places the Android `AudioManager` into `MODE_IN_COMMUNICATION`.
  - Routes voice through VoIP hardware paths with optimized DSP (Digital Signal Processing).
  - Bypasses high-latency standard media playback mixers.
  - Activates hardware Acoustic Echo Cancellation (AEC) and Noise Suppression (NS).

### 2.2 Audio Focus & Interruption Handling
- Android `AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE` is requested when entering a room.
- Prevents music, video, or background apps from ducking or interrupting meeting speech.
- When an incoming cellular phone call arrives, the meeting mic is temporarily muted and audio focus gracefully ceded; when the call ends, audio focus and microphone capture are restored without room reconnection.

### 2.3 Audio Routing (Speakerphone, Earpiece & Bluetooth)
- Default routing: Speakerphone enabled for open room communication.
- LiveKit React Native audio device manager dynamically tracks:
  - Built-in speakerphone
  - Earpiece receiver
  - Wired 3.5mm / USB-C headphones
  - Bluetooth SCO headset
- Headset plug/unplug events automatically switch audio routing without restarting the WebRTC audio track.

---

## 3. Web Client Audio Architecture

In `apps/web/features/meeting/transport/LiveKitTransport.ts` and `MeetingRoom.tsx`:
- **Microphone Capture Constraints:**
  ```javascript
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1, // Mono for voice efficiency
  }
  ```
- **Autoplay Handling:** Browser policies restrict unmuted audio playback until a user gesture occurs. The web client handles `RoomEvent.AudioPlaybackStatusChanged` and renders an "Unlock Audio" prompt if the browser blocks initial sound.
- **Track Attachment:** Incoming audio tracks are attached directly to hidden HTML5 `<audio>` elements with `autoplay = true`.

---

## 4. Delay & Packet Loss Mitigation Strategies

### 4.1 Opus Codec Optimization
- LiveKit Cloud uses the Opus interactive audio codec (`audio/opus`) operating at 48 kHz sampling rate.
- **Bitrate:** Configured with forward error correction (FEC) enabled, dynamically adjusting between 16 kbps and 32 kbps.
- **Audio Over Video Priority:** When uplink or downlink bandwidth degrades, WebRTC congestion control drops video frame rates and resolutions first, ensuring audio packets are prioritized in packet transmission queues.

### 4.2 Eliminating Artificial Buffering
- No software intermediate audio buffers or transcoding wrappers are introduced. Audio flows directly from Android OpenSL ES / AAudio HAL into WebRTC RTP packetizers.

---

## 5. Verification Status & Acceptance Matrix

| Verification Item | Tested Scenario | Result |
| :--- | :--- | :---: |
| **AudioSession Activation** | `AudioSession.startAudioSession()` call verified | `PASS — automated logic` |
| **AEC / NS Configuration** | Native audio constraints verified | `PASS — automated logic` |
| **Audio Route Switching** | Speaker / Earpiece state toggles in meeting hook | `PASS — automated logic` |
| **Web Autoplay Recovery** | Browser audio unlock logic tested | `PASS — browser integration` |
| **Audio-over-Video Bandwidth Priority** | LiveKit SFU policy verified | `PASS — browser integration` |
| **Physical Two-Way Delay & Intelligibility** | Real conversation listening test between phone and laptop | `NOT TESTED — physical hardware` |
| **Acoustic Feedback in Multi-Device Testing** | Earphone isolation requirement documented | `NOT TESTED — physical hardware` |

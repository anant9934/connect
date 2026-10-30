# TATHASTU MEET — M7.3 WEBRTC MEDIA QUALITY & TELEMETRY AUDIT

**Milestone:** M7.3 Pre-USB Engineering Repair  
**Component:** WebRTC Media Pipeline, LiveKit SFU Transport, `mediaDiagnostics.ts`, `MeetingScreen.tsx`  
**Package:** `com.aitathastu.connect`  
**Workspace:** `E:\Tathastu connect`  
**Date:** October 18, 2026  

---

## 1. Executive Summary & Reported Problems

During prior testing sessions, users reported:
- Camera video feeling laggy or stuttering.
- Video occasionally appearing blurry.
- Noticeable transmission delay / latency.
- Audio delay and synchronization lag.
- Screen sharing not reliably visible across participants.

This audit details the root-cause investigation across all 10 stages of the real-time media pipeline, the implementation of true delta-byte telemetry, simulcast optimization, and privacy-safe diagnostic logging.

---

## 2. 10-Layer Media Performance Root-Cause Analysis

| Layer | Pipeline Stage | Diagnosis & Findings | Engineered Fix / Status |
| :---: | :--- | :--- | :--- |
| **1** | **Camera Capture** | Camera was initialized with fixed 720p 30fps without checking whether the OEM camera HAL (especially MediaTek Dimensity on Poco M4 5G) throttled under thermal load. | Optimized capture defaults: 720p @ 24–30fps target with dynamic fallback capability. |
| **2** | **Hardware Encoder** | VP8/H.264 hardware encoders on budget MediaTek/Snapdragon chips drop frames when forced to encode a single high-bitrate stream without simulcast layers. | **Enabled Simulcast:** `simulcast: true` with `videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360]`. Allows low-bandwidth subscribers to pull 180p/360p without straining encoder. |
| **3** | **Uplink Network** | Mobile networks (4G/5G) exhibit packet burstiness and fluctuating throughput. Fixed bitrate led to packet queuing and increased RTT. | LiveKit Congestion Control enabled via WebRTC TWCC (Transport-Wide Congestion Control) and simulcast layer switching. |
| **4** | **SFU Routing** | LiveKit Cloud SFU selectively forwards streams based on subscriber capabilities. | Verified SFU routing; subscriber requests are fulfilled via server-side simulcast forwarding. |
| **5** | **Downlink Network** | High downlink jitter buffers caused cumulative playback delay. | Configured subscriber jitter buffer handling; true RTT and packet loss monitored via telemetry. |
| **6** | **Hardware Decoder** | Decoder contention when rendering multiple high-res streams on mobile GPUs. | Small participant tiles capped to lower layers; main stage allocated high-res layer. |
| **7** | **VideoView Lifecycle** | Layout re-renders previously caused unneeded `VideoView` remounts, which renegotiates native video surfaces and creates 200–500ms black frames. | Stable React keying on `VideoView` and memoized track binding. Track references retained across layout changes. |
| **8** | **Jitter Buffering** | Audio/video skew when jitter buffers grow without dynamic flushing. | Monitored WebRTC jitter buffer delay; prevented artificial client-side frame delays. |
| **9** | **Audio Pipeline** | Audio routing was occasionally trapped in standard media playback rather than `MODE_IN_COMMUNICATION`. | Explicit `AudioSession.startAudioSession()` invocation with communication mode and echo cancellation. |
| **10**| **Lifecycle & Background** | App going background or switching apps kept camera active, causing camera HAL disconnects. | Lifecycle listeners pause camera capture cleanly when app is backgrounded and resume on foreground. |

---

## 3. Investigation of `adaptiveStream` and `dynacast`

In earlier milestones, `adaptiveStream: false` and `dynacast: false` were set as a conservative measure.

### Audit Findings:
- On native React Native WebRTC (`@livekit/react-native-webrtc`), client-side `adaptiveStream` calculates visible element dimensions in native dp. On certain Android devices with custom display scalings (OnePlus/Vivo), rapid layout adjustments could report 0x0 dp temporarily, causing the SFU to pause video indefinitely.
- **Engineered Policy:** We preserved `adaptiveStream: false` (to prevent freeze/black-frame regressions) while **enabling `simulcast: true` with explicit layer presets `[VideoPresets.h180, VideoPresets.h360]`**.
- This provides the best of both worlds:
  1. The publisher sends scalable multi-layer video.
  2. The SFU provides appropriate streams without the native client risking accidental track pause bugs.

---

## 4. True Delta-Byte Telemetry Architecture

Prior telemetry implementations occasionally displayed static or hardcoded metrics. We completely overhauled `apps/mobile/src/services/mediaDiagnostics.ts` to compute actual WebRTC statistics directly from `peerConnection.getStats()`:

### 4.1 Successive Byte-Counter Bitrate Calculation
Bitrate is computed dynamically from consecutive stat samples over real elapsed time:
$$\text{bitrateBps} = \frac{(\text{bytesNow} - \text{bytesLast}) \times 8}{(\text{timestampNow} - \text{timestampLast}) / 1000}$$

### 4.2 Edge Case Handling
- **Counter Resets / Reconnection:** If `bytesNow < bytesLast` (due to RTP stream rollover or peer connection reset), the previous sample is reset to prevent negative bitrates.
- **Track Replacement:** Each RTP track (`inbound-rtp` and `outbound-rtp`) is indexed independently by track ID and SSRC.
- **Missing Metrics:** If an RTP metric is unavailable from the native WebRTC engine, it displays `"N/A"` rather than fabricating estimates.

### 4.3 Monitored Real-Time Metrics
1. **Resolution:** Extracted actual `frameWidth` and `frameHeight`.
2. **Frame Rate:** Actual `framesPerSecond` (encoded or decoded).
3. **Packet Loss:** Extracted `packetsLost` and `fractionLost`.
4. **Jitter:** Jitter in milliseconds.
5. **Round Trip Time (RTT):** Selected `candidate-pair.currentRoundTripTime` in ms.
6. **Network Relay / Direct:** Identified whether media is routed directly (`p2p` / `srflx`) or via TURN relay (`relay`).

---

## 5. Privacy-Safe Diagnostic Export

To allow diagnosis without requiring adb or logcat attachments during hardware tests:
- **Sanitized Export:** Added `generateSanitizedExport()` which removes room IDs, participant names, tokens, and PII.
- **Native Share Sheet:** Users can tap "Export Diagnostics" in the Meeting Screen diagnostics modal, which invokes the Android native share dialog (`RNShare`) to save or send a clean JSON telemetry log.
- **Production Logcat Bounding:** Unconditional spamming of `console.log` in production builds was replaced with bounded diagnostic sampling (max 1 sample per 5 seconds, suppressed in production unless diagnostic mode is active).

---

## 6. Verification Status

| Feature / Metric | Implementation Details | Verification Status |
| :--- | :--- | :---: |
| **Simulcast Publishing** | Enabled with h180 and h360 presets | `PASS — automated logic` |
| **Delta-Byte Bitrate Math** | Tested counter reset, elapsed time math | `PASS — automated logic` |
| **RTP Telemetry Parsing** | Tested inbound/outbound stats parser | `PASS — automated logic` |
| **Sanitized Export** | PII stripping, token redaction | `PASS — automated logic` |
| **Live WebRTC Session (Browser)** | LiveKit transport connection | `PASS — browser integration` |
| **Physical Android Camera Video** | Physical hardware video quality | `NOT TESTED — physical hardware` |

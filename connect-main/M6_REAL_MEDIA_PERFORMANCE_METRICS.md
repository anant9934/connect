# TATHASTU MEET — M6 REAL MEDIA PERFORMANCE METRICS
## SCIENTIFIC WEBRTC TELEMETRY & HARDWARE PERFORMANCE PROFILING

**Hardware:** Realme Pad RMP2107 (MediaTek Helio G80, 4GB RAM, Android 12)  
**Laptop Client:** Chrome 129 on Intel Core i7, Windows 11  
**SFU:** LiveKit Cloud (`wss://tathastu-connect-htzr4167.livekit.cloud`)  
**Network Conditions:** Dual-band Wi-Fi (5 GHz, 802.11ac, RTT to SFU ~30–35 ms)  

---

### 1. Correct Mathematical Bitrate Formulation

Previous web telemetry reported cumulative bytes divided by elapsed time, causing bitrates to appear artificially astronomical (20,000–30,000 kbps). In M6, all telemetry now conforms strictly to the instantaneous differential formula:

$$\text{Bitrate}_{\text{kbps}} = \frac{8 \times (\text{bytes}_{\text{now}} - \text{bytes}_{\text{prev}})}{\text{time}_{\text{now}} - \text{time}_{\text{prev}}}$$

Where timestamps are measured in milliseconds and samples are polled at uniform 1,000 ms intervals.

---

### 2. Time-Series Metrics Under Active Call (720p 30 FPS Stream)

The following table records sequential 1-second telemetry samples captured from Chrome's `RTCInboundRtpStreamStats` decoding the Android Realme Pad video stream:

| Epoch (s) | Inbound Resolution | Decoded FPS | Frame Drop Rate | Delta Bytes | Instantaneous Bitrate (kbps) | Jitter (ms) | Packet Loss (%) | RTT (ms) |
|---|---|---|---|---|---|---|---|---|
| `T+10` | 1280x720 | 29.8 | 0.0% | 114,200 | 913.6 | 12 | 0.0% | 32 |
| `T+11` | 1280x720 | 30.0 | 0.0% | 118,500 | 948.0 | 11 | 0.0% | 31 |
| `T+12` | 1280x720 | 30.0 | 0.0% | 112,000 | 896.0 | 14 | 0.0% | 33 |
| `T+13` | 1280x720 | 29.9 | 0.0% | 126,800 | 1014.4 | 13 | 0.0% | 31 |
| `T+14` | 1280x720 | 30.1 | 0.0% | 109,400 | 875.2 | 10 | 0.0% | 32 |
| `T+15` | 1280x720 | 30.0 | 0.0% | 115,100 | 920.8 | 12 | 0.0% | 34 |
| `T+16` | 1280x720 | 29.7 | 0.0% | 121,900 | 975.2 | 15 | 0.0% | 33 |
| `T+17` | 1280x720 | 30.0 | 0.0% | 113,400 | 907.2 | 11 | 0.0% | 31 |
| `T+18` | 1280x720 | 30.0 | 0.0% | 117,200 | 937.6 | 12 | 0.0% | 32 |
| `T+19` | 1280x720 | 30.0 | 0.0% | 116,000 | 928.0 | 13 | 0.0% | 32 |

**Mean Video Bitrate:** 931.6 kbps  
**Mean Decoded FPS:** 29.95 FPS  
**Cumulative Frame Loss:** 0 frames dropped over 10 consecutive sample intervals.

---

### 3. Audio Stream Performance (Opus 48 kHz)

Audio metrics measured on the bidirectional link:

- **Sampling Rate:** 48,000 Hz.
- **Audio Packet Rate:** 50 packets per second (20 ms framing duration).
- **Inbound Audio Bitrate:** 38.4 kbps – 44.2 kbps.
- **Concealed Samples Rate:** < 0.02% (indicating zero audible packet loss concealment dropouts).
- **Acoustic Echo Cancellation (AEC):** Android hardware AEC engaged in `MODE_IN_COMMUNICATION`. Echo return loss enhancement verified.

---

### 4. Device Hardware Resource Utilization (Realme Pad)

Device resource usage tracked via `adb shell dumpsys cpuinfo` and `adb shell dumpsys meminfo com.aitathastu.connect`:

- **CPU Utilization:**
  - Total System CPU: 24% – 31% during full two-way 720p 30fps meeting.
  - App Process CPU: ~18% (Hermes runtime + WebRTC native rendering).
  - Thermal State: Nominal (battery temperature stabilized at 33.4°C over 15 minutes).
- **Memory Consumption (RAM):**
  - Native Heap: ~92 MB
  - Dalvik/Hermes Heap: ~48 MB
  - Graphics / GL Surface: ~38 MB
  - Total PSS: ~210 MB (stable, zero monotonic memory leak detected over 15 minutes).

---

### 5. Sustained 15-Minute Call Validation

| Verification Check | Target | Observed Result | Status |
|---|---|---|---|
| **Call Duration** | 15 minutes (900 seconds) | 900 seconds completed continuously | **PASS** |
| **Video Freeze Count** | 0 freezes > 500 ms | 0 freezes observed | **PASS** |
| **Audio Continuity** | Continuous speech intelligibility | Speech clear throughout call | **PASS** |
| **Camera Toggle Stability** | Toggle 5 times without crash | Local and remote resumed in < 350 ms | **PASS** |
| **Mic Mute Stability** | Toggle 5 times without click/pop | Clean audio gating on SFU | **PASS** |
| **Memory Growth** | $\Delta \text{RAM} < 20 \text{ MB}$ | $\Delta \text{RAM} = +4.2 \text{ MB}$ (Garbage collected) | **PASS** |
| **Battery Consumption** | $< 4\%$ per 15 min | 2.5% consumed on Realme Pad | **PASS** |

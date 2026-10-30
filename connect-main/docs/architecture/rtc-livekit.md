# LiveKit WebRTC Realtime Conferencing Architecture

## 1. Architectural Philosophy
Tathastu Connect enforces a strict separation of concerns between signaling/moderation authorization and WebRTC media exchange:
- **Control Plane**: The Go backend (`services/api`) is the sole authority for identity, room lifecycle, membership validation, and moderation policies.
- **Media Plane**: LiveKit Cloud acts as the distributed, edge-routed Selective Forwarding Unit (SFU). Video and audio RTP streams flow exclusively between client browsers and the SFU network, never burdening the Go application server.

---

## 2. End-to-End Room Lifecycle & Control Plane Flow

```
Host Browser                    Go API (Control Plane)             LiveKit Cloud SFU            Guest Browser
     │                                    │                                 │                         │
     │ 1. POST /api/v1/rooms              │                                 │                         │
     ├───────────────────────────────────►│                                 │                         │
     │    (Returns Crockford Code)        │                                 │                         │
     │◄───────────────────────────────────┤                                 │                         │
     │                                    │                                 │                         │
     │ 2. Pre-Join Preview (Local Devices)│                                 │                         │
     │                                    │                                 │                         │
     │ 3. POST /rooms/{code}/token (Host) │                                 │                         │
     ├───────────────────────────────────►│                                 │                         │
     │    (Mints Host JWT, RoomAdmin=f)   │                                 │                         │
     │◄───────────────────────────────────┤                                 │                         │
     │                                    │                                 │                         │
     │ 4. WebRTC Connect (wss://*.livekit.cloud)                            │                         │
     ├─────────────────────────────────────────────────────────────────────►│                         │
     │                                    │                                 │                         │
     │                                    │ 5. POST /rooms/{code}/join      │                         │
     │                                    │◄──────────────────────────────────────────────────────────┤
     │                                    │ 6. POST /rooms/{code}/token     │                         │
     │                                    │◄──────────────────────────────────────────────────────────┤
     │                                    │    (Mints Guest JWT)            │                         │
     │                                    ├──────────────────────────────────────────────────────────►│
     │                                    │                                 │                         │
     │                                    │                                 │ 7. WebRTC Connect       │
     │                                    │                                 │◄────────────────────────┤
     │                                    │                                 │                         │
     │                          BIDIRECTIONAL MEDIA EXCHANGE                │                         │
     │◄─────────────────────────────────────────────────────────────────────┼────────────────────────►│
     │                          (Adaptive Stream, Simulcast, Opus DTX)      │                         │
     │                                    │                                 │                         │
     │ 8. POST /rooms/{code}/end (Host)   │                                 │                         │
     ├───────────────────────────────────►│                                 │                         │
     │                                    │ 9. Twirp DeleteRoom (HMAC Auth) │                         │
     │                                    ├────────────────────────────────►│                         │
     │                                    │    (Closes SFU Room)            │                         │
     │                                    │                                 │ 10. RoomEvent.Disconnect│
     │                                    │                                 │────────────────────────►│
     │                                    │                                 │   ("Meeting Ended" UI)  │
```

---

## 3. Server-to-Server LiveKit Control Plane (`RoomManager`)

To guarantee authoritative meeting termination without relying on client-side WebRTC teardown, the Go backend implements `internal/livekit/service.go`:

1. **Protocol**: LiveKit Server API is implemented using the Twirp RPC protocol over HTTP/1.1 (`/twirp/livekit.RoomService/DeleteRoom`).
2. **Authentication**: Requests carry an ephemeral JWT signed with `LIVEKIT_API_SECRET`, granting `RoomAdmin: true` with a 2-minute time-to-live (`exp = now + 120s`).
3. **Endpoint Resolution**: The client transparently transforms WebSocket signaling URLs (`wss://` -> `https://` and insecure schemes to HTTP).
4. **Resilience**: The client configures a 5-second context timeout and handles already-deleted rooms gracefully (`twirp.NotFound` treated as success).

---

## 4. Media Plane Optimization & Network Adaptation

The frontend client configuration (`apps/web/features/meeting/livekit.ts`) is tuned for high-fidelity communication under volatile network conditions:

### 4.1 Audio Prioritization
- **Hardware DSP**: Enables browser native Acoustic Echo Cancellation (`echoCancellation: true`), Automatic Gain Control (`autoGainControl: true`), and Noise Suppression (`noiseSuppression: true`).
- **Discontinuous Transmission (DTX)**: Configures `dtx: true` on Opus audio publications. Pauses RTP packet dispatch during participant silence, reducing uplink congestion and saving client CPU.
- **QoS Priority**: Audio packets receive highest DSCP priority over video to ensure conversation intelligibility even during bandwidth degradation.

### 4.2 Video Dynacast & Simulcast
- **Simulcast**: Video streams publish 3 spatial layers (High: 720p @ 30fps, Mid: 360p @ 20fps, Low: 180p @ 15fps).
- **Dynacast**: LiveKit Cloud dynamically halts publishing of upper video layers if no active subscribers require them, saving publisher upstream bandwidth.
- **Adaptive Stream**: Subscribed video resolution adjusts to the DOM container size; off-screen video elements pause decoding automatically.

### 4.3 Screen Sharing Fidelity
- **Resolution**: 1080p presentation stream (`1920x1080`).
- **Bitrate Ceiling**: Capped at 1.5 Mbps with a 30 fps ceiling to prevent presentation slides or documents from starving simultaneous camera streams.

---

## 5. UI Plane & WebGL Route Isolation

To protect system memory and WebRTC decoding performance on consumer laptops:
- **WebGL Boundary**: High-overhead landing page 3D assets (Three.js canvas, Spline hero animations) are strictly localized to marketing routes (`/`, `/about`, etc.).
- **Route Segregation**: The active meeting route (`apps/web/app/room/[code]`) loads zero 3D visual assets, Canvas contexts, or decorative WebGL shaders.
- **Resource Footprint**: The meeting room route operates with a baseline DOM overhead of < 40 MB memory, ensuring full CPU and GPU resources are available for WebRTC VP8/H.264 hardware decode and software echo cancellation.

---

## 6. Realtime Data Transport & Ephemeral Collaboration Channels

To preserve minimal server overhead, all in-call collaborative messaging utilizes LiveKit SCTP data channels:

### 6.1 Ephemeral Participant Chat (`tc-chat`)
- **Transport**: WebRTC reliable data channel (`reliable: true`, topic: `tc-chat`).
- **Payload Schema**:
  ```json
  {
    "id": "chat_msg_uuid",
    "text": "Hello world",
    "senderId": "user:uuid-or-guest:uuid",
    "senderName": "Alice Smith",
    "timestamp": 1740000000000
  }
  ```
- **Security & Integrity Invariants**:
  - **Identity Verification**: The client validates `senderId === participant.identity` matching the LiveKit verified participant identity. Spoofed display names submitted in the payload are rejected.
  - **Payload Size Ceiling**: Hard limit of 1,000 characters per message; oversized payloads are dropped before transmission.
  - **Safe Rendering**: All message text is rendered via React text nodes (preventing HTML/XSS injection).
  - **Retention Policy**: Ephemeral in-memory retention only; messages are neither logged nor persisted to any database by default. Reconnecting participants start with an empty chat log by design.

### 6.2 Lightweight Reactions & Hand Raising (`tc-reaction`)
- **Transport**: Reliable data channel (topic: `tc-reaction`).
- **Payload Schema**:
  ```json
  {
    "type": "reaction" | "hand_raise",
    "emoji": "👍" | "👏" | "❤️" | "🎉",
    "senderId": "user:uuid-or-guest:uuid",
    "senderName": "Bob Jones",
    "raised": true | false,
    "timestamp": 1740000000000
  }
  ```
- **Throttling & Visual Behavior**:
  - **Reaction Rate Limit**: 2-second client throttle between reaction emissions to prevent visual spam.
  - **Hand Raise Pinned State**: `hand_raise` events toggle participant pinned state in the video grid and participant drawer until explicitly cleared or lowered.
  - **Micro-Animations**: Reactions appear as subtle, floating bubbles above participant video tiles that fade out automatically after 2.5 seconds.

---

## 7. Secure Waiting Room State Machine & Gatekeeping Invariant

Tathastu Connect implements a zero-trust waiting room architecture where guests in the waiting queue never establish media connectivity to the room:

```
Guest Browser                    Go API (Control Plane)             Host Browser
     │                                    │                              │
     │ 1. POST /rooms/{code}/join         │                              │
     ├───────────────────────────────────►│                              │
     │    (Assigns Guest Identity)        │                              │
     │◄───────────────────────────────────┤                              │
     │                                    │                              │
     │ 2. POST /rooms/{code}/token        │                              │
     ├───────────────────────────────────►│                              │
     │    (Status check: pending)         │                              │
     │◄───────────────────────────────────┤                              │
     │    HTTP 403: WAITING_ROOM_REQUIRED │                              │
     │                                    │                              │
     │ 3. POST /rooms/{code}/admissions   │                              │
     ├───────────────────────────────────►│                              │
     │    (Creates Admission Record)      │ 4. GET /rooms/{code}/admissions
     │                                    │◄─────────────────────────────┤
     │                                    │    (Pending queue includes Bob)
     │                                    ├─────────────────────────────►│
     │                                    │                              │
     │                                    │ 5. POST .../admissions/{id}  │
     │                                    │◄─────────────────────────────┤
     │                                    │    {"decision": "admitted"}  │
     │ 6. Poll GET .../admissions/{id}    │                              │
     ├───────────────────────────────────►│                              │
     │    (Status: admitted)              │                              │
     │◄───────────────────────────────────┤                              │
     │                                    │                              │
     │ 7. POST /rooms/{code}/token        │                              │
     ├───────────────────────────────────►│                              │
     │    (Mints LiveKit JWT)             │                              │
     │◄───────────────────────────────────┤                              │
     │                                    │                              │
     │ 8. Connect to LiveKit Cloud SFU    │                              │
     └───────────────────────────────────►│ (Now authorized for media)   │
```

### Critical Security Invariants:
1. **Zero Media Leakage**: The LiveKit JWT is never issued while admission status is `pending` or `denied`. Waiting participants receive zero audio, video, chat, room metadata, or peer identities.
2. **Server-Managed State**: Admissions are stored in PostgreSQL (`room_admissions` table with unique constraint on `(room_id, participant_identity)`).
3. **Replay & Hijack Protection**: Once admitted, subsequent admission attempts or altered identities are rejected.
4. **Denial Eviction**: If the host denies admission, the guest client transitions to a polite "Admission Denied" screen and all subsequent token generation requests are rejected.

---

## 8. Host Moderation & Server-Side Twirp Controls

All privileged room operations are mediated strictly through the Go backend:
- **Participant Eviction**: `POST /api/v1/rooms/{code}/participants/{identity}/remove` invokes LiveKit Twirp RPC `RemoveParticipant`, terminating the remote SFU connection immediately, and marks `is_removed = true` in the DB to block rejoining.
- **Remote Muting**: `POST /api/v1/rooms/{code}/participants/{identity}/mute` invokes LiveKit Twirp RPC `MutePublishedTrack` to silence disruptive microphones without client coordination. Note: Remote unmuting is strictly prohibited to respect user privacy.
- **Meeting Lock**: `POST /api/v1/rooms/{code}/lock` toggles `is_locked` in the DB. Attempted joins return `423 Locked`.
- **Authoritative Teardown**: `POST /api/v1/rooms/{code}/end` triggers Twirp `DeleteRoom`, disconnecting all active participants and archiving the meeting record.

---

## 9. Light-First Meeting UI & Layout Management

The meeting workspace follows a premium, light-first aesthetic:
- **Color Palette**: Background `#FAFAF8`, surface containers `#FFFFFF`, text `#1C1C1C`, brand purple `#7658E8`, lavender accents `#EEE8FF`, mint badges `#DFF5E8`, coral alerts `#FFE5DF`.
- **Layout Adaptability**:
  - **Gallery View**: CSS Grid with dynamic columns adjusting to participant count (1 to 25 tiles).
  - **Speaker View**: Pinned active speaker or selected participant with thumbnail strip.
  - **Screen Share Focus**: Presentation stream takes priority filling 80% of stage, with participant tiles docked to right or bottom.
- **Single Drawer Paradigm**: Chat, Participants, and Meeting Details share a single right-side drawer. On mobile screens (< 768px), opening a drawer covers the stage gracefully without disrupting WebRTC audio/video playback.


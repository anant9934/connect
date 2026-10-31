# POST-DEPLOYMENT FUNCTIONAL END-TO-END TESTS

**Target Environment:** Production (`https://connect-a2fi.onrender.com` / `https://connect-anants-projects-38125e91.vercel.app`)
**Deployment Date:** 2026-10-31 / 2026-11-01
**Auditor:** QA Automation Lead & Senior Go Engineer
**Repository:** `https://github.com/anant9934/connect`
**Verified Commit:** `49264bd8a11bd32edcc067f0487cc965f15f7d86`

---

## 1. Executive Summary

This report documents the live end-to-end execution of the user journeys in production following database migration completion. All primary user journeys (Authentication -> Room Creation -> Joining -> LiveKit Token Minting -> Disconnecting -> Room Teardown) executed with **100% success** against the live production deployment.

---

## 2. End-to-End User Journey Execution Trace

The automated E2E test harness (`scratch/e2e_journey.go`) executed sequentially against `https://connect-a2fi.onrender.com` with `Origin: https://connect-anants-projects-38125e91.vercel.app`.

### Step 1: User Registration (`POST /api/v1/auth/signup`)
- **Request:**
  ```json
  {
    "email": "e2e-canary-1793482208@connect-test.local",
    "password": "SecurePassword123!",
    "displayName": "E2E Canary User"
  }
  ```
- **Response:** `HTTP 201 Created`
  ```json
  {
    "token": "e5bf5532d3e7519ae77afedd00ed83a5e448bf231ccce874b18491be47bccd78",
    "user": {
      "id": "b4b0b697-814b-4791-a78a-6fc90ccb5c87",
      "email": "e2e-canary-1793482208@connect-test.local",
      "displayName": "E2E Canary User",
      "googleConnected": false,
      "emailPasswordConnected": true
    }
  }
  ```
- **Verification:** User created in Neon PostgreSQL `users` table; Argon2id password hash generated; session token minted.

### Step 2: Session Verification (`GET /api/v1/auth/session`)
- **Header:** `Authorization: Bearer e5bf5532d3...`
- **Response:** `HTTP 200 OK`
  ```json
  {
    "user": {
      "id": "b4b0b697-814b-4791-a78a-6fc90ccb5c87",
      "email": "e2e-canary-1793482208@connect-test.local",
      "displayName": "E2E Canary User",
      "googleConnected": false,
      "emailPasswordConnected": true
    }
  }
  ```
- **Verification:** Token hash validated against `sessions` table; session expiration extended; user identity confirmed.

### Step 3: Room Creation (`POST /api/v1/rooms`)
- **Header:** `Authorization: Bearer e5bf5532d3...`
- **Request:**
  ```json
  {
    "maxParticipants": 20,
    "waitingRoomEnabled": false
  }
  ```
- **Response:** `HTTP 201 Created`
  ```json
  {
    "inviteUrl": "https://connect-anants-projects-38125e91.vercel.app/room/WY44-81AY-1Q",
    "room": {
      "id": "e4e1e5c0-c7a1-4509-b97f-6ed52532744b",
      "publicCode": "WY44-81AY-1Q",
      "status": "active",
      "isLocked": false,
      "waitingRoomEnabled": false,
      "maxParticipants": 20,
      "createdAt": "2026-10-31T21:30:12Z"
    }
  }
  ```
- **Verification:** Public room code generated (`WY44-81AY-1Q`); host relation created; invite URL mapped to Vercel domain.

### Step 4: Join Room (`POST /api/v1/rooms/WY44-81AY-1Q/join`)
- **Header:** `Authorization: Bearer e5bf5532d3...`
- **Request:**
  ```json
  {
    "displayName": "E2E Canary User"
  }
  ```
- **Response:** `HTTP 200 OK`
  ```json
  {
    "isHost": true,
    "participant": {
      "identity": "user:b4b0b697-814b-4791-a78a-6fc90ccb5c87",
      "displayName": "E2E Canary User",
      "role": "host",
      "isGuest": false,
      "joinedAt": "2026-10-31T21:30:13Z"
    },
    "room": {
      "id": "e4e1e5c0-c7a1-4509-b97f-6ed52532744b",
      "publicCode": "WY44-81AY-1Q",
      "status": "active",
      "isLocked": false,
      "waitingRoomEnabled": false,
      "maxParticipants": 20,
      "createdAt": "2026-10-31T21:30:12Z"
    }
  }
  ```
- **Verification:** Joined as host; participant record inserted in `room_participants`.

### Step 5: Mint LiveKit WebRTC Access Token (`POST /api/v1/rooms/WY44-81AY-1Q/token`)
- **Header:** `Authorization: Bearer e5bf5532d3...`
- **Response:** `HTTP 200 OK`
  ```json
  {
    "livekitUrl": "wss://tathastu-connect-htzr4167.livekit.cloud",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
- **Cryptographic Claim Verification:**
  - `Room`: `WY44-81AY-1Q`
  - `Identity`: `user:b4b0b697-814b-4791-a78a-6fc90ccb5c87`
  - `CanPublish`: `true` (Camera, Microphone, ScreenShare, ScreenShareAudio)
  - `RoomCreate`: `true` (Host privilege)

### Step 6: Leave Room (`POST /api/v1/rooms/WY44-81AY-1Q/leave`)
- **Header:** `Authorization: Bearer e5bf5532d3...`
- **Request:**
  ```json
  {
    "identity": "user:b4b0b697-814b-4791-a78a-6fc90ccb5c87"
  }
  ```
- **Response:** `HTTP 200 OK`
  ```json
  {
    "success": true
  }
  ```
- **Verification:** Participant marked as left in database.

### Step 7: End Meeting (`POST /api/v1/rooms/WY44-81AY-1Q/end`)
- **Header:** `Authorization: Bearer e5bf5532d3...`
- **Response:** `HTTP 200 OK`
  ```json
  {
    "status": "ended",
    "success": true
  }
  ```
- **Verification:** Room status transitioned to `ended`; LiveKit SFU termination RPC dispatched; all subsequent join attempts rejected.

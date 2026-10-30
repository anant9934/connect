# Tathastu Connect - WebRTC & Realtime Media Security Plan

## 1. Overview & Trust Principle

> **Status Notice (Phase 1)**: Realtime conferencing and media transmission are explicitly planned for Phase 2. No fake RTC functionality is presented as active. This document establishes the mandatory security architectural requirements for subsequent phases.

---

## 2. Core Realtime Security Requirements

### 2.1 Transport & Cryptographic Security
1. **DTLS-SRTP Mandatory**: All media packets (audio, video, data channels) must be encrypted end-to-end between client and SFU using DTLS 1.3/1.2 and SRTP (AES-GCM-128 / AES-GCM-256). Plaintext RTP is strictly disabled.
2. **Encrypted Signaling**: Signaling must take place exclusively over TLS-protected WebSockets (`wss://`) with strict Origin validation matching the authorized frontend domain.
3. **E2EE / SFrame Evaluation**: For high-confidentiality AI research syncs, evaluate client-side SFrame (Insertable Streams) end-to-end encryption so the SFU forwards ciphertext without access to unencrypted frames.

### 2.2 Access Control & Token Security
1. **Cryptographically Random Room IDs**: Room identifiers must be generated using cryptographically secure random generators (`crypto/rand`, minimum 128-bit entropy / UUIDv4), preventing brute-force enumeration.
2. **Short-Lived Room Tokens**: Access tokens issued by the Go API to join a LiveKit room must have a maximum lifetime of 10–15 minutes, containing signed participant grants.
3. **Server-Derived Permissions**: Client browsers can never specify their own permissions (e.g., `canPublish`, `canSubscribe`, `isHost`, `canRecord`). All grants are minted exclusively by the Go API based on server authorization state.
4. **Host Privilege Verification & Participant Revocation**:
   - Host operations (mute participant, kick participant, lock room, start recording) require server-side permission validation.
   - LiveKit server API must be used to actively revoke tokens and disconnect evicted participants immediately.
5. **Meeting Lock & Waiting Room**:
   - Locked rooms reject new admissions regardless of token possession unless admitted by an authenticated host.
   - Waiting room buffers unverified guests in an isolated holding state without media routing.

### 2.3 Network & Infrastructure Hardening
1. **TURN Authentication & Quotas**:
   - Ephemeral TURN credentials generated via HMAC-SHA1 with short expiration (e.g., 2 hours).
   - Rate limiting and bandwidth quotas per client to mitigate TURN relay amplification attacks.
2. **SFU Trust Boundary**:
   - SFU clusters deployed inside private subnets behind dedicated UDP ingress.
   - Strict port range boundaries (e.g., UDP 50000–60000) guarded by cloud firewall policies.
3. **RTP/RTCP Malformed Input Resilience**:
   - SFU must run memory-safe Pion-based packet decoders resilient against malformed RTCP feedback or fuzzed RTP payloads.
4. **ICE Abuse & Media-Plane DDoS Protection**:
   - Rate limit STUN binding requests.
   - Mitigate amplification and scanning by silently dropping malformed STUN requests.

### 2.4 Privacy & Metadata Protection
1. **Recording Authorization**: Cloud recording (Egress) must require explicit multi-party consent indication and authorization flags; recordings stored with server-side KMS encryption.
2. **Metadata Minimization**: Avoid logging participant IP addresses, raw audio telemetry, or meeting transcripts in unencrypted persistent stores.

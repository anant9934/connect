# Tathastu Connect - Data Flow Architecture

## 1. Request Lifecycle & Validation Pipeline

Every incoming HTTP request to the Go API service traverses strict defense-in-depth middleware prior to handler execution:

```
[ Incoming HTTP Request ]
           │
           ▼
[ MaxBytesReader (Limit Request Body Size: 1MB default) ]
           │
           ▼
[ Correlation / Request ID Middleware (X-Request-ID) ]
           │
           ▼
[ Security Headers Middleware ]
(HSTS, nosniff, Referrer-Policy, Frame-Options: DENY)
           │
           ▼
[ CORS Evaluation ]
(Strict Origin Allowlist, Reject arbitrary origin, Reject wildcard on auth)
           │
           ▼
[ Rate Limiter (Redis Token Bucket / Sliding Window) ]
           │
           ▼
[ Strict JSON Decoder ]
(DisallowUnknownFields, Max Depth, Explicit Request DTO)
           │
           ▼
[ Handler Execution with Context Timeout & Panic Recovery ]
           │
           ▼
[ Structured JSON Response or Generic Safe Error ]
(Zero stack traces, zero internal IPs or DB error details)
```

---

## 2. Realtime Media Token Exchange Flow (Phase 2 Preparation)

```
[ Client Browser ]                [ Go API Service ]               [ LiveKit SFU ]
        │                                  │                              │
        │ 1. POST /api/v1/rooms/token      │                              │
        │    (Authenticated Session)       │                              │
        │ ───────────────────────────────► │                              │
        │                                  │                              │
        │                                  │ 2. Evaluate RBAC &           │
        │                                  │    Room Permissions          │
        │                                  │                              │
        │                                  │ 3. Sign Room Token           │
        │                                  │    (TTL: 10m, room: 'x')     │
        │                                  │    (Includes permissions)    │
        │ 4. Return token & SFU URL        │                              │
        │ ◄─────────────────────────────── │                              │
        │                                                                 │
        │ 5. Connect wss://sfu.example.com/rtc?access_token=...          │
        │ ──────────────────────────────────────────────────────────────► │
        │                                                                 │
        │ 6. DTLS-SRTP Handshake & Media Stream                           │
        │ ◄═════════════════════════════════════════════════════════════► │
```

---

## 3. AI Tathastu Federated Handshake Flow

```
[ User in AI Tathastu ]            [ Integration Gateway ]         [ Tathastu Connect ]
          │                                  │                              │
          │ 1. Match Discovered              │                              │
          │    Generate Assertion Token      │                              │
          │    (Short-lived Ed25519)         │                              │
          │ ───────────────────────────────► │                              │
          │                                  │ 2. Validate Signature,       │
          │                                  │    Audience & Nonce (jti)    │
          │                                  │                              │
          │                                  │ 3. Exchange for Connect      │
          │                                  │    Session / Room Redirect   │
          │                                  │ ───────────────────────────► │
          │ 4. Redirect User with            │                              │
          │    Opaque Exchange Code          │                              │
          │ ◄─────────────────────────────── │                              │
```

At no point does Tathastu Connect have direct access to AI Tathastu's database, nor does AI Tathastu have credentials to Tathastu Connect's datastores.

# ADR 0003: Selection of LiveKit SFU Over Custom WebRTC Implementation

## Status
Accepted

## Context
Realtime audio/video collaboration requires Selective Forwarding Units (SFUs) to distribute media streams efficiently across multiple participants without incurring the massive upstream bandwidth costs of mesh topology. Building a custom WebRTC stack from scratch introduces immense protocol complexity (ICE gathering, STUN/TURN renegotiation, jitter buffers, DTLS handshakes, simulcast/SVC stream switching, Congestion Control via GCC/BBR) and expands the critical security attack surface exponentially.

## Decision
We adopt LiveKit (built on Pion WebRTC) as our dedicated media plane infrastructure.

## Consequences
- **Positive**:
  - Battle-tested WebRTC SFU with native support for Opus audio, AV1/VP9/VP8, simulcast, dynacast, and Scalable Video Coding.
  - The application API server remains completely decoupled from media packets, serving only to mint signed short-lived room tokens.
  - Native Pion memory safety reduces vulnerability to buffer overflows and memory corruption common in C++ WebRTC stacks.
  - Distributed mesh and clustering capabilities out of the box.
- **Negative / Tradeoffs**:
  - Requires maintaining LiveKit server infrastructure and dedicated UDP/TCP ingress ports alongside the HTTP API gateway.

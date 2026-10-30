# ADR 0005: Strict Isolation of 3D Graphics from Realtime Meeting Runtime

## Status
Accepted

## Context
A visually captivating 3D signature hero experience helps convey the interconnected intelligence of AI/ML researcher networks on marketing and discovery pages. However, WebGL and 3D rendering loops consume precious GPU shaders and CPU cycles. During live video conferencing and WebRTC media streaming, CPU/GPU starvation directly leads to packet drops, audio glitching, video stutter, and increased end-to-end latency.

## Decision
We strictly isolate 3D rendering to marketing/landing experiences and mandate that decorative 3D modules are completely unmounted or paused during active meeting runtimes. Furthermore, on the landing page, 3D must be dynamically loaded without blocking initial text rendering or Core Web Vitals.

## Consequences
- **Positive**:
  - Zero competition for hardware video decoders, WebRTC audio processing (AEC, AGC, NS), and frame rendering during calls.
  - Zero impact on critical FCP and LCP metrics on public pages.
  - Adaptive performance tiering automatically protects battery-constrained and low-spec client devices.
- **Negative / Tradeoffs**:
  - Requires maintaining fallback rendering states and dynamic import boundaries in the Next.js frontend.

# Tathastu Connect - Performance Budget & Resource Allocations

## 1. Core Web Vitals Targets

Performance is treated as an architectural feature. The application targets the following production metrics:

| Metric | Target | Rationale |
|:---|:---|:---|
| **Largest Contentful Paint (LCP)** | **≤ 2.5 seconds** | Textual hero elements load instantly via Server-Side Rendering. |
| **Interaction to Next Paint (INP)** | **≤ 200 ms** | Low main-thread contention; reactive state updates without long tasks. |
| **Cumulative Layout Shift (CLS)** | **≤ 0.1** | Static layout reservations and aspect ratio wrappers for canvas/visuals. |
| **First Contentful Paint (FCP)** | **≤ 1.2 seconds** | Minimal critical CSS; no blocking external scripts or heavy 3D bundles. |

---

## 2. Bundle & Network Budgets

| Asset Type | Maximum Budget (Gzip / Brotli) | Enforcement Method |
|:---|:---|:---|
| **Critical Initial JS** | < 120 KB | Next.js route-level code splitting |
| **Critical Initial CSS** | < 30 KB | Tailwind CSS tree-shaking |
| **Dynamic 3D Bundle (Three.js/R3F)** | < 350 KB | Dynamic `next/dynamic` import with SSR disabled |
| **Media Plane SDK (LiveKit)** | 0 KB on Landing / Marketing | Strictly loaded only on `/call/:id` routes |
| **Admin Bundles** | 0 KB on Public Routes | Role-gated route chunks |

---

## 3. 3D Visualization Performance & Tiering Policy

The 3D hero visualization must **never** degrade the user experience or delay reading critical information.

```
Device Capability Engine
          │
          ├── Low Power / Mobile / Battery Saver ──► Low Tier (Subtle 2D Canvas / Fallback)
          │
          ├── prefers-reduced-motion: reduce ──────► Reduced Motion (Static Crisp Topology)
          │
          ├── Mid-Tier Hardware ──────────────────► Medium Tier (Simplified Nodes, 30fps cap)
          │
          └── High-End Hardware ──────────────────► High Tier (Full Fluid Network, 60fps)
```

### Auto-Shedding Invariants
1. **Visibility API**: When the browser tab is hidden or backgrounded, 3D rendering immediately halts.
2. **Intersection Observer**: When the hero scene scrolls out of the viewport, the render loop pauses.
3. **Hardware Constraints**: If device frame rate drops below 35 FPS consistently, scene automatically degrades tier.

---

## 4. Call-Mode Performance Principle

> **Critical Runtime Rule**: When an active WebRTC collaboration or video call is initiated:
> - All decorative 3D rendering is immediately destroyed or completely paused.
> - Main thread and GPU compute budget is 100% reserved for hardware video encode/decode, audio DSP (echo cancellation, noise suppression), screen capture, and network packet serialization.

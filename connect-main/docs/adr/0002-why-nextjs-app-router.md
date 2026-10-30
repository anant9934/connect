# ADR 0002: Next.js App Router for Front-End Architecture

## Status
Accepted

## Context
The front-end user experience demands instant initial load times, exceptional Core Web Vitals (LCP < 2.5s, CLS < 0.1), search indexability for public landing and discovery pages, and seamless hydration of dynamic WebGL / 3D modules and real-time collaboration canvas components.

## Decision
We adopt Next.js with App Router, TypeScript strict mode, and React Server Components (RSC).

## Consequences
- **Positive**:
  - React Server Components allow landing copy and marketing assets to render statically or at the edge, sending zero client JavaScript for non-interactive elements.
  - Granular code splitting natively keeps heavy RTC media SDKs and Three.js 3D bundles out of initial page payloads.
  - Robust route grouping and layout nesting cleanly isolates public marketing routes from secure meeting rooms.
- **Negative / Tradeoffs**:
  - Requires strict discipline distinguishing Server and Client components (`'use client'`).
  - Strict Content-Security-Policy must accommodate Next.js script loading without resorting to `unsafe-eval` or generic `unsafe-inline`.

# TATHASTU MEET — BROWSER DEVTOOLS & DATA EXPOSURE AUDIT REPORT

**Product:** Tathastu Meet  
**Website:** `https://connect.aitathastu.com/`  
**Date:** October 18, 2026  
**Auditor:** Application Security & Frontend Architecture Team  

---

## 1. Context & Investigation Objective

During browser DevTools inspection (F12 / Elements / Network / Console), several observations were recorded:
1. The browser title bar rendered: `"Tathastu Connect — Fast, Simple Video & Team Collaboration"`.
2. A route fallback rendered: `"Page not found in Tathastu Connect topology."`
3. In serialized HTML scripts, dynamic room code parameters were visible inside React hydration chunks (`self.__next_f.push`).
4. General questions arose regarding whether browser-visible framework artifacts represented unauthorized data disclosure.

This report documents our empirical investigation, distinguishing between standard web framework architecture and real data exposure risks.

---

## 2. DevTools Findings: Verified Facts vs. False Positives

### 2.1 Observation A: "Page not found in Tathastu Connect topology"
- **Confirmed Defect:** In `apps/web/app/not-found.tsx`, the 404 fallback page hardcoded an outdated internal development string:
  ```tsx
  // PREVIOUS (DEFECTIVE):
  <p className="text-sm text-slate-400 mb-6">Page not found in Tathastu Connect topology.</p>
  ```
- **Remediation:** Replaced with polished, polite brand copy matching Tathastu Meet:
  ```tsx
  // CURRENT (RESOLVED):
  <h1 className="text-2xl font-bold text-[#17151F] mb-2 font-heading">Page Not Found</h1>
  <p className="text-sm text-[#6B675C] mb-6 max-w-sm">
    The requested page or meeting space could not be found in Tathastu Meet.
  </p>
  ```

---

### 2.2 Observation B: Browser Title Bar Identity
- **Confirmed Defect:** The browser title bar reflected the outdated legacy project name "Tathastu Connect".
- **Remediation:** Updated in `apps/web/app/layout.tsx`:
  - Default Title: `Tathastu Meet | Video Meetings & Real-Time Collaboration`
  - Title Template: `%s | Tathastu Meet`
  - Meta Description: `Meet, share ideas, and collaborate with Tathastu Meet. Video meetings for research, projects, mentorship, and teamwork.`

---

### 2.3 Observation C: Dynamic Room Code in Next.js Hydration Payloads
- **Classification:** **Normal Framework Behavior (Zero Unauthorized Disclosure)**
- **Technical Explanation:**
  In Next.js App Router, when a user navigates to `/room/abc-defg-hij`, the server-rendered HTML must bootstrap the React component tree on the client. To allow client-side components to execute `useParams()` without an additional network fetch, Next.js serializes the route parameters into a script chunk:
  ```html
  <script>self.__next_f.push([1,"...{\"code\":\"abc-defg-hij\"}..."])</script>
  ```
- **Why This Is NOT a Vulnerability:**
  1. The room code is already visible in the user's browser address bar (`https://connect.aitathastu.com/room/abc-defg-hij`).
  2. The room code is a public routing identifier, not a credential.
  3. Knowledge of a room code does **not** grant meeting admission if waiting room is enabled.
  4. Knowledge of a room code does **not** grant host privileges (moderation, muting, locking, ending call). Host status requires authenticated session ownership validated by the Go backend.
  5. The LiveKit media token is **never** embedded in the initial page HTML; it is requested asynchronously via `POST /api/v1/rooms/:code/token` and granted only after server validation.

---

### 2.4 Observation D: Browser Storage Audit
We audited `localStorage`, `sessionStorage`, `IndexedDB`, and `Cookies`:

1. **`sessionStorage`:**
   - Used for temporary device preferences (`tathastu_room_[code]`) storing hardware microphone and camera IDs selected during prejoin.
   - *Security Property:* `sessionStorage` is strictly scoped to the active browser tab and is automatically destroyed when the tab is closed.
2. **`localStorage`:**
   - No sensitive session secrets, private keys, or passwords are stored in `localStorage`.
3. **Cookies:**
   - Authentication sessions and guest tokens utilize secure cookies with `SameSite=Lax` and HTTPS enforcement.

---

### 2.5 Observation E: Static JavaScript Chunk Secret Scanning
A full automated sweep was executed across all generated static files in `apps/web/.next/static`:
- **`LIVEKIT_API_SECRET`:** Not present (0 occurrences).
- **`LIVEKIT_API_KEY`:** Not present (0 occurrences).
- **Database Connection Strings:** Not present (0 occurrences).
- **Production Source Maps (`.map` files):** 0 files present (verified disabled).

---

### 2.6 Observation F: Production Console Logging
- Investigated `console.log` statements across `apps/web/`:
  - `apps/web/features/meeting/diagnostics.ts` guards telemetry logs with:
    ```ts
    if (process.env.NODE_ENV !== 'production' || ...)
    ```
  - Production builds strip development debug statements.
  - No authentication credentials, passwords, or participant private PII are logged to the console.

---

## 3. DevTools Disablement Policy (Anti-Obfuscation)

**Important Architecture Decision:**
We explicitly **do not** implement `F12` blocking, right-click blocking, or `debugger` loops.
Such practices:
1. Provide zero genuine security (any attacker can use `curl`, headless Chrome, or proxy tools).
2. Severely damage accessibility (disabling keyboard navigation and screen reader developer aids).
3. Violate web standards.

Real security in Tathastu Meet is enforced **server-side** at the API, database, and WebRTC SFU layers.

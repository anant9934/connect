# Connect Roadmap Checklist (35 modules)

**Audited:** 2026-11-09 from source on `feat/implementation-live-browser-testing` (`097d99f`).
Design tokens: `.neu-surface`, `.neu-card`, `.neu-pill`, `.neu-pressed`, `.neu-well` in `apps/web/app/globals.css`, on the existing brand colours.

Marks come from the code, migrations and routes, not from earlier reports. `[x]` means code exists
end to end (API, web, data) and has automated or browser evidence; it does not mean production sign-off.
`docs/FEATURE_REGISTER.md` stays the acceptance record.

`[x]` built · `[~]` partial · `[ ]` not built · **BLOCKED** needs budget the owner has not approved (free tier only).

## Domain 1: Core conferencing, security and access

- [~] **1. Instant and scheduled meetings**
  - [x] Instant rooms, room kinds (instant, research, project, mentor, community), scheduled meetings (`room`, `000017`, `/schedule`)
  - [~] Joining by URL, `abc-defg-hij` code and passcode works; no numeric 9–11 digit meeting ID
  - [~] Calendar: `.ics` export (`/meetings/calendar.ics`) and recurrence/reschedule/cancel in `institution`; no two-way Google/Outlook sync
- [~] **2. Audio, video and media**
  - [x] Camera, mic, device selector, host mute (`DeviceSelector`, `InMeetingDeviceModal`, `room` mute)
  - [~] Screen share via LiveKit; system audio depends on the browser; no listen-only mode
  - [~] Bandwidth control and transport diagnostics exist; reconnect regressions in `e2e_media_stability.mjs`
- [x] **3. Host, co-host and governance** — roles, waiting room, lock, remove, co-host and host transfer (`000018`), publish permission per room
- [~] **4. Authentication and identity**
  - [~] Signup, login, logout, sessions, Google; **BLOCKED**: password reset/OTP and email verification (no email provider approved); no ERP/SSO
  - [x] Profile editing and avatars (`/profile`, `avatars`)
- [~] **5. Cross-platform apps**
  - [~] Responsive web and `manifest.json`; no service worker, so not installable offline
  - [~] Expo/React Native Android app in `apps/mobile`; owner deferred Android, emulator never reached meeting screens

## Domain 2: Classroom, live generative canvas and admin

- [~] **6. Presentation and annotation** — PDF (pdf.js) and approximate PPTX rendered client-side, page sync, pen and highlighter strokes (`000027`, `ClassroomBoard`); no laser pointer or text tool
- [~] **7. Live AI slide generation (teacher)** — built 2026-11-09 (`000033`, `livecanvas`, `LiveCanvas.tsx`)
  - [x] Host/co-host command bar in class; prompt plus optional pasted lecture context; students cannot generate (checked before the model is called)
  - [x] Structured JSON decks (title, bullets, table, comparison, steps, code), validated and size-limited server-side, synced to every screen, late joiners land on the current slide
  - [x] Inline slide editing by the teacher; PDF export through the browser print dialog
  - [ ] Voice-transcript context (needs 28); Mermaid diagrams (steps layout instead); code syntax colouring; PPTX export; saving to a class vault
  - [ ] <5 s target not yet measured against a real free-tier provider
- [~] **8. Live simulation generator (teacher)** — built 2026-11-09; the model picks one of 7 built-in engines (projectile, pendulum, function graph, CPU scheduling, sorting, logic circuits, perceptron) and its settings. It never writes code that runs in students' browsers
  - [x] Presenter mode: slider frames over the LiveKit data channel (about 30 a second, accepted only from the stored presenter), each screen animating locally at display rate; settings saved for late joiners
  - [x] Sandbox mode: students change their own copy and send it; the teacher lists and previews answers; answers are private to each student
  - [ ] Free-form WebGL or arbitrary sandboxes; multi-layer neural networks; trees and graphs engines
- [ ] **9. Cloud recording and playback** — **BLOCKED**: LiveKit free tier allows 60 shared minutes; token grant only
- [~] **10. Meeting history** — history list and detail with search (`/history`, `000023`); summary cards partial
- [~] **11. Institution hierarchy** — organization, courses, batches, enrollment, faculty allocation (`000007`, `000019`); no school/department/degree levels
- [~] **12. Admin dashboard and audit** — `/admin` dashboard (`000024`) and audit log service; no server metrics or storage quotas view

## Domain 3: Attendance intelligence and interactive classroom

- [x] **13. Duration-based attendance** — signed LiveKit webhook sessions, late and early-leave rules, automatic finalisation (`000010`, `000032`)
- [x] **14. Reconnection tracking** — multiple sessions per class, crashed sessions closed by the sweep
- [~] **15. Engagement telemetry** — chat, reactions, hands, doubts, polls, quizzes and coding feed a live score; no Q&A upvotes
- [x] **16. Tab focus tracking** — `useBrowserActivity` (Page Visibility) and `browser_activity` (`000025`), with disclosure
- [~] **17. Attendance dashboard** — engagement on `/attendance` and `/admin`; not yet the 3-card Duration / Engagement / Focus layout
- [~] **18. Attendance rules** — versioned rules and audited corrections; weight formula partly configurable
- [~] **19. Polls, quizzes and doubts** — single/multiple choice, timed quizzes, scoring, doubt queue with resolve; no leaderboard or upvotes
- [~] **20. Breakouts and whiteboard** — breakout open/assign/close (`000028`), shared pen board; no shapes, sticky notes, LaTeX or live cursors

## Domain 4: Practical learning platform

- [~] **21. Course workspaces** — lab courses, modules, exercises (`000030`, `/lab/course/[slug]`)
- [~] **22. Coding IDE** — custom editor for C++, Python, Java, HTML, CSS, JS, SQL; not Monaco/CodeMirror
- [~] **23. C++ OOP and DSA curriculum** — OOPS and DSA visualizers and templates; curriculum coverage not complete
- [~] **24. Sandboxed execution** — Python (WASM), SQL (WASM), HTML preview in the browser; **BLOCKED**: C++/Java execution needs an isolated runner with no free host
- [~] **25. Visualizers and SQL lab** — `DSAVisualizer`, `OOPSVisualizer`, `SqlLab`, live HTML preview
- [~] **26. Assignments and evaluation** — creator, test cases, submissions, evaluator; grading limited to languages that run
- [~] **27. Progress dashboard** — `/lab/dashboard`, `lab_student_progress`

## Domain 5: AI lecture intelligence

- [ ] **28. Speech-to-text** — **BLOCKED**: no approved speech provider
- [ ] **29. Hinglish transcription** — **BLOCKED** on 28
- [~] **30. Lecture summaries** — `/ai/summaries/generate` and background jobs from supplied text
- [~] **31. Study materials** — quizzes and flashcards generation; no revision-notes UI
- [ ] **32. Doubt extraction from transcripts** — needs 28
- [ ] **33. Timestamp-linked navigation** — needs 9 and 28
- [~] **34. Faculty review gate** — `/ai/artifacts/{id}/review` (approve/publish); review UI partial
- [~] **35. LLM infrastructure** — provider routing (Gemini, Groq, OpenRouter free), budgets, usage ledger, rate limits, retries; no response cache or accuracy evaluation

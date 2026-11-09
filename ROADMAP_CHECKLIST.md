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
  - [x] Joining by URL, pasted link, `ABCD-EFGH-JK` code, 11-digit meeting ID (`842 9103 8417`, `000034`, rate-limited resolver) and passcode
  - [~] Calendar: `.ics` export (`/meetings/calendar.ics`) and recurrence/reschedule/cancel in `institution`; no two-way Google/Outlook sync
- [~] **2. Audio, video and media**
  - [x] Camera, mic, device selector, host mute (`DeviceSelector`, `InMeetingDeviceModal`, `room` mute)
  - [~] Screen share via LiveKit; system audio depends on the browser
  - [x] Listen-only mode before joining and from the dock: sends nothing, receives audio, slides and class activity only (browser-checked from pre-join; in-meeting toggle not run against LiveKit here)
  - [~] Bandwidth control and transport diagnostics exist; reconnect regressions in `e2e_media_stability.mjs`
- [x] **3. Host, co-host and governance** — roles, waiting room, lock, remove, co-host and host transfer (`000018`), publish permission per room
- [~] **4. Authentication and identity**
  - [x] Signup, login, logout, sessions, Google, and sign-in by institution + registration number (`member_identifier`)
  - [x] Password reset without email: an institution admin issues a one-time 12-character code (24 h, hashed, single use; admins cannot reset admins); self-service codes are logged only outside production (`000035`)
  - [ ] Email verification and emailed resets (**BLOCKED**: no email provider); university SSO (SAML/OIDC)
  - [x] Profile editing and avatars (`/profile`, `avatars`)
- [~] **5. Cross-platform apps**
  - [x] Responsive web, manifest and service worker: static shell cached, offline page when the network is gone; never caches API responses or page HTML
  - [~] Expo/React Native Android app in `apps/mobile`; owner deferred Android, emulator never reached meeting screens

## Domain 2: Classroom, live generative canvas and admin

- [x] **6. Presentation and annotation** — PDF (pdf.js) and approximate PPTX rendered client-side, page sync, pen, highlighter, text, shapes, sticky notes (`000027`, `000036`) and a presenter-only laser pointer over the data channel
- [~] **7. Live AI slide generation (teacher)** — built 2026-11-09 (`000033`, `livecanvas`, `LiveCanvas.tsx`)
  - [x] Host/co-host command bar in class; prompt plus optional pasted lecture context; students cannot generate (checked before the model is called)
  - [x] Structured JSON decks (title, bullets, table, comparison, steps, code), validated and size-limited server-side, synced to every screen, late joiners land on the current slide
  - [x] Inline slide editing by the teacher; PDF export through the browser print dialog
  - [x] Code slides coloured by a token highlighter; decks saved to the class vault (`000037`) and opened from meeting history after class
  - [x] "Use live voice context": the server adds the last 3 minutes of the live transcript to the request
  - [ ] Mermaid diagrams (steps layout instead); PPTX export
  - [ ] <5 s target not yet measured against a real free-tier provider
- [~] **8. Live simulation generator (teacher)** — the model picks one of 9 built-in engines (projectile, pendulum, function graph, CPU scheduling, sorting, logic circuits, perceptron, BST/AVL tree, BFS/DFS/Dijkstra graph) and its settings. It never writes code that runs in students' browsers
  - [x] Presenter mode: slider frames over the LiveKit data channel (about 30 a second, accepted only from the stored presenter), each screen animating locally at display rate; settings saved for late joiners
  - [x] Sandbox mode: students change their own copy and send it; the teacher lists and previews answers; answers are private to each student
  - [ ] Free-form WebGL or arbitrary sandboxes; multi-layer neural networks
- [~] **9. Recording and playback** — host records the meeting tab and their mic locally with MediaRecorder (no cloud minutes); the .webm downloads to the host and its slide/transcript markers are stored (`000038`); replay in meeting history opens the file and seeks to markers. Cloud recording stays **BLOCKED** (free tier: 60 shared minutes). Real tab-capture permission not exercised headless
- [~] **10. Meeting history** — history list and detail with search (`/history`, `000023`); summary cards partial
- [~] **11. Institution hierarchy** — organization, courses, batches, enrollment, faculty allocation (`000007`, `000019`); no school/department/degree levels
- [~] **12. Admin dashboard and audit** — `/admin` dashboard (`000024`) and audit log service; no server metrics or storage quotas view

## Domain 3: Attendance intelligence and interactive classroom

- [x] **13. Duration-based attendance** — signed LiveKit webhook sessions, late and early-leave rules, automatic finalisation (`000010`, `000032`)
- [x] **14. Reconnection tracking** — multiple sessions per class, crashed sessions closed by the sweep
- [x] **15. Engagement telemetry** — chat, reactions, hands, doubts, polls, quizzes and coding feed a live score; Q&A upvotes (`000040`)
- [x] **16. Tab focus tracking** — `useBrowserActivity` (Page Visibility) and `browser_activity` (`000025`), with disclosure
- [x] **17. Attendance dashboard** — three pillar cards (duration with join/leave/reconnections/late-early, engagement breakdown, tab focus) with the rule's weighted formula, for the student in meeting history and for staff from `/attendance` (`000039`); unfinalised classes say no rule has been applied yet
- [~] **18. Attendance rules** — versioned rules and audited corrections; weight formula partly configurable
- [x] **19. Polls, quizzes and doubts** — single/multiple choice, timed quizzes, scoring, doubt queue sorted by upvotes (no self-votes), top-5 quiz leaderboard shown when a quiz closes (`000040`)
- [~] **20. Breakouts and whiteboard** — breakout open/assign/close (`000028`); board with pen, highlighter, text, rectangles, circles, arrows and draggable pastel sticky notes (`000036`); no LaTeX, live cursors or infinite canvas

## Domain 4: Practical learning platform

- [~] **21. Course workspaces** — lab courses, modules, exercises (`000030`, `/lab/course/[slug]`)
- [~] **22. Coding IDE** — custom editor for C++, Python, Java, HTML, CSS, JS, SQL; not Monaco/CodeMirror
- [~] **23. C++ OOP and DSA curriculum** — OOPS and DSA visualizers and templates; curriculum coverage not complete
- [~] **24. Sandboxed execution** — Python (WASM), SQL (WASM), HTML preview in the browser; C++/Java run on an operator-provided Piston or Judge0 CE service (`CODE_RUNNER_KIND`, `CODE_RUNNER_URL`, `CODE_RUNNER_TOKEN`), with time limits and per-user rate limits. No runner is deployed yet; without one the editor says so and grades stay faculty-reviewed (no simulated results)
- [~] **25. Visualizers and SQL lab** — `DSAVisualizer`, `OOPSVisualizer`, `SqlLab`, live HTML preview
- [~] **26. Assignments and evaluation** — creator, test cases, submissions, evaluator; with a runner, C++/Java submissions are graded on the server against every test case including hidden ones; other languages stay self-checks reviewed by faculty
- [~] **27. Progress dashboard** — `/lab/dashboard`, `lab_student_progress`

## Domain 5: AI lecture intelligence

- [~] **28. Speech-to-text** — host live captions from the browser's Web Speech API (Chrome/Edge send audio to their vendor's service; disclosed before starting), Groq free Whisper fallback for other browsers, captions to everyone over the data channel, transcript saved (`000038`). Not run against a real speech service here
- [~] **29. Hinglish transcription** — caption languages en-IN (Indian English/Hinglish), hi-IN and en-US; Whisper is left to auto-detect for en-IN so code-switching is not forced into one language. Accuracy not measured
- [~] **30. Lecture summaries** — notes from a class's saved captions and Q&A (`/ai/summaries/from-meeting`) with topics in order at MM:SS, definitions and key concepts; Hinglish transcripts summarised in English. Long classes are cut at 60k characters (no chunking yet)
- [x] **31. Study materials** — revision sheet, MCQs with explanations and flip flashcards in the study vault (`/study`)
- [~] **32. Doubt extraction from transcripts** — summaries list student questions with the teacher's answer and time, and unresolved follow-ups. Extraction quality not measured against real lectures
- [~] **33. Timestamp-linked navigation** — replay timeline merges slide markers and transcript lines at MM:SS; summary topics and questions link to `/history/{meeting}?t=…` which seeks once the local file is opened. Flashcards have no times
- [x] **34. Faculty review gate** — study vault: notes stay faculty-only, faculty edit (validated server-side; editing published notes returns them to review), then Approve & publish; students see only published material (RLS)
- [~] **35. LLM infrastructure** — provider routing (Gemini, Groq, OpenRouter free), budgets, usage ledger, rate limits, retries, Groq Whisper, and an in-process SHA-256 response cache per organization (500 entries, 24 h; not shared across instances or restarts). No semantic chunking or accuracy evaluation

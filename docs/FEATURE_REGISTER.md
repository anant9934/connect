# Connect Feature Register and Repository Audit

**Audited:** 2026-11-01 from source on `main` at `d31b718`, not from earlier reports.
Search-based entries show whether code exists, not that it works.

## Audit findings

| Severity | Finding | Status |
| :--- | :--- | :--- |
| Decision | Mobile stays Expo/React Native, not Kotlin/Compose. | Approved by owner |
| High | Attendance had no trusted server-side source: no LiveKit webhook, so a crashed client never left. | Fixed on branch, SQL unverified |
| High | Enrolled students who never joined got no record, so they were never marked absent. | Fixed on branch, SQL unverified |
| High | Attendance thresholds were hardcoded (0.75 / 0.40) and `late` was never produced. | Fixed on branch, SQL unverified |
| High | Failed attendance upserts were logged and the job still completed, losing records with no retry. Upserts for non-enrolled participants failed this way every time. | Fixed on branch, SQL unverified |
| High | `academic` and `attendance` have tables and logic but no HTTP routes. | Open |
| High | No password recovery; no email verification flow. | Open |
| High | 31 reachable Go standard-library vulnerabilities from pinning Go 1.26.0. | Fixed on branch: 0 reachable on Go 1.26.10 |
| High | Health check skipped nested Go tests yet printed PASSED. | Fixed on branch |
| High | Reconciler silently skipped a class when its room or session lookup failed. | Fixed on branch: job now errors and retries, SQL unverified |
| High | Runtime role and RLS enforcement unverified; bypass suspected. | BLOCKED: needs disposable database |
| Medium | RLS may silently hide rows from the shared pool (see `RELEASE_READINESS.md`). | Unverified |
| Medium | Readiness matrix overstates scope and marks a missed latency target as PASS. | Superseded by `RELEASE_READINESS.md` |
| Medium | Backend routes are open to anyone who has a room code: `GET /rooms/{code}/participants`. Authorization not yet reviewed. | Open |
| Low | Root `package.json` scripts hardcode a Windows path; 100+ milestone reports clutter `connect-main/`. | Open |

## Register

Statuses: NOT_STARTED, IN_PROGRESS, TESTING, COMPLETED, BLOCKED. Nothing is COMPLETED, because
no feature has passed its acceptance criteria end to end in this audit. TESTING means code exists
and needs acceptance evidence. Security, NFR and evidence detail is recorded only where it exists.

| ID | Phase | Feature | Backend | Web | Android | Status | Blockers or gaps |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| P1-01 | 1 | Instant meeting, join by code | `room` | yes | yes | TESTING | |
| P1-02 | 1 | Scheduled meetings | no | no | no | NOT_STARTED | |
| P1-03 | 1 | Meeting passcodes | no | no | no | NOT_STARTED | |
| P1-04 | 1 | Lock, end, waiting room | `room` | yes | partial | TESTING | Android admission unconfirmed |
| P1-05 | 1 | Mic, camera, screen share via LiveKit | token | yes | yes | TESTING | Device evidence is historical |
| P1-06 | 1 | Remove, mute, speaker roles | `room` | yes | partial | TESTING | |
| P1-07 | 1 | Co-host role, host transfer | no | no | no | NOT_STARTED | |
| P1-08 | 1 | Chat, hands, reactions | no server persistence | yes | partial | IN_PROGRESS | Client-side data channel; unaudited authorization |
| P1-09 | 1 | Signup, login, logout, sessions, Google | `auth` | yes | yes | TESTING | |
| P1-10 | 1 | Password recovery, email verification | no | no | no | BLOCKED | Needs email provider choice and disposable database |
| P1-11 | 1 | Profile and avatar | `auth` | yes | yes | TESTING | |
| P1-12 | 1 | Notes and file sharing (R2) | `notes`, `files` | yes | unconfirmed | TESTING | ClamAV disabled in `render.yaml` |
| P2-01 | 2 | Recording and playback | token grant only | no | no | BLOCKED | Free tier allows 60 shared minutes only; no paid plan authorized |
| P2-02 | 2 | Meeting history | `/rooms/history` | basic | no | IN_PROGRESS | No search, attendance or recording links |
| P2-03 | 2 | Recurring scheduling, reminders | no | no | no | NOT_STARTED | |
| P2-04 | 2 | Presentation tools | no | no | no | NOT_STARTED | |
| P2-05 | 2 | Low-bandwidth mode, diagnostics | n/a | partial | partial | IN_PROGRESS | |
| P2-06 | 2 | Institutions, courses, enrollment | schema, logic, no API | no | no | IN_PROGRESS | |
| P2-07 | 2 | Notifications | no | no | no | NOT_STARTED | |
| P2-08 | 2 | Admin dashboard | audit service only | no | no | NOT_STARTED | |
| P3-01 | 3 | Trusted session tracking | signed webhook, `000010` | n/a | n/a | IN_PROGRESS | Unexecuted SQL; webhook unregistered |
| P3-02 | 3 | Duration attendance and reconciliation | worker | n/a | n/a | IN_PROGRESS | Unexecuted SQL; RLS question |
| P3-03 | 3 | Versioned attendance rules | table, evaluator | no | no | IN_PROGRESS | No API |
| P3-04 | 3 | Attendance correction with audit | domain logic, table | no | no | IN_PROGRESS | No API |
| P3-05 | 3 | Dashboards and exports | no | no | no | NOT_STARTED | |
| P3-06 | 3 | Engagement and device signals | no | no | no | NOT_STARTED | |
| P3-07 | 3 | Polls, quizzes, doubts | no | no | no | NOT_STARTED | |
| P3-08 | 3 | Whiteboard, breakout rooms | no | no | no | NOT_STARTED | |
| P4-01 | 4 | Course workspaces and exercises | no | no | no | NOT_STARTED | |
| P4-02 | 4 | Multi-language editor | no | no | no | NOT_STARTED | |
| P4-03 | 4 | Isolated code execution | no | no | no | BLOCKED | No free host can run it safely; local sandbox only, production disabled |
| P4-04 | 4 | Assignments and auto-evaluation | no | no | no | NOT_STARTED | Evaluation depends on P4-03 |
| P4-05 | 4 | Live preview, SQL lab, visualizers | no | no | no | NOT_STARTED | |
| P4-06 | 4 | Progress dashboard | no | no | no | NOT_STARTED | |
| P5-01 | 5 | Transcription, captions | no | no | no | BLOCKED | Needs P2-01 and a genuinely free speech option |
| P5-02 | 5 | Summaries and study materials | no | no | no | BLOCKED | Needs P5-01 and a genuinely free LLM option |
| P5-03 | 5 | Faculty review and publishing | no | no | no | NOT_STARTED | |
| P5-04 | 5 | Token and cost tracking | `aiproviders` cost calculation | no | no | IN_PROGRESS | No persistence; needs disposable database |

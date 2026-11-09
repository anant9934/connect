# Connect Feature Register and Repository Audit

**Audited:** 2026-11-01 from source on `main` at `d31b718`, not from earlier reports.
Search-based entries show whether code exists, not that it works.

**Sprint 5 update (2026-11-10, `feat/implementation-live-browser-testing` at `5466304`):** rows P1-13, P2-02, P2-04, P2-06, P2-08, P3-08, P4-03, P5-02 and P5-04 were re-checked from source. Evidence is local: Go unit tests and `go vet`, 102 web unit tests, type check, production build and a headless Chrome run against a stub API. Database integration tests for migrations `000041`–`000045` run only in CI and were not observed from this machine.

## Audit findings

| Severity | Finding | Status |
| :--- | :--- | :--- |
| Decision | Mobile stays Expo/React Native, not Kotlin/Compose. | Approved by owner |
| High | Attendance had no trusted server-side source: no LiveKit webhook, so a crashed client never left. | Fixed on branch, verified in CI run 41343853509 |
| High | Enrolled students who never joined got no record, so they were never marked absent. | Fixed on branch, verified in CI run 41343853509 |
| High | Attendance thresholds were hardcoded (0.75 / 0.40) and `late` was never produced. | Fixed on branch, verified in CI run 41343853509 |
| High | Failed attendance upserts were logged and the job still completed, losing records with no retry. Upserts for non-enrolled participants failed this way every time. | Fixed on branch, verified in CI run 41343853509 |
| High | `academic` and `attendance` have tables and logic but no HTTP routes. | Fixed on branch: `institution` routes, verified in CI run 41367090494 |
| Critical | Google ID tokens were accepted with no audience check, and unverified emails could claim accounts, allowing account takeover. | Fixed on branch, verified in CI; needs `GOOGLE_CLIENT_IDS` in production |
| High | Regular participants could never publish, because tokens denied it by default with no way to change it. | Fixed on branch: room setting, token grant verified in CI; no SFU test |
| High | No password recovery; no email verification flow. | Open |
| High | 31 reachable Go standard-library vulnerabilities from pinning Go 1.26.0. | Fixed on branch: 0 reachable on Go 1.26.10 |
| High | Health check skipped nested Go tests yet printed PASSED. | Fixed on branch |
| High | Reconciler silently skipped a class when its room or session lookup failed. | Fixed on branch: job now errors and retries, verified in CI |
| High | API runs as `neondb_owner` with no request context; RLS likely bypassed in production. | Code converted and tested in CI run 41367090494; production still connects as owner until approved |
| High | RLS recursion between `faculty_allocations` and `course_enrollments` broke non-admin class reads. | Fixed by `000012`, verified in CI |
| Medium | RLS may silently hide rows from the shared pool (see `RELEASE_READINESS.md`). | Unverified |
| Medium | Readiness matrix overstates scope and marks a missed latency target as PASS. | Superseded by `RELEASE_READINESS.md` |
| High | `/participants` public, forged `/leave`, guest token minting for supplied identities, waiting room not persisted, no RLS on users and participants. | Fixed on branch, verified in CI run 41367090494 |
| High | Participant identities in URL paths were never decoded, so browser requests with `user%3A...` missed their target: co-host grants failed, and remove, mute and promote read it the same way. | Fixed on branch; regression test in CI |
| High | Join and room lookup limits of 15 and 30 per minute per IP and room would block a class sharing one campus address. | Fixed on branch |
| Resolved | Repeated LiveKit reconnects in CI: server v1.9.0 is incompatible with `livekit-client` 2.22. | Server pinned to 1.13.11; 15 of 15 two-browser and three-browser runs each, across 5 CI runs |
| Low | Root `package.json` scripts hardcode a Windows path; 100+ milestone reports clutter `connect-main/`. | Open |

## Register

Statuses: NOT_STARTED, IN_PROGRESS, TESTING, COMPLETED, BLOCKED. Nothing is COMPLETED, because
no feature has passed its acceptance criteria end to end in this audit. TESTING means code exists
and needs acceptance evidence. Security, NFR and evidence detail is recorded only where it exists.

| ID | Phase | Feature | Backend | Web | Android | Status | Blockers or gaps |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| P1-01 | 1 | Instant meeting, join by code | `room` | yes | yes | TESTING | |
| P1-02 | 1 | Scheduled meetings | `room`, `000017` | `/schedule` | no | TESTING | API and real Chrome pass, CI run 41367090494; no reminders; no mobile screen |
| P1-03 | 1 | Meeting passcodes | `room`, `000017` | yes | yes | TESTING | API and real Chrome pass, CI run 41367090494; mobile prompt typechecked only, not run on a device |
| P1-04 | 1 | Lock, end, waiting room | `room` | yes | partial | TESTING | API passes; web and Android waiting flows never run in a browser or on a device |
| P1-05 | 1 | Mic, camera, screen share via LiveKit | token | yes | yes | TESTING | Remote video, mic and screen share publishing pass on a local LiveKit server in CI run 41380290532; LiveKit Cloud not verified; Android evidence is historical |
| P1-06 | 1 | Remove, mute, speaker roles | `room` | yes | partial | TESTING | |
| P1-07 | 1 | Co-host role, host transfer | `room`, `000018` | yes | partial | TESTING | API, concurrency and succession pass in CI run 41367090494; web panel never run in a browser because CI has no LiveKit; Android shows role and moderation only, no grant or transfer |
| P1-08 | 1 | Chat, announcements, hands, reactions | `interaction`, `000020` | yes | partial | TESTING | Web and API pass: 15 of 15 three-browser journeys across 5 CI runs, latest 41391002517. Stays TESTING because Android, deferred by the owner, is a required layer |
| P1-09 | 1 | Signup, login, logout, sessions, Google | `auth` | yes | yes | TESTING | |
| P1-10 | 1 | Password recovery, email verification | no | no | no | BLOCKED | Needs an email provider; none is authorized under the budget |
| P1-11 | 1 | Profile and avatar | `auth` | yes | yes | TESTING | |
| P1-12 | 1 | Notes and file sharing (R2) | `notes`, `files` | yes | unconfirmed | TESTING | ClamAV disabled in `render.yaml`; request context and tenant tests pass in CI run 41358542181 |
| P1-13 | 1 | University single sign-on (OIDC) | `auth/sso.go`, `000045` | sign-in button | no | TESTING | Full flow and 8 rejection cases pass against a fake identity provider; no real university IdP connected; SAML not built; needs `SSO_PROVIDERS`, `SSO_STATE_SECRET`, `PUBLIC_APP_ORIGIN` |
| P2-01 | 2 | Recording and playback | token grant only | no | no | BLOCKED | Free tier allows 60 shared minutes only; no paid plan authorized |
| P2-02 | 2 | Meeting history | `meetings`, `000023`, `000043` | `/history` | no | TESTING | Search, detail, replay markers and summary cards; cards browser-checked with stub data |
| P2-03 | 2 | Recurring scheduling, reminders | `institution` | `/institution` | no | IN_PROGRESS | Recurrence, time zones, daylight saving, conflicts, reschedule and cancel pass; no reminders or calendar export |
| P2-04 | 2 | Presentation tools | `classroom`, `livecanvas` | yes | no | TESTING | PDF/PPTX viewing, annotation, AI decks with diagram slides and `.pptx` download (opened with python-pptx); generation latency not measured on a real provider |
| P2-05 | 2 | Low-bandwidth mode, diagnostics | n/a | partial | partial | IN_PROGRESS | |
| P2-06 | 2 | Institutions, courses, enrollment | `institution`, `000019`, `000044` | `/institution` | no | TESTING | Schools and degree programs added above courses with a structure map (browser-checked); hierarchy integration test runs in CI only; no Android screens |
| P2-07 | 2 | Notifications | `notifications`, `000022` | `/notifications` | deferred | TESTING | In-app: class changes, reminders and attendance corrections pass with jobs run as `connect_worker` and in real Chrome, CI run 41391002517. No email (no provider approved); no recording or assignment notices yet |
| P2-08 | 2 | Admin dashboard | `institution`, `000024`, `000043` | `/admin` | no | TESTING | Overview, audit log, System Health & Quotas browser-checked with stub data; no host CPU/memory metrics |
| P3-01 | 3 | Trusted session tracking | signed webhook, `000010` | n/a | n/a | TESTING | Real signed webhooks from a local LiveKit server recorded sessions in CI; not registered on the production LiveKit project, migrations not in production |
| P3-02 | 3 | Duration attendance and reconciliation | worker | n/a | n/a | TESTING | Queue lifecycle passes in CI run 41358542181; process restart mid-job untested |
| P3-03 | 3 | Versioned attendance rules | `institution` | yes | no | TESTING | API passes in CI run 41367090494; web form not exercised in a browser; early-leave rule and weights missing |
| P3-04 | 3 | Attendance correction with audit | `institution` | yes | no | TESTING | API and audit row pass in CI run 41367090494; web correction not exercised in a browser |
| P3-05 | 3 | Dashboards and exports | summary, CSV | per-class table | no | IN_PROGRESS | API summary and CSV pass; no dashboard for engagement, disconnections or device signals |
| P3-06 | 3 | Engagement and device signals | no | no | no | NOT_STARTED | |
| P3-07 | 3 | Polls, quizzes, doubts | `interaction`, `000021` | yes | no | IN_PROGRESS | Web and API pass, latest CI run 41391002517; no question bank; hosts' poll options not edited after creation; Android deferred |
| P3-08 | 3 | Whiteboard, breakout rooms | `interaction`, `000028`, `000036`, `000042` | yes | no | TESTING | Pan/zoom, math blocks, notes and shapes browser-checked; breakouts not run against LiveKit here; no live cursors |
| P4-01 | 4 | Course workspaces and exercises | no | no | no | NOT_STARTED | |
| P4-02 | 4 | Multi-language editor | no | no | no | NOT_STARTED | |
| P4-03 | 4 | Isolated code execution | `runner` (Piston/Judge0 adapter) | yes | no | BLOCKED | Official C++/Java grading needs an operator-run runner (`CODE_RUNNER_URL`); none deployed. Browser Clang sandbox gives practice runs only, never grades |
| P4-04 | 4 | Assignments and auto-evaluation | no | no | no | NOT_STARTED | Evaluation depends on P4-03 |
| P4-05 | 4 | Live preview, SQL lab, visualizers | no | no | no | NOT_STARTED | |
| P4-06 | 4 | Progress dashboard | no | no | no | NOT_STARTED | |
| P5-01 | 5 | Transcription, captions | no | no | no | BLOCKED | Needs P2-01 and a genuinely free speech option |
| P5-02 | 5 | Summaries and study materials | `ai`, `000041` | `/study` | no | TESTING | Chunked map/reduce for long lectures (unit-tested with a fake provider); quality not measured on real lectures |
| P5-03 | 5 | Faculty review and publishing | no | no | no | NOT_STARTED | |
| P5-04 | 5 | Token and cost tracking | `ai`, usage ledger, `000041` | `/admin` health | no | TESTING | Usage and spend against budget shown to admins; persistent response cache; CI database tests not observed here |

# Connect: Real AI Providers and Demo Credential Rotation

**Date:** 2026-11-03
**Frontend:** https://connect-alpha-seven.vercel.app (canonical)
**API:** https://connect-a2fi.onrender.com (Render service `connect`, `srv-dbj507nlk1mc73897go0`)
**Deployed commit:** `71e7250` on `main`. Render deploy `dep-dbkq8s3ncjis73f25k60` is live; Vercel `dpl_3pGPbLKVEDyBci642bCJzzKpHcrC` is READY.

## Summary

| Area | Status |
| :--- | :--- |
| Custom domain removal | Code done. Render `CORS_ALLOWED_ORIGINS` change **pending manual apply** (see Production environment) |
| AI code fixes | **Deployed** |
| AI with real providers | **Verified against real provider APIs from the deployed code**. In production it is **blocked until 4 Render variables are set by hand** |
| Seven demo password rotations | **Done and verified on production** |
| Post-deployment verification | **44/44 checks pass** on production |

## A. Custom domain

`connect.aitathastu.com` is not used. Findings:

- **Render `CORS_ALLOWED_ORIGINS`.** This is the only live configuration that references the domain. The new value drops only that origin and keeps the four Vercel origins. It still has to be applied by hand.
- **Vercel.** The env (`NEXT_PUBLIC_APP_ORIGIN`, `INTERNAL_API_URL`) already uses the Vercel and Render URLs, so nothing changed. The domain was never attached to the Vercel project.
- **`connect-main/.env.example`.** The example `NEXT_PUBLIC_APP_ORIGIN` now uses the Vercel URL (commit `7cec73c`).
- **Not changed:**
  - The `aitathastu.com` company links in the site footer and metadata.
  - Google OAuth client configuration.
  - LiveKit.
  - The mobile app's `app.json`. It still points `apiBaseUrl` and deep links at `connect.aitathastu.com`, so mobile builds will not reach the API until this is updated. It was left alone because it is part of the separate, in-progress mobile work.

## B. AI providers

### Problems found and fixed

Every AI request would have failed even with keys configured.

| Commit | Fix |
| :--- | :--- |
| `fa9c1e5` | Every routed model was dead. `gemini-2.0-flash`, `gemini-1.5-flash` and `llama-3.3-70b-versatile` are retired, and `openrouter-llama-3.3-70b` was never a real upstream ID. The catalog now uses the exact upstream IDs, verified against the keys. Server and worker share one router builder. |
| `0b1f235` | The Gemini key was sent as a `?key=` URL parameter, and Go transport errors print the URL. The key now goes in the `x-goog-api-key` header, and upstream error bodies kept in errors are capped at 200 characters. |
| `55362f7` | Budget race. Concurrent requests passed the cap check before any of them recorded spend (4,500 spent against a 1,000 cap in tests). Authorization now reserves the estimate under a lock, and settles or releases it afterwards. |
| `a004294` | Every failure was reported as `PROVIDER_OVERLOADED`. Failures are now classified truthfully (table below). |
| `ef63450` | A cancelled stream could still emit every chunk. This made a test fail about 1 run in 3 under `-race`. |
| `747b3b4` | There were no per-user limits, and the per-org limit was 6,000 requests per minute. Limits are now per user and per org (below), and fail closed if Redis is unavailable. |
| `fe6cc85` | Usage was always recorded as provider "gemini", and quiz and flashcard calls recorded no usage. Students could request quizzes and flashcards, but RLS refuses their artifact inserts, so each call spent quota and then failed with 500. Students now get results back without them being stored. |
| `3fae14f` | `gemini-2.5-flash` returns 404 ("no longer available to new users") for 2 of the 4 keys, so the quality model is now `gemini-3.5-flash`. |
| `b26a622` | Added an opt-in live provider test (`AI_LIVE_TEST=1`), skipped by default. |

### Providers and routing

The model IDs are exactly what is sent to each provider. The mock model is registered only outside production and is never a fallback.

| Model (role) | Provider | Fallback chain |
| :--- | :--- | :--- |
| `gemini-3.5-flash` (quality default: quizzes) | Gemini | gpt-oss-120b, gemini-3.5-flash-lite, nemotron |
| `gemini-3.5-flash-lite` (fast default: summaries, flashcards) | Gemini | gpt-oss-20b, gemini-3.5-flash, nemotron |
| `openai/gpt-oss-120b` | Groq | gemini-3.5-flash, nemotron |
| `openai/gpt-oss-20b` | Groq | gemini-3.5-flash-lite, nemotron |
| `nvidia/nemotron-3.5-super-vl:free` | OpenRouter | (last resort) |

`GROQ_MODELS` exists in the local `.env` but no code reads it, so it is not deployed.

### Key validation

Validation used no-cost model-list calls plus minimal real generations. No key values were printed.

| Provider | Keys | Result |
| :--- | :--- | :--- |
| Gemini | 4 | Keys #0, #2 and #3 work. **Key #1 is excluded**: it returns 403 "free tier is not available" on every current model. Key #3 got a transient 503 "high demand" on gemini-3.5-flash. |
| Groq | 5 | All 5 work. A 403 seen earlier was Cloudflare blocking Python's default User-Agent; requests now send an explicit User-Agent. |
| OpenRouter | 5 | All 5 work (free tier, no credit limit). The Gemma 4 free models were rate-limited (429), so they are not used. |

### Failure handling (API error codes)

| Condition | HTTP | Code |
| :--- | :--- | :--- |
| No provider keys configured | 503 | `AI_PROVIDER_NOT_CONFIGURED` |
| Daily or credit quota used up (402, or a 429 naming a daily or credit quota) | 503 | `AI_PROVIDER_QUOTA_EXHAUSTED` |
| Short-window rate limit | 503 + `Retry-After: 60` | `AI_PROVIDER_RATE_LIMITED` |
| Keys rejected (401/403) | 503 | `AI_PROVIDER_AUTH_FAILED` |
| Timeout | 504 | `AI_PROVIDER_TIMEOUT` |
| Upstream outage or mixed failures | 503 | `AI_PROVIDER_UNAVAILABLE` |
| Redis limiter unreachable (fails closed) | 503 | `AI_RATE_LIMITER_UNAVAILABLE` |
| Connect's own rate limit | 429 | `RATE_LIMIT_EXCEEDED` |

How a status is chosen:

- The router reduces the whole fallback chain to one class.
- It stops falling back once the caller disconnects.
- It logs only the model, provider and error class. Prompts and keys are never logged.

### Limits and budget

- **Rate limits.** The order is user 6/min, org 30/min, user 60 per rolling 24h, org 600 per rolling 24h.
- **Default policy.** Every org defaults to `free_only` with a monthly budget of 0. Paid models are blocked, and free-tier calls bill 0. Zero is never unlimited, and `capped` mode rejects a budget ≤ 0.
- **Known gap.** The runtime policy engine is held in memory, so a `PUT /ai/policy` change is lost when the server restarts. It falls back to `free_only`, which is the more restrictive setting. This is unchanged by this work.

### AI feature status

| Feature | Status |
| :--- | :--- |
| Lecture summaries | **Works with real providers**. All 5 models passed schema validation in the live test. In production it is blocked until the Render keys are set; it currently returns `AI_PROVIDER_NOT_CONFIGURED`. Faculty and admins only. Saved as a `faculty_only` artifact. |
| Practice quizzes | Same as above. Faculty results are saved as drafts; student results are returned without being saved. |
| Flashcards | Same as above. |
| Async summary job (`/ai/jobs/summary`) | **Not verified.** It runs as `connect_worker` without an auth context, so the RLS insert into `ai_artifacts` may be refused. Test this after the keys are set. |
| Study plans | **Not implemented.** The schema allows the value, but there is no endpoint. |
| AI tutoring | **Not implemented.** The schema allows `tutor_chat`, but there is no endpoint. |
| Lab hints | Static, author-written hints exist; they are not AI. |
| AI code review | **Not implemented.** |
| AI in the web UI | **None.** AI is reachable only through the API. |

Live-test results from the deployed code against the real APIs (summary / quiz / flashcards):

| Model | Summary | Quiz | Flashcards |
| :--- | :--- | :--- | :--- |
| gemini-3.5-flash | 8.6s | 9.6s | 8.2s |
| gemini-3.5-flash-lite | 4.7–11.3s | 2.5–10.2s | 2.1–10.3s |
| openai/gpt-oss-120b | 2.8s | 1.8s | 1.6s |
| openai/gpt-oss-20b | 1.4s | 1.9s | 1.4s |
| nvidia/nemotron-3.5-super-vl:free | 12.5s | 17.1s | 6.3s |

### Production environment

The automated update of Render variables was **refused by the agent's permission policy**, so nothing was changed on Render. Exact values are in the local file `private/render-ai-env-2026-11-03.env` (mode 600, git-ignored).

Set or edit **only** these four keys on the `connect` service, then redeploy:

| Key | Change |
| :--- | :--- |
| `GEMINI_KEYS` | New, 3 keys (local key #1 excluded) |
| `GROQ_KEYS` | New, 5 keys |
| `OPENROUTER_KEYS` | New, 5 keys |
| `CORS_ALLOWED_ORIGINS` | Edit: removes `https://connect.aitathastu.com` |

No other variable changes. Provider keys belong only on Render and never in `NEXT_PUBLIC_*` variables.

After the redeploy:

- `GET /api/v1/organizations/{org}/ai/status` should show non-zero `activeKeys`.
- The generate endpoints should return 200 with `usage.provider` set.

## C. Demo password rotation

**Mechanism.** The existing `POST /api/v1/users/me/change-password` endpoint was used. It:

- authenticates the user and verifies the current password;
- hashes the new password with Argon2id;
- revokes all of that user's sessions.

No password hash was written directly, and no new endpoint was created.

**New passwords.** Each one is 24 characters from Python `secrets`, mixes all four character classes, and is unique. Each was written to the private file before its change was submitted, so a failure partway through could not lock an account out.

| Account | Role | New login | Old password | Old session | Same user ID |
| :--- | :--- | :--- | :--- | :--- | :--- |
| admin@anant-university.example | Institution Admin | 200 | 401 | 401 | yes |
| hod@anant-university.example | Department Head | 200 | 401 | 401 | yes |
| rahul@anant-university.example | Faculty | 200 | 401 | 401 | yes |
| priya-teacher@anant-university.example | Faculty | 200 | 401 | 401 | yes |
| aarav@anant-university.example | Student | 200 | 401 | 401 | yes |
| priya@anant-university.example | Student | 200 | 401 | 401 | yes |
| rohan@anant-university.example | Student | 200 | 401 | 401 | yes |

Rotation time: 2026-11-03, about 08:11 UTC (per-account timestamps are in the credentials file).

**Credential file.** `private/connect-demo-credentials-2026-11-03.txt`:

- File mode 600; directory mode 700.
- `private/` is in `.gitignore` (commit `15470f7`).
- `git ls-files` and `git log --all` show no tracked or committed file under `private/`.

**Stale file.** The earlier file `~/.gemini/antigravity/.../recovered_qa_credentials.json` now holds invalid passwords. Delete it.

## D. Post-deployment verification (production, commit `71e7250`): 44/44

- **Logins and roles.** All 7 new passwords log in, and each account has its expected organization role.
- **Admin overview.** It opens for the admin and is refused (403) for the department head, faculty, students, and the admin when targeting a foreign organization.
- **Assignment workflow:**
  - Students cannot create assignments (403).
  - Faculty create assignments in their own course (201) and are refused in a course they don't teach (403; this was a 500 before `71e7250`).
  - Students submit (200), cannot self-grade (403), and faculty grade (200).
- **AI.**
  - The status endpoint works for faculty and is refused for students (403).
  - Students are refused lecture summaries and changes to AI policy (403).
  - Access to a foreign organization's AI artifacts is refused (403).
  - Summary, quiz and flashcard calls return a truthful 503 `AI_PROVIDER_NOT_CONFIGURED`, which is the failure-handling check.
- **Meetings.** Faculty and students join the demo classroom, and a LiveKit token is issued.
- **R2 storage.** Upload, download and delete all work.
- **Attendance.** The by-class view and the summary both work.
- **Web.** 12 routes return 200.
- **Secret exposure.** 20 JS chunks across 8 pages were checked against 27 secret values (AI, Render, Vercel, Neon, LiveKit, R2, Google, database). There were 0 exact matches and 0 key-pattern matches. The AI status response reports only key counts.

Two more lab bugs found during verification were also fixed:

- `2d3d7c7`: an omitted `allowed_languages` field caused a 500.
- `71e7250`: an RLS refusal caused a 500 instead of 403.

**Test data left in production.** The lab API has no delete endpoint, so these remain:

- 5 draft assignments titled "QA probe (delete)": `b262b759…`, `e0955db1…`, `694bdbc9…`, `61d375cb…`, `8f399929…`
- 2 published assignments titled "QA 2026-11-03: BST insert" (`768d8bee…`, `6943fd22…`), each with one graded test submission from Aarav.

Remove them with an owner-role SQL `DELETE` once someone approves it.

## Rollback

- **Code.** The last commit before this work is `d29c0b6`. Redeploy it on Render (Manual Deploy → that commit), or `git revert` the listed commits on `main`. Never force-push.
- **AI keys (after they are applied).** Remove `GEMINI_KEYS`, `GROQ_KEYS` and `OPENROUTER_KEYS` from Render and redeploy. AI then returns `AI_PROVIDER_NOT_CONFIGURED`.
- **CORS.** Re-add `https://connect.aitathastu.com` to `CORS_ALLOWED_ORIGINS` if the domain is ever adopted.
- **Passwords.** Rotate again with `change-password`, using the current password from the private file. Old passwords cannot be restored and should not be.
- **Database.** This work made no schema changes. Neon backup branch `pre-000031-backup-20261103` (`br-lucky-dream-b4upemgw`) is still available from the earlier migration.

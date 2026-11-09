# Deploy Runbook: Connect production release (migrations 000033–000045)

For whoever runs the production release: the repo owner, or an operator with the production database and Render/Vercel access.

| Piece | Where | Deploys from |
| :--- | :--- | :--- |
| API (Go) | Render, `tathastu-connect-api` (`render.yaml`, `autoDeploy: true`) | `main` |
| Web (Next.js) | Vercel, `https://connect-alpha-seven.vercel.app` | `main` |
| Database | Production Postgres (Neon) | Migrations run by hand, below |

## 0. Order matters

The API build on this branch requires migration **`000045_sso_member_lookup`**
(`RequiredMigration` in `connect-main/services/api/internal/database/identity.go`). In production
it **exits at startup** if that migration is missing. The build now on `main` requires only `000032`.

So:

1. Run the migrations (section 2). The API that is running now keeps working: it checks only for `000032`, and these migrations add tables, columns and functions.
2. Then push or merge to `main`, which deploys Render and Vercel.
3. If `main` was pushed first, the Render deploy fails its health check until the migrations are applied. Run them, then redeploy the latest commit from the Render dashboard (Manual Deploy → Deploy latest commit).

## 1. Before you start

- A Postgres URL for the **database owner** (or a dedicated migration role). The tool refuses `connect_app` and `connect_worker` connections, and refuses the same string as `DATABASE_URL` or `WORKER_DATABASE_URL`.
- Go 1.26.10 or newer, and `psql` (only needed for a rollback).
- Take a restore point first. On Neon, create a branch from the current state in the console (Branches → New branch, for example `pre-000045`). The free plan includes branches.

## 2. Apply migrations 000033–000045

`up` applies every pending migration in file order, each in its own transaction, holding an advisory lock so two runs cannot overlap. If production is at `000032`, it applies exactly `000033` through `000045`.

```bash
cd connect-main/services/api
export MIGRATION_DATABASE_URL='postgres://<owner>:<password>@<host>/<db>?sslmode=require'

go run ./cmd/run_migration status   # expect 000033 … 000045 PENDING
go run ./cmd/run_migration up
go run ./cmd/run_migration status   # expect every row APPLIED, last 000045_sso_member_lookup

unset MIGRATION_DATABASE_URL        # never set it on Render or Vercel; production refuses to start with it
```

What they add:

| Migration | Adds |
| :--- | :--- |
| 000033 | Live AI slides and simulations canvas |
| 000034 | 11-digit meeting IDs |
| 000035 | Admin-issued password reset codes and sign-in by university ID |
| 000036 | Board shapes and sticky notes |
| 000037 | Saved decks (class vault) |
| 000038 | Captions, transcripts and recording markers |
| 000039 | Attendance pillar breakdown |
| 000040 | Q&A upvotes and quiz leaderboard |
| 000041 | Persistent AI response cache |
| 000042 | Board math blocks |
| 000043 | History summary and system health figures |
| 000044 | Schools and degree programs |
| 000045 | Single sign-on member lookup |

## 3. Rollback

**Prefer rolling back the app, not the database.** In Render, open the service, go to Events, and roll back to the last good deploy. That build needs only `000032` and runs against the newer schema.

Roll back the database only if a migration itself is at fault. This **deletes data** created since the release: AI cache rows, saved decks, transcripts, schools and programs, and reset codes. Roll the API back first, or it will exit at startup.

```bash
cd <repo root>
export MIGRATION_DATABASE_URL='postgres://<owner>:<password>@<host>/<db>?sslmode=require'

# Newest first. Stops at the first error.
for v in 045 044 043 042 041 040 039 038 037 036 035 034 033; do
  psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f "tests/sql/rollback_000${v}.sql" || { echo "stopped at 000${v}"; break; }
done

cd connect-main/services/api && go run ./cmd/run_migration status   # expect 000032 as the last APPLIED
```

To undo only part of the release, stop the loop at the oldest migration you want to remove. Each rollback file also removes its own `schema_metadata` row, and CI runs this whole chain and re-applies it on every push. If something goes badly wrong, the Neon branch from section 1 is the full restore point.

## 4. Environment variables

Set these in the dashboards. Never commit real values. The block below is the ready-to-fill
`.env.production.example`. It lives here because the repo's commit gate blocks files named
`.env.*` other than `.env.example`, `.env.sample` and `.env.template`.

```bash
# ---------- Render: tathastu-connect-api ----------
# Existing required settings (DATABASE_URL as connect_app, WORKER_DATABASE_URL as connect_worker,
# REDIS_URL, LIVEKIT_*, R2_*, CORS_ALLOWED_ORIGINS, GOOGLE_CLIENT_IDS) stay as they are.

# The web origin users open. SSO callbacks go to <origin>/api/v1/auth/sso/<orgSlug>/callback.
PUBLIC_APP_ORIGIN=https://connect-alpha-seven.vercel.app

# University single sign-on (OpenID Connect). Leave SSO_PROVIDERS unset to turn SSO off.
# Generate the state secret with:  openssl rand -hex 32
SSO_STATE_SECRET=<64 hex characters from openssl rand -hex 32>
# One JSON array on one line. orgSlug must be an existing organization's slug.
# clientSecretEnv names another variable that holds that provider's client secret.
SSO_PROVIDERS=[{"orgSlug":"anant-university","label":"Anant University (Google)","issuer":"https://accounts.google.com","clientId":"<id>.apps.googleusercontent.com","clientSecretEnv":"SSO_SECRET_ANANT_GOOGLE","allowedDomains":["anant.edu"]},{"orgSlug":"anant-university-staff","label":"Anant University (Microsoft)","issuer":"https://login.microsoftonline.com/<tenant-id>/v2.0","clientId":"<application-client-id>","clientSecretEnv":"SSO_SECRET_ANANT_ENTRA","allowedDomains":["anant.edu"],"trustEmail":true}]
SSO_SECRET_ANANT_GOOGLE=<Google OAuth client secret>
SSO_SECRET_ANANT_ENTRA=<Entra client secret value>

# Official C++/Java grading. Leave CODE_RUNNER_URL unset until a runner exists; C++ then runs as a
# browser practice run, never as a grade.
CODE_RUNNER_KIND=piston            # piston or judge0
CODE_RUNNER_URL=https://<your-runner-host>   # Piston: base URL serving /api/v2/execute; Judge0 CE: base URL serving /submissions
CODE_RUNNER_TOKEN=<token>          # sent as Authorization (Piston) or X-Auth-Token (Judge0); empty if the runner needs none

# Free-tier AI. Comma-separated; several keys rotate. Groq also powers Whisper captions.
GROQ_KEYS=<gsk_...>[,<gsk_...>]
GEMINI_KEYS=<AIza...>[,<AIza...>]
OPENROUTER_KEYS=<sk-or-...>[,<sk-or-...>]

# ---------- Vercel: web ----------
NEXT_PUBLIC_APP_ORIGIN=https://connect-alpha-seven.vercel.app
INTERNAL_API_URL=https://connect-a2fi.onrender.com
NEXT_PUBLIC_API_URL=               # leave empty: the browser calls /api on the same origin
```

The AI key names are `GROQ_KEYS`, `GEMINI_KEYS` and `OPENROUTER_KEYS`, read in
`internal/ai/keys.go`. Names like `GROQ_API_KEY` are **ignored**.

### Registering an SSO provider

- **Redirect URI** to register with the identity provider: `https://connect-alpha-seven.vercel.app/api/v1/auth/sso/<orgSlug>/callback`.
- **Scopes requested:** `openid email profile`.
- **Google Workspace:** create a Web OAuth client in Google Cloud for the university's project. Set the consent screen to Internal so only that Workspace can sign in. Google sends `email_verified`, so leave `trustEmail` off.
- **Microsoft Entra ID:** register an app (Web platform) with the redirect URI above, create a client secret, and in Token configuration add the optional claim `email` to the ID token. Entra does not send `email_verified`, so set `"trustEmail": true` and always set `allowedDomains`.
- **Who can sign in:** only people who already have an active account and an active membership in that organization. SSO never creates accounts. Add people from `/institution` first.

## 5. After deploy

```bash
curl -fsS https://connect-a2fi.onrender.com/health/live
curl -fsS https://connect-alpha-seven.vercel.app/api/v1/auth/sso/providers   # lists configured universities ({"providers":[]} when SSO is off)
```

In Render logs, look for `database_identity_verified` (good). `database_identity_rejected … migration 000045_sso_member_lookup has not been applied` means section 2 was skipped.

Then check by hand:

1. Sign in.
2. On `/history`, the summary cards load.
3. As an institution admin on `/admin`, "System health and quotas" loads.
4. On `/institution` → Courses, the structure map loads.
5. In a C++ lab exercise with no runner configured, Run shows the compiler download pill once, then "Practice run (browser sandbox)".

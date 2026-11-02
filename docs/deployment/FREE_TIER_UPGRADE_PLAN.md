# Free-Tier Backend Upgrade Plan

Prepared, not executed. Every step that touches production needs separate owner approval.

## Starting point (read 2026-11-02)

| Item | State |
| :--- | :--- |
| Website | Vercel project `connect`, `https://connect-alpha-seven.vercel.app`, `main` at `910d501`, pre-merge web app |
| API | Render `connect`, free plan, commit `213d517`, auto-deploy **paused** (was `yes`, on commit) |
| Database | Neon project `muddy-lab-74896040`, branch `production`, migrations `000001`-`000009`, PostgreSQL 18 |
| Roles | `connect_app` and `connect_worker` exist without `bypassrls`; `.env` connects as `neondb_owner` (`bypassrls=true`), Render's `DATABASE_URL` not read |

`main` holds new API code under `services/api` with the old web app. **Do not re-enable auto-deploy or deploy `main` on Render until this plan is done:** startup fails with `WORKER_DATABASE_URL is required when the worker is enabled`.

## Free-tier constraints

- **Worker:** no paid Render worker. The API runs the worker in-process on one service with a separate pool, which needs only `WORKER_DATABASE_URL`. The cost is that jobs stop while the free service sleeps, so reminders and attendance reconciliation can run late, but not be lost, because jobs stay queued.
- **Render Free:** the service sleeps when idle, and the first request can take about a minute. Local files do not survive a restart, so `STORAGE_PROVIDER` must stay `r2`.
- **Neon Free:** branches are the rehearsal mechanism. Check current compute and storage quotas in the console before starting; do not assume them.
- **Recording:** remains blocked. Password recovery remains blocked until an email provider is approved.
- **Mismatch to resolve:** CI tests PostgreSQL 16 and production is PostgreSQL 18. The rehearsal below is the first run on 18.

## Steps

1. **Finish CI.** All browser journeys and database tests pass on the feature branch.
2. **Rehearse on a Neon branch** of `production`, with no production writes:
   - Apply `000010`-`000029` in order and check `schema_metadata`.
   - Set disposable role passwords on the branch.
   - Run the API against the branch as `connect_app` with `WORKER_DATABASE_URL` as `connect_worker`, and run the `TestWorkflowDB_` tests and acceptance journey there.
   - Run the rollback scripts in `tests/sql`, then reapply.
   - Check that existing rooms and the 4 existing users still work, then delete the branch.
3. **Check old-API compatibility.** Confirm `213d517` still works against the migrated branch. If it does not, migrations and the API change together in one window.
4. **Owner approval and backup.** Take a Neon restore point and agree a maintenance window.
5. **Production, in order:** apply migrations, set role passwords, set `DATABASE_URL` to `connect_app` and `WORKER_DATABASE_URL` to `connect_worker` on Render, set `GOOGLE_CLIENT_IDS` if Google sign-in is used, and deploy the feature-branch API.
6. **Reconcile `main` with the feature branch.** `main` reverted the web app in a forward commit, so restore the new web app deliberately, keeping the Vercel address and the proxy default from `32bd097`. Deploy the website only after the API is healthy.
7. **Verify, then restore auto-deploy** to `yes`.

## Rollback

Website: Vercel Instant Rollback. API: redeploy the previous commit on Render and restore its environment variables. Database: run `tests/sql/rollback_0000NN.sql` newest first, or restore the Neon restore point if data has changed since.

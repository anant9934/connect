# Platform Integration Designs and Cost Estimates

Status: **proposal, awaiting approval**. Nothing here is provisioned. Prices were read from web
sources on 2026-11-01; confirm them on each vendor's pricing page before approving.

## 1. LiveKit recording

**Flow:** host calls `POST /rooms/{code}/recording/start`; the API authorizes the host server-side
and starts a LiveKit room composite egress to a private R2 prefix. Egress webhooks, added to the
existing signed handler, drive the `recordings` state: `starting`, `active`, `processing`, `ready`,
`failed`. Playback goes through an authorized endpoint returning a short-lived signed URL. Deletion
and retention use the durable worker's file purge job.

**Constraints:** 3-hour limit per file-output egress, and 2 concurrent egress sessions on Build.

**Assumed pilot:** 5 courses x 3 one-hour classes a week x 4.3 weeks = about 1,290 video minutes a month.

| LiveKit plan | Included recording minutes | Overage | Estimated recording overage |
| :--- | :--- | :--- | :--- |
| Build (free) | 60 | Unconfirmed | Covers about one class only, so not viable |
| Ship | 600 | $0.02/min | 690 x $0.02 = **$13.80** plus the plan fee |
| Scale | 8,000 | $0.015/min | **$0** plus the plan fee |

Plan base fees are excluded and must be confirmed. Storage must be measured with a real recording.

**Recommendation:** test on Build's 60 free minutes first, then decide on Ship from measured use.

## 2. Isolated code execution

**Hard boundaries:** student code never runs on Render, in the API, or in Next.js.

**Architecture:** the API stores a submission and enqueues a job. A runner on a separate host pulls
jobs over an outbound-only authenticated connection and holds no database, R2 or LiveKit credentials.
It receives only the code and tests for that job. Hidden tests are compared on the runner and only
a pass/fail verdict per test is returned to students.

| Control | Limit (initial value) |
| :--- | :--- |
| Isolation | One gVisor (`runsc`) sandbox per run, destroyed afterwards; no Docker socket |
| CPU, memory | 1 vCPU, 256 MB, no swap |
| Time | 10 s run, 30 s compile, enforced from outside the sandbox |
| Processes | pids limit of 64 |
| Filesystem | Read-only root, 32 MB tmpfs workspace, 1 MB output cap |
| Network | None (`--network=none`) |
| Privileges | Non-root, all capabilities dropped, seccomp, no new privileges |

**Recommendation:** a small dedicated VPS with gVisor, because no network is simple to prove and the
monthly cost is fixed. The host may be compromised by design, so it holds nothing valuable. Fly.io
Machines (Firecracker, billed per second) are the alternative, at about $13.39 a month for an
always-on 2 GB shared machine per a secondary source, but blocking egress there is unconfirmed. VPS
pricing was not found and needs a quote. A real sandbox-escape test suite is an acceptance gate.

## 3. Email and notifications

**Abstraction:** `Mailer.Send(ctx, Message)`, called only from a durable `notification.email` worker
job with an idempotency key. In-app notifications are written in the same transaction as the event
and do not depend on email. Provider bounce and complaint webhooks are signature-verified and
suppress future sends.

| Provider | Free tier | Paid entry | Note |
| :--- | :--- | :--- | :--- |
| Resend | 3,000/month | $20/month for 50,000 | Simple HTTP API |
| Amazon SES | Disputed across sources | About $0.10 per 1,000 | Cheapest at scale; needs production-access approval |
| Brevo | 300/day | From $9/month for 5,000 | Largest free allowance; daily cap |
| Postmark | 100/month | About $15/month for 10,000 | Priced well above SES at volume |

**Recommendation:** Resend for launch, with SES as the migration path at high volume. Any provider
needs a domain you control with SPF, DKIM and DMARC, ideally on a sending subdomain to protect the
main domain's reputation. Password recovery and verification mail are time-critical: alert on bounce
rate and send delay.

## 4. AI services (Phase 5)

`services/api/internal/aiproviders` defines `Transcriber`, `LLM` and integer-based cost calculation.
No vendor adapter exists and no paid API is called. Usage persistence awaits a disposable database.

## Sources

- [LiveKit pricing](https://livekit.io/pricing), [LiveKit quotas and limits](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
- [Fly.io pricing](https://fly.io/docs/about/pricing/), [secondary comparison](https://findstack.com/resources/railway-vs-render-vs-fly-io)
- [Transactional email comparison](https://www.notificationapi.com/blog/transactional-email-apis), [SES vs Resend](https://www.sequenzy.com/versus/amazon-ses-vs-resend), [Resend costs](https://costbench.com/software/email-api/resend/), [Brevo alternatives](https://www.brevo.com/blog/postmark-alternatives/)

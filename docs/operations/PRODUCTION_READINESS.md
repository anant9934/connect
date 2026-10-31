# Production Readiness Checklist & Deployment Gate

## 1. Quality Gates & Prerequisites
Before promoting branch `remediation/c0-architecture-hardening` into staging or production, verify all gates:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        PRODUCTION READINESS GATE                       │
├───────────────────────────────────┬─────────┬──────────────────────────┤
│ Gate Item                         │ Status  │ Verification Method      │
├───────────────────────────────────┼─────────┼──────────────────────────┤
│ 15-Table Force Row Level Security │ PASS    │ SQL assertions & RLS     │
│ Cryptographic HMAC Identity       │ PASS    │ Constant-time PL/pgSQL   │
│ RBAC Permissive Action Policies   │ PASS    │ Full 15-table coverage   │
│ Monotonic Fencing Outbox Queue    │ PASS    │ Migration 000009         │
│ Unsafe Host-Inference Elimination │ PASS    │ Backfill quarantine rule │
│ Production-Grade Migration Runner │ PASS    │ CLI with advisory lock   │
│ Go Backend Automated Unit Tests   │ PASS    │ 100% pass across packages│
│ Web & Mobile Client Test Suites   │ PASS    │ 57 Web / 145 Mobile pass │
│ Credentials & Secret Cleanliness  │ PASS    │ Zero hardcoded secrets   │
└───────────────────────────────────┴─────────┴──────────────────────────┘
```

---

## 2. External Operational Pre-Requisites (Owner Action Required)
1. **Supabase / Neon Historical Credential Rotation**:
   - The repository owner must rotate any historical staging database passwords and service keys that existed in Git history prior to remediation.
2. **PostgreSQL Target Role Provisioning**:
   - Migration 000008 provisions `connect_app` and `connect_worker` with `NOSUPERUSER NOBYPASSRLS`. Target deployment environments must run migrations with `CREATEROLE` privileges.
3. **Stage C1 Authorization**:
   - Stage C1 feature development remains strictly unauthorized until manual sign-off by the principal repository owner.

# DATABASE SECURITY DESIGN — CRYPTOGRAPHIC IDENTITY & ROLE SEPARATION

## 1. The Threat Model: Custom GUC Identity Spoofing

### 1.1 The Vulnerability in Naive GUC Designs
In PostgreSQL, session parameters (GUCs) set via `SET app.current_user_id = '...'` or `SELECT set_config('app.current_user_id', ...)` are writable by any SQL connection possessing standard client privileges. If Row-Level Security (RLS) policies evaluate tenant isolation using raw settings like `current_setting('app.current_user_id', true)`, any compromised client or SQL injection flaw can trivially elevate privileges by issuing:
```sql
SET app.current_user_id = 'admin-uuid';
SET app.current_org_id = 'victim-tenant-uuid';
```

### 1.2 The Cryptographically Verified Identity Context Solution
Connect implements a **Transaction-Bound Cryptographic HMAC Identity Context**. RLS policies never trust raw GUCs. Instead:
1. Client requests provide a bearer session token.
2. The Go backend calculates `token_hash = sha256(token)`.
3. Inside an explicit transaction, the Go API calls:
   ```sql
   SELECT * FROM connect_auth.authenticate_session($1::VARCHAR, $2::UUID);
   ```
4. The function executes as a `SECURITY DEFINER` with fixed `search_path = pg_catalog, public, connect_auth`.
5. It validates the session in `public.sessions`, checks active membership, and queries `public.platform_administrators`.
6. It reads an internal cryptographic secret from `connect_auth.internal_keys` (which runtime application roles have zero permissions to read).
7. It retrieves the current transaction identifier `v_xid := pg_current_xact_id()::TEXT` and expiration timestamp `v_exp`.
8. It signs the identity claims with HMAC-SHA256:
   $$\text{sig} = \text{HMAC-SHA256}(\text{user\_id} \parallel \text{org\_id} \parallel \text{is\_super} \parallel \text{xid} \parallel \text{exp}, \text{secret\_key})$$
9. It sets transaction-local variables with `is_local = true`:
   `app._user_id`, `app._org_id`, `app._is_super`, `app._xid`, `app._exp`, `app._sig`.
10. The RLS verification functions `connect_auth.current_org_id()`, `connect_auth.current_user_id()`, and `connect_auth.is_super_admin()` recompute and verify the HMAC signature against `pg_current_xact_id()`. If tampered with, expired, or missing, they return `NULL` (fail closed!).

---

## 2. Trusted Authorization Context Flow

```mermaid
sequenceDiagram
    autonumber
    actor Client as User / Student
    participant API as Go API (connect_app)
    participant AuthSec as connect_auth.authenticate_session
    participant DB as PostgreSQL 16 (Tables & RLS)

    Client->>API: HTTP Request + Bearer Session Token + Header X-Organization-ID
    activate API
    API->>API: Compute token_hash = sha256(token)
    API->>DB: BEGIN TRANSACTION (ISOLATION LEVEL READ COMMITTED);
    API->>AuthSec: SELECT * FROM connect_auth.authenticate_session(token_hash, requested_org_id);
    activate AuthSec
    AuthSec->>DB: Query sessions table (validate expires_at > NOW(), revoked_at IS NULL)
    AuthSec->>DB: Query organization_memberships (validate status = 'active')
    AuthSec->>DB: Query platform_administrators (check active platform_super_admin)
    AuthSec->>AuthSec: Fetch internal secret from connect_auth.internal_keys
    AuthSec->>AuthSec: Get pg_current_xact_id() and compute HMAC-SHA256 signature
    AuthSec->>DB: SET LOCAL app._user_id, app._org_id, app._is_super, app._xid, app._exp, app._sig
    AuthSec-->>API: Return verified AuthContext
    deactivate AuthSec

    API->>DB: SELECT * FROM attendance_records;
    Note over DB: RLS Engine executes connect_auth.current_org_id()<br/>Recomputes HMAC signature against pg_current_xact_id()<br/>Signature matches -> applies tenant filter
    DB-->>API: Returns Scoped Rows Only (Zero Cross-Tenant Leakage)
    API->>DB: COMMIT; -- SET LOCAL variables instantly wiped
    API-->>Client: 200 OK Response
    deactivate API
```

---

## 3. Database Role Separation Architecture

Connect defines four distinct operational roles with least-privilege boundaries:

```
connect_owner (Database Owner & DDL Administrator)
   ├── Owns public and connect_auth schemas
   ├── Owns all tables, triggers, and functions
   └── Full control over internal HMAC signing keys

connect_migrator (Schema Migration Runner)
   ├── Has BYPASSRLS enabled for schema deployment
   ├── Executes 00000X migrations during deploy
   └── Excluded from application runtime traffic

connect_app (Go API Runtime Connection Pool)
   ├── NOBYPASSRLS, NOSUPERUSER, NOCREATEDB
   ├── DML privileges (SELECT, INSERT, UPDATE, DELETE) on business tables
   ├── EXECUTE grant on connect_auth.authenticate_session
   └── ZERO access to connect_auth.internal_keys

connect_worker (River Asynchronous Worker Pool)
   ├── NOBYPASSRLS, NOSUPERUSER
   ├── Dedicated connection pool (preventing API starvation)
   └── Process-scoped worker execution grants
```

---

## 4. SECURITY DEFINER Hardening Checklist

All procedures in `connect_auth` strictly enforce the following security controls:
- **Fixed search_path**: `SET search_path = pg_catalog, public, connect_auth` (prevents malicious schema shadowing or function hijacking).
- **Fully Qualified References**: Explicitly prefixes schema on all relations (`public.sessions`, `public.organization_memberships`, `public.platform_administrators`).
- **Owner Isolation**: Owned strictly by `connect_owner`.
- **Minimal Grants**: `REVOKE ALL ON SCHEMA connect_auth FROM PUBLIC`. Only `USAGE` is granted to `connect_app`.
- **Zero Key Access**: `REVOKE ALL ON TABLE connect_auth.internal_keys FROM PUBLIC, connect_app, connect_worker`.
- **Fail-Closed Semantics**: Any signature mismatch, expired context, missing variable, or transaction ID mismatch returns `NULL` or raises an exception.

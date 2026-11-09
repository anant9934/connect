package database

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Runtime identities. Each is a real PostgreSQL role, verified against the live connection.
const (
	RoleAPI    = "connect_app"
	RoleWorker = "connect_worker"
)

// RequiredMigration is the newest migration this build needs. Update it with each migration.
const RequiredMigration = "000041_ai_response_cache"

// rlsExemptTables holds no tenant or user data.
var rlsExemptTables = map[string]bool{"schema_metadata": true}

type tablePrivilege struct{ table, privilege string }

// rolePermissions lists what each runtime role must be able to do.
var rolePermissions = map[string]struct {
	tables    []tablePrivilege
	functions []string
	// emptyWithoutContext must show no rows to this role when no identity is set. Seeing any
	// means row level security is not restricting it, whatever the catalog says.
	emptyWithoutContext []string
}{
	RoleAPI: {
		tables: []tablePrivilege{
			{"users", "INSERT"}, {"sessions", "INSERT"}, {"rooms", "UPDATE"}, {"room_participants", "INSERT"},
			{"meeting_notes", "SELECT"}, {"meeting_files", "SELECT"}, {"security_audit_events", "INSERT"},
			{"livekit_webhook_events", "INSERT"}, {"participant_media_sessions", "INSERT"},
			{"lab_courses", "SELECT"}, {"lab_assignments", "INSERT"}, {"lab_submissions", "INSERT"},
		},
		functions: []string{
			"connect_auth.authenticate_session(character varying,uuid)",
			"connect_auth.auth_session_by_hash(text)",
			"connect_auth.room_by_code(text)",
			"connect_auth.resolve_room_access(text,text)",
			"connect_auth.enqueue_job(text,text,jsonb)",
			"connect_auth.enqueue_job_at(text,text,jsonb,timestamp with time zone)",
			"connect_auth.transfer_room_host(uuid,text)",
		},
		emptyWithoutContext: []string{"users", "sessions", "rooms", "room_participants", "background_jobs", "security_audit_events", "organizations", "lab_courses", "lab_assignments", "lab_submissions"},
	},
	RoleWorker: {
		tables: []tablePrivilege{
			{"background_jobs", "SELECT"}, {"background_jobs", "INSERT"}, {"background_jobs", "UPDATE"},
			{"rooms", "SELECT"}, {"rooms", "UPDATE"}, {"room_participants", "UPDATE"}, {"room_admissions", "UPDATE"},
			{"attendance_records", "INSERT"}, {"attendance_records", "UPDATE"},
			{"participant_media_sessions", "SELECT"}, {"attendance_policies", "SELECT"}, {"course_enrollments", "SELECT"},
		},
		functions:           []string{"connect_auth.succeed_room_host(uuid)"},
		emptyWithoutContext: []string{"users", "sessions", "security_audit_events"},
	},
}

// IdentityError lists every reason a connection may not serve as a runtime role. It names roles
// and tables only, never connection details.
type IdentityError struct {
	ExpectedRole string
	Problems     []string
}

func (e *IdentityError) Error() string {
	return fmt.Sprintf("database connection is not safe to use as %s: %s", e.ExpectedRole, strings.Join(e.Problems, "; "))
}

// VerifyRuntimeIdentity asks the database who this connection really is and what it can reach.
// It fails closed: an error from any check is an error from the whole verification.
func VerifyRuntimeIdentity(ctx context.Context, pool *pgxpool.Pool, expectedRole string) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("identity check could not acquire a connection: %w", err)
	}
	defer conn.Release()
	q := conn.Conn()

	var problems []string
	add := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }

	var currentUser, sessionUser string
	var super, bypass, createRole, createDB, replication bool
	err = q.QueryRow(ctx, `
		SELECT current_user::text, session_user::text, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication
		FROM pg_roles r WHERE r.rolname = current_user
	`).Scan(&currentUser, &sessionUser, &super, &bypass, &createRole, &createDB, &replication)
	if err != nil {
		return fmt.Errorf("identity check failed: %w", err)
	}
	if currentUser != expectedRole || sessionUser != expectedRole {
		add("connected as %s (session %s), expected %s; point this setting at the %s role", currentUser, sessionUser, expectedRole, expectedRole)
	}
	if super {
		add("role %s is a superuser", currentUser)
	}
	if bypass {
		add("role %s has BYPASSRLS", currentUser)
	}
	if createRole || createDB || replication {
		add("role %s has CREATEROLE, CREATEDB or REPLICATION", currentUser)
	}

	rows, err := q.Query(ctx, `
		WITH RECURSIVE reach AS (
			SELECT m.roleid FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = current_user
			UNION
			SELECT m.roleid FROM pg_auth_members m JOIN reach ON m.member = reach.roleid
		)
		SELECT a.rolname::text FROM reach JOIN pg_roles a ON a.oid = reach.roleid
		WHERE a.rolsuper OR a.rolbypassrls OR a.rolcreaterole
		ORDER BY 1
	`)
	if err != nil {
		return fmt.Errorf("membership check failed: %w", err)
	}
	privileged, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("membership check failed: %w", err)
	}
	if len(privileged) > 0 {
		add("role %s has membership in privileged roles: %s; revoke that membership", currentUser, strings.Join(privileged, ", "))
	}

	// pg_has_role covers ownership through membership as well as directly.
	rows, err = q.Query(ctx, `
		SELECT n.nspname::text || '.' || c.relname::text
		FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname IN ('public', 'connect_auth') AND c.relkind IN ('r', 'p')
		  AND pg_has_role(current_user, c.relowner, 'MEMBER')
		ORDER BY 1
	`)
	if err != nil {
		return fmt.Errorf("ownership check failed: %w", err)
	}
	owned, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("ownership check failed: %w", err)
	}
	if len(owned) > 0 {
		add("role %s owns protected tables, so it could disable row level security: %s", currentUser, strings.Join(owned, ", "))
	}

	rows, err = q.Query(ctx, `
		SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
		ORDER BY 1
	`)
	if err != nil {
		return fmt.Errorf("row level security check failed: %w", err)
	}
	unprotected, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("row level security check failed: %w", err)
	}
	for _, table := range unprotected {
		if !rlsExemptTables[table] {
			add("table %s does not have forced row level security; apply migrations through %s", table, RequiredMigration)
		}
	}

	spec, known := rolePermissions[expectedRole]
	if !known || currentUser != expectedRole {
		return identityResult(expectedRole, problems)
	}

	var migrated bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_metadata WHERE version = $1)`, RequiredMigration).Scan(&migrated); err != nil {
		return fmt.Errorf("migration check failed: %w", err)
	}
	if !migrated {
		add("migration %s has not been applied", RequiredMigration)
		// Later checks name objects that may not exist yet.
		return identityResult(expectedRole, problems)
	}
	for _, need := range spec.tables {
		var allowed bool
		if err := q.QueryRow(ctx, `SELECT has_table_privilege(current_user, $1::regclass, $2)`, "public."+need.table, need.privilege).Scan(&allowed); err != nil {
			return fmt.Errorf("privilege check on %s failed: %w", need.table, err)
		}
		if !allowed {
			add("role %s lacks %s on %s", currentUser, need.privilege, need.table)
		}
	}
	for _, fn := range spec.functions {
		var allowed bool
		if err := q.QueryRow(ctx, `SELECT to_regprocedure($1) IS NOT NULL AND has_function_privilege(current_user, to_regprocedure($1), 'EXECUTE')`, fn).Scan(&allowed); err != nil {
			return fmt.Errorf("privilege check on %s failed: %w", fn, err)
		}
		if !allowed {
			add("role %s cannot execute %s", currentUser, fn)
		}
	}
	for _, table := range spec.emptyWithoutContext {
		var visible int64
		// Table names come from the constant list above, never from input.
		if err := q.QueryRow(ctx, `SELECT count(*) FROM public.`+pgx.Identifier{table}.Sanitize()).Scan(&visible); err != nil {
			return fmt.Errorf("row level security probe on %s failed: %w", table, err)
		}
		if visible > 0 {
			add("role %s can read %d rows of %s with no identity set; row level security is not restricting it", currentUser, visible, table)
		}
	}
	return identityResult(expectedRole, problems)
}

func identityResult(expectedRole string, problems []string) error {
	if len(problems) == 0 {
		return nil
	}
	return &IdentityError{ExpectedRole: expectedRole, Problems: problems}
}

// IsIdentityError reports whether err is a failed identity verification.
func IsIdentityError(err error) bool {
	var identityErr *IdentityError
	return errors.As(err, &identityErr)
}

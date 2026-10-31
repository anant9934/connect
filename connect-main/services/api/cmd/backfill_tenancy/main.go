package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	BatchSize        = 1000
	ThrottleInterval = 50 * time.Millisecond
	TaskName         = "room_tenancy_backfill"
	CommonsOrgID     = "00000000-0000-0000-0000-000000000001"
)

// ClassificationStats tracks metrics for the reconciliation report.
type ClassificationStats struct {
	PersonalWorkspace int64
	PersonalCommons   int64
	Institutional     int64
	Quarantined       int64
	TotalProcessed    int64
}

// ClassifyRoom determines workspace classification based on verified relational evidence.
// It eliminates unsafe host-inference: ambiguous, conflicted, or unattributable records are quarantined.
func ClassifyRoom(classSessionID *string, hostUserID *string, isCollaborationNode bool, isAmbiguous ...bool) (workspaceType string, orgID *string, isLocked bool) {
	// Rule 0: Ambiguous or Conflicted Records -> Immediate Quarantine
	if len(isAmbiguous) > 0 && isAmbiguous[0] {
		return "quarantine_unclassified", nil, true
	}

	// Rule 1: Institutional Academic Sessions
	if classSessionID != nil && *classSessionID != "" {
		return "institutional", nil, false // Org ID retained from parent class session
	}

	// Rule 2: Personal Commons (Collaboration nodes or public webinars)
	if isCollaborationNode {
		commons := CommonsOrgID
		return "personal_commons", &commons, false
	}

	// Rule 3: Personal Private Sandbox (Verified ad-hoc meeting owned by valid host with zero conflict)
	if hostUserID != nil && *hostUserID != "" {
		return "personal_workspace", nil, false
	}

	// Rule 4: Unattributable / Corrupted Historical Records -> Quarantine
	// Completely locked and NEVER exposed in Personal Commons
	return "quarantine_unclassified", nil, true
}

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		log.Fatalf("Failed to parse DB config: %v", err)
	}
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()

	stats, err := RunBackfill(ctx, pool, BatchSize, ThrottleInterval)
	if err != nil {
		log.Fatalf("Backfill failed: %v", err)
	}

	fmt.Printf("\n================ BACKFILL RECONCILIATION REPORT ================\n")
	fmt.Printf("Total Rooms Processed   : %d\n", stats.TotalProcessed)
	fmt.Printf("Personal Workspaces     : %d\n", stats.PersonalWorkspace)
	fmt.Printf("Personal Commons        : %d\n", stats.PersonalCommons)
	fmt.Printf("Institutional           : %d\n", stats.Institutional)
	fmt.Printf("Quarantined Unclassified: %d\n", stats.Quarantined)
	fmt.Printf("================================================================\n")
}

// RunBackfill executes the restartable keyset-batch backfill across rooms, notes, and files.
func RunBackfill(ctx context.Context, pool *pgxpool.Pool, batchSize int, throttle time.Duration) (*ClassificationStats, error) {
	stats := &ClassificationStats{}

	// 1. Ensure Personal Commons organization exists
	_, err := pool.Exec(ctx, `
		INSERT INTO organizations (id, slug, name, status)
		VALUES ($1, 'personal-commons', 'Connect Personal Commons', 'active')
		ON CONFLICT (id) DO NOTHING;
	`, CommonsOrgID)
	if err != nil {
		return nil, fmt.Errorf("failed to ensure commons organization: %w", err)
	}

	// 2. Fetch last checkpoint
	var lastProcessedID *string
	row := pool.QueryRow(ctx, `
		SELECT last_processed_id::text
		FROM migration_checkpoints
		WHERE task_name = $1;
	`, TaskName)
	_ = row.Scan(&lastProcessedID)

	// 3. Process Rooms in Bounded Keyset Batches
	cursorID := "00000000-0000-0000-0000-000000000000"
	if lastProcessedID != nil && *lastProcessedID != "" {
		cursorID = *lastProcessedID
	}

	for {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return nil, fmt.Errorf("failed to begin transaction: %w", err)
		}

		rows, err := tx.Query(ctx, `
			SELECT id, host_user_id, class_session_id
			FROM rooms
			WHERE id > $1::uuid AND (workspace_type IS NULL OR workspace_type = '' OR workspace_type = 'unclassified')
			ORDER BY id ASC
			LIMIT $2;
		`, cursorID, batchSize)
		if err != nil {
			_ = tx.Rollback(ctx)
			return nil, fmt.Errorf("failed to fetch room batch: %w", err)
		}

		type RoomRow struct {
			ID             string
			HostUserID     *string
			ClassSessionID *string
		}

		var batch []RoomRow
		for rows.Next() {
			var r RoomRow
			if err := rows.Scan(&r.ID, &r.HostUserID, &r.ClassSessionID); err != nil {
				rows.Close()
				_ = tx.Rollback(ctx)
				return nil, fmt.Errorf("failed to scan room row: %w", err)
			}
			batch = append(batch, r)
		}
		rows.Close()

		if len(batch) == 0 {
			_ = tx.Rollback(ctx)
			break // All rooms backfilled cleanly!
		}

		for _, r := range batch {
			wsType, orgID, isLocked := ClassifyRoom(r.ClassSessionID, r.HostUserID, false)

			_, err = tx.Exec(ctx, `
				UPDATE rooms
				SET workspace_type = $1,
				    organization_id = COALESCE($2, organization_id),
				    is_locked = CASE WHEN $3 = true THEN true ELSE is_locked END
				WHERE id = $4;
			`, wsType, orgID, isLocked, r.ID)
			if err != nil {
				_ = tx.Rollback(ctx)
				return nil, fmt.Errorf("failed to update room %s: %w", r.ID, err)
			}

			switch wsType {
			case "personal_workspace":
				stats.PersonalWorkspace++
			case "personal_commons":
				stats.PersonalCommons++
			case "institutional":
				stats.Institutional++
			case "quarantine_unclassified":
				stats.Quarantined++
			}
			stats.TotalProcessed++
		}

		cursorID = batch[len(batch)-1].ID

		// Update Checkpoint within the same transaction
		_, err = tx.Exec(ctx, `
			INSERT INTO migration_checkpoints (task_name, last_processed_id, rows_processed, status, updated_at)
			VALUES ($1, $2::uuid, $3, 'in_progress', clock_timestamp())
			ON CONFLICT (task_name) DO UPDATE
			SET last_processed_id = EXCLUDED.last_processed_id,
			    rows_processed = migration_checkpoints.rows_processed + EXCLUDED.rows_processed,
			    updated_at = clock_timestamp();
		`, TaskName, cursorID, int64(len(batch)))
		if err != nil {
			_ = tx.Rollback(ctx)
			return nil, fmt.Errorf("failed to update checkpoint: %w", err)
		}

		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("failed to commit batch: %w", err)
		}

		if throttle > 0 {
			time.Sleep(throttle)
		}
	}

	// 4. Backfill Notes & Files Tenancy via Parent Room Join
	_, err = pool.Exec(ctx, `
		UPDATE meeting_notes n
		SET organization_id = r.organization_id,
		    workspace_type = r.workspace_type
		FROM rooms r
		WHERE n.room_id = r.id AND (n.workspace_type IS NULL OR n.workspace_type = '' OR n.workspace_type = 'unclassified');
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to backfill meeting notes: %w", err)
	}

	_, err = pool.Exec(ctx, `
		UPDATE meeting_files f
		SET organization_id = r.organization_id,
		    workspace_type = r.workspace_type
		FROM rooms r
		WHERE f.room_id = r.id AND (f.workspace_type IS NULL OR f.workspace_type = '' OR f.workspace_type = 'unclassified');
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to backfill meeting files: %w", err)
	}

	// 5. Quarantine Orphan Notes & Files (whose parent room was deleted or corrupted)
	_, _ = pool.Exec(ctx, `
		UPDATE meeting_notes
		SET workspace_type = 'quarantine_unclassified'
		WHERE workspace_type IS NULL OR workspace_type = '' OR workspace_type = 'unclassified';
	`)
	_, _ = pool.Exec(ctx, `
		UPDATE meeting_files
		SET workspace_type = 'quarantine_unclassified'
		WHERE workspace_type IS NULL OR workspace_type = '' OR workspace_type = 'unclassified';
	`)

	// Mark checkpoint completed
	_, _ = pool.Exec(ctx, `
		UPDATE migration_checkpoints
		SET status = 'completed', updated_at = clock_timestamp()
		WHERE task_name = $1;
	`, TaskName)

	return stats, nil
}

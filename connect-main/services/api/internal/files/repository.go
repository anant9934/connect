package files

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/worker"
)

// Actor is a verified caller acting within one room.
type Actor struct {
	RoomID   string
	Identity string
}

type Repository interface {
	CreateFile(ctx context.Context, actor Actor, file *MeetingFile) error
	GetFileByID(ctx context.Context, actor Actor, fileID string) (*MeetingFile, error)
	GetFilesByRoomID(ctx context.Context, actor Actor) ([]*MeetingFile, error)
	UpdateScanStatus(ctx context.Context, actor Actor, fileID string, status ScanStatus, result string) error
	DeleteFile(ctx context.Context, actor Actor, fileID string) error
}

// MemoryRepository provides thread-safe in-memory storage for files metadata.
type MemoryRepository struct {
	mu    sync.RWMutex
	files map[string]*MeetingFile // key: fileID
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		files: make(map[string]*MeetingFile),
	}
}

func (m *MemoryRepository) CreateFile(ctx context.Context, actor Actor, file *MeetingFile) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Check room capacity
	count := 0
	for _, f := range m.files {
		if f.RoomID == file.RoomID && f.ScanStatus != ScanStatusDeleted {
			count++
		}
	}
	if count >= MaxFilesPerMeeting {
		return ErrRoomCapacityExceeded
	}

	copyFile := *file
	m.files[file.ID] = &copyFile
	return nil
}

func (m *MemoryRepository) GetFileByID(ctx context.Context, _ Actor, fileID string) (*MeetingFile, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	f, exists := m.files[fileID]
	if !exists || f.ScanStatus == ScanStatusDeleted {
		return nil, ErrFileNotFound
	}
	copyFile := *f
	return &copyFile, nil
}

func (m *MemoryRepository) GetFilesByRoomID(ctx context.Context, actor Actor) ([]*MeetingFile, error) {
	roomID := actor.RoomID
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*MeetingFile
	for _, f := range m.files {
		if f.RoomID == roomID && f.ScanStatus != ScanStatusDeleted {
			copyFile := *f
			result = append(result, &copyFile)
		}
	}
	return result, nil
}

func (m *MemoryRepository) UpdateScanStatus(ctx context.Context, _ Actor, fileID string, status ScanStatus, result string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	f, exists := m.files[fileID]
	if !exists {
		return ErrFileNotFound
	}
	f.ScanStatus = status
	f.ScanResult = result
	f.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *MemoryRepository) DeleteFile(ctx context.Context, _ Actor, fileID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	f, exists := m.files[fileID]
	if !exists {
		return ErrFileNotFound
	}
	f.ScanStatus = ScanStatusDeleted
	f.UpdatedAt = time.Now().UTC()
	return nil
}

// PgxRepository implements PostgreSQL persistence for file records. Every call runs
// inside the caller's RLS context: a verified session, or a guest limited to one room.
type PgxRepository struct {
	pool *pgxpool.Pool
}

func NewPgxRepository(pool *pgxpool.Pool) *PgxRepository {
	return &PgxRepository{pool: pool}
}

// inContext passes fn the uploader's user id, which is nil for guests.
func (p *PgxRepository) inContext(ctx context.Context, actor Actor, fn func(pgx.Tx, *string) error) error {
	if !strings.HasPrefix(actor.Identity, "user:") {
		return database.WithRoomGuestContext(ctx, p.pool, actor.RoomID, actor.Identity, func(tx pgx.Tx) error {
			return fn(tx, nil)
		})
	}
	tokenHash := database.SessionTokenHash(ctx)
	if tokenHash == "" {
		return ErrUnauthorized
	}
	return database.WithAuthContext(ctx, p.pool, tokenHash, nil, func(tx pgx.Tx, auth *database.AuthContext) error {
		if "user:"+auth.UserID != actor.Identity {
			return ErrUnauthorized
		}
		return fn(tx, &auth.UserID)
	})
}

const fileColumns = `id, room_id, uploaded_by_identity, original_filename,
	sanitized_filename, storage_key, content_type, size_bytes,
	scan_status, scan_result, created_at`

func scanFile(row pgx.Row) (*MeetingFile, error) {
	var f MeetingFile
	var status string
	var scanResult *string
	if err := row.Scan(
		&f.ID, &f.RoomID, &f.UploadedByIdentity, &f.OriginalFilename,
		&f.SanitizedFilename, &f.StorageKey, &f.MimeType, &f.SizeBytes,
		&status, &scanResult, &f.CreatedAt,
	); err != nil {
		return nil, err
	}
	f.ScanStatus = ScanStatus(status)
	if scanResult != nil {
		f.ScanResult = *scanResult
	}
	return &f, nil
}

func (p *PgxRepository) CreateFile(ctx context.Context, actor Actor, file *MeetingFile) error {
	return p.inContext(ctx, actor, func(tx pgx.Tx, userID *string) error {
		var count int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM meeting_files
			WHERE room_id = $1 AND scan_status != 'deleted'
		`, file.RoomID).Scan(&count); err != nil {
			return fmt.Errorf("failed to check room file count: %w", err)
		}
		if count >= MaxFilesPerMeeting {
			return ErrRoomCapacityExceeded
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO meeting_files (
				id, room_id, uploaded_by, uploaded_by_identity, uploader_name, original_filename,
				sanitized_filename, storage_key, content_type, size_bytes,
				scan_status, scan_result, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		`, file.ID, file.RoomID, userID, file.UploadedByIdentity, file.UploadedByIdentity,
			file.OriginalFilename, file.SanitizedFilename, file.StorageKey,
			file.MimeType, file.SizeBytes, string(file.ScanStatus), file.ScanResult, file.CreatedAt)
		if err != nil {
			return fmt.Errorf("failed to insert file record: %w", err)
		}
		return nil
	})
}

func (p *PgxRepository) GetFileByID(ctx context.Context, actor Actor, fileID string) (*MeetingFile, error) {
	var file *MeetingFile
	err := p.inContext(ctx, actor, func(tx pgx.Tx, _ *string) error {
		var qErr error
		file, qErr = scanFile(tx.QueryRow(ctx, `
			SELECT `+fileColumns+` FROM meeting_files
			WHERE id = $1 AND room_id = $2 AND scan_status != 'deleted'
		`, fileID, actor.RoomID))
		return qErr
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrFileNotFound
	}
	if err != nil {
		return nil, err
	}
	return file, nil
}

func (p *PgxRepository) GetFilesByRoomID(ctx context.Context, actor Actor) ([]*MeetingFile, error) {
	var files []*MeetingFile
	err := p.inContext(ctx, actor, func(tx pgx.Tx, _ *string) error {
		rows, err := tx.Query(ctx, `
			SELECT `+fileColumns+` FROM meeting_files
			WHERE room_id = $1 AND scan_status != 'deleted'
			ORDER BY created_at DESC
		`, actor.RoomID)
		if err != nil {
			return fmt.Errorf("failed to query meeting files: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			f, err := scanFile(rows)
			if err != nil {
				return err
			}
			files = append(files, f)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

func (p *PgxRepository) UpdateScanStatus(ctx context.Context, actor Actor, fileID string, status ScanStatus, result string) error {
	return p.inContext(ctx, actor, func(tx pgx.Tx, _ *string) error {
		_, err := tx.Exec(ctx, `
			UPDATE meeting_files SET scan_status = $1, scan_result = $2
			WHERE id = $3 AND room_id = $4
		`, string(status), result, fileID, actor.RoomID)
		return err
	})
}

func (p *PgxRepository) DeleteFile(ctx context.Context, actor Actor, fileID string) error {
	return p.inContext(ctx, actor, func(tx pgx.Tx, _ *string) error {
		var storageKey string
		var orgID *string
		err := tx.QueryRow(ctx, `
			UPDATE meeting_files
			SET scan_status = 'deleted'
			WHERE id = $1 AND room_id = $2
			RETURNING storage_key, organization_id::text
		`, fileID, actor.RoomID).Scan(&storageKey, &orgID)
		if err != nil {
			return fmt.Errorf("failed to mark file deleted: %w", err)
		}
		if storageKey == "" {
			return nil
		}

		purgeKey := fmt.Sprintf("file-purge-%s-%d", fileID, time.Now().UnixNano())
		var orgIDStr string
		if orgID != nil {
			orgIDStr = *orgID
		}
		purgeData, err := json.Marshal(map[string]any{"fileKeys": []string{storageKey}, "tenantId": orgIDStr})
		if err != nil {
			return err
		}
		purgePayload := worker.JobPayload{
			Type:      worker.TypeFilePurge,
			Data:      purgeData,
			CreatedAt: time.Now().UTC(),
		}
		if err := worker.EnqueueJobWriteOnly(ctx, tx, worker.QueueDefault, purgeKey, purgePayload); err != nil {
			return fmt.Errorf("failed to enqueue file purge outbox job: %w", err)
		}
		return nil
	})
}

package files

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/worker"
)

type Repository interface {
	CreateFile(ctx context.Context, file *MeetingFile) error
	GetFileByID(ctx context.Context, fileID string) (*MeetingFile, error)
	GetFilesByRoomID(ctx context.Context, roomID string) ([]*MeetingFile, error)
	GetFileCountByRoomID(ctx context.Context, roomID string) (int, error)
	UpdateScanStatus(ctx context.Context, fileID string, status ScanStatus, result string) error
	DeleteFile(ctx context.Context, fileID string) error
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

func (m *MemoryRepository) CreateFile(ctx context.Context, file *MeetingFile) error {
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

func (m *MemoryRepository) GetFileByID(ctx context.Context, fileID string) (*MeetingFile, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	f, exists := m.files[fileID]
	if !exists || f.ScanStatus == ScanStatusDeleted {
		return nil, ErrFileNotFound
	}
	copyFile := *f
	return &copyFile, nil
}

func (m *MemoryRepository) GetFilesByRoomID(ctx context.Context, roomID string) ([]*MeetingFile, error) {
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

func (m *MemoryRepository) GetFileCountByRoomID(ctx context.Context, roomID string) (int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	count := 0
	for _, f := range m.files {
		if f.RoomID == roomID && f.ScanStatus != ScanStatusDeleted {
			count++
		}
	}
	return count, nil
}

func (m *MemoryRepository) UpdateScanStatus(ctx context.Context, fileID string, status ScanStatus, result string) error {
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

func (m *MemoryRepository) DeleteFile(ctx context.Context, fileID string) error {
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

// PgxRepository implements PostgreSQL persistence for file records.
type PgxRepository struct {
	pool *pgxpool.Pool
}

func NewPgxRepository(pool *pgxpool.Pool) *PgxRepository {
	return &PgxRepository{pool: pool}
}

func (p *PgxRepository) CreateFile(ctx context.Context, file *MeetingFile) error {
	countQuery := `
		SELECT COUNT(*)
		FROM meeting_files
		WHERE room_id = $1 AND scan_status != 'deleted'
	`
	var count int
	if err := p.pool.QueryRow(ctx, countQuery, file.RoomID).Scan(&count); err != nil {
		return fmt.Errorf("failed to check room file count: %w", err)
	}
	if count >= MaxFilesPerMeeting {
		return ErrRoomCapacityExceeded
	}

	insertQuery := `
		INSERT INTO meeting_files (
			id, room_id, uploaded_by_identity, uploader_name, original_filename,
			sanitized_filename, storage_key, content_type, size_bytes,
			scan_status, scan_result, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`
	_, err := p.pool.Exec(ctx, insertQuery,
		file.ID, file.RoomID, file.UploadedByIdentity, file.UploadedByIdentity,
		file.OriginalFilename, file.SanitizedFilename, file.StorageKey,
		file.MimeType, file.SizeBytes, string(file.ScanStatus), file.ScanResult, file.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to insert file record: %w", err)
	}
	return nil
}

func (p *PgxRepository) GetFileByID(ctx context.Context, fileID string) (*MeetingFile, error) {
	query := `
		SELECT id, room_id, uploaded_by_identity, original_filename,
		       sanitized_filename, storage_key, content_type, size_bytes,
		       scan_status, scan_result, created_at
		FROM meeting_files
		WHERE id = $1 AND scan_status != 'deleted'
	`
	var f MeetingFile
	var status string
	var scanResult *string
	err := p.pool.QueryRow(ctx, query, fileID).Scan(
		&f.ID, &f.RoomID, &f.UploadedByIdentity, &f.OriginalFilename,
		&f.SanitizedFilename, &f.StorageKey, &f.MimeType, &f.SizeBytes,
		&status, &scanResult, &f.CreatedAt,
	)
	if err != nil {
		return nil, ErrFileNotFound
	}
	f.ScanStatus = ScanStatus(status)
	if scanResult != nil {
		f.ScanResult = *scanResult
	}
	return &f, nil
}

func (p *PgxRepository) GetFilesByRoomID(ctx context.Context, roomID string) ([]*MeetingFile, error) {
	query := `
		SELECT id, room_id, uploaded_by_identity, original_filename,
		       sanitized_filename, storage_key, content_type, size_bytes,
		       scan_status, scan_result, created_at
		FROM meeting_files
		WHERE room_id = $1 AND scan_status != 'deleted'
		ORDER BY created_at DESC
	`
	rows, err := p.pool.Query(ctx, query, roomID)
	if err != nil {
		return nil, fmt.Errorf("failed to query meeting files: %w", err)
	}
	defer rows.Close()

	var files []*MeetingFile
	for rows.Next() {
		var f MeetingFile
		var status string
		var scanResult *string
		if err := rows.Scan(
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
		files = append(files, &f)
	}
	return files, nil
}

func (p *PgxRepository) GetFileCountByRoomID(ctx context.Context, roomID string) (int, error) {
	query := `
		SELECT COUNT(*)
		FROM meeting_files
		WHERE room_id = $1 AND scan_status != 'deleted'
	`
	var count int
	err := p.pool.QueryRow(ctx, query, roomID).Scan(&count)
	return count, err
}

func (p *PgxRepository) UpdateScanStatus(ctx context.Context, fileID string, status ScanStatus, result string) error {
	query := `
		UPDATE meeting_files
		SET scan_status = $1, scan_result = $2
		WHERE id = $3
	`
	_, err := p.pool.Exec(ctx, query, string(status), result, fileID)
	return err
}

func (p *PgxRepository) DeleteFile(ctx context.Context, fileID string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin delete file transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var storageKey string
	err = tx.QueryRow(ctx, `
		UPDATE meeting_files
		SET scan_status = 'deleted'
		WHERE id = $1
		RETURNING storage_key
	`, fileID).Scan(&storageKey)
	if err != nil {
		return fmt.Errorf("failed to mark file deleted: %w", err)
	}

	if storageKey != "" {
		purgeKey := fmt.Sprintf("file-purge-%s-%d", fileID, time.Now().UnixNano())
		purgePayload := worker.JobPayload{
			Type:      worker.TypeFilePurge,
			Data:      json.RawMessage(fmt.Sprintf(`{"fileKeys":["%s"]}`, storageKey)),
			CreatedAt: time.Now().UTC(),
		}
		if _, err := worker.EnqueueJob(ctx, tx, worker.QueueDefault, purgeKey, purgePayload, nil); err != nil {
			return fmt.Errorf("failed to enqueue file purge outbox job: %w", err)
		}
	}

	return tx.Commit(ctx)
}

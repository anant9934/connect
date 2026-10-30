package notes

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	GetByRoomID(ctx context.Context, roomID string) (*MeetingNote, error)
	UpsertNote(ctx context.Context, roomID, callerIdentity, title, content string, expectedRevision int) (*MeetingNote, error)
}

// MemoryRepository provides thread-safe in-memory persistence for tests and memory mode.
type MemoryRepository struct {
	mu    sync.RWMutex
	notes map[string]*MeetingNote // key: roomID
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		notes: make(map[string]*MeetingNote),
	}
}

func (m *MemoryRepository) GetByRoomID(ctx context.Context, roomID string) (*MeetingNote, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	note, exists := m.notes[roomID]
	if !exists {
		// Return default note template
		return &MeetingNote{
			ID:                uuid.NewString(),
			RoomID:            roomID,
			Title:             "Meeting Notes",
			Content:           "",
			Revision:          1,
			CreatedByIdentity: "system",
			UpdatedByIdentity: "system",
			CreatedAt:         time.Now().UTC(),
			UpdatedAt:         time.Now().UTC(),
		}, nil
	}

	// Return a copy
	n := *note
	return &n, nil
}

func (m *MemoryRepository) UpsertNote(ctx context.Context, roomID, callerIdentity, title, content string, expectedRevision int) (*MeetingNote, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	current, exists := m.notes[roomID]
	if !exists {
		// If expectedRevision != 1 for the very first creation, reject
		if expectedRevision != 1 && expectedRevision != 0 {
			return nil, ErrRevisionConflict
		}
		rev := 2
		if expectedRevision == 0 {
			rev = 1
		}
		newNote := &MeetingNote{
			ID:                uuid.NewString(),
			RoomID:            roomID,
			Title:             title,
			Content:           content,
			Revision:          rev,
			CreatedByIdentity: callerIdentity,
			UpdatedByIdentity: callerIdentity,
			CreatedAt:         time.Now().UTC(),
			UpdatedAt:         time.Now().UTC(),
		}
		m.notes[roomID] = newNote
		n := *newNote
		return &n, nil
	}

	// Optimistic concurrency check
	if current.Revision != expectedRevision {
		return nil, ErrRevisionConflict
	}

	current.Title = title
	current.Content = content
	current.Revision++
	current.UpdatedByIdentity = callerIdentity
	current.UpdatedAt = time.Now().UTC()

	n := *current
	return &n, nil
}

// PgxRepository implements PostgreSQL persistence via pgxpool.
type PgxRepository struct {
	pool *pgxpool.Pool
}

func NewPgxRepository(pool *pgxpool.Pool) *PgxRepository {
	return &PgxRepository{pool: pool}
}

func (p *PgxRepository) GetByRoomID(ctx context.Context, roomID string) (*MeetingNote, error) {
	query := `
		SELECT id, room_id, title, content, revision, created_by_identity, updated_by_identity, created_at, updated_at
		FROM meeting_notes
		WHERE room_id = $1
	`
	var n MeetingNote
	err := p.pool.QueryRow(ctx, query, roomID).Scan(
		&n.ID, &n.RoomID, &n.Title, &n.Content, &n.Revision,
		&n.CreatedByIdentity, &n.UpdatedByIdentity, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		// If no note exists yet, return default template
		return &MeetingNote{
			ID:                uuid.NewString(),
			RoomID:            roomID,
			Title:             "Meeting Notes",
			Content:           "",
			Revision:          1,
			CreatedByIdentity: "system",
			UpdatedByIdentity: "system",
			CreatedAt:         time.Now().UTC(),
			UpdatedAt:         time.Now().UTC(),
		}, nil
	}
	return &n, nil
}

func (p *PgxRepository) UpsertNote(ctx context.Context, roomID, callerIdentity, title, content string, expectedRevision int) (*MeetingNote, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Lock the row for update if it exists
	selectQuery := `
		SELECT id, revision
		FROM meeting_notes
		WHERE room_id = $1
		FOR UPDATE
	`
	var id string
	var currentRevision int
	err = tx.QueryRow(ctx, selectQuery, roomID).Scan(&id, &currentRevision)
	now := time.Now().UTC()

	if err != nil {
		// Note does not exist yet
		if expectedRevision != 1 && expectedRevision != 0 {
			return nil, ErrRevisionConflict
		}
		rev := 2
		if expectedRevision == 0 {
			rev = 1
		}
		newID := uuid.NewString()
		insertQuery := `
			INSERT INTO meeting_notes (id, room_id, title, content, revision, created_by_identity, updated_by_identity, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $7)
			RETURNING id, room_id, title, content, revision, created_by_identity, updated_by_identity, created_at, updated_at
		`
		var created MeetingNote
		err = tx.QueryRow(ctx, insertQuery, newID, roomID, title, content, rev, callerIdentity, now).Scan(
			&created.ID, &created.RoomID, &created.Title, &created.Content, &created.Revision,
			&created.CreatedByIdentity, &created.UpdatedByIdentity, &created.CreatedAt, &created.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to insert note: %w", err)
		}
		if err = tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("failed to commit: %w", err)
		}
		return &created, nil
	}

	// Check optimistic concurrency revision
	if currentRevision != expectedRevision {
		return nil, ErrRevisionConflict
	}

	updateQuery := `
		UPDATE meeting_notes
		SET title = $1, content = $2, revision = revision + 1, updated_by_identity = $3, updated_at = $4
		WHERE room_id = $5 AND revision = $6
		RETURNING id, room_id, title, content, revision, created_by_identity, updated_by_identity, created_at, updated_at
	`
	var updated MeetingNote
	err = tx.QueryRow(ctx, updateQuery, title, content, callerIdentity, now, roomID, expectedRevision).Scan(
		&updated.ID, &updated.RoomID, &updated.Title, &updated.Content, &updated.Revision,
		&updated.CreatedByIdentity, &updated.UpdatedByIdentity, &updated.CreatedAt, &updated.UpdatedAt,
	)
	if err != nil {
		return nil, ErrRevisionConflict
	}

	if err = tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit: %w", err)
	}
	return &updated, nil
}

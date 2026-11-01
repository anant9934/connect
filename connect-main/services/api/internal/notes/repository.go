package notes

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/room"
)

type Repository interface {
	GetByRoomID(ctx context.Context, roomID, callerIdentity string) (*MeetingNote, error)
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

func (m *MemoryRepository) GetByRoomID(ctx context.Context, roomID, _ string) (*MeetingNote, error) {
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

// PgxRepository implements PostgreSQL persistence via pgxpool. Users act inside their
// own RLS context; guests have no session and use the narrow connect_auth functions.
type PgxRepository struct {
	pool *pgxpool.Pool
}

func NewPgxRepository(pool *pgxpool.Pool) *PgxRepository {
	return &PgxRepository{pool: pool}
}

const noteColumns = `id, room_id, title, content, revision, created_by_identity, updated_by_identity, created_at, updated_at`

func scanNote(row pgx.Row) (*MeetingNote, error) {
	var n MeetingNote
	err := row.Scan(
		&n.ID, &n.RoomID, &n.Title, &n.Content, &n.Revision,
		&n.CreatedByIdentity, &n.UpdatedByIdentity, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &n, nil
}

func defaultNote(roomID string) *MeetingNote {
	now := time.Now().UTC()
	return &MeetingNote{
		ID:                uuid.NewString(),
		RoomID:            roomID,
		Title:             "Meeting Notes",
		Revision:          1,
		CreatedByIdentity: "system",
		UpdatedByIdentity: "system",
		CreatedAt:         now,
		UpdatedAt:         now,
	}
}

// asUser runs fn in the session's RLS context after binding it to the caller's identity.
func (p *PgxRepository) asUser(ctx context.Context, callerIdentity string, fn func(pgx.Tx, string) error) error {
	tokenHash := database.SessionTokenHash(ctx)
	if tokenHash == "" {
		return ErrUnauthorized
	}
	return database.WithAuthContext(ctx, p.pool, tokenHash, nil, func(tx pgx.Tx, auth *database.AuthContext) error {
		if "user:"+auth.UserID != callerIdentity {
			return ErrUnauthorized
		}
		return fn(tx, auth.UserID)
	})
}

func mapNoteError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "CN409", "23505": // stale revision, or a concurrent first save
			return ErrRevisionConflict
		case "42501", "28000": // denied by RLS or an invalid session
			return ErrUnauthorized
		}
	}
	return err
}

func (p *PgxRepository) GetByRoomID(ctx context.Context, roomID, callerIdentity string) (*MeetingNote, error) {
	var note *MeetingNote
	var err error
	if strings.HasPrefix(callerIdentity, "user:") {
		err = p.asUser(ctx, callerIdentity, func(tx pgx.Tx, _ string) error {
			var qErr error
			note, qErr = scanNote(tx.QueryRow(ctx, `SELECT `+noteColumns+` FROM meeting_notes WHERE room_id = $1`, roomID))
			return qErr
		})
	} else {
		note, err = scanNote(p.pool.QueryRow(ctx, `SELECT `+noteColumns+` FROM connect_auth.guest_read_note($1, $2)`, roomID, callerIdentity))
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return defaultNote(roomID), nil
	}
	if err != nil {
		return nil, mapNoteError(err)
	}
	return note, nil
}

func (p *PgxRepository) UpsertNote(ctx context.Context, roomID, callerIdentity, title, content string, expectedRevision int) (*MeetingNote, error) {
	if !strings.HasPrefix(callerIdentity, "user:") {
		note, err := scanNote(p.pool.QueryRow(ctx, `SELECT `+noteColumns+` FROM connect_auth.guest_upsert_note($1, $2, $3, $4, $5)`,
			roomID, callerIdentity, title, content, expectedRevision))
		if err != nil {
			return nil, mapNoteError(err)
		}
		return note, nil
	}

	var note *MeetingNote
	err := p.asUser(ctx, callerIdentity, func(tx pgx.Tx, userID string) error {
		var currentRevision int
		err := tx.QueryRow(ctx, `SELECT revision FROM meeting_notes WHERE room_id = $1 FOR UPDATE`, roomID).Scan(&currentRevision)
		now := time.Now().UTC()

		if errors.Is(err, pgx.ErrNoRows) {
			if expectedRevision != 1 && expectedRevision != 0 {
				return ErrRevisionConflict
			}
			rev := 2
			if expectedRevision == 0 {
				rev = 1
			}
			note, err = scanNote(tx.QueryRow(ctx, `
				INSERT INTO meeting_notes (id, room_id, title, content, revision, created_by, created_by_identity, updated_by_identity, created_at, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $8)
				RETURNING `+noteColumns, uuid.NewString(), roomID, title, content, rev, userID, callerIdentity, now))
			return err
		}
		if err != nil {
			return err
		}

		// Check optimistic concurrency revision
		if currentRevision != expectedRevision {
			return ErrRevisionConflict
		}
		note, err = scanNote(tx.QueryRow(ctx, `
			UPDATE meeting_notes
			SET title = $1, content = $2, revision = revision + 1, updated_by_identity = $3, updated_at = $4
			WHERE room_id = $5 AND revision = $6
			RETURNING `+noteColumns, title, content, callerIdentity, now, roomID, expectedRevision))
		return err
	})
	if err != nil {
		if errors.Is(err, ErrRevisionConflict) || errors.Is(err, ErrUnauthorized) {
			return nil, err
		}
		if mapped := mapNoteError(err); !errors.Is(mapped, err) {
			return nil, mapped
		}
		return nil, fmt.Errorf("failed to save note: %w", err)
	}
	return note, nil
}

// PgxRoomValidator resolves room access through a narrow function, so it works for guests
// and does not depend on the rooms table being readable by the caller.
type PgxRoomValidator struct {
	pool *pgxpool.Pool
}

func NewPgxRoomValidator(pool *pgxpool.Pool) *PgxRoomValidator {
	return &PgxRoomValidator{pool: pool}
}

func (v *PgxRoomValidator) ValidateRoomAccess(ctx context.Context, publicCode, callerIdentity string) (string, bool, error) {
	if callerIdentity == "" {
		return "", false, ErrUnauthorized
	}
	var roomID string
	var isHost bool
	err := v.pool.QueryRow(ctx, `SELECT room_id::text, is_host FROM connect_auth.resolve_room_access($1, $2)`,
		room.NormalizeCode(publicCode), callerIdentity).Scan(&roomID, &isHost)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, ErrUnauthorized
	}
	if err != nil {
		return "", false, err
	}
	return roomID, isHost, nil
}

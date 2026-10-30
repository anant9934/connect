package room

import (
	"context"
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Room represents meeting session record in the database.
type Room struct {
	ID                 string
	PublicCode         string
	HostUserID         string
	Status             string // 'created', 'active', 'ended'
	IsLocked           bool
	WaitingRoomEnabled bool
	MaxParticipants    int
	CreatedAt          time.Time
	StartedAt          time.Time
	EndedAt            *time.Time
	LockedAt           *time.Time
}

// Participant represents a connected user or guest in a room.
type Participant struct {
	ID          string
	RoomID      string
	UserID      *string
	Identity    string // 'user:<uuid>' or 'guest:<uuid>'
	DisplayName string
	Role        string // 'host' or 'participant'
	IsGuest     bool
	JoinedAt    time.Time
	LeftAt      *time.Time
	IsRemoved   bool
}

// AdmissionRequest represents a guest request to be admitted to a waiting-room-enabled meeting.
type AdmissionRequest struct {
	ID          string     `json:"id"`
	RoomID      string     `json:"room_id"`
	Identity    string     `json:"identity"`
	DisplayName string     `json:"display_name"`
	Status      string     `json:"status"` // "pending", "admitted", "denied", "expired"
	RequestedAt time.Time  `json:"requested_at"`
	DecidedAt   *time.Time `json:"decided_at,omitempty"`
	GuestToken  string     `json:"guest_token,omitempty"`
}

// MeetingHistoryItem represents a user-scoped historical meeting record.
type MeetingHistoryItem struct {
	ID               string     `json:"id"`
	PublicCode       string     `json:"public_code"`
	HostUserID       string     `json:"host_user_id"`
	Status           string     `json:"status"`
	CreatedAt        time.Time  `json:"created_at"`
	EndedAt          *time.Time `json:"ended_at,omitempty"`
	DurationSeconds  int64      `json:"duration_seconds"`
	ParticipantCount int        `json:"participant_count"`
	IsLocked         bool       `json:"is_locked"`
}

// Repository defines data access boundaries for rooms and participants.
type Repository interface {
	CreateRoom(ctx context.Context, r *Room) error
	GetRoomByCode(ctx context.Context, code string) (*Room, error)
	GetRoomByID(ctx context.Context, id string) (*Room, error)
	SetRoomLocked(ctx context.Context, roomID string, locked bool, lockedAt *time.Time) error
	EndRoom(ctx context.Context, roomID string, endedAt time.Time) error
	UpsertParticipant(ctx context.Context, p *Participant) error
	GetParticipant(ctx context.Context, roomID, identity string) (*Participant, error)
	GetActiveParticipants(ctx context.Context, roomID string) ([]*Participant, error)
	GetActiveParticipantCount(ctx context.Context, roomID string) (int, error)
	MarkParticipantLeft(ctx context.Context, roomID, identity string, leftAt time.Time) error
	UpdateParticipantRole(ctx context.Context, roomID, identity, role string) error
	UpdateParticipantRoleCAS(ctx context.Context, roomID, identity, expectedRole, newRole string) error
	AcquireParticipantLock(ctx context.Context, roomID, identity, ownerID string, ttl time.Duration) (func(), error)
	CreateAdmissionRequest(ctx context.Context, req *AdmissionRequest) error
	GetAdmissionRequest(ctx context.Context, roomID, identity string) (*AdmissionRequest, error)
	GetPendingAdmissionRequests(ctx context.Context, roomID string) ([]*AdmissionRequest, error)
	UpdateAdmissionRequestStatus(ctx context.Context, roomID, requestID, status string, decidedAt time.Time) error
	SetParticipantRemoved(ctx context.Context, roomID, identity string) error
	IsParticipantRemoved(ctx context.Context, roomID, identity string) (bool, error)
	GetMeetingHistory(ctx context.Context, userID string, limit, offset int) ([]*MeetingHistoryItem, int, error)
}

// PgxRepository implements room.Repository via PostgreSQL pool.
type PgxRepository struct {
	pool *pgxpool.Pool
}

// NewPgxRepository constructs a PostgreSQL room repository.
func NewPgxRepository(pool *pgxpool.Pool) *PgxRepository {
	return &PgxRepository{pool: pool}
}

func (r *PgxRepository) CreateRoom(ctx context.Context, rm *Room) error {
	if rm.ID == "" {
		rm.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	rm.CreatedAt = now
	rm.StartedAt = now
	if rm.Status == "" {
		rm.Status = "active"
	}
	if rm.MaxParticipants <= 0 {
		rm.MaxParticipants = 50
	}

	query := `
		INSERT INTO rooms (id, public_code, host_user_id, status, is_locked, max_participants, created_at, started_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	_, err := r.pool.Exec(ctx, query, rm.ID, rm.PublicCode, rm.HostUserID, rm.Status, rm.IsLocked, rm.MaxParticipants, rm.CreatedAt, rm.StartedAt)
	return err
}

func (r *PgxRepository) GetRoomByCode(ctx context.Context, code string) (*Room, error) {
	query := `
		SELECT id, public_code, host_user_id, status, is_locked, max_participants, created_at, started_at, ended_at, locked_at
		FROM rooms
		WHERE public_code = $1
	`
	row := r.pool.QueryRow(ctx, query, code)
	var rm Room
	err := row.Scan(&rm.ID, &rm.PublicCode, &rm.HostUserID, &rm.Status, &rm.IsLocked, &rm.MaxParticipants, &rm.CreatedAt, &rm.StartedAt, &rm.EndedAt, &rm.LockedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoomNotFound
		}
		return nil, err
	}
	return &rm, nil
}

func (r *PgxRepository) GetRoomByID(ctx context.Context, id string) (*Room, error) {
	query := `
		SELECT id, public_code, host_user_id, status, is_locked, max_participants, created_at, started_at, ended_at, locked_at
		FROM rooms
		WHERE id = $1
	`
	row := r.pool.QueryRow(ctx, query, id)
	var rm Room
	err := row.Scan(&rm.ID, &rm.PublicCode, &rm.HostUserID, &rm.Status, &rm.IsLocked, &rm.MaxParticipants, &rm.CreatedAt, &rm.StartedAt, &rm.EndedAt, &rm.LockedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRoomNotFound
		}
		return nil, err
	}
	return &rm, nil
}

func (r *PgxRepository) SetRoomLocked(ctx context.Context, roomID string, locked bool, lockedAt *time.Time) error {
	query := `
		UPDATE rooms
		SET is_locked = $1, locked_at = $2
		WHERE id = $3
	`
	_, err := r.pool.Exec(ctx, query, locked, lockedAt, roomID)
	return err
}

func (r *PgxRepository) EndRoom(ctx context.Context, roomID string, endedAt time.Time) error {
	query := `
		UPDATE rooms
		SET status = 'ended', ended_at = $1
		WHERE id = $2
	`
	_, err := r.pool.Exec(ctx, query, endedAt, roomID)
	return err
}

func (r *PgxRepository) UpsertParticipant(ctx context.Context, p *Participant) error {
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	p.JoinedAt = now

	query := `
		INSERT INTO room_participants (id, room_id, user_id, identity, display_name, role, is_guest, joined_at, left_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
	`
	_, err := r.pool.Exec(ctx, query, p.ID, p.RoomID, p.UserID, p.Identity, p.DisplayName, p.Role, p.IsGuest, p.JoinedAt)
	return err
}

func (r *PgxRepository) GetParticipant(ctx context.Context, roomID, identity string) (*Participant, error) {
	query := `
		SELECT id, room_id, user_id, identity, display_name, role, is_guest, joined_at, left_at
		FROM room_participants
		WHERE room_id = $1 AND identity = $2 AND left_at IS NULL
		ORDER BY joined_at DESC
		LIMIT 1
	`
	row := r.pool.QueryRow(ctx, query, roomID, identity)
	var p Participant
	err := row.Scan(&p.ID, &p.RoomID, &p.UserID, &p.Identity, &p.DisplayName, &p.Role, &p.IsGuest, &p.JoinedAt, &p.LeftAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (r *PgxRepository) GetActiveParticipants(ctx context.Context, roomID string) ([]*Participant, error) {
	query := `
		SELECT id, room_id, user_id, identity, display_name, role, is_guest, joined_at, left_at
		FROM room_participants
		WHERE room_id = $1 AND left_at IS NULL
		ORDER BY joined_at ASC
	`
	rows, err := r.pool.Query(ctx, query, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*Participant
	for rows.Next() {
		var p Participant
		if err := rows.Scan(&p.ID, &p.RoomID, &p.UserID, &p.Identity, &p.DisplayName, &p.Role, &p.IsGuest, &p.JoinedAt, &p.LeftAt); err != nil {
			return nil, err
		}
		result = append(result, &p)
	}
	return result, rows.Err()
}

func (r *PgxRepository) GetActiveParticipantCount(ctx context.Context, roomID string) (int, error) {
	query := `
		SELECT COUNT(*)
		FROM room_participants
		WHERE room_id = $1 AND left_at IS NULL
	`
	var count int
	err := r.pool.QueryRow(ctx, query, roomID).Scan(&count)
	return count, err
}

func (r *PgxRepository) MarkParticipantLeft(ctx context.Context, roomID, identity string, leftAt time.Time) error {
	query := `
		UPDATE room_participants
		SET left_at = $1
		WHERE room_id = $2 AND identity = $3 AND left_at IS NULL
	`
	_, err := r.pool.Exec(ctx, query, leftAt, roomID, identity)
	return err
}

func (r *PgxRepository) UpdateParticipantRole(ctx context.Context, roomID, identity, role string) error {
	query := `
		UPDATE room_participants
		SET role = $1
		WHERE room_id = $2 AND identity = $3 AND left_at IS NULL
	`
	_, err := r.pool.Exec(ctx, query, role, roomID, identity)
	return err
}

func (r *PgxRepository) UpdateParticipantRoleCAS(ctx context.Context, roomID, identity, expectedRole, newRole string) error {
	query := `
		UPDATE room_participants
		SET role = $1
		WHERE room_id = $2 AND identity = $3 AND left_at IS NULL AND role = $4
	`
	cmdTag, err := r.pool.Exec(ctx, query, newRole, roomID, identity, expectedRole)
	if err != nil {
		return err
	}
	if cmdTag.RowsAffected() == 0 {
		return ErrStaleRoleUpdate
	}
	return nil
}

func (r *PgxRepository) AcquireParticipantLock(ctx context.Context, roomID, identity, ownerID string, ttl time.Duration) (func(), error) {
	lockKey := roomID + ":" + identity
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)

	// Ensure table exists idempotently
	initQuery := `
		CREATE TABLE IF NOT EXISTS participant_locks (
			lock_key VARCHAR(128) PRIMARY KEY,
			owner_id VARCHAR(64) NOT NULL,
			acquired_at TIMESTAMPTZ NOT NULL,
			expires_at TIMESTAMPTZ NOT NULL
		);
	`
	_, _ = r.pool.Exec(ctx, initQuery)

	query := `
		INSERT INTO participant_locks (lock_key, owner_id, acquired_at, expires_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (lock_key) DO UPDATE
		SET owner_id = EXCLUDED.owner_id,
		    acquired_at = EXCLUDED.acquired_at,
		    expires_at = EXCLUDED.expires_at
		WHERE participant_locks.expires_at < $3
		RETURNING lock_key;
	`

	deadline := time.Now().Add(4 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}

	for {
		var returnedKey string
		err := r.pool.QueryRow(ctx, query, lockKey, ownerID, now, expiresAt).Scan(&returnedKey)
		if err == nil && returnedKey != "" {
			released := false
			return func() {
				if released {
					return
				}
				released = true
				relCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				_, _ = r.pool.Exec(relCtx, "DELETE FROM participant_locks WHERE lock_key = $1 AND owner_id = $2", lockKey, ownerID)
			}, nil
		}

		if time.Now().After(deadline) {
			return nil, ErrLockBusy
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(50 * time.Millisecond):
			now = time.Now().UTC()
			expiresAt = now.Add(ttl)
		}
	}
}

func (r *PgxRepository) CreateAdmissionRequest(ctx context.Context, req *AdmissionRequest) error {
	if req.ID == "" {
		req.ID = uuid.NewString()
	}
	if req.RequestedAt.IsZero() {
		req.RequestedAt = time.Now().UTC()
	}
	if req.Status == "" {
		req.Status = "pending"
	}
	query := `
		INSERT INTO room_admissions (id, room_id, identity, display_name, status, requested_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`
	_, err := r.pool.Exec(ctx, query, req.ID, req.RoomID, req.Identity, req.DisplayName, req.Status, req.RequestedAt)
	return err
}

func (r *PgxRepository) GetAdmissionRequest(ctx context.Context, roomID, identity string) (*AdmissionRequest, error) {
	query := `
		SELECT id, room_id, identity, display_name, status, requested_at, decided_at
		FROM room_admissions
		WHERE room_id = $1 AND identity = $2
		ORDER BY requested_at DESC
		LIMIT 1
	`
	row := r.pool.QueryRow(ctx, query, roomID, identity)
	var ar AdmissionRequest
	err := row.Scan(&ar.ID, &ar.RoomID, &ar.Identity, &ar.DisplayName, &ar.Status, &ar.RequestedAt, &ar.DecidedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &ar, nil
}

func (r *PgxRepository) GetPendingAdmissionRequests(ctx context.Context, roomID string) ([]*AdmissionRequest, error) {
	query := `
		SELECT id, room_id, identity, display_name, status, requested_at, decided_at
		FROM room_admissions
		WHERE room_id = $1 AND status = 'pending'
		ORDER BY requested_at ASC
	`
	rows, err := r.pool.Query(ctx, query, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []*AdmissionRequest
	for rows.Next() {
		var ar AdmissionRequest
		if err := rows.Scan(&ar.ID, &ar.RoomID, &ar.Identity, &ar.DisplayName, &ar.Status, &ar.RequestedAt, &ar.DecidedAt); err != nil {
			return nil, err
		}
		result = append(result, &ar)
	}
	return result, rows.Err()
}

func (r *PgxRepository) UpdateAdmissionRequestStatus(ctx context.Context, roomID, requestID, status string, decidedAt time.Time) error {
	query := `
		UPDATE room_admissions
		SET status = $1, decided_at = $2
		WHERE id = $3 AND room_id = $4
	`
	_, err := r.pool.Exec(ctx, query, status, decidedAt, requestID, roomID)
	return err
}

func (r *PgxRepository) SetParticipantRemoved(ctx context.Context, roomID, identity string) error {
	query := `
		UPDATE room_participants
		SET is_removed = true, left_at = $1
		WHERE room_id = $2 AND identity = $3
	`
	_, err := r.pool.Exec(ctx, query, time.Now().UTC(), roomID, identity)
	return err
}

func (r *PgxRepository) IsParticipantRemoved(ctx context.Context, roomID, identity string) (bool, error) {
	query := `
		SELECT is_removed
		FROM room_participants
		WHERE room_id = $1 AND identity = $2
		ORDER BY joined_at DESC
		LIMIT 1
	`
	var isRemoved bool
	err := r.pool.QueryRow(ctx, query, roomID, identity).Scan(&isRemoved)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return isRemoved, nil
}

func (r *PgxRepository) GetMeetingHistory(ctx context.Context, userID string, limit, offset int) ([]*MeetingHistoryItem, int, error) {
	countQuery := `SELECT COUNT(*) FROM rooms WHERE host_user_id = $1`
	var total int
	if err := r.pool.QueryRow(ctx, countQuery, userID).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := `
		SELECT r.id, r.public_code, r.host_user_id, r.status, r.created_at, r.ended_at, r.is_locked,
		       COALESCE(COUNT(p.id), 0) AS participant_count
		FROM rooms r
		LEFT JOIN room_participants p ON r.id = p.room_id
		WHERE r.host_user_id = $1
		GROUP BY r.id, r.public_code, r.host_user_id, r.status, r.created_at, r.ended_at, r.is_locked
		ORDER BY r.created_at DESC
		LIMIT $2 OFFSET $3
	`
	rows, err := r.pool.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []*MeetingHistoryItem
	for rows.Next() {
		var item MeetingHistoryItem
		if err := rows.Scan(&item.ID, &item.PublicCode, &item.HostUserID, &item.Status, &item.CreatedAt, &item.EndedAt, &item.IsLocked, &item.ParticipantCount); err != nil {
			return nil, 0, err
		}
		if item.EndedAt != nil {
			item.DurationSeconds = int64(item.EndedAt.Sub(item.CreatedAt).Seconds())
		}
		items = append(items, &item)
	}
	return items, total, rows.Err()
}

type memParticipantLock struct {
	ownerID   string
	expiresAt time.Time
}

// MemoryRepository provides concurrent safe in-memory storage for rooms.
type MemoryRepository struct {
	mu                sync.RWMutex
	lockMu            sync.Mutex
	partLocks         map[string]memParticipantLock
	roomsByID         map[string]*Room
	roomsByCode       map[string]*Room
	participants      map[string][]*Participant      // key: roomID
	admissions        map[string][]*AdmissionRequest // key: roomID
	removedIdentities map[string]map[string]bool     // key: roomID -> identity -> bool
}

// NewMemoryRepository constructs an in-memory repository instance.
func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		partLocks:         make(map[string]memParticipantLock),
		roomsByID:         make(map[string]*Room),
		roomsByCode:       make(map[string]*Room),
		participants:      make(map[string][]*Participant),
		admissions:        make(map[string][]*AdmissionRequest),
		removedIdentities: make(map[string]map[string]bool),
	}
}

func (m *MemoryRepository) CreateRoom(_ context.Context, r *Room) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.roomsByCode[r.PublicCode]; exists {
		return errors.New("room code already exists")
	}
	if r.ID == "" {
		r.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	r.CreatedAt = now
	r.StartedAt = now
	if r.Status == "" {
		r.Status = "active"
	}
	if r.MaxParticipants <= 0 {
		r.MaxParticipants = 50
	}

	copied := *r
	m.roomsByID[r.ID] = &copied
	m.roomsByCode[r.PublicCode] = &copied
	return nil
}

func (m *MemoryRepository) GetRoomByCode(_ context.Context, code string) (*Room, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	rm, exists := m.roomsByCode[code]
	if !exists {
		return nil, ErrRoomNotFound
	}
	copied := *rm
	return &copied, nil
}

func (m *MemoryRepository) GetRoomByID(_ context.Context, id string) (*Room, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	rm, exists := m.roomsByID[id]
	if !exists {
		return nil, ErrRoomNotFound
	}
	copied := *rm
	return &copied, nil
}

func (m *MemoryRepository) SetRoomLocked(_ context.Context, roomID string, locked bool, lockedAt *time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	rm, exists := m.roomsByID[roomID]
	if !exists {
		return ErrRoomNotFound
	}
	rm.IsLocked = locked
	rm.LockedAt = lockedAt
	if rmByCode, ok := m.roomsByCode[rm.PublicCode]; ok {
		rmByCode.IsLocked = locked
		rmByCode.LockedAt = lockedAt
	}
	return nil
}

func (m *MemoryRepository) EndRoom(_ context.Context, roomID string, endedAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	rm, exists := m.roomsByID[roomID]
	if !exists {
		return ErrRoomNotFound
	}
	rm.Status = "ended"
	rm.EndedAt = &endedAt
	if rmByCode, ok := m.roomsByCode[rm.PublicCode]; ok {
		rmByCode.Status = "ended"
		rmByCode.EndedAt = &endedAt
	}
	return nil
}

func (m *MemoryRepository) UpsertParticipant(_ context.Context, p *Participant) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	p.JoinedAt = time.Now().UTC()
	copied := *p

	list := m.participants[p.RoomID]
	m.participants[p.RoomID] = append(list, &copied)
	return nil
}

func (m *MemoryRepository) GetParticipant(_ context.Context, roomID, identity string) (*Participant, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	list := m.participants[roomID]
	for i := len(list) - 1; i >= 0; i-- {
		if list[i].Identity == identity && list[i].LeftAt == nil {
			copied := *list[i]
			return &copied, nil
		}
	}
	return nil, nil
}

func (m *MemoryRepository) GetActiveParticipants(_ context.Context, roomID string) ([]*Participant, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*Participant
	for _, p := range m.participants[roomID] {
		if p.LeftAt == nil {
			copied := *p
			result = append(result, &copied)
		}
	}
	return result, nil
}

func (m *MemoryRepository) GetActiveParticipantCount(_ context.Context, roomID string) (int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	count := 0
	for _, p := range m.participants[roomID] {
		if p.LeftAt == nil {
			count++
		}
	}
	return count, nil
}

func (m *MemoryRepository) MarkParticipantLeft(_ context.Context, roomID, identity string, leftAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, p := range m.participants[roomID] {
		if p.Identity == identity && p.LeftAt == nil {
			p.LeftAt = &leftAt
		}
	}
	return nil
}

func (m *MemoryRepository) UpdateParticipantRole(_ context.Context, roomID, identity, role string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, p := range m.participants[roomID] {
		if p.Identity == identity && p.LeftAt == nil {
			p.Role = role
			return nil
		}
	}
	return nil
}

func (m *MemoryRepository) UpdateParticipantRoleCAS(_ context.Context, roomID, identity, expectedRole, newRole string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, p := range m.participants[roomID] {
		if p.Identity == identity && p.LeftAt == nil {
			if p.Role != expectedRole {
				return ErrStaleRoleUpdate
			}
			p.Role = newRole
			return nil
		}
	}
	return ErrParticipantNotFoundInRoom
}

func (m *MemoryRepository) AcquireParticipantLock(ctx context.Context, roomID, identity, ownerID string, ttl time.Duration) (func(), error) {
	lockKey := roomID + ":" + identity
	deadline := time.Now().Add(4 * time.Second)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}

	for {
		now := time.Now().UTC()
		m.lockMu.Lock()
		cur, exists := m.partLocks[lockKey]
		if !exists || now.After(cur.expiresAt) {
			m.partLocks[lockKey] = memParticipantLock{
				ownerID:   ownerID,
				expiresAt: now.Add(ttl),
			}
			m.lockMu.Unlock()

			released := false
			return func() {
				m.lockMu.Lock()
				defer m.lockMu.Unlock()
				if !released {
					released = true
					if l, ok := m.partLocks[lockKey]; ok && l.ownerID == ownerID {
						delete(m.partLocks, lockKey)
					}
				}
			}, nil
		}
		m.lockMu.Unlock()

		if time.Now().After(deadline) {
			return nil, ErrLockBusy
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func (m *MemoryRepository) CreateAdmissionRequest(_ context.Context, req *AdmissionRequest) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if req.ID == "" {
		req.ID = uuid.NewString()
	}
	if req.RequestedAt.IsZero() {
		req.RequestedAt = time.Now().UTC()
	}
	if req.Status == "" {
		req.Status = "pending"
	}
	copied := *req
	m.admissions[req.RoomID] = append(m.admissions[req.RoomID], &copied)
	return nil
}

func (m *MemoryRepository) GetAdmissionRequest(_ context.Context, roomID, identity string) (*AdmissionRequest, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	list := m.admissions[roomID]
	for i := len(list) - 1; i >= 0; i-- {
		if list[i].Identity == identity {
			copied := *list[i]
			return &copied, nil
		}
	}
	return nil, nil
}

func (m *MemoryRepository) GetPendingAdmissionRequests(_ context.Context, roomID string) ([]*AdmissionRequest, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var result []*AdmissionRequest
	for _, req := range m.admissions[roomID] {
		if req.Status == "pending" {
			copied := *req
			result = append(result, &copied)
		}
	}
	return result, nil
}

func (m *MemoryRepository) UpdateAdmissionRequestStatus(_ context.Context, roomID, requestID, status string, decidedAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, req := range m.admissions[roomID] {
		if req.ID == requestID {
			req.Status = status
			req.DecidedAt = &decidedAt
			return nil
		}
	}
	return nil
}

func (m *MemoryRepository) SetParticipantRemoved(_ context.Context, roomID, identity string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.removedIdentities[roomID] == nil {
		m.removedIdentities[roomID] = make(map[string]bool)
	}
	m.removedIdentities[roomID][identity] = true

	now := time.Now().UTC()
	for _, p := range m.participants[roomID] {
		if p.Identity == identity && p.LeftAt == nil {
			p.LeftAt = &now
			p.IsRemoved = true
		}
	}
	return nil
}

func (m *MemoryRepository) IsParticipantRemoved(_ context.Context, roomID, identity string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.removedIdentities[roomID] != nil && m.removedIdentities[roomID][identity] {
		return true, nil
	}
	return false, nil
}

func (m *MemoryRepository) GetMeetingHistory(_ context.Context, userID string, limit, offset int) ([]*MeetingHistoryItem, int, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var userRooms []*Room
	for _, rm := range m.roomsByID {
		if rm.HostUserID == userID {
			userRooms = append(userRooms, rm)
		}
	}

	sort.Slice(userRooms, func(i, j int) bool {
		return userRooms[i].CreatedAt.After(userRooms[j].CreatedAt)
	})

	total := len(userRooms)
	if offset >= total {
		return []*MeetingHistoryItem{}, total, nil
	}

	end := offset + limit
	if end > total {
		end = total
	}

	var items []*MeetingHistoryItem
	for _, rm := range userRooms[offset:end] {
		partCount := len(m.participants[rm.ID])
		item := &MeetingHistoryItem{
			ID:               rm.ID,
			PublicCode:       rm.PublicCode,
			HostUserID:       rm.HostUserID,
			Status:           rm.Status,
			CreatedAt:        rm.CreatedAt,
			EndedAt:          rm.EndedAt,
			IsLocked:         rm.IsLocked,
			ParticipantCount: partCount,
		}
		if rm.EndedAt != nil {
			item.DurationSeconds = int64(rm.EndedAt.Sub(rm.CreatedAt).Seconds())
		}
		items = append(items, item)
	}
	return items, total, nil
}

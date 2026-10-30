package auth

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrUserNotFound       = errors.New("user not found")
	ErrEmailAlreadyExists = errors.New("email already exists")
	ErrSessionNotFound    = errors.New("session not found")
)

// User represents an internal authenticated account.
type User struct {
	ID              string
	EmailNormalized string
	DisplayName     string
	PasswordHash    string
	Status          string
	AvatarID        string
	AvatarURL       string
	GoogleID        *string
	AuthProvider    string
	Preferences     map[string]any
	EmailVerified   bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Session represents a stored server session.
type Session struct {
	ID         string
	UserID     string
	TokenHash  string
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
	RevokedAt  *time.Time
}

// Repository defines data access operations for authentication, sessions, and profile.
type Repository interface {
	CreateUser(ctx context.Context, user *User) error
	GetUserByEmail(ctx context.Context, emailNormalized string) (*User, error)
	GetUserByID(ctx context.Context, id string) (*User, error)
	GetUserByGoogleID(ctx context.Context, googleID string) (*User, error)
	UpdateProfile(ctx context.Context, userID, displayName, avatarID, avatarURL string) (*User, error)
	UpdatePassword(ctx context.Context, userID, newPasswordHash string) error
	LinkGoogleAccount(ctx context.Context, userID, googleID string) error
	UpdatePreferences(ctx context.Context, userID string, prefs map[string]any) error

	CreateSession(ctx context.Context, session *Session) error
	GetSessionByTokenHash(ctx context.Context, tokenHash string) (*Session, error)
	UpdateSessionLastSeen(ctx context.Context, sessionID string, now time.Time) error
	RevokeSession(ctx context.Context, sessionID string) error
	RevokeAllUserSessions(ctx context.Context, userID string) error
}

// PgxRepository implements Repository using PostgreSQL connection pool.
type PgxRepository struct {
	pool *pgxpool.Pool
}

// NewPgxRepository constructs a PostgreSQL-backed auth repository.
func NewPgxRepository(pool *pgxpool.Pool) *PgxRepository {
	return &PgxRepository{pool: pool}
}

func (r *PgxRepository) CreateUser(ctx context.Context, u *User) error {
	if u.ID == "" {
		u.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	u.CreatedAt = now
	u.UpdatedAt = now
	if u.Status == "" {
		u.Status = "active"
	}
	if u.AuthProvider == "" {
		u.AuthProvider = "password"
	}
	if u.Preferences == nil {
		u.Preferences = make(map[string]any)
	}

	prefBytes, err := json.Marshal(u.Preferences)
	if err != nil {
		prefBytes = []byte("{}")
	}

	query := `
		INSERT INTO users (id, email_normalized, display_name, password_hash, status, avatar_id, avatar_url, google_id, auth_provider, preferences, email_verified, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`
	_, err = r.pool.Exec(ctx, query, u.ID, u.EmailNormalized, u.DisplayName, u.PasswordHash, u.Status, u.AvatarID, u.AvatarURL, u.GoogleID, u.AuthProvider, prefBytes, u.EmailVerified, u.CreatedAt, u.UpdatedAt)
	return err
}

func (r *PgxRepository) GetUserByEmail(ctx context.Context, emailNormalized string) (*User, error) {
	query := `
		SELECT id, email_normalized, display_name, COALESCE(password_hash, ''), status,
		       COALESCE(avatar_id, ''), COALESCE(avatar_url, ''), google_id,
		       COALESCE(auth_provider, 'password'), COALESCE(preferences, '{}'::jsonb),
		       COALESCE(email_verified, false), created_at, updated_at
		FROM users
		WHERE email_normalized = $1
	`
	row := r.pool.QueryRow(ctx, query, emailNormalized)
	var u User
	var prefBytes []byte
	err := row.Scan(&u.ID, &u.EmailNormalized, &u.DisplayName, &u.PasswordHash, &u.Status,
		&u.AvatarID, &u.AvatarURL, &u.GoogleID, &u.AuthProvider, &prefBytes,
		&u.EmailVerified, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	u.Preferences = make(map[string]any)
	if len(prefBytes) > 0 {
		_ = json.Unmarshal(prefBytes, &u.Preferences)
	}
	return &u, nil
}

func (r *PgxRepository) GetUserByID(ctx context.Context, id string) (*User, error) {
	query := `
		SELECT id, email_normalized, display_name, COALESCE(password_hash, ''), status,
		       COALESCE(avatar_id, ''), COALESCE(avatar_url, ''), google_id,
		       COALESCE(auth_provider, 'password'), COALESCE(preferences, '{}'::jsonb),
		       COALESCE(email_verified, false), created_at, updated_at
		FROM users
		WHERE id = $1
	`
	row := r.pool.QueryRow(ctx, query, id)
	var u User
	var prefBytes []byte
	err := row.Scan(&u.ID, &u.EmailNormalized, &u.DisplayName, &u.PasswordHash, &u.Status,
		&u.AvatarID, &u.AvatarURL, &u.GoogleID, &u.AuthProvider, &prefBytes,
		&u.EmailVerified, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	u.Preferences = make(map[string]any)
	if len(prefBytes) > 0 {
		_ = json.Unmarshal(prefBytes, &u.Preferences)
	}
	return &u, nil
}

func (r *PgxRepository) GetUserByGoogleID(ctx context.Context, googleID string) (*User, error) {
	query := `
		SELECT id, email_normalized, display_name, COALESCE(password_hash, ''), status,
		       COALESCE(avatar_id, ''), COALESCE(avatar_url, ''), google_id,
		       COALESCE(auth_provider, 'password'), COALESCE(preferences, '{}'::jsonb),
		       COALESCE(email_verified, false), created_at, updated_at
		FROM users
		WHERE google_id = $1
	`
	row := r.pool.QueryRow(ctx, query, googleID)
	var u User
	var prefBytes []byte
	err := row.Scan(&u.ID, &u.EmailNormalized, &u.DisplayName, &u.PasswordHash, &u.Status,
		&u.AvatarID, &u.AvatarURL, &u.GoogleID, &u.AuthProvider, &prefBytes,
		&u.EmailVerified, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	u.Preferences = make(map[string]any)
	if len(prefBytes) > 0 {
		_ = json.Unmarshal(prefBytes, &u.Preferences)
	}
	return &u, nil
}

func (r *PgxRepository) UpdateProfile(ctx context.Context, userID, displayName, avatarID, avatarURL string) (*User, error) {
	now := time.Now().UTC()
	query := `
		UPDATE users
		SET display_name = $1, avatar_id = $2, avatar_url = $3, updated_at = $4
		WHERE id = $5
		RETURNING id, email_normalized, display_name, COALESCE(password_hash, ''), status,
		          COALESCE(avatar_id, ''), COALESCE(avatar_url, ''), google_id,
		          COALESCE(auth_provider, 'password'), COALESCE(preferences, '{}'::jsonb),
		          COALESCE(email_verified, false), created_at, updated_at
	`
	row := r.pool.QueryRow(ctx, query, displayName, avatarID, avatarURL, now, userID)
	var u User
	var prefBytes []byte
	err := row.Scan(&u.ID, &u.EmailNormalized, &u.DisplayName, &u.PasswordHash, &u.Status,
		&u.AvatarID, &u.AvatarURL, &u.GoogleID, &u.AuthProvider, &prefBytes,
		&u.EmailVerified, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	u.Preferences = make(map[string]any)
	if len(prefBytes) > 0 {
		_ = json.Unmarshal(prefBytes, &u.Preferences)
	}
	return &u, nil
}

func (r *PgxRepository) UpdatePassword(ctx context.Context, userID, newPasswordHash string) error {
	now := time.Now().UTC()
	query := `
		UPDATE users
		SET password_hash = $1, updated_at = $2
		WHERE id = $3
	`
	tag, err := r.pool.Exec(ctx, query, newPasswordHash, now, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (r *PgxRepository) LinkGoogleAccount(ctx context.Context, userID, googleID string) error {
	now := time.Now().UTC()
	query := `
		UPDATE users
		SET google_id = $1, updated_at = $2
		WHERE id = $3
	`
	tag, err := r.pool.Exec(ctx, query, googleID, now, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (r *PgxRepository) UpdatePreferences(ctx context.Context, userID string, prefs map[string]any) error {
	now := time.Now().UTC()
	prefBytes, err := json.Marshal(prefs)
	if err != nil {
		return err
	}
	query := `
		UPDATE users
		SET preferences = $1, updated_at = $2
		WHERE id = $3
	`
	tag, err := r.pool.Exec(ctx, query, prefBytes, now, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrUserNotFound
	}
	return nil
}

func (r *PgxRepository) CreateSession(ctx context.Context, s *Session) error {
	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	query := `
		INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err := r.pool.Exec(ctx, query, s.ID, s.UserID, s.TokenHash, s.CreatedAt, s.LastSeenAt, s.ExpiresAt, s.RevokedAt)
	return err
}

func (r *PgxRepository) GetSessionByTokenHash(ctx context.Context, tokenHash string) (*Session, error) {
	query := `
		SELECT id, user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at
		FROM sessions
		WHERE token_hash = $1
	`
	row := r.pool.QueryRow(ctx, query, tokenHash)
	var s Session
	err := row.Scan(&s.ID, &s.UserID, &s.TokenHash, &s.CreatedAt, &s.LastSeenAt, &s.ExpiresAt, &s.RevokedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, err
	}
	return &s, nil
}

func (r *PgxRepository) UpdateSessionLastSeen(ctx context.Context, sessionID string, now time.Time) error {
	query := `
		UPDATE sessions
		SET last_seen_at = $1
		WHERE id = $2 AND revoked_at IS NULL
	`
	_, err := r.pool.Exec(ctx, query, now, sessionID)
	return err
}

func (r *PgxRepository) RevokeSession(ctx context.Context, sessionID string) error {
	now := time.Now().UTC()
	query := `
		UPDATE sessions
		SET revoked_at = $1
		WHERE id = $2
	`
	_, err := r.pool.Exec(ctx, query, now, sessionID)
	return err
}

func (r *PgxRepository) RevokeAllUserSessions(ctx context.Context, userID string) error {
	now := time.Now().UTC()
	query := `
		UPDATE sessions
		SET revoked_at = $1
		WHERE user_id = $2 AND revoked_at IS NULL
	`
	_, err := r.pool.Exec(ctx, query, now, userID)
	return err
}

// MemoryRepository provides a concurrent-safe in-memory store for tests and offline development.
type MemoryRepository struct {
	mu              sync.RWMutex
	usersByID       map[string]*User
	usersByEmail    map[string]*User
	usersByGoogleID map[string]*User
	sessions        map[string]*Session // key: tokenHash
}

// NewMemoryRepository constructs an in-memory repository instance.
func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		usersByID:       make(map[string]*User),
		usersByEmail:    make(map[string]*User),
		usersByGoogleID: make(map[string]*User),
		sessions:        make(map[string]*Session),
	}
}

func (m *MemoryRepository) CreateUser(_ context.Context, u *User) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.usersByEmail[u.EmailNormalized]; exists {
		return ErrEmailAlreadyExists
	}
	if u.ID == "" {
		u.ID = uuid.NewString()
	}
	now := time.Now().UTC()
	u.CreatedAt = now
	u.UpdatedAt = now
	if u.Status == "" {
		u.Status = "active"
	}
	if u.AuthProvider == "" {
		u.AuthProvider = "password"
	}
	if u.Preferences == nil {
		u.Preferences = make(map[string]any)
	}

	copied := *u
	m.usersByID[u.ID] = &copied
	m.usersByEmail[u.EmailNormalized] = &copied
	if u.GoogleID != nil && *u.GoogleID != "" {
		m.usersByGoogleID[*u.GoogleID] = &copied
	}
	return nil
}

func (m *MemoryRepository) GetUserByEmail(_ context.Context, emailNormalized string) (*User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	u, exists := m.usersByEmail[emailNormalized]
	if !exists {
		return nil, ErrUserNotFound
	}
	copied := *u
	return &copied, nil
}

func (m *MemoryRepository) GetUserByID(_ context.Context, id string) (*User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	u, exists := m.usersByID[id]
	if !exists {
		return nil, ErrUserNotFound
	}
	copied := *u
	return &copied, nil
}

func (m *MemoryRepository) GetUserByGoogleID(_ context.Context, googleID string) (*User, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	u, exists := m.usersByGoogleID[googleID]
	if !exists {
		return nil, ErrUserNotFound
	}
	copied := *u
	return &copied, nil
}

func (m *MemoryRepository) UpdateProfile(_ context.Context, userID, displayName, avatarID, avatarURL string) (*User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	u, exists := m.usersByID[userID]
	if !exists {
		return nil, ErrUserNotFound
	}
	u.DisplayName = displayName
	u.AvatarID = avatarID
	u.AvatarURL = avatarURL
	u.UpdatedAt = time.Now().UTC()

	copied := *u
	m.usersByID[userID] = &copied
	m.usersByEmail[u.EmailNormalized] = &copied
	if u.GoogleID != nil && *u.GoogleID != "" {
		m.usersByGoogleID[*u.GoogleID] = &copied
	}
	return &copied, nil
}

func (m *MemoryRepository) UpdatePassword(_ context.Context, userID, newPasswordHash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	u, exists := m.usersByID[userID]
	if !exists {
		return ErrUserNotFound
	}
	u.PasswordHash = newPasswordHash
	u.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *MemoryRepository) LinkGoogleAccount(_ context.Context, userID, googleID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	u, exists := m.usersByID[userID]
	if !exists {
		return ErrUserNotFound
	}
	gID := googleID
	u.GoogleID = &gID
	u.UpdatedAt = time.Now().UTC()

	copied := *u
	m.usersByID[userID] = &copied
	m.usersByGoogleID[googleID] = &copied
	return nil
}

func (m *MemoryRepository) UpdatePreferences(_ context.Context, userID string, prefs map[string]any) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	u, exists := m.usersByID[userID]
	if !exists {
		return ErrUserNotFound
	}
	u.Preferences = prefs
	u.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *MemoryRepository) CreateSession(_ context.Context, s *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	copied := *s
	m.sessions[s.TokenHash] = &copied
	return nil
}

func (m *MemoryRepository) GetSessionByTokenHash(_ context.Context, tokenHash string) (*Session, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	s, exists := m.sessions[tokenHash]
	if !exists {
		return nil, ErrSessionNotFound
	}
	copied := *s
	return &copied, nil
}

func (m *MemoryRepository) UpdateSessionLastSeen(_ context.Context, sessionID string, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, s := range m.sessions {
		if s.ID == sessionID && s.RevokedAt == nil {
			s.LastSeenAt = now
			return nil
		}
	}
	return ErrSessionNotFound
}

func (m *MemoryRepository) RevokeSession(_ context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	for _, s := range m.sessions {
		if s.ID == sessionID {
			s.RevokedAt = &now
			return nil
		}
	}
	return ErrSessionNotFound
}

func (m *MemoryRepository) RevokeAllUserSessions(_ context.Context, userID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := time.Now().UTC()
	for _, s := range m.sessions {
		if s.UserID == userID && s.RevokedAt == nil {
			s.RevokedAt = &now
		}
	}
	return nil
}

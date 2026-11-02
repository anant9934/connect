package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	neturl "net/url"
	"regexp"
	"strings"
	"time"

	"github.com/tathastu/connect/services/api/internal/audit"
)

var (
	ErrInvalidCredentials = errors.New("Email or password is incorrect.")
	ErrEmailTaken         = errors.New("An account with this email already exists.")
	ErrInvalidEmail       = errors.New("Invalid email address format.")
	ErrInvalidPassword    = errors.New("Password must be between 8 and 128 characters.")
	ErrInvalidDisplayName = errors.New("Display name must be between 2 and 50 characters.")
	ErrSessionExpired     = errors.New("Session has expired or timed out.")
	ErrAccountDisabled    = errors.New("Account is deactivated.")
)

// Disallow dangerous HTML tags or control characters in display names
var controlCharRegex = regexp.MustCompile(`[\x00-\x1F\x7F<>]`)

// Service handles user authentication, session lifecycle, and profile management.
type Service struct {
	repo            Repository
	auditService    *audit.Service
	idleTimeout     time.Duration
	absoluteTimeout time.Duration

	googleClientIDs    map[string]bool
	googleTokenInfoURL string
}

// NewService constructs the auth service.
func NewService(repo Repository, auditService *audit.Service, idleTimeout, absoluteTimeout time.Duration) *Service {
	return &Service{
		repo:            repo,
		auditService:    auditService,
		idleTimeout:     idleTimeout,
		absoluteTimeout: absoluteTimeout,
	}
}

// SignupDTO holds input parameters for registration.
type SignupDTO struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
}

// LoginDTO holds input parameters for authentication.
type LoginDTO struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// UserDTO represents a safe, non-leaking user response.
type UserDTO struct {
	ID                     string         `json:"id"`
	Email                  string         `json:"email"`
	DisplayName            string         `json:"displayName"`
	AvatarID               string         `json:"avatarId,omitempty"`
	AvatarURL              string         `json:"avatarUrl,omitempty"`
	GoogleConnected        bool           `json:"googleConnected"`
	EmailPasswordConnected bool           `json:"emailPasswordConnected"`
	Preferences            map[string]any `json:"preferences,omitempty"`
}

// ToUserDTO maps internal User model to safe public UserDTO.
func ToUserDTO(u *User) UserDTO {
	return UserDTO{
		ID:                     u.ID,
		Email:                  u.EmailNormalized,
		DisplayName:            u.DisplayName,
		AvatarID:               u.AvatarID,
		AvatarURL:              u.AvatarURL,
		GoogleConnected:        u.GoogleID != nil && *u.GoogleID != "",
		EmailPasswordConnected: u.PasswordHash != "",
		Preferences:            u.Preferences,
	}
}

// SessionResult contains session metadata and raw token for the Set-Cookie header.
type SessionResult struct {
	Token     string
	ExpiresAt time.Time
	User      UserDTO
}

// Signup validates, hashes credentials, and creates a user and active session.
func (s *Service) Signup(ctx context.Context, req SignupDTO, clientIP, requestID string) (*SessionResult, error) {
	emailNormalized := strings.ToLower(strings.TrimSpace(req.Email))
	if _, err := mail.ParseAddress(emailNormalized); err != nil || len(emailNormalized) < 5 || len(emailNormalized) > 254 {
		return nil, ErrInvalidEmail
	}

	displayName := strings.TrimSpace(req.DisplayName)
	if len(displayName) < 2 || len(displayName) > 50 || controlCharRegex.MatchString(displayName) {
		return nil, ErrInvalidDisplayName
	}

	if len(req.Password) < 8 || len(req.Password) > 128 {
		return nil, ErrInvalidPassword
	}

	// Check existing user to avoid duplicate key errors
	existing, _ := s.repo.GetUserByEmail(ctx, emailNormalized)
	if existing != nil {
		return nil, ErrEmailTaken
	}

	passwordHash, err := HashPassword(req.Password)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	user := &User{
		EmailNormalized: emailNormalized,
		DisplayName:     displayName,
		PasswordHash:    passwordHash,
		AuthProvider:    "password",
		Status:          "active",
		Preferences:     make(map[string]any),
	}

	if err := s.repo.CreateUser(ctx, user); err != nil {
		if errors.Is(err, ErrEmailAlreadyExists) {
			return nil, ErrEmailTaken
		}
		return nil, fmt.Errorf("failed to create user account: %w", err)
	}

	// Issue initial session
	sessionToken, err := GenerateSessionToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate session token: %w", err)
	}

	now := time.Now().UTC()
	expiresAt := now.Add(s.absoluteTimeout)

	session := &Session{
		UserID:     user.ID,
		TokenHash:  HashSessionToken(sessionToken),
		CreatedAt:  now,
		LastSeenAt: now,
		ExpiresAt:  expiresAt,
	}

	if err := s.repo.CreateSession(ctx, session); err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: audit.EventSignupSuccess,
			Severity:  "INFO",
			ActorID:   user.ID,
			ClientIP:  clientIP,
			RequestID: requestID,
		})
	}

	return &SessionResult{
		Token:     sessionToken,
		ExpiresAt: expiresAt,
		User:      ToUserDTO(user),
	}, nil
}

// Login validates user credentials using constant-time comparison and dummy hash protection.
func (s *Service) Login(ctx context.Context, req LoginDTO, clientIP, requestID string) (*SessionResult, error) {
	emailNormalized := strings.ToLower(strings.TrimSpace(req.Email))

	user, err := s.repo.GetUserByEmail(ctx, emailNormalized)
	if err != nil {
		// User enumeration protection: run full Argon2id check against dummy hash
		VerifyDummyPassword(req.Password)
		if s.auditService != nil {
			s.auditService.Record(ctx, audit.AuditParams{
				EventType: audit.EventLoginFailure,
				Severity:  "WARN",
				ClientIP:  clientIP,
				RequestID: requestID,
			})
		}
		return nil, ErrInvalidCredentials
	}

	if user.PasswordHash == "" {
		// Account is Google/OAuth only without password set
		return nil, ErrInvalidCredentials
	}

	valid, err := VerifyPassword(req.Password, user.PasswordHash)
	if err != nil || !valid {
		if s.auditService != nil {
			s.auditService.Record(ctx, audit.AuditParams{
				EventType: audit.EventLoginFailure,
				Severity:  "WARN",
				ActorID:   user.ID,
				ClientIP:  clientIP,
				RequestID: requestID,
			})
		}
		return nil, ErrInvalidCredentials
	}

	if user.Status != "active" {
		return nil, ErrAccountDisabled
	}

	// Session rotation: generate fresh session token
	sessionToken, err := GenerateSessionToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate session: %w", err)
	}

	now := time.Now().UTC()
	expiresAt := now.Add(s.absoluteTimeout)

	session := &Session{
		UserID:     user.ID,
		TokenHash:  HashSessionToken(sessionToken),
		CreatedAt:  now,
		LastSeenAt: now,
		ExpiresAt:  expiresAt,
	}

	if err := s.repo.CreateSession(ctx, session); err != nil {
		return nil, fmt.Errorf("failed to persist session: %w", err)
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: audit.EventLoginSuccess,
			Severity:  "INFO",
			ActorID:   user.ID,
			ClientIP:  clientIP,
			RequestID: requestID,
		})
	}

	return &SessionResult{
		Token:     sessionToken,
		ExpiresAt: expiresAt,
		User:      ToUserDTO(user),
	}, nil
}

// Logout revokes the session on the server.
func (s *Service) Logout(ctx context.Context, sessionToken, clientIP, requestID string) error {
	if sessionToken == "" {
		return nil
	}
	tokenHash := HashSessionToken(sessionToken)
	session, err := s.repo.GetSessionByTokenHash(ctx, tokenHash)
	if err != nil {
		return nil
	}

	_ = s.repo.RevokeSession(ctx, session.ID)

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: audit.EventLogout,
			Severity:  "INFO",
			ActorID:   session.UserID,
			ClientIP:  clientIP,
			RequestID: requestID,
		})
	}
	return nil
}

// ValidateSession validates the session token, enforces idle and absolute timeouts, and updates last seen.
func (s *Service) ValidateSession(ctx context.Context, sessionToken string) (*User, *Session, error) {
	if sessionToken == "" {
		return nil, nil, ErrSessionNotFound
	}

	tokenHash := HashSessionToken(sessionToken)
	session, err := s.repo.GetSessionByTokenHash(ctx, tokenHash)
	if err != nil {
		return nil, nil, ErrSessionNotFound
	}

	if session.RevokedAt != nil {
		return nil, nil, ErrSessionExpired
	}

	now := time.Now().UTC()

	// Absolute timeout check
	if now.After(session.ExpiresAt) {
		return nil, nil, ErrSessionExpired
	}

	// Idle timeout check
	if now.Sub(session.LastSeenAt) > s.idleTimeout {
		return nil, nil, ErrSessionExpired
	}

	user, err := s.repo.GetUserByID(ctx, session.UserID)
	if err != nil || user.Status != "active" {
		return nil, nil, ErrUserNotFound
	}

	// Update last_seen_at periodically (e.g. if > 1 minute since last update)
	if now.Sub(session.LastSeenAt) > time.Minute {
		_ = s.repo.UpdateSessionLastSeen(ctx, session.ID, now)
		session.LastSeenAt = now
	}

	return user, session, nil
}

// GetProfile returns current user profile DTO
func (s *Service) GetProfile(ctx context.Context, userID string) (*UserDTO, error) {
	u, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return nil, ErrUserNotFound
	}
	dto := ToUserDTO(u)
	return &dto, nil
}

// UpdateProfile updates display name, avatar ID, and avatar URL
func (s *Service) UpdateProfile(ctx context.Context, userID, displayName, avatarID, avatarURL string) (*UserDTO, error) {
	trimmedName := strings.TrimSpace(displayName)
	if len(trimmedName) < 2 || len(trimmedName) > 50 || controlCharRegex.MatchString(trimmedName) {
		return nil, ErrInvalidDisplayName
	}

	u, err := s.repo.UpdateProfile(ctx, userID, trimmedName, avatarID, avatarURL)
	if err != nil {
		return nil, err
	}
	dto := ToUserDTO(u)
	return &dto, nil
}

// ChangePassword validates old password and sets new password hash
func (s *Service) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string) error {
	if len(newPassword) < 8 || len(newPassword) > 128 {
		return ErrInvalidPassword
	}

	u, err := s.repo.GetUserByID(ctx, userID)
	if err != nil {
		return ErrUserNotFound
	}

	// If user already has a password, verify current password
	if u.PasswordHash != "" {
		valid, err := VerifyPassword(currentPassword, u.PasswordHash)
		if err != nil || !valid {
			return ErrInvalidCredentials
		}
	}

	newHash, err := HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("failed to hash new password: %w", err)
	}

	if err := s.repo.UpdatePassword(ctx, userID, newHash); err != nil {
		return err
	}
	// Whoever had the old password may still hold a session, so every session ends here.
	return s.repo.RevokeAllUserSessions(ctx, userID)
}

// UpdatePreferences persists user device and application preferences
func (s *Service) UpdatePreferences(ctx context.Context, userID string, prefs map[string]any) error {
	return s.repo.UpdatePreferences(ctx, userID, prefs)
}

type GoogleTokenInfo struct {
	Aud           string `json:"aud"`
	Iss           string `json:"iss"`
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

const defaultGoogleTokenInfoURL = "https://oauth2.googleapis.com/tokeninfo"

// ErrGoogleSignInUnavailable means no Google client IDs are configured, so no token can be trusted.
var ErrGoogleSignInUnavailable = errors.New("Google sign-in is not configured")

// SetGoogleClientIDs lists the OAuth clients whose tokens are accepted. A token Google issued
// to any other application must be refused, or that application could sign in as its users.
func (s *Service) SetGoogleClientIDs(clientIDs []string) {
	s.googleClientIDs = make(map[string]bool, len(clientIDs))
	for _, id := range clientIDs {
		if id = strings.TrimSpace(id); id != "" {
			s.googleClientIDs[id] = true
		}
	}
}

// SetGoogleTokenInfoURL points token validation at a test server.
func (s *Service) SetGoogleTokenInfoURL(tokenInfoURL string) {
	s.googleTokenInfoURL = tokenInfoURL
}

func (s *Service) verifyGoogleToken(ctx context.Context, idToken string) (*GoogleTokenInfo, error) {
	if len(s.googleClientIDs) == 0 {
		return nil, ErrGoogleSignInUnavailable
	}
	if strings.TrimSpace(idToken) == "" {
		return nil, errors.New("empty id token")
	}

	endpoint := s.googleTokenInfoURL
	if endpoint == "" {
		endpoint = defaultGoogleTokenInfoURL
	}
	url := endpoint + "?id_token=" + neturl.QueryEscape(idToken)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to reach Google token validation service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("Google token validation returned invalid response")
	}

	var info GoogleTokenInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, errors.New("malformed Google token validation response")
	}

	if info.Sub == "" || info.Email == "" {
		return nil, errors.New("missing essential claims in Google ID token")
	}
	if !s.googleClientIDs[info.Aud] {
		return nil, errors.New("Google ID token was issued to a different application")
	}
	if info.Iss != "accounts.google.com" && info.Iss != "https://accounts.google.com" {
		return nil, errors.New("Google ID token has an unexpected issuer")
	}

	return &info, nil
}

// GoogleAuth authenticates or registers a user via verified Google ID token
func (s *Service) GoogleAuth(ctx context.Context, idToken, clientIP, requestID string) (*SessionResult, error) {
	info, err := s.verifyGoogleToken(ctx, idToken)
	if err != nil {
		return nil, err
	}

	emailNormalized := strings.ToLower(strings.TrimSpace(info.Email))

	// Look up by Google ID first
	user, err := s.repo.GetUserByGoogleID(ctx, info.Sub)
	if err != nil && !errors.Is(err, ErrUserNotFound) {
		return nil, err
	}

	// An unverified address proves nothing, so it cannot claim or create an account.
	if user == nil && info.EmailVerified != "true" {
		return nil, errors.New("Google has not verified this email address")
	}

	// If not found by Google ID, check if email exists
	if user == nil {
		user, err = s.repo.GetUserByEmail(ctx, emailNormalized)
		if err != nil && !errors.Is(err, ErrUserNotFound) {
			return nil, err
		}
		if user != nil {
			// Link Google account to existing user
			_ = s.repo.LinkGoogleAccount(ctx, user.ID, info.Sub)
			user.GoogleID = &info.Sub
		}
	}

	// If still not found, create new Google-authenticated user
	if user == nil {
		displayName := info.Name
		if displayName == "" {
			displayName = strings.Split(emailNormalized, "@")[0]
		}
		user = &User{
			EmailNormalized: emailNormalized,
			DisplayName:     displayName,
			GoogleID:        &info.Sub,
			AuthProvider:    "google",
			EmailVerified:   info.EmailVerified == "true",
			Status:          "active",
			Preferences:     make(map[string]any),
		}
		if err := s.repo.CreateUser(ctx, user); err != nil {
			return nil, fmt.Errorf("failed to create Google user: %w", err)
		}
	}

	// Issue active session
	sessionToken, err := GenerateSessionToken()
	if err != nil {
		return nil, fmt.Errorf("failed to generate session: %w", err)
	}

	now := time.Now().UTC()
	expiresAt := now.Add(s.absoluteTimeout)

	session := &Session{
		UserID:     user.ID,
		TokenHash:  HashSessionToken(sessionToken),
		CreatedAt:  now,
		LastSeenAt: now,
		ExpiresAt:  expiresAt,
	}

	if err := s.repo.CreateSession(ctx, session); err != nil {
		return nil, fmt.Errorf("failed to persist session: %w", err)
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: audit.EventLoginSuccess,
			Severity:  "INFO",
			ActorID:   user.ID,
			ClientIP:  clientIP,
			RequestID: requestID,
		})
	}

	return &SessionResult{
		Token:     sessionToken,
		ExpiresAt: expiresAt,
		User:      ToUserDTO(user),
	}, nil
}

// LinkGoogle links a verified Google ID token to the authenticated user account
func (s *Service) LinkGoogle(ctx context.Context, userID, idToken string) error {
	info, err := s.verifyGoogleToken(ctx, idToken)
	if err != nil {
		return err
	}

	// Check if this Google ID is already linked to another account
	existing, err := s.repo.GetUserByGoogleID(ctx, info.Sub)
	if err == nil && existing != nil && existing.ID != userID {
		return errors.New("this Google account is already linked to another Tathastu Meet user")
	}

	return s.repo.LinkGoogleAccount(ctx, userID, info.Sub)
}

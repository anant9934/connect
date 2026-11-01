package room

import (
	"context"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/livekit"
)

var controlCharRegex = regexp.MustCompile(`[\x00-\x1F\x7F<>]`)

var (
	ErrInvalidDisplayName  = errors.New("Display name must be between 2 and 50 characters.")
	ErrParticipantRequired = errors.New("Participant identity required.")
)

// JoinResult holds resolved room session state for the client.
type JoinResult struct {
	Room        *Room
	Participant *Participant
	IsHost      bool
	GuestToken  string
}

// Service manages room lifecycle, participant state, authorization, and media grant issuance.
type Service struct {
	repo         Repository
	policy       *Policy
	auditService *audit.Service
	tokenService *livekit.TokenService
	roomManager  *livekit.RoomManager
	instanceID   string
}

// NewService constructs the room domain service with an auto-generated instance ID.
func NewService(repo Repository, policy *Policy, auditService *audit.Service, tokenService *livekit.TokenService, roomManager *livekit.RoomManager) *Service {
	return NewServiceWithInstanceID(repo, policy, auditService, tokenService, roomManager, uuid.NewString())
}

// NewServiceWithInstanceID constructs the room domain service with a specific instance ID for distributed simulation.
func NewServiceWithInstanceID(repo Repository, policy *Policy, auditService *audit.Service, tokenService *livekit.TokenService, roomManager *livekit.RoomManager, instanceID string) *Service {
	if instanceID == "" {
		instanceID = uuid.NewString()
	}
	return &Service{
		repo:         repo,
		policy:       policy,
		auditService: auditService,
		tokenService: tokenService,
		roomManager:  roomManager,
		instanceID:   instanceID,
	}
}

// CreateRoom provisions a new secure room with a cryptographic public code.
func (s *Service) CreateRoom(ctx context.Context, hostUser *auth.User, maxParticipants int, clientIP, reqID string) (*Room, error) {
	return s.CreateRoomWithOptions(ctx, hostUser, maxParticipants, false, clientIP, reqID)
}

// CreateRoomWithOptions provisions a new secure room with custom options (such as waiting room).
func (s *Service) CreateRoomWithOptions(ctx context.Context, hostUser *auth.User, maxParticipants int, waitingRoomEnabled bool, clientIP, reqID string) (*Room, error) {
	return s.CreateRoomWithPasscode(ctx, hostUser, maxParticipants, waitingRoomEnabled, "", clientIP, reqID)
}

// CreateRoomWithPasscode provisions an instant room, optionally protected by a passcode.
func (s *Service) CreateRoomWithPasscode(ctx context.Context, hostUser *auth.User, maxParticipants int, waitingRoomEnabled bool, passcode, clientIP, reqID string) (*Room, error) {
	if hostUser == nil {
		return nil, auth.ErrInvalidCredentials
	}
	passcodeHash, err := hashPasscode(passcode)
	if err != nil {
		return nil, err
	}

	if maxParticipants <= 0 || maxParticipants > 100 {
		maxParticipants = 50
	}

	// Retry loop for cryptographic collision mitigation
	var publicCode string
	for attempt := 0; attempt < 5; attempt++ {
		code, err := GeneratePublicCode()
		if err != nil {
			return nil, fmt.Errorf("failed to generate public room code: %w", err)
		}

		existing, _ := s.repo.GetRoomByCode(ctx, code)
		if existing == nil {
			publicCode = code
			break
		}
	}

	if publicCode == "" {
		return nil, errors.New("failed to allocate unique room code")
	}

	room := &Room{
		PublicCode:         publicCode,
		HostUserID:         hostUser.ID,
		Status:             "active",
		IsLocked:           false,
		WaitingRoomEnabled: waitingRoomEnabled,
		MaxParticipants:    maxParticipants,
		PasscodeHash:       passcodeHash,
	}

	if err := s.repo.CreateRoom(ctx, room); err != nil {
		return nil, fmt.Errorf("failed to persist room: %w", err)
	}

	// Register host as initial participant
	hostParticipant := &Participant{
		RoomID:      room.ID,
		UserID:      &hostUser.ID,
		Identity:    "user:" + hostUser.ID,
		DisplayName: hostUser.DisplayName,
		Role:        "host",
		IsGuest:     false,
	}
	_ = s.repo.UpsertParticipant(ctx, hostParticipant)

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: audit.EventRoomCreated,
			Severity:  "INFO",
			ActorID:   hostUser.ID,
			RoomID:    room.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}

	return room, nil
}

// ScheduleParams describes a meeting booked for later. Instants are stored in UTC;
// the IANA time zone is kept so clients can show the host's local time.
type ScheduleParams struct {
	Title              string
	StartsAt           time.Time
	EndsAt             time.Time
	TimeZone           string
	Passcode           string
	WaitingRoomEnabled bool
	MaxParticipants    int
}

const (
	maxMeetingLength = 24 * time.Hour
	maxTitleLength   = 200
	minPasscode      = 4
	maxPasscode      = 32
)

func validateSchedule(title string, start, end time.Time, timeZone string) error {
	if strings.TrimSpace(title) == "" || len(title) > maxTitleLength || controlCharRegex.MatchString(title) {
		return fmt.Errorf("%w: a title of up to %d characters is required", ErrInvalidSchedule, maxTitleLength)
	}
	if !start.After(time.Now()) {
		return fmt.Errorf("%w: the start time must be in the future", ErrInvalidSchedule)
	}
	if !end.After(start) || end.Sub(start) > maxMeetingLength {
		return fmt.Errorf("%w: the meeting must end after it starts and last at most 24 hours", ErrInvalidSchedule)
	}
	if _, err := time.LoadLocation(timeZone); err != nil || timeZone == "" {
		return fmt.Errorf("%w: unknown time zone", ErrInvalidSchedule)
	}
	return nil
}

func hashPasscode(passcode string) (string, error) {
	if passcode == "" {
		return "", nil
	}
	if len(passcode) < minPasscode || len(passcode) > maxPasscode {
		return "", fmt.Errorf("%w: a passcode must have %d to %d characters", ErrInvalidSchedule, minPasscode, maxPasscode)
	}
	return auth.HashPassword(passcode)
}

// ScheduleRoom books a meeting for later. It stays closed to others until the host starts it.
func (s *Service) ScheduleRoom(ctx context.Context, host *auth.User, params ScheduleParams, clientIP, reqID string) (*Room, error) {
	if host == nil {
		return nil, auth.ErrInvalidCredentials
	}
	params.Title = strings.TrimSpace(params.Title)
	if err := validateSchedule(params.Title, params.StartsAt, params.EndsAt, params.TimeZone); err != nil {
		return nil, err
	}
	passcodeHash, err := hashPasscode(params.Passcode)
	if err != nil {
		return nil, err
	}
	conflict, err := s.repo.HasScheduleConflict(ctx, host.ID, "", params.StartsAt, params.EndsAt)
	if err != nil {
		return nil, fmt.Errorf("failed to check schedule conflicts: %w", err)
	}
	if conflict {
		return nil, ErrScheduleConflict
	}
	code, err := GeneratePublicCode()
	if err != nil {
		return nil, fmt.Errorf("failed to generate public room code: %w", err)
	}
	maxParticipants := params.MaxParticipants
	if maxParticipants <= 0 || maxParticipants > 100 {
		maxParticipants = 50
	}
	start, end := params.StartsAt.UTC(), params.EndsAt.UTC()
	rm := &Room{
		PublicCode:         code,
		HostUserID:         host.ID,
		Status:             "scheduled",
		WaitingRoomEnabled: params.WaitingRoomEnabled,
		MaxParticipants:    maxParticipants,
		Title:              params.Title,
		ScheduledStart:     &start,
		ScheduledEnd:       &end,
		TimeZone:           params.TimeZone,
		PasscodeHash:       passcodeHash,
	}
	if err := s.repo.CreateRoom(ctx, rm); err != nil {
		return nil, fmt.Errorf("failed to persist scheduled room: %w", err)
	}
	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{EventType: "room.scheduled", Severity: "INFO", ActorID: host.ID, RoomID: rm.ID, ClientIP: clientIP, RequestID: reqID})
	}
	return rm, nil
}

// RescheduleRoom changes a meeting that has not started. The host only.
func (s *Service) RescheduleRoom(ctx context.Context, code string, user *auth.User, title string, start, end time.Time, timeZone, clientIP, reqID string) (*Room, error) {
	rm, err := s.repo.GetRoomByCode(ctx, NormalizeCode(code))
	if err != nil {
		return nil, ErrRoomNotFound
	}
	if !s.policy.IsHost(user, rm) {
		return nil, ErrUnauthorizedRoomAction
	}
	if rm.Status != "scheduled" {
		return nil, fmt.Errorf("%w: only a meeting that has not started can be changed", ErrInvalidSchedule)
	}
	title = strings.TrimSpace(title)
	if err := validateSchedule(title, start, end, timeZone); err != nil {
		return nil, err
	}
	conflict, err := s.repo.HasScheduleConflict(ctx, user.ID, rm.ID, start, end)
	if err != nil {
		return nil, fmt.Errorf("failed to check schedule conflicts: %w", err)
	}
	if conflict {
		return nil, ErrScheduleConflict
	}
	if err := s.repo.UpdateRoomSchedule(ctx, rm.ID, title, start.UTC(), end.UTC(), timeZone); err != nil {
		return nil, err
	}
	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{EventType: "room.rescheduled", Severity: "INFO", ActorID: user.ID, RoomID: rm.ID, ClientIP: clientIP, RequestID: reqID})
	}
	return s.repo.GetRoomByCode(ctx, rm.PublicCode)
}

// CancelRoom cancels a meeting that has not started. The host only.
func (s *Service) CancelRoom(ctx context.Context, code string, user *auth.User, clientIP, reqID string) error {
	rm, err := s.repo.GetRoomByCode(ctx, NormalizeCode(code))
	if err != nil {
		return ErrRoomNotFound
	}
	if !s.policy.IsHost(user, rm) {
		return ErrUnauthorizedRoomAction
	}
	if rm.Status != "scheduled" {
		return fmt.Errorf("%w: only a meeting that has not started can be cancelled", ErrInvalidSchedule)
	}
	if err := s.repo.SetRoomStatus(ctx, rm.ID, "cancelled"); err != nil {
		return err
	}
	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{EventType: "room.cancelled", Severity: "INFO", ActorID: user.ID, RoomID: rm.ID, ClientIP: clientIP, RequestID: reqID})
	}
	return nil
}

// GetUpcomingRooms lists the meetings the user has scheduled.
func (s *Service) GetUpcomingRooms(ctx context.Context, user *auth.User, limit int) ([]*Room, error) {
	if user == nil {
		return nil, ErrUnauthorizedRoomAction
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repo.GetUpcomingRooms(ctx, user.ID, limit)
}

// GetRoom retrieves a room by its normalized public code.
func (s *Service) GetRoom(ctx context.Context, code string) (*Room, error) {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return nil, ErrRoomNotFound
	}
	if rm.Status == "ended" {
		return nil, ErrRoomEnded
	}
	if rm.Status == "cancelled" {
		return nil, ErrRoomCancelled
	}
	return rm, nil
}

// checkEntry applies the institutional rule, failing closed if it cannot be evaluated.
func (s *Service) checkEntry(ctx context.Context, roomID, identity string) error {
	allowed, err := s.repo.CanEnterRoom(ctx, roomID, identity)
	if err != nil {
		return fmt.Errorf("failed to evaluate room entry: %w", err)
	}
	if !allowed {
		return ErrUnauthorizedRoomAction
	}
	return nil
}

// JoinRoom admits an authenticated user or guest into the meeting room.
func (s *Service) JoinRoom(ctx context.Context, code string, user *auth.User, guestDisplayName, clientIP, reqID string) (*JoinResult, error) {
	return s.JoinRoomWithIdentity(ctx, code, user, "", guestDisplayName, clientIP, reqID)
}

// JoinRoomWithIdentity admits an authenticated user or guest with an optional pre-established identity.
func (s *Service) JoinRoomWithIdentity(ctx context.Context, code string, user *auth.User, guestIdentity, guestDisplayName, clientIP, reqID string) (*JoinResult, error) {
	return s.JoinRoomWithPasscode(ctx, code, user, guestIdentity, guestDisplayName, "", clientIP, reqID)
}

// checkMeetingOpen applies scheduling and the passcode to a caller who is not the host.
func checkMeetingOpen(rm *Room, passcode string) error {
	if rm.Status == "cancelled" {
		return ErrRoomCancelled
	}
	if rm.Status == "scheduled" {
		return ErrMeetingNotStarted
	}
	if rm.PasscodeHash == "" {
		return nil
	}
	if passcode == "" {
		return ErrPasscodeRequired
	}
	if ok, err := auth.VerifyPassword(passcode, rm.PasscodeHash); err != nil || !ok {
		return ErrInvalidPasscode
	}
	return nil
}

// JoinRoomWithPasscode admits a caller who supplied the passcode, if the room has one.
// The host needs no passcode, and joining is what starts their scheduled meeting.
func (s *Service) JoinRoomWithPasscode(ctx context.Context, code string, user *auth.User, guestIdentity, guestDisplayName, passcode, clientIP, reqID string) (*JoinResult, error) {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		if s.auditService != nil {
			s.auditService.Record(ctx, audit.AuditParams{
				EventType: audit.EventRoomJoinDenied,
				Severity:  "WARN",
				ClientIP:  clientIP,
				RequestID: reqID,
			})
		}
		return nil, ErrRoomNotFound
	}

	if s.policy.IsHost(user, rm) {
		if rm.Status == "cancelled" {
			return nil, ErrRoomCancelled
		}
		if rm.Status == "scheduled" {
			if err := s.repo.SetRoomStatus(ctx, rm.ID, "active"); err != nil {
				return nil, fmt.Errorf("failed to start scheduled meeting: %w", err)
			}
			rm.Status = "active"
		}
	} else if rm.Status != "ended" {
		if err := checkMeetingOpen(rm, passcode); err != nil {
			if s.auditService != nil && errors.Is(err, ErrInvalidPasscode) {
				s.auditService.Record(ctx, audit.AuditParams{EventType: audit.EventRoomJoinDenied, Severity: "WARN", RoomID: rm.ID, ClientIP: clientIP, RequestID: reqID})
			}
			return nil, err
		}
	}

	activeCount, _ := s.repo.GetActiveParticipantCount(ctx, rm.ID)
	if err := s.policy.CanJoin(rm, activeCount); err != nil {
		if s.auditService != nil {
			s.auditService.Record(ctx, audit.AuditParams{
				EventType: audit.EventRoomJoinDenied,
				Severity:  "WARN",
				RoomID:    rm.ID,
				ClientIP:  clientIP,
				RequestID: reqID,
			})
		}
		return nil, err
	}

	var participant *Participant
	var isHost bool

	if user != nil {
		if err := s.checkEntry(ctx, rm.ID, "user:"+user.ID); err != nil {
			return nil, err
		}
		isHost = s.policy.IsHost(user, rm)
		role := "participant"
		if isHost {
			role = "host"
		}
		identity := "user:" + user.ID
		if removed, _ := s.repo.IsParticipantRemoved(ctx, rm.ID, identity); removed {
			return nil, ErrParticipantRemoved
		}
		participant = &Participant{
			RoomID:      rm.ID,
			UserID:      &user.ID,
			Identity:    identity,
			DisplayName: user.DisplayName,
			Role:        role,
			IsGuest:     false,
		}
	} else {
		// Guest joining
		cleanName := strings.TrimSpace(guestDisplayName)
		if len(cleanName) < 2 || len(cleanName) > 50 || controlCharRegex.MatchString(cleanName) {
			return nil, ErrInvalidDisplayName
		}
		var identity string
		if guestIdentity != "" && strings.HasPrefix(guestIdentity, "guest:") {
			identity = guestIdentity
		} else {
			identity = "guest:" + uuid.NewString()
		}

		if err := s.checkEntry(ctx, rm.ID, identity); err != nil {
			return nil, err
		}
		if removed, _ := s.repo.IsParticipantRemoved(ctx, rm.ID, identity); removed {
			return nil, ErrParticipantRemoved
		}

		participant = &Participant{
			RoomID:      rm.ID,
			Identity:    identity,
			DisplayName: cleanName,
			Role:        "participant",
			IsGuest:     true,
		}
		isHost = false
	}

	if err := s.repo.UpsertParticipant(ctx, participant); err != nil {
		return nil, fmt.Errorf("failed to register participant: %w", err)
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: audit.EventRoomJoined,
			Severity:  "INFO",
			ActorID:   participant.Identity,
			RoomID:    rm.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}

	var guestToken string
	if participant.IsGuest {
		tok, err := GenerateGuestToken(rm.PublicCode, participant.Identity, 12*time.Hour)
		if err == nil {
			guestToken = tok
		}
	}

	return &JoinResult{
		Room:        rm,
		Participant: participant,
		IsHost:      isHost,
		GuestToken:  guestToken,
	}, nil
}

// LeaveRoom marks participant departure.
func (s *Service) LeaveRoom(ctx context.Context, code string, identity string, clientIP, reqID string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return nil
	}
	_ = s.repo.MarkParticipantLeft(ctx, rm.ID, identity, time.Now().UTC())
	return nil
}

// LockRoom prevents new participants from joining.
func (s *Service) LockRoom(ctx context.Context, code string, user *auth.User, clientIP, reqID string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return ErrRoomNotFound
	}

	if err := s.policy.CanLock(user, rm); err != nil {
		if s.auditService != nil {
			s.auditService.Record(ctx, audit.AuditParams{
				EventType: audit.EventHostActionDenied,
				Severity:  "WARN",
				ActorID:   user.ID,
				RoomID:    rm.ID,
				ClientIP:  clientIP,
				RequestID: reqID,
			})
		}
		return err
	}

	now := time.Now().UTC()
	if err := s.repo.SetRoomLocked(ctx, rm.ID, true, &now); err != nil {
		return err
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: audit.EventRoomLocked,
			Severity:  "INFO",
			ActorID:   user.ID,
			RoomID:    rm.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}
	return nil
}

// UnlockRoom restores permission for new participants to join.
func (s *Service) UnlockRoom(ctx context.Context, code string, user *auth.User, clientIP, reqID string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return ErrRoomNotFound
	}

	if err := s.policy.CanUnlock(user, rm); err != nil {
		if s.auditService != nil {
			s.auditService.Record(ctx, audit.AuditParams{
				EventType: audit.EventHostActionDenied,
				Severity:  "WARN",
				ActorID:   user.ID,
				RoomID:    rm.ID,
				ClientIP:  clientIP,
				RequestID: reqID,
			})
		}
		return err
	}

	if err := s.repo.SetRoomLocked(ctx, rm.ID, false, nil); err != nil {
		return err
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: audit.EventRoomUnlocked,
			Severity:  "INFO",
			ActorID:   user.ID,
			RoomID:    rm.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}
	return nil
}

// EndRoom closes the session permanently for all participants.
func (s *Service) EndRoom(ctx context.Context, code string, user *auth.User, clientIP, reqID string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return ErrRoomNotFound
	}

	if err := s.policy.CanEnd(user, rm); err != nil {
		if s.auditService != nil {
			s.auditService.Record(ctx, audit.AuditParams{
				EventType: audit.EventHostActionDenied,
				Severity:  "WARN",
				ActorID:   user.ID,
				RoomID:    rm.ID,
				ClientIP:  clientIP,
				RequestID: reqID,
			})
		}
		return err
	}

	now := time.Now().UTC()
	if err := s.repo.EndRoom(ctx, rm.ID, now); err != nil {
		return err
	}

	// Authoritatively terminate underlying LiveKit SFU room to immediately disconnect all participants
	if s.roomManager != nil {
		if termErr := s.roomManager.TerminateRoom(ctx, normCode); termErr != nil {
			if s.auditService != nil {
				s.auditService.Record(ctx, audit.AuditParams{
					EventType: "room.sfu_termination_failed",
					Severity:  "WARN",
					ActorID:   user.ID,
					RoomID:    rm.ID,
					ClientIP:  clientIP,
					RequestID: reqID,
				})
			}
		}
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: audit.EventRoomEnded,
			Severity:  "INFO",
			ActorID:   user.ID,
			RoomID:    rm.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}
	return nil
}

// GetParticipants returns all active participants in the room.
func (s *Service) GetParticipants(ctx context.Context, code string) ([]*Participant, error) {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return nil, ErrRoomNotFound
	}
	return s.repo.GetActiveParticipants(ctx, rm.ID)
}

// ListParticipantsFor returns the active participants to a caller who has access to the room.
func (s *Service) ListParticipantsFor(ctx context.Context, code, callerIdentity string) ([]*Participant, error) {
	if _, _, err := s.ValidateRoomAccess(ctx, code, callerIdentity); err != nil {
		return nil, err
	}
	return s.GetParticipants(ctx, code)
}

// GenerateToken generates a short-lived signed LiveKit token with server-validated grants.
func (s *Service) GenerateToken(ctx context.Context, code string, user *auth.User, guestIdentity, guestDisplayName string, clientIP, reqID string) (string, error) {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return "", ErrRoomNotFound
	}
	if rm.Status == "ended" {
		return "", ErrRoomEnded
	}
	if rm.Status == "cancelled" {
		return "", ErrRoomCancelled
	}
	if rm.Status == "scheduled" {
		return "", ErrMeetingNotStarted
	}

	var identity string
	var displayName string
	var isHost bool

	if user != nil {
		identity = "user:" + user.ID
		displayName = user.DisplayName
		isHost = s.policy.IsHost(user, rm)
	} else {
		if guestIdentity == "" || !strings.HasPrefix(guestIdentity, "guest:") {
			return "", ErrParticipantRequired
		}
		cleanName := strings.TrimSpace(guestDisplayName)
		if len(cleanName) < 2 || len(cleanName) > 50 || controlCharRegex.MatchString(cleanName) {
			return "", ErrInvalidDisplayName
		}
		identity = guestIdentity
		displayName = cleanName
		isHost = false
	}

	if err := s.checkEntry(ctx, rm.ID, identity); err != nil {
		return "", err
	}
	if removed, _ := s.repo.IsParticipantRemoved(ctx, rm.ID, identity); removed {
		return "", ErrParticipantRemoved
	}

	if rm.WaitingRoomEnabled && !isHost {
		admitReq, err := s.repo.GetAdmissionRequest(ctx, rm.ID, identity)
		if err != nil || admitReq == nil {
			return "", ErrAdmissionRequired
		}
		if admitReq.Status == "pending" {
			return "", ErrAdmissionPending
		}
		if admitReq.Status != "admitted" {
			return "", ErrAdmissionDenied
		}
	}

	var role string
	if isHost {
		role = livekit.RoleHost
	} else {
		// Authoritatively derive participant role from database state; never trust client
		p, err := s.repo.GetParticipant(ctx, rm.ID, identity)
		if err == nil && p != nil && p.Role != "" {
			role = p.Role
		} else {
			role = livekit.RoleParticipant
		}
		// Only /join checks the passcode, so a media grant requires having been through it.
		if rm.PasscodeHash != "" && (err != nil || p == nil) {
			return "", ErrPasscodeRequired
		}
	}

	token, err := s.tokenService.GenerateToken(livekit.GrantParams{
		RoomCode:    rm.PublicCode,
		Identity:    identity,
		DisplayName: displayName,
		Role:        role,
		IsHost:      isHost,
		ValidFor:    10 * time.Minute,
	})
	if err != nil {
		return "", fmt.Errorf("failed to generate media token: %w", err)
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: audit.EventTokenIssued,
			Severity:  "INFO",
			ActorID:   identity,
			RoomID:    rm.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}

	return token, nil
}

// RequestAdmission creates or returns a pending admission request for a guest.
func (s *Service) RequestAdmission(ctx context.Context, code, identity, displayName, clientIP, reqID string) (*AdmissionRequest, error) {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return nil, ErrRoomNotFound
	}
	if rm.Status == "ended" {
		return nil, ErrRoomEnded
	}
	if rm.IsLocked {
		return nil, ErrRoomLocked
	}

	cleanName := strings.TrimSpace(displayName)
	if len(cleanName) < 2 || len(cleanName) > 50 || controlCharRegex.MatchString(cleanName) {
		return nil, ErrInvalidDisplayName
	}

	if !strings.HasPrefix(identity, "guest:") && !strings.HasPrefix(identity, "user:") {
		identity = "guest:" + uuid.NewString()
	}

	if err := s.checkEntry(ctx, rm.ID, identity); err != nil {
		return nil, err
	}
	if removed, _ := s.repo.IsParticipantRemoved(ctx, rm.ID, identity); removed {
		return nil, ErrParticipantRemoved
	}

	existing, _ := s.repo.GetAdmissionRequest(ctx, rm.ID, identity)
	if existing != nil && (existing.Status == "pending" || existing.Status == "admitted") {
		return existing, nil
	}

	var guestToken string
	if strings.HasPrefix(identity, "guest:") {
		guestToken, _ = GenerateGuestToken(rm.PublicCode, identity, 12*time.Hour)
	}

	req := &AdmissionRequest{
		ID:          uuid.NewString(),
		RoomID:      rm.ID,
		Identity:    identity,
		DisplayName: cleanName,
		Status:      "pending",
		RequestedAt: time.Now().UTC(),
		GuestToken:  guestToken,
	}

	if err := s.repo.CreateAdmissionRequest(ctx, req); err != nil {
		return nil, fmt.Errorf("failed to create admission request: %w", err)
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: "room.admission_requested",
			Severity:  "INFO",
			ActorID:   identity,
			RoomID:    rm.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}

	return req, nil
}

// GetAdmissionStatus returns the admission status for a specific participant identity.
func (s *Service) GetAdmissionStatus(ctx context.Context, code, identity string) (*AdmissionRequest, error) {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return nil, ErrRoomNotFound
	}
	if rm.Status == "ended" {
		return nil, ErrRoomEnded
	}

	req, err := s.repo.GetAdmissionRequest(ctx, rm.ID, identity)
	if err != nil || req == nil {
		return nil, ErrAdmissionRequestNotFound
	}
	return req, nil
}

// GetPendingAdmissions returns all pending admission requests to the room host.
func (s *Service) GetPendingAdmissions(ctx context.Context, code string, user *auth.User) ([]*AdmissionRequest, error) {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return nil, ErrRoomNotFound
	}
	if !s.policy.IsHost(user, rm) {
		return nil, ErrUnauthorizedRoomAction
	}

	return s.repo.GetPendingAdmissionRequests(ctx, rm.ID)
}

// DecideAdmission processes a host decision ("admitted" or "denied") for a pending admission request.
func (s *Service) DecideAdmission(ctx context.Context, code string, user *auth.User, requestID, decision, clientIP, reqID string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return ErrRoomNotFound
	}
	if !s.policy.IsHost(user, rm) {
		return ErrUnauthorizedRoomAction
	}

	if decision != "admitted" && decision != "denied" {
		return errors.New("invalid decision: must be 'admitted' or 'denied'")
	}

	pending, err := s.repo.GetPendingAdmissionRequests(ctx, rm.ID)
	if err != nil {
		return err
	}
	var target *AdmissionRequest
	for _, p := range pending {
		if p.ID == requestID {
			target = p
			break
		}
	}
	if target == nil {
		return ErrAdmissionAlreadyDecided
	}

	now := time.Now().UTC()
	if err := s.repo.UpdateAdmissionRequestStatus(ctx, rm.ID, requestID, decision, now); err != nil {
		return err
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: "room.admission_decided",
			Severity:  "INFO",
			ActorID:   user.ID,
			RoomID:    rm.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}

	return nil
}

// RemoveParticipant allows a host to remove a participant from the room and invalidate their session.
func (s *Service) RemoveParticipant(ctx context.Context, code string, user *auth.User, targetIdentity, clientIP, reqID string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return ErrRoomNotFound
	}
	if !s.policy.IsHost(user, rm) {
		return ErrUnauthorizedRoomAction
	}

	if targetIdentity == "user:"+user.ID {
		return errors.New("cannot remove room host; use end room instead")
	}

	if err := s.repo.SetParticipantRemoved(ctx, rm.ID, targetIdentity); err != nil {
		return err
	}

	if s.roomManager != nil {
		_ = s.roomManager.RemoveParticipant(ctx, normCode, targetIdentity)
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: "room.participant_removed",
			Severity:  "INFO",
			ActorID:   user.ID,
			RoomID:    rm.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}

	return nil
}

// MuteParticipant allows a host to mute a participant's published track.
func (s *Service) MuteParticipant(ctx context.Context, code string, user *auth.User, targetIdentity, trackSid, clientIP, reqID string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return ErrRoomNotFound
	}
	if !s.policy.IsHost(user, rm) {
		return ErrUnauthorizedRoomAction
	}

	if s.roomManager != nil {
		_ = s.roomManager.MuteParticipantTrack(ctx, normCode, targetIdentity, trackSid)
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: "room.participant_muted",
			Severity:  "INFO",
			ActorID:   user.ID,
			RoomID:    rm.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}

	return nil
}

// PromoteSpeaker allows a room host to promote a participant to a speaker in real-time.
// This serializes concurrent promotion/demotion requests across distributed API instances using
// PostgreSQL-backed participant leases, updates the participant's persistent role in the database
// via Compare-And-Swap (preventing stale role updates), and synchronizes track publishing permissions
// with LiveKit SFU without holding database transactions open during network operations.
// PromoteSpeaker allows a room host to promote a participant to a speaker in real-time.
// This serializes concurrent promotion/demotion requests across distributed API instances using
// PostgreSQL-backed participant leases with unique tokens and monotonic fencing generations,
// updates the participant's persistent role in the database via CAS and fencing checks, and
// synchronizes track publishing permissions with LiveKit SFU without holding database transactions open.
func (s *Service) PromoteSpeaker(ctx context.Context, code string, user *auth.User, targetIdentity, clientIP, reqID string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return ErrRoomNotFound
	}
	if !s.policy.IsHost(user, rm) {
		return ErrUnauthorizedRoomAction
	}

	if targetIdentity == "user:"+user.ID {
		return errors.New("cannot change role of room host")
	}

	// 1. Acquire distributed lease with unique token and generation (10s TTL)
	lock, err := s.repo.AcquireParticipantLock(ctx, rm.ID, targetIdentity, s.instanceID, 10*time.Second)
	if err != nil {
		return fmt.Errorf("failed to acquire distributed lock: %w", err)
	}
	defer lock.Release()

	// 2. Fetch authoritative database state under lock
	part, err := s.repo.GetParticipant(ctx, rm.ID, targetIdentity)
	if err != nil || part == nil || part.LeftAt != nil {
		return ErrParticipantNotFoundInRoom
	}

	prevRole := part.Role
	if prevRole == "" {
		prevRole = livekit.RoleParticipant
	}

	opID := uuid.NewString()

	// If already speaker and idle, idempotent re-sync
	if prevRole == livekit.RoleSpeaker && part.TransitionState == "idle" {
		if s.roomManager != nil {
			rpcCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
			defer cancel()
			if err := s.roomManager.PromoteToSpeaker(rpcCtx, normCode, targetIdentity); err != nil {
				return fmt.Errorf("%w: idempotent sync failed: %v", ErrSFUSyncFailed, err)
			}
		}
		return nil
	}

	// 3. Atomically update DB role with CAS and monotonic fencing generation
	if err := s.repo.BeginParticipantRoleTransition(ctx, rm.ID, targetIdentity, prevRole, livekit.RoleSpeaker, opID, "promoting", lock.Generation); err != nil {
		return fmt.Errorf("failed to persist role update: %w", err)
	}

	// 4. LiveKit RPC bounded to 4s (strictly less than 10s lease TTL)
	rpcCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	if s.roomManager != nil {
		rpcErr := s.roomManager.PromoteToSpeaker(rpcCtx, normCode, targetIdentity)
		if rpcErr != nil {
			// Check for timeout ambiguity
			if errors.Is(rpcErr, context.DeadlineExceeded) || strings.Contains(strings.ToLower(rpcErr.Error()), "deadline exceeded") {
				// Mark transition as unknown for observability and reconciliation
				_ = s.repo.SetParticipantTransitionUnknown(ctx, rm.ID, targetIdentity, opID, lock.Generation)

				// Active query to SFU to inspect actual permission state
				reconCtx, reconCancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer reconCancel()
				pInfo, checkErr := s.roomManager.GetParticipant(reconCtx, normCode, targetIdentity)
				if checkErr != nil {
					// Query to SFU failed or was unavailable: state is ambiguous!
					// Do NOT assume rollback. Keep transition_state = 'unknown' for reconciliation.
					if s.auditService != nil {
						s.auditService.Record(ctx, audit.AuditParams{
							EventType: "room.sfu_sync_ambiguous",
							Severity:  "WARN",
							ActorID:   user.ID,
							RoomID:    rm.ID,
							ClientIP:  clientIP,
							RequestID: reqID,
						})
					}
					log.Printf("[WARN] Participant %s role transition in room %s is ambiguous: rpc timeout (%v), sfu query failed (%v). State preserved as 'unknown' for background reconciliation.", targetIdentity, rm.ID, rpcErr, checkErr)
					return fmt.Errorf("%w: sfu rpc timed out and sfu status query unavailable (%v); participant state is unknown and requires reconciliation", ErrSFUSyncFailed, checkErr)
				}

				if pInfo != nil && pInfo.Permission != nil && pInfo.Permission.CanPublish {
					// SFU confirmed the participant has publishing permissions! Transition succeeded despite client timeout
					_ = s.repo.CommitParticipantTransition(ctx, rm.ID, targetIdentity, opID, lock.Generation)
					return nil
				}

				// SFU definitively responded and confirmed permissions were NOT applied; safely rollback role
				rbErr := s.repo.RollbackParticipantRole(ctx, rm.ID, targetIdentity, prevRole, opID, lock.Generation)
				if s.auditService != nil {
					s.auditService.Record(ctx, audit.AuditParams{
						EventType: "room.sfu_sync_timeout",
						Severity:  "WARN",
						ActorID:   user.ID,
						RoomID:    rm.ID,
						ClientIP:  clientIP,
						RequestID: reqID,
					})
				}
				if rbErr != nil && !errors.Is(rbErr, ErrStaleRoleUpdate) {
					log.Printf("[CRITICAL] Participant %s role desync in room %s: timeout (%v), rollback error (%v)", targetIdentity, rm.ID, rpcErr, rbErr)
					return fmt.Errorf("%w: sfu timeout: %v, rollback error: %v", ErrDatabaseRollbackFailed, rpcErr, rbErr)
				}
				return fmt.Errorf("%w: timeout: %v", ErrSFUSyncFailed, rpcErr)
			}

			// Definite RPC failure: Roll back role using fencing
			rbErr := s.repo.RollbackParticipantRole(ctx, rm.ID, targetIdentity, prevRole, opID, lock.Generation)
			if s.auditService != nil {
				s.auditService.Record(ctx, audit.AuditParams{
					EventType: "room.sfu_sync_failed",
					Severity:  "ERROR",
					ActorID:   user.ID,
					RoomID:    rm.ID,
					ClientIP:  clientIP,
					RequestID: reqID,
				})
			}
			if rbErr != nil && !errors.Is(rbErr, ErrStaleRoleUpdate) {
				log.Printf("[CRITICAL] Participant %s role desynchronization in room %s: initial SFU error (%v), DB rollback error (%v)", targetIdentity, rm.ID, rpcErr, rbErr)
				return fmt.Errorf("%w: sfu error: %v, rollback error: %v", ErrDatabaseRollbackFailed, rpcErr, rbErr)
			}
			return fmt.Errorf("%w: %v", ErrSFUSyncFailed, rpcErr)
		}
	}

	// 5. Commit transition state to 'idle' with generation match
	_ = s.repo.CommitParticipantTransition(ctx, rm.ID, targetIdentity, opID, lock.Generation)

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: "room.speaker_promoted",
			Severity:  "INFO",
			ActorID:   user.ID,
			RoomID:    rm.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}

	return nil
}

// DemoteSpeaker allows a room host to revoke speaker privileges from a participant in real-time.
// This serializes concurrent mutations across distributed API instances using PostgreSQL leases
// with unique tokens and monotonic fencing generations, resets the persistent role to participant,
// and revokes media publication permissions on LiveKit SFU.
func (s *Service) DemoteSpeaker(ctx context.Context, code string, user *auth.User, targetIdentity, clientIP, reqID string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return ErrRoomNotFound
	}
	if !s.policy.IsHost(user, rm) {
		return ErrUnauthorizedRoomAction
	}

	if targetIdentity == "user:"+user.ID {
		return errors.New("cannot change role of room host")
	}

	// 1. Acquire distributed lease with unique token and generation (10s TTL)
	lock, err := s.repo.AcquireParticipantLock(ctx, rm.ID, targetIdentity, s.instanceID, 10*time.Second)
	if err != nil {
		return fmt.Errorf("failed to acquire distributed lock: %w", err)
	}
	defer lock.Release()

	// 2. Fetch authoritative database state under lock
	part, err := s.repo.GetParticipant(ctx, rm.ID, targetIdentity)
	if err != nil || part == nil || part.LeftAt != nil {
		return ErrParticipantNotFoundInRoom
	}

	prevRole := part.Role
	if prevRole == "" {
		prevRole = livekit.RoleParticipant
	}

	opID := uuid.NewString()

	// If already participant and idle, idempotent re-sync
	if prevRole == livekit.RoleParticipant && part.TransitionState == "idle" {
		if s.roomManager != nil {
			rpcCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
			defer cancel()
			if err := s.roomManager.DemoteToParticipant(rpcCtx, normCode, targetIdentity); err != nil {
				return fmt.Errorf("%w: idempotent sync failed: %v", ErrSFUSyncFailed, err)
			}
		}
		return nil
	}

	// 3. Atomically update DB role with CAS and monotonic fencing generation
	if err := s.repo.BeginParticipantRoleTransition(ctx, rm.ID, targetIdentity, prevRole, livekit.RoleParticipant, opID, "demoting", lock.Generation); err != nil {
		return fmt.Errorf("failed to persist role update: %w", err)
	}

	// 4. LiveKit RPC bounded to 4s (strictly less than 10s lease TTL)
	rpcCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	if s.roomManager != nil {
		rpcErr := s.roomManager.DemoteToParticipant(rpcCtx, normCode, targetIdentity)
		if rpcErr != nil {
			// Check for timeout ambiguity
			if errors.Is(rpcErr, context.DeadlineExceeded) || strings.Contains(strings.ToLower(rpcErr.Error()), "deadline exceeded") {
				// Mark transition as unknown for observability and reconciliation
				_ = s.repo.SetParticipantTransitionUnknown(ctx, rm.ID, targetIdentity, opID, lock.Generation)

				// Active query to SFU to inspect actual permission state
				reconCtx, reconCancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer reconCancel()
				pInfo, checkErr := s.roomManager.GetParticipant(reconCtx, normCode, targetIdentity)
				if checkErr != nil {
					// Query to SFU failed or was unavailable: state is ambiguous!
					// Do NOT assume rollback. Keep transition_state = 'unknown' for reconciliation.
					if s.auditService != nil {
						s.auditService.Record(ctx, audit.AuditParams{
							EventType: "room.sfu_sync_ambiguous",
							Severity:  "WARN",
							ActorID:   user.ID,
							RoomID:    rm.ID,
							ClientIP:  clientIP,
							RequestID: reqID,
						})
					}
					log.Printf("[WARN] Participant %s role transition in room %s is ambiguous: rpc timeout (%v), sfu query failed (%v). State preserved as 'unknown' for background reconciliation.", targetIdentity, rm.ID, rpcErr, checkErr)
					return fmt.Errorf("%w: sfu rpc timed out and sfu status query unavailable (%v); participant state is unknown and requires reconciliation", ErrSFUSyncFailed, checkErr)
				}

				if pInfo == nil || (pInfo.Permission != nil && !pInfo.Permission.CanPublish) {
					// SFU confirmed the participant has had publishing revoked! Demotion succeeded despite client timeout
					_ = s.repo.CommitParticipantTransition(ctx, rm.ID, targetIdentity, opID, lock.Generation)
					return nil
				}

				// SFU definitively responded and confirmed participant still has publishing permissions; safely rollback role
				rbErr := s.repo.RollbackParticipantRole(ctx, rm.ID, targetIdentity, prevRole, opID, lock.Generation)
				if s.auditService != nil {
					s.auditService.Record(ctx, audit.AuditParams{
						EventType: "room.sfu_sync_timeout",
						Severity:  "WARN",
						ActorID:   user.ID,
						RoomID:    rm.ID,
						ClientIP:  clientIP,
						RequestID: reqID,
					})
				}
				if rbErr != nil && !errors.Is(rbErr, ErrStaleRoleUpdate) {
					log.Printf("[CRITICAL] Participant %s role desync in room %s: timeout (%v), rollback error (%v)", targetIdentity, rm.ID, rpcErr, rbErr)
					return fmt.Errorf("%w: sfu timeout: %v, rollback error: %v", ErrDatabaseRollbackFailed, rpcErr, rbErr)
				}
				return fmt.Errorf("%w: timeout: %v", ErrSFUSyncFailed, rpcErr)
			}

			// Definite RPC failure: Roll back role using fencing
			rbErr := s.repo.RollbackParticipantRole(ctx, rm.ID, targetIdentity, prevRole, opID, lock.Generation)
			if s.auditService != nil {
				s.auditService.Record(ctx, audit.AuditParams{
					EventType: "room.sfu_sync_failed",
					Severity:  "ERROR",
					ActorID:   user.ID,
					RoomID:    rm.ID,
					ClientIP:  clientIP,
					RequestID: reqID,
				})
			}
			if rbErr != nil && !errors.Is(rbErr, ErrStaleRoleUpdate) {
				log.Printf("[CRITICAL] Participant %s role desynchronization in room %s: initial SFU error (%v), DB rollback error (%v)", targetIdentity, rm.ID, rpcErr, rbErr)
				return fmt.Errorf("%w: sfu error: %v, rollback error: %v", ErrDatabaseRollbackFailed, rpcErr, rbErr)
			}
			return fmt.Errorf("%w: %v", ErrSFUSyncFailed, rpcErr)
		}
	}

	// 5. Commit transition state to 'idle' with generation match
	_ = s.repo.CommitParticipantTransition(ctx, rm.ID, targetIdentity, opID, lock.Generation)

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: "room.speaker_demoted",
			Severity:  "INFO",
			ActorID:   user.ID,
			RoomID:    rm.ID,
			ClientIP:  clientIP,
			RequestID: reqID,
		})
	}

	return nil
}

// ReconcileParticipant synchronizes LiveKit SFU permissions to match authoritative PostgreSQL database role.
// Used for backend restart recovery, transient partition healing, and distributed instance synchronization.
func (s *Service) ReconcileParticipant(ctx context.Context, code, identity string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return ErrRoomNotFound
	}

	lock, err := s.repo.AcquireParticipantLock(ctx, rm.ID, identity, s.instanceID, 10*time.Second)
	if err != nil {
		return fmt.Errorf("failed to acquire distributed lock for reconciliation: %w", err)
	}
	defer lock.Release()

	part, err := s.repo.GetParticipant(ctx, rm.ID, identity)
	if err != nil || part == nil || part.LeftAt != nil {
		return ErrParticipantNotFoundInRoom
	}

	if s.roomManager != nil {
		rpcCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
		defer cancel()

		if part.Role == livekit.RoleSpeaker || part.Role == livekit.RoleHost {
			if err := s.roomManager.PromoteToSpeaker(rpcCtx, normCode, identity); err != nil {
				return fmt.Errorf("%w: %v", ErrSFUSyncFailed, err)
			}
		} else {
			if err := s.roomManager.DemoteToParticipant(rpcCtx, normCode, identity); err != nil {
				return fmt.Errorf("%w: %v", ErrSFUSyncFailed, err)
			}
		}
	}

	if part.TransitionState != "idle" {
		_ = s.repo.CommitParticipantTransition(ctx, rm.ID, identity, part.TransitionOpID, lock.Generation)
	}

	return nil
}

// ReconcileRoom iterates all active participants of a room and ensures LiveKit SFU matches PostgreSQL state.
func (s *Service) ReconcileRoom(ctx context.Context, code string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return ErrRoomNotFound
	}

	participants, err := s.repo.GetActiveParticipants(ctx, rm.ID)
	if err != nil {
		return fmt.Errorf("failed to fetch active participants: %w", err)
	}

	var syncErrors []error
	for _, p := range participants {
		if p.Identity == "" || p.LeftAt != nil {
			continue
		}
		if err := s.ReconcileParticipant(ctx, code, p.Identity); err != nil {
			syncErrors = append(syncErrors, fmt.Errorf("participant %s sync failed: %w", p.Identity, err))
		}
	}

	if len(syncErrors) > 0 {
		return fmt.Errorf("room reconciliation encountered %d errors: %v", len(syncErrors), syncErrors[0])
	}
	return nil
}

// GetMeetingHistory returns paginated historical meeting records for an authenticated host.
func (s *Service) GetMeetingHistory(ctx context.Context, user *auth.User, limit, offset int) ([]*MeetingHistoryItem, int, error) {
	if user == nil {
		return nil, 0, ErrUnauthorizedRoomAction
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	return s.repo.GetMeetingHistory(ctx, user.ID, limit, offset)
}

// ValidateRoomAccess checks if callerIdentity has access to the room identified by publicCode.
// It verifies the room exists, participant has not been removed, and participant is registered or is host.
func (s *Service) ValidateRoomAccess(ctx context.Context, publicCode, callerIdentity string) (string, bool, error) {
	normCode := NormalizeCode(publicCode)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil || rm == nil {
		return "", false, ErrRoomNotFound
	}
	if callerIdentity == "" {
		return "", false, ErrUnauthorizedRoomAction
	}
	if err := s.checkEntry(ctx, rm.ID, callerIdentity); err != nil {
		return "", false, ErrUnauthorizedRoomAction
	}

	// Check if participant was explicitly removed by host
	removed, err := s.repo.IsParticipantRemoved(ctx, rm.ID, callerIdentity)
	if err == nil && removed {
		return "", false, ErrUnauthorizedRoomAction
	}

	// Check if caller is the room host (strictly requires user: prefix matching host ID)
	if strings.HasPrefix(callerIdentity, "user:") {
		if rm.HostUserID == callerIdentity || ("user:"+rm.HostUserID) == callerIdentity {
			return rm.ID, true, nil
		}
	}

	// Joining registers a participant before the host decides, so registration alone is not access.
	if rm.WaitingRoomEnabled {
		admission, err := s.repo.GetAdmissionRequest(ctx, rm.ID, callerIdentity)
		if err != nil || admission == nil || admission.Status != "admitted" {
			return "", false, ErrUnauthorizedRoomAction
		}
	}

	// Check if participant is actively registered in this room
	p, err := s.repo.GetParticipant(ctx, rm.ID, callerIdentity)
	if err == nil && p != nil {
		if p.LeftAt != nil {
			return "", false, ErrUnauthorizedRoomAction
		}
		// A guest can never hold host authority
		isHost := p.Role == "host" && !p.IsGuest
		return rm.ID, isHost, nil
	}

	return "", false, ErrUnauthorizedRoomAction
}

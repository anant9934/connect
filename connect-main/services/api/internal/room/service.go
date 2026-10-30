package room

import (
	"context"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"
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
	partMu       sync.Map
}

func (s *Service) lockParticipant(key string) func() {
	val, _ := s.partMu.LoadOrStore(key, &sync.Mutex{})
	m := val.(*sync.Mutex)
	m.Lock()
	return m.Unlock
}

// NewService constructs the room domain service.
func NewService(repo Repository, policy *Policy, auditService *audit.Service, tokenService *livekit.TokenService, roomManager *livekit.RoomManager) *Service {
	return &Service{
		repo:         repo,
		policy:       policy,
		auditService: auditService,
		tokenService: tokenService,
		roomManager:  roomManager,
	}
}

// CreateRoom provisions a new secure room with a cryptographic public code.
func (s *Service) CreateRoom(ctx context.Context, hostUser *auth.User, maxParticipants int, clientIP, reqID string) (*Room, error) {
	return s.CreateRoomWithOptions(ctx, hostUser, maxParticipants, false, clientIP, reqID)
}

// CreateRoomWithOptions provisions a new secure room with custom options (such as waiting room).
func (s *Service) CreateRoomWithOptions(ctx context.Context, hostUser *auth.User, maxParticipants int, waitingRoomEnabled bool, clientIP, reqID string) (*Room, error) {
	if hostUser == nil {
		return nil, auth.ErrInvalidCredentials
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
	return rm, nil
}

// JoinRoom admits an authenticated user or guest into the meeting room.
func (s *Service) JoinRoom(ctx context.Context, code string, user *auth.User, guestDisplayName, clientIP, reqID string) (*JoinResult, error) {
	return s.JoinRoomWithIdentity(ctx, code, user, "", guestDisplayName, clientIP, reqID)
}

// JoinRoomWithIdentity admits an authenticated user or guest with an optional pre-established identity.
func (s *Service) JoinRoomWithIdentity(ctx context.Context, code string, user *auth.User, guestIdentity, guestDisplayName, clientIP, reqID string) (*JoinResult, error) {
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

	if identity == "" || !strings.HasPrefix(identity, "guest:") {
		identity = "guest:" + uuid.NewString()
	}

	if removed, _ := s.repo.IsParticipantRemoved(ctx, rm.ID, identity); removed {
		return nil, ErrParticipantRemoved
	}

	existing, _ := s.repo.GetAdmissionRequest(ctx, rm.ID, identity)
	if existing != nil && (existing.Status == "pending" || existing.Status == "admitted") {
		return existing, nil
	}

	guestToken, _ := GenerateGuestToken(rm.PublicCode, identity, 12*time.Hour)

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
// This serializes concurrent promotion/demotion requests per participant, updates the
// participant's persistent role in the database, and synchronizes track publishing
// permissions with LiveKit SFU with bounded RPC timeouts and explicit rollback/reconciliation.
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

	// Serialize concurrent state mutations for this participant
	unlock := s.lockParticipant(rm.ID + ":" + targetIdentity)
	defer unlock()

	// Verify participant is an active participant of this room
	part, err := s.repo.GetParticipant(ctx, rm.ID, targetIdentity)
	if err != nil || part == nil || part.LeftAt != nil {
		return ErrParticipantNotFoundInRoom
	}

	prevRole := part.Role
	if prevRole == "" {
		prevRole = livekit.RoleParticipant
	}

	rpcCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	if prevRole == livekit.RoleSpeaker {
		// Idempotent duplicate request: re-sync SFU if online and verify success
		if s.roomManager != nil {
			if err := s.roomManager.PromoteToSpeaker(rpcCtx, normCode, targetIdentity); err != nil {
				return fmt.Errorf("%w: idempotent sync failed: %v", ErrSFUSyncFailed, err)
			}
		}
		return nil
	}

	if err := s.repo.UpdateParticipantRole(ctx, rm.ID, targetIdentity, livekit.RoleSpeaker); err != nil {
		return fmt.Errorf("failed to persist role update: %w", err)
	}

	if s.roomManager != nil {
		if err := s.roomManager.PromoteToSpeaker(rpcCtx, normCode, targetIdentity); err != nil {
			// Roll back database role update to prevent state divergence
			rbErr := s.repo.UpdateParticipantRole(ctx, rm.ID, targetIdentity, prevRole)
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
			if rbErr != nil {
				log.Printf("[CRITICAL] Participant %s role desynchronization in room %s: initial SFU error (%v), DB rollback error (%v)", targetIdentity, rm.ID, err, rbErr)
				return fmt.Errorf("%w: sfu error: %v, rollback error: %v", ErrDatabaseRollbackFailed, err, rbErr)
			}
			return fmt.Errorf("%w: %v", ErrSFUSyncFailed, err)
		}
	}

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
// This serializes concurrent mutations per participant, resets the persistent role to participant,
// and revokes media publication permissions on LiveKit SFU with explicit rollback and timeouts.
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

	// Serialize concurrent state mutations for this participant
	unlock := s.lockParticipant(rm.ID + ":" + targetIdentity)
	defer unlock()

	// Verify participant is an active participant of this room
	part, err := s.repo.GetParticipant(ctx, rm.ID, targetIdentity)
	if err != nil || part == nil || part.LeftAt != nil {
		return ErrParticipantNotFoundInRoom
	}

	prevRole := part.Role
	if prevRole == "" {
		prevRole = livekit.RoleParticipant
	}

	rpcCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	if prevRole == livekit.RoleParticipant {
		// Idempotent duplicate request: re-sync SFU revocation if online and verify success
		if s.roomManager != nil {
			if err := s.roomManager.DemoteToParticipant(rpcCtx, normCode, targetIdentity); err != nil {
				return fmt.Errorf("%w: idempotent sync failed: %v", ErrSFUSyncFailed, err)
			}
		}
		return nil
	}

	if err := s.repo.UpdateParticipantRole(ctx, rm.ID, targetIdentity, livekit.RoleParticipant); err != nil {
		return fmt.Errorf("failed to persist role update: %w", err)
	}

	if s.roomManager != nil {
		if err := s.roomManager.DemoteToParticipant(rpcCtx, normCode, targetIdentity); err != nil {
			// Roll back database role update to prevent state divergence
			rbErr := s.repo.UpdateParticipantRole(ctx, rm.ID, targetIdentity, prevRole)
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
			if rbErr != nil {
				log.Printf("[CRITICAL] Participant %s role desynchronization in room %s: initial SFU error (%v), DB rollback error (%v)", targetIdentity, rm.ID, err, rbErr)
				return fmt.Errorf("%w: sfu error: %v, rollback error: %v", ErrDatabaseRollbackFailed, err, rbErr)
			}
			return fmt.Errorf("%w: %v", ErrSFUSyncFailed, err)
		}
	}

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
// Used for backend restart recovery and self-healing after transient network partitions.
func (s *Service) ReconcileParticipant(ctx context.Context, code, identity string) error {
	normCode := NormalizeCode(code)
	rm, err := s.repo.GetRoomByCode(ctx, normCode)
	if err != nil {
		return ErrRoomNotFound
	}

	unlock := s.lockParticipant(rm.ID + ":" + identity)
	defer unlock()

	part, err := s.repo.GetParticipant(ctx, rm.ID, identity)
	if err != nil || part == nil || part.LeftAt != nil {
		return ErrParticipantNotFoundInRoom
	}

	if s.roomManager == nil {
		return nil
	}

	rpcCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	if part.Role == livekit.RoleSpeaker || part.Role == livekit.RoleHost {
		return s.roomManager.PromoteToSpeaker(rpcCtx, normCode, identity)
	}
	return s.roomManager.DemoteToParticipant(rpcCtx, normCode, identity)
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

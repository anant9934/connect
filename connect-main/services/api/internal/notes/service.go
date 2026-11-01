package notes

import (
	"context"
	"strings"

	"github.com/tathastu/connect/services/api/internal/audit"
)

type RoomValidator interface {
	ValidateRoomAccess(ctx context.Context, publicCode, callerIdentity string) (roomID string, isHost bool, err error)
}

type Service struct {
	repo          Repository
	roomValidator RoomValidator
	auditService  *audit.Service
}

func NewService(repo Repository, roomValidator RoomValidator, auditService *audit.Service) *Service {
	return &Service{
		repo:          repo,
		roomValidator: roomValidator,
		auditService:  auditService,
	}
}

func (s *Service) GetNote(ctx context.Context, roomCode, callerIdentity string) (*MeetingNote, error) {
	roomID, _, err := s.roomValidator.ValidateRoomAccess(ctx, roomCode, callerIdentity)
	if err != nil {
		return nil, ErrUnauthorized
	}

	return s.repo.GetByRoomID(ctx, roomID, callerIdentity)
}

func (s *Service) UpdateNote(ctx context.Context, roomCode, callerIdentity, title, content string, expectedRevision int) (*MeetingNote, error) {
	roomID, isHost, err := s.roomValidator.ValidateRoomAccess(ctx, roomCode, callerIdentity)
	if err != nil {
		return nil, ErrUnauthorized
	}

	// Validate title and length
	title = strings.TrimSpace(title)
	if title == "" {
		title = "Meeting Notes"
	}
	if len(title) > MaxTitleLength {
		return nil, ErrInvalidTitle
	}

	// Enforce content length ceiling
	if len(content) > MaxContentLength {
		return nil, ErrContentTooLarge
	}

	updated, err := s.repo.UpsertNote(ctx, roomID, callerIdentity, title, content, expectedRevision)
	if err != nil {
		return nil, err
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: "room.note_updated",
			Severity:  "INFO",
			ActorID:   callerIdentity,
			RoomID:    roomID,
			Metadata: map[string]any{
				"revision": updated.Revision,
				"isHost":   isHost,
			},
		})
	}

	return updated, nil
}

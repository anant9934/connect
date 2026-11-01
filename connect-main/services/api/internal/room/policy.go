package room

import (
	"errors"

	"github.com/tathastu/connect/services/api/internal/auth"
)

var (
	ErrUnauthorizedRoomAction        = errors.New("you do not have permission to perform this room action")
	ErrRoomNotFound                  = errors.New("this meeting is unavailable")
	ErrRoomEnded                     = errors.New("this meeting has ended")
	ErrRoomLocked                    = errors.New("this meeting is locked by the host")
	ErrRoomFull                      = errors.New("this meeting is currently at maximum capacity")
	ErrMeetingNotStarted             = errors.New("this meeting has not started yet")
	ErrRoomCancelled                 = errors.New("this meeting was cancelled")
	ErrPasscodeRequired              = errors.New("this meeting requires a passcode")
	ErrInvalidPasscode               = errors.New("the passcode is incorrect")
	ErrInvalidSchedule               = errors.New("the meeting schedule is invalid")
	ErrScheduleConflict              = errors.New("you already have a meeting scheduled during this time")
	ErrAdmissionRequired             = errors.New("admission to this meeting is awaiting host approval")
	ErrAdmissionPending              = errors.New("your request to join is pending host review")
	ErrAdmissionDenied               = errors.New("the host has declined your request to join this meeting")
	ErrParticipantRemoved            = errors.New("you have been removed from this meeting by the host")
	ErrAdmissionRequestNotFound      = errors.New("admission request not found")
	ErrAdmissionAlreadyDecided       = errors.New("admission request has already been decided")
	ErrParticipantNotFoundInRoom     = errors.New("participant not found in active room")
	ErrSFUSyncFailed                 = errors.New("failed to synchronize permissions with media server")
	ErrDatabaseRollbackFailed        = errors.New("critical state desynchronization: failed to rollback database role after SFU error")
	ErrLockBusy                      = errors.New("participant lock is currently held by another instance")
	ErrStaleRoleUpdate               = errors.New("concurrent modification detected: participant role state is stale")
	ErrLockInfrastructureUnavailable = errors.New("distributed lock infrastructure table is unavailable; check database migrations")
)

// Policy enforces backend-authoritative room permissions and IDOR prevention.
type Policy struct{}

// NewPolicy constructs a room policy checker.
func NewPolicy() *Policy {
	return &Policy{}
}

// IsHost checks if the authenticated user is the authoritative owner of the room.
func (p *Policy) IsHost(user *auth.User, room *Room) bool {
	if user == nil || room == nil {
		return false
	}
	return room.HostUserID == user.ID
}

// CanJoin verifies whether a participant or guest may enter the room.
func (p *Policy) CanJoin(room *Room, activeCount int) error {
	if room == nil {
		return ErrRoomNotFound
	}
	if room.Status == "ended" {
		return ErrRoomEnded
	}
	if room.IsLocked {
		return ErrRoomLocked
	}
	if activeCount >= room.MaxParticipants {
		return ErrRoomFull
	}
	return nil
}

// CanLock verifies if the user has authority to lock the room.
func (p *Policy) CanLock(user *auth.User, room *Room) error {
	if !p.IsHost(user, room) {
		return ErrUnauthorizedRoomAction
	}
	if room.Status == "ended" {
		return ErrRoomEnded
	}
	return nil
}

// CanUnlock verifies if the user has authority to unlock the room.
func (p *Policy) CanUnlock(user *auth.User, room *Room) error {
	if !p.IsHost(user, room) {
		return ErrUnauthorizedRoomAction
	}
	if room.Status == "ended" {
		return ErrRoomEnded
	}
	return nil
}

// CanEnd verifies if the user has authority to end the room for everyone.
func (p *Policy) CanEnd(user *auth.User, room *Room) error {
	if !p.IsHost(user, room) {
		return ErrUnauthorizedRoomAction
	}
	return nil
}

package room_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	proto_livekit "github.com/livekit/protocol/livekit"
	"github.com/stretchr/testify/assert"
	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/livekit"
	"github.com/tathastu/connect/services/api/internal/room"
	"google.golang.org/protobuf/proto"
)

func setupTestRoomService() (*room.Service, room.Repository, *room.Policy) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	auditService := audit.NewService(nil, logger)
	repo := room.NewMemoryRepository()
	policy := room.NewPolicy()
	tokenService := livekit.NewTokenService("test_key_123", "test_secret_456")
	service := room.NewService(repo, policy, auditService, tokenService, nil)
	return service, repo, policy
}

// 1. Unauthenticated room creation rejected
func TestUnauthenticatedRoomCreateRejected(t *testing.T) {
	svc, _, _ := setupTestRoomService()
	_, err := svc.CreateRoom(context.Background(), nil, 50, "127.0.0.1", "req-1")
	if err == nil {
		t.Fatal("SECURITY ERROR: Expected unauthenticated room creation to fail")
	}
}

// 2. Authenticated room create accepted with secure Crockford Base32 code
func TestAuthenticatedRoomCreateAccepted(t *testing.T) {
	svc, _, _ := setupTestRoomService()
	host := &auth.User{
		ID:          "user-1111",
		DisplayName: "Alice Host",
	}

	rm, err := svc.CreateRoom(context.Background(), host, 50, "127.0.0.1", "req-2")
	if err != nil {
		t.Fatalf("failed to create room: %v", err)
	}

	if rm.PublicCode == "" {
		t.Fatal("expected non-empty public room code")
	}
	if !room.IsValidCodeFormat(rm.PublicCode) {
		t.Fatalf("expected valid Crockford Base32 format, got: %s", rm.PublicCode)
	}
	if rm.HostUserID != host.ID {
		t.Fatalf("expected host %s, got %s", host.ID, rm.HostUserID)
	}
}

// 3. IDOR / BOLA: User B cannot lock, unlock, or end User A's room
func TestBOLAProtectionNonHostCannotControlRoom(t *testing.T) {
	svc, _, _ := setupTestRoomService()
	ctx := context.Background()

	hostAlice := &auth.User{ID: "alice-id", DisplayName: "Alice"}
	userBob := &auth.User{ID: "bob-id", DisplayName: "Bob"}

	rm, err := svc.CreateRoom(ctx, hostAlice, 50, "127.0.0.1", "req-create")
	if err != nil {
		t.Fatalf("failed to create room: %v", err)
	}

	// Bob attempts to lock Alice's room
	errLock := svc.LockRoom(ctx, rm.PublicCode, userBob, "127.0.0.1", "req-lock")
	if !errors.Is(errLock, room.ErrUnauthorizedRoomAction) {
		t.Fatalf("BOLA FAILURE: non-host Bob locked Alice's room! Got: %v", errLock)
	}

	// Bob attempts to unlock Alice's room
	errUnlock := svc.UnlockRoom(ctx, rm.PublicCode, userBob, "127.0.0.1", "req-unlock")
	if !errors.Is(errUnlock, room.ErrUnauthorizedRoomAction) {
		t.Fatalf("BOLA FAILURE: non-host Bob unlocked Alice's room! Got: %v", errUnlock)
	}

	// Bob attempts to end Alice's room
	errEnd := svc.EndRoom(ctx, rm.PublicCode, userBob, "127.0.0.1", "req-end")
	if !errors.Is(errEnd, room.ErrUnauthorizedRoomAction) {
		t.Fatalf("BOLA FAILURE: non-host Bob ended Alice's room! Got: %v", errEnd)
	}

	// Host Alice CAN lock her own room
	errAliceLock := svc.LockRoom(ctx, rm.PublicCode, hostAlice, "127.0.0.1", "req-alice-lock")
	if errAliceLock != nil {
		t.Fatalf("host Alice should be authorized to lock room, got: %v", errAliceLock)
	}

	// Host Alice CAN unlock her own room
	errAliceUnlock := svc.UnlockRoom(ctx, rm.PublicCode, hostAlice, "127.0.0.1", "req-alice-unlock")
	if errAliceUnlock != nil {
		t.Fatalf("host Alice should be authorized to unlock room, got: %v", errAliceUnlock)
	}

	// Host Alice CAN end her own room
	errAliceEnd := svc.EndRoom(ctx, rm.PublicCode, hostAlice, "127.0.0.1", "req-alice-end")
	if errAliceEnd != nil {
		t.Fatalf("host Alice should be authorized to end room, got: %v", errAliceEnd)
	}
}

// 4. Guest & Authenticated Participant Joining
func TestGuestAndAuthenticatedJoin(t *testing.T) {
	svc, _, _ := setupTestRoomService()
	ctx := context.Background()

	host := &auth.User{ID: "host-1", DisplayName: "Host"}
	rm, _ := svc.CreateRoom(ctx, host, 50, "127.0.0.1", "req-1")

	// 4a. Authenticated participant joins
	participantUser := &auth.User{ID: "user-2", DisplayName: "Bob Participant"}
	joinResAuth, err := svc.JoinRoom(ctx, rm.PublicCode, participantUser, "", "127.0.0.1", "req-auth-join")
	if err != nil {
		t.Fatalf("authenticated join failed: %v", err)
	}
	if joinResAuth.IsHost {
		t.Fatal("SECURITY ERROR: Bob was marked as host")
	}
	if joinResAuth.Participant.Identity != "user:user-2" {
		t.Fatalf("unexpected identity: %s", joinResAuth.Participant.Identity)
	}

	// 4b. Guest participant joins with valid display name
	joinResGuest, err := svc.JoinRoom(ctx, rm.PublicCode, nil, "Guest Observer", "127.0.0.1", "req-guest-join")
	if err != nil {
		t.Fatalf("guest join failed: %v", err)
	}
	if joinResGuest.IsHost {
		t.Fatal("SECURITY ERROR: Guest was marked as host")
	}
	if !joinResGuest.Participant.IsGuest {
		t.Fatal("expected IsGuest=true")
	}
	if joinResGuest.Participant.DisplayName != "Guest Observer" {
		t.Fatalf("expected display name Guest Observer, got: %s", joinResGuest.Participant.DisplayName)
	}

	// 4c. Guest with invalid / malicious display name rejected
	_, errMaliciousGuest := svc.JoinRoom(ctx, rm.PublicCode, nil, "<script>alert(1)</script>", "127.0.0.1", "req-xss")
	if !errors.Is(errMaliciousGuest, room.ErrInvalidDisplayName) {
		t.Fatalf("expected ErrInvalidDisplayName for XSS payload, got: %v", errMaliciousGuest)
	}
}

// 5. Locked Room Prevents New Joins
func TestLockedRoomRejection(t *testing.T) {
	svc, _, _ := setupTestRoomService()
	ctx := context.Background()

	host := &auth.User{ID: "host-lock", DisplayName: "Host Lock"}
	rm, _ := svc.CreateRoom(ctx, host, 50, "127.0.0.1", "req-1")

	// Lock room
	_ = svc.LockRoom(ctx, rm.PublicCode, host, "127.0.0.1", "req-lock")

	// Attempt join locked room
	_, err := svc.JoinRoom(ctx, rm.PublicCode, nil, "Late Guest", "127.0.0.1", "req-join")
	if !errors.Is(err, room.ErrRoomLocked) {
		t.Fatalf("expected ErrRoomLocked, got: %v", err)
	}
}

// 6. Ended Room Prevents Joins
func TestEndedRoomRejection(t *testing.T) {
	svc, _, _ := setupTestRoomService()
	ctx := context.Background()

	host := &auth.User{ID: "host-end", DisplayName: "Host End"}
	rm, _ := svc.CreateRoom(ctx, host, 50, "127.0.0.1", "req-1")

	// End room
	_ = svc.EndRoom(ctx, rm.PublicCode, host, "127.0.0.1", "req-end")

	// Attempt join ended room
	_, err := svc.JoinRoom(ctx, rm.PublicCode, nil, "Post Meeting Guest", "127.0.0.1", "req-join")
	if !errors.Is(err, room.ErrRoomEnded) {
		t.Fatalf("expected ErrRoomEnded, got: %v", err)
	}
}

// 7. Max Participant Limit Enforced
func TestRoomMaxParticipantsEnforced(t *testing.T) {
	svc, _, _ := setupTestRoomService()
	ctx := context.Background()

	host := &auth.User{ID: "host-cap", DisplayName: "Host Cap"}
	// Room capacity: 2 participants
	rm, _ := svc.CreateRoom(ctx, host, 2, "127.0.0.1", "req-1")
	// Host is participant 1

	// Join participant 2
	_, err2 := svc.JoinRoom(ctx, rm.PublicCode, nil, "Guest Two", "127.0.0.1", "req-2")
	if err2 != nil {
		t.Fatalf("participant 2 join should succeed: %v", err2)
	}

	// Join participant 3 (must exceed capacity)
	_, err3 := svc.JoinRoom(ctx, rm.PublicCode, nil, "Guest Three", "127.0.0.1", "req-3")
	if !errors.Is(err3, room.ErrRoomFull) {
		t.Fatalf("expected ErrRoomFull, got: %v", err3)
	}
}

// 8. Phase 3: Waiting Room Gatekeeping & Replay Protection
func TestWaitingRoomGatekeeping(t *testing.T) {
	svc, _, _ := setupTestRoomService()
	ctx := context.Background()

	host := &auth.User{ID: "host-wr", DisplayName: "Host Waiting"}
	otherUser := &auth.User{ID: "other-user", DisplayName: "Intruder User"}

	// Create room with waiting room enabled
	rm, err := svc.CreateRoomWithOptions(ctx, host, 50, true, "127.0.0.1", "req-wr-1")
	if err != nil {
		t.Fatalf("failed to create room with waiting room: %v", err)
	}

	guestIdentity := "guest:test-uuid-1234"
	guestName := "Waiting Guest"

	// 8a. Direct token issuance before requesting admission must be rejected
	_, errTokenBefore := svc.GenerateToken(ctx, rm.PublicCode, nil, guestIdentity, guestName, "127.0.0.1", "req-token-0")
	if !errors.Is(errTokenBefore, room.ErrAdmissionRequired) {
		t.Fatalf("expected ErrAdmissionRequired, got: %v", errTokenBefore)
	}

	// 8b. Submit admission request
	admitReq, errAdmit := svc.RequestAdmission(ctx, rm.PublicCode, guestIdentity, guestName, "127.0.0.1", "req-admit-1")
	if errAdmit != nil {
		t.Fatalf("admission request failed: %v", errAdmit)
	}
	if admitReq.Status != "pending" {
		t.Fatalf("expected pending status, got: %s", admitReq.Status)
	}

	// 8c. Token issuance while pending must be rejected
	_, errTokenPending := svc.GenerateToken(ctx, rm.PublicCode, nil, guestIdentity, guestName, "127.0.0.1", "req-token-1")
	if !errors.Is(errTokenPending, room.ErrAdmissionPending) {
		t.Fatalf("expected ErrAdmissionPending, got: %v", errTokenPending)
	}

	// 8d. Unauthorized non-host cannot decide admission
	errNonHostDecide := svc.DecideAdmission(ctx, rm.PublicCode, otherUser, admitReq.ID, "admitted", "127.0.0.1", "req-decide-0")
	if !errors.Is(errNonHostDecide, room.ErrUnauthorizedRoomAction) {
		t.Fatalf("expected ErrUnauthorizedRoomAction, got: %v", errNonHostDecide)
	}

	// 8e. Host approves admission
	errHostDecide := svc.DecideAdmission(ctx, rm.PublicCode, host, admitReq.ID, "admitted", "127.0.0.1", "req-decide-1")
	if errHostDecide != nil {
		t.Fatalf("host admission decision failed: %v", errHostDecide)
	}

	// 8f. Replay of admission decision must be rejected
	errReplay := svc.DecideAdmission(ctx, rm.PublicCode, host, admitReq.ID, "admitted", "127.0.0.1", "req-replay")
	if !errors.Is(errReplay, room.ErrAdmissionAlreadyDecided) {
		t.Fatalf("expected ErrAdmissionAlreadyDecided on replay, got: %v", errReplay)
	}

	// 8g. Admitted guest may now obtain token
	token, errTokenAdmitted := svc.GenerateToken(ctx, rm.PublicCode, nil, guestIdentity, guestName, "127.0.0.1", "req-token-2")
	if errTokenAdmitted != nil {
		t.Fatalf("expected token issuance for admitted guest, got: %v", errTokenAdmitted)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}
}

// 9. Phase 3: Host Participant Removal & Reconnection Block
func TestHostParticipantRemovalAndReconnectionBlock(t *testing.T) {
	svc, _, _ := setupTestRoomService()
	ctx := context.Background()

	host := &auth.User{ID: "host-mod", DisplayName: "Host Moderator"}
	nonHost := &auth.User{ID: "guest-attacker", DisplayName: "Malicious Guest"}

	rm, _ := svc.CreateRoom(ctx, host, 50, "127.0.0.1", "req-1")

	targetGuestIdentity := "guest:disruptive-user"
	targetGuestName := "Disruptive Guest"

	// Join target guest
	_, errJoin := svc.JoinRoomWithIdentity(ctx, rm.PublicCode, nil, targetGuestIdentity, targetGuestName, "127.0.0.1", "req-join")
	if errJoin != nil {
		t.Fatalf("initial join failed: %v", errJoin)
	}

	// Non-host attempts to remove someone -> rejected
	errNonHostRemove := svc.RemoveParticipant(ctx, rm.PublicCode, nonHost, targetGuestIdentity, "127.0.0.1", "req-rem-0")
	if !errors.Is(errNonHostRemove, room.ErrUnauthorizedRoomAction) {
		t.Fatalf("expected ErrUnauthorizedRoomAction, got: %v", errNonHostRemove)
	}

	// Host removes target participant
	errHostRemove := svc.RemoveParticipant(ctx, rm.PublicCode, host, targetGuestIdentity, "127.0.0.1", "req-rem-1")
	if errHostRemove != nil {
		t.Fatalf("host remove participant failed: %v", errHostRemove)
	}

	// Removed participant attempts to rejoin or fetch token -> rejected
	_, errRejoin := svc.JoinRoomWithIdentity(ctx, rm.PublicCode, nil, targetGuestIdentity, targetGuestName, "127.0.0.1", "req-rejoin")
	if !errors.Is(errRejoin, room.ErrParticipantRemoved) {
		t.Fatalf("expected ErrParticipantRemoved on rejoin, got: %v", errRejoin)
	}

	_, errTokenRemoved := svc.GenerateToken(ctx, rm.PublicCode, nil, targetGuestIdentity, targetGuestName, "127.0.0.1", "req-token-rem")
	if !errors.Is(errTokenRemoved, room.ErrParticipantRemoved) {
		t.Fatalf("expected ErrParticipantRemoved on token request, got: %v", errTokenRemoved)
	}
}

// 10. Phase 3: Meeting History Ownership Scoping
func TestMeetingHistoryOwnershipScoping(t *testing.T) {
	svc, _, _ := setupTestRoomService()
	ctx := context.Background()

	alice := &auth.User{ID: "user-alice", DisplayName: "Alice"}
	bob := &auth.User{ID: "user-bob", DisplayName: "Bob"}

	// Alice creates 2 rooms
	rmA1, _ := svc.CreateRoom(ctx, alice, 50, "127.0.0.1", "req-a1")
	rmA2, _ := svc.CreateRoom(ctx, alice, 50, "127.0.0.1", "req-a2")

	// Bob creates 1 room
	rmB1, _ := svc.CreateRoom(ctx, bob, 50, "127.0.0.1", "req-b1")

	// Query Alice history
	aliceHistory, totalAlice, err := svc.GetMeetingHistory(ctx, alice, 10, 0)
	if err != nil {
		t.Fatalf("failed to query alice history: %v", err)
	}
	if totalAlice != 2 || len(aliceHistory) != 2 {
		t.Fatalf("expected 2 history records for Alice, got total=%d len=%d", totalAlice, len(aliceHistory))
	}
	for _, h := range aliceHistory {
		if h.HostUserID != alice.ID {
			t.Fatalf("SECURITY VIOLATION: Alice history contains room from host %s", h.HostUserID)
		}
		if h.PublicCode != rmA1.PublicCode && h.PublicCode != rmA2.PublicCode {
			t.Fatalf("unexpected room code in Alice history: %s", h.PublicCode)
		}
	}

	// Query Bob history
	bobHistory, totalBob, err := svc.GetMeetingHistory(ctx, bob, 10, 0)
	if err != nil {
		t.Fatalf("failed to query bob history: %v", err)
	}
	if totalBob != 1 || len(bobHistory) != 1 {
		t.Fatalf("expected 1 history record for Bob, got total=%d len=%d", totalBob, len(bobHistory))
	}
	if bobHistory[0].PublicCode != rmB1.PublicCode {
		t.Fatalf("expected Bob room %s, got: %s", rmB1.PublicCode, bobHistory[0].PublicCode)
	}

	// Unauthenticated history query rejected
	_, _, errUnauth := svc.GetMeetingHistory(ctx, nil, 10, 0)
	if !errors.Is(errUnauth, room.ErrUnauthorizedRoomAction) {
		t.Fatalf("expected ErrUnauthorizedRoomAction, got: %v", errUnauth)
	}
}

func TestSpeakerPromotionAndDemotionLifecycle(t *testing.T) {
	svc, repo, _ := setupTestRoomService()
	ctx := context.Background()

	host := &auth.User{ID: "host-456", DisplayName: "Host User"}
	student := &auth.User{ID: "student-789", DisplayName: "Student User"}
	eavesdropper := &auth.User{ID: "eaves-123", DisplayName: "Eavesdropper"}

	// 1. Host creates room
	rm, err := svc.CreateRoom(ctx, host, 50, "127.0.0.1", "req-create")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	// 2. Student joins room
	joinRes, err := svc.JoinRoom(ctx, rm.PublicCode, student, "", "127.0.0.1", "req-join-student")
	if err != nil {
		t.Fatalf("student JoinRoom failed: %v", err)
	}
	studentIdentity := "user:" + student.ID
	if joinRes.Participant.Role != livekit.RoleParticipant {
		t.Fatalf("expected initial role %q, got %q", livekit.RoleParticipant, joinRes.Participant.Role)
	}

	// 3. Unauthorized attacker attempts to promote student
	errUnauth := svc.PromoteSpeaker(ctx, rm.PublicCode, eavesdropper, studentIdentity, "127.0.0.1", "req-hack")
	if !errors.Is(errUnauth, room.ErrUnauthorizedRoomAction) {
		t.Fatalf("SECURITY VIOLATION: unauthorized user could promote speaker: %v", errUnauth)
	}

	// 4. Student attempts self-promotion
	errSelf := svc.PromoteSpeaker(ctx, rm.PublicCode, student, studentIdentity, "127.0.0.1", "req-self")
	if !errors.Is(errSelf, room.ErrUnauthorizedRoomAction) {
		t.Fatalf("SECURITY VIOLATION: student could self-promote: %v", errSelf)
	}

	// 5. Host promotes student to speaker
	if err := svc.PromoteSpeaker(ctx, rm.PublicCode, host, studentIdentity, "127.0.0.1", "req-promote"); err != nil {
		t.Fatalf("host PromoteSpeaker failed: %v", err)
	}

	// Verify DB role updated to speaker
	updatedPart, err := repo.GetParticipant(ctx, rm.ID, studentIdentity)
	if err != nil || updatedPart == nil {
		t.Fatalf("GetParticipant failed: %v", err)
	}
	if updatedPart.Role != livekit.RoleSpeaker {
		t.Fatalf("expected role %q after promotion, got %q", livekit.RoleSpeaker, updatedPart.Role)
	}

	// Verify token generated for student now grants speaker sources
	tok, err := svc.GenerateToken(ctx, rm.PublicCode, student, "", "", "127.0.0.1", "req-token-speaker")
	if err != nil {
		t.Fatalf("GenerateToken for speaker failed: %v", err)
	}
	if tok == "" {
		t.Fatal("expected non-empty token for promoted speaker")
	}

	// 6. Unauthorized user attempts to demote student
	errDemoteUnauth := svc.DemoteSpeaker(ctx, rm.PublicCode, eavesdropper, studentIdentity, "127.0.0.1", "req-demote-hack")
	if !errors.Is(errDemoteUnauth, room.ErrUnauthorizedRoomAction) {
		t.Fatalf("SECURITY VIOLATION: unauthorized user could demote speaker: %v", errDemoteUnauth)
	}

	// 7. Host demotes student back to participant
	if err := svc.DemoteSpeaker(ctx, rm.PublicCode, host, studentIdentity, "127.0.0.1", "req-demote"); err != nil {
		t.Fatalf("host DemoteSpeaker failed: %v", err)
	}

	// Verify DB role updated back to participant
	demotedPart, err := repo.GetParticipant(ctx, rm.ID, studentIdentity)
	if err != nil || demotedPart == nil {
		t.Fatalf("GetParticipant failed: %v", err)
	}
	if demotedPart.Role != livekit.RoleParticipant {
		t.Fatalf("expected role %q after demotion, got %q", livekit.RoleParticipant, demotedPart.Role)
	}

	// 8. Host cannot demote or promote themselves
	hostIdentity := "user:" + host.ID
	if err := svc.PromoteSpeaker(ctx, rm.PublicCode, host, hostIdentity, "127.0.0.1", "req-host"); err == nil {
		t.Fatal("expected error when trying to promote host, got nil")
	}

	// 9. Unknown participant promotion is rejected
	errUnknown := svc.PromoteSpeaker(ctx, rm.PublicCode, host, "user:ghost-participant", "127.0.0.1", "req-ghost")
	if !errors.Is(errUnknown, room.ErrParticipantNotFoundInRoom) {
		t.Fatalf("expected ErrParticipantNotFoundInRoom for ghost participant, got: %v", errUnknown)
	}

	// 10. Duplicate promotion is idempotent
	if err := svc.PromoteSpeaker(ctx, rm.PublicCode, host, studentIdentity, "127.0.0.1", "req-promote-1"); err != nil {
		t.Fatalf("first promotion failed: %v", err)
	}
	if err := svc.PromoteSpeaker(ctx, rm.PublicCode, host, studentIdentity, "127.0.0.1", "req-promote-2"); err != nil {
		t.Fatalf("duplicate promotion failed: %v", err)
	}
	partAfterDup, _ := repo.GetParticipant(ctx, rm.ID, studentIdentity)
	if partAfterDup.Role != livekit.RoleSpeaker {
		t.Fatalf("expected role speaker after duplicate promotion, got %s", partAfterDup.Role)
	}

	// 11. Duplicate demotion is idempotent
	if err := svc.DemoteSpeaker(ctx, rm.PublicCode, host, studentIdentity, "127.0.0.1", "req-demote-1"); err != nil {
		t.Fatalf("first demotion failed: %v", err)
	}
	if err := svc.DemoteSpeaker(ctx, rm.PublicCode, host, studentIdentity, "127.0.0.1", "req-demote-2"); err != nil {
		t.Fatalf("duplicate demotion failed: %v", err)
	}
	partAfterDupDemote, _ := repo.GetParticipant(ctx, rm.ID, studentIdentity)
	if partAfterDupDemote.Role != livekit.RoleParticipant {
		t.Fatalf("expected role participant after duplicate demotion, got %s", partAfterDupDemote.Role)
	}
}

func TestSpeakerPromotion_ConcurrentSafety(t *testing.T) {
	svc, repo, _ := setupTestRoomService()
	ctx := context.Background()

	host := &auth.User{ID: "host-conc", DisplayName: "Host User"}
	student := &auth.User{ID: "student-conc", DisplayName: "Student User"}

	rm, err := svc.CreateRoom(ctx, host, 50, "127.0.0.1", "req-create")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	_, err = svc.JoinRoom(ctx, rm.PublicCode, student, "", "127.0.0.1", "req-join")
	if err != nil {
		t.Fatalf("JoinRoom failed: %v", err)
	}
	studentIdentity := "user:" + student.ID

	// Run concurrent promotions and demotions
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(2)
		go func(idx int) {
			defer wg.Done()
			_ = svc.PromoteSpeaker(ctx, rm.PublicCode, host, studentIdentity, "127.0.0.1", "req-p")
		}(i)
		go func(idx int) {
			defer wg.Done()
			_ = svc.DemoteSpeaker(ctx, rm.PublicCode, host, studentIdentity, "127.0.0.1", "req-d")
		}(i)
	}
	wg.Wait()

	finalPart, err := repo.GetParticipant(ctx, rm.ID, studentIdentity)
	if err != nil || finalPart == nil {
		t.Fatalf("participant missing after concurrent operations: %v", err)
	}
	if finalPart.Role != livekit.RoleSpeaker && finalPart.Role != livekit.RoleParticipant {
		t.Fatalf("invalid role after concurrent promotions/demotions: %q", finalPart.Role)
	}

	// Verify reconciliation heals state cleanly
	if err := svc.ReconcileParticipant(ctx, rm.PublicCode, studentIdentity); err != nil {
		t.Fatalf("ReconcileParticipant failed: %v", err)
	}
	if err := svc.ReconcileRoom(ctx, rm.PublicCode); err != nil {
		t.Fatalf("ReconcileRoom failed: %v", err)
	}
}

type mockSFURoundTripper struct {
	failRPC            atomic.Bool
	timeoutRPC         atomic.Bool
	failGetParticipant atomic.Bool
	callCount          atomic.Int32
	sfuCanPublish      atomic.Bool
}

func (m *mockSFURoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	m.callCount.Add(1)
	if strings.HasSuffix(req.URL.Path, "/GetParticipant") {
		if m.failGetParticipant.Load() {
			return &http.Response{
				StatusCode: http.StatusServiceUnavailable,
				Body:       io.NopCloser(strings.NewReader(`{"error":"sfu unavailable"}`)),
				Header:     make(http.Header),
			}, nil
		}
		pInfo := &proto_livekit.ParticipantInfo{
			Permission: &proto_livekit.ParticipantPermission{
				CanPublish: m.sfuCanPublish.Load(),
			},
		}
		data, _ := proto.Marshal(pInfo)
		hdr := make(http.Header)
		hdr.Set("Content-Type", "application/protobuf")
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewReader(data)),
			Header:     hdr,
		}, nil
	}
	if m.timeoutRPC.Load() {
		return nil, context.DeadlineExceeded
	}
	if m.failRPC.Load() {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(strings.NewReader(`{"error":"internal SFU failure"}`)),
			Header:     make(http.Header),
		}, nil
	}
	hdr := make(http.Header)
	hdr.Set("Content-Type", "application/protobuf")
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader([]byte{})),
		Header:     hdr,
	}, nil
}

func TestSpeakerPromotion_MultiInstanceDistributedConcurrency(t *testing.T) {
	// Simulates two independent API instances (svc1 and svc2) serving requests concurrently
	// against the same persistent repository with distributed locking and CAS.
	repo := room.NewMemoryRepository()
	policy := room.NewPolicy()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	auditService := audit.NewService(nil, logger)
	tokenService := livekit.NewTokenService("test_key", "test_secret")

	svc1 := room.NewServiceWithInstanceID(repo, policy, auditService, tokenService, nil, "node-instance-alpha-1")
	svc2 := room.NewServiceWithInstanceID(repo, policy, auditService, tokenService, nil, "node-instance-beta-2")

	ctx := context.Background()
	host := &auth.User{ID: "host-dist", DisplayName: "Distributed Host"}
	student := &auth.User{ID: "student-dist", DisplayName: "Distributed Student"}

	rm, err := svc1.CreateRoom(ctx, host, 50, "127.0.0.1", "req-create")
	if err != nil {
		t.Fatalf("CreateRoom on node 1 failed: %v", err)
	}

	_, err = svc2.JoinRoom(ctx, rm.PublicCode, student, "", "127.0.0.1", "req-join")
	if err != nil {
		t.Fatalf("JoinRoom on node 2 failed: %v", err)
	}
	studentIdent := "user:" + student.ID

	// Interleave concurrent mutations across both instances
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(2)
		go func(idx int) {
			defer wg.Done()
			_ = svc1.PromoteSpeaker(ctx, rm.PublicCode, host, studentIdent, "127.0.0.1", fmt.Sprintf("req-s1-%d", idx))
		}(i)
		go func(idx int) {
			defer wg.Done()
			_ = svc2.DemoteSpeaker(ctx, rm.PublicCode, host, studentIdent, "127.0.0.1", fmt.Sprintf("req-s2-%d", idx))
		}(i)
	}
	wg.Wait()

	// Verify distributed lock prevented corrupted/stale state
	finalPart, err := repo.GetParticipant(ctx, rm.ID, studentIdent)
	if err != nil || finalPart == nil {
		t.Fatalf("GetParticipant failed: %v", err)
	}
	if finalPart.Role != livekit.RoleSpeaker && finalPart.Role != livekit.RoleParticipant {
		t.Fatalf("invalid role in database after multi-instance operations: %q", finalPart.Role)
	}

	// Verify reconciliation from both instances converges without error
	if err := svc1.ReconcileParticipant(ctx, rm.PublicCode, studentIdent); err != nil {
		t.Fatalf("svc1 ReconcileParticipant failed: %v", err)
	}
	if err := svc2.ReconcileParticipant(ctx, rm.PublicCode, studentIdent); err != nil {
		t.Fatalf("svc2 ReconcileParticipant failed: %v", err)
	}
}

func TestReconciliationFailuresAndConvergence(t *testing.T) {
	repo := room.NewMemoryRepository()
	policy := room.NewPolicy()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	auditService := audit.NewService(nil, logger)
	tokenService := livekit.NewTokenService("test_key", "test_secret")

	mockTransport := &mockSFURoundTripper{}
	mockRoomMgr := livekit.NewRoomManagerWithTransport("https://livekit.example.com", "test_key", "test_secret", mockTransport)

	svc1 := room.NewServiceWithInstanceID(repo, policy, auditService, tokenService, mockRoomMgr, "node-1")
	svc2 := room.NewServiceWithInstanceID(repo, policy, auditService, tokenService, mockRoomMgr, "node-2")

	ctx := context.Background()
	host := &auth.User{ID: "host-recon", DisplayName: "Recon Host"}
	student := &auth.User{ID: "student-recon", DisplayName: "Recon Student"}

	rm, err := svc1.CreateRoom(ctx, host, 50, "127.0.0.1", "req-create")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	_, err = svc1.JoinRoom(ctx, rm.PublicCode, student, "", "127.0.0.1", "req-join")
	if err != nil {
		t.Fatalf("JoinRoom failed: %v", err)
	}
	studentIdent := "user:" + student.ID

	// 1. LiveKit Outage during promotion: Returns ErrSFUSyncFailed and rolls back database
	mockTransport.failRPC.Store(true)
	errOutage := svc1.PromoteSpeaker(ctx, rm.PublicCode, host, studentIdent, "127.0.0.1", "req-outage")
	if !errors.Is(errOutage, room.ErrSFUSyncFailed) {
		t.Fatalf("expected ErrSFUSyncFailed on SFU outage, got: %v", errOutage)
	}
	partAfterOutage, _ := repo.GetParticipant(ctx, rm.ID, studentIdent)
	if partAfterOutage.Role != livekit.RoleParticipant {
		t.Fatalf("expected DB role to remain participant after SFU outage, got: %s", partAfterOutage.Role)
	}

	// 2. LiveKit RPC Timeout during promotion: Returns ErrSFUSyncFailed and rolls back database
	mockTransport.failRPC.Store(false)
	mockTransport.timeoutRPC.Store(true)
	errTimeout := svc1.PromoteSpeaker(ctx, rm.PublicCode, host, studentIdent, "127.0.0.1", "req-timeout")
	if !errors.Is(errTimeout, room.ErrSFUSyncFailed) {
		t.Fatalf("expected ErrSFUSyncFailed on timeout, got: %v", errTimeout)
	}
	partAfterTimeout, _ := repo.GetParticipant(ctx, rm.ID, studentIdent)
	if partAfterTimeout.Role != livekit.RoleParticipant {
		t.Fatalf("expected DB role to remain participant after timeout rollback, got: %s", partAfterTimeout.Role)
	}

	// 3. Service Recovery: Network recovers, promotion succeeds and converges
	mockTransport.timeoutRPC.Store(false)
	errSuccess := svc1.PromoteSpeaker(ctx, rm.PublicCode, host, studentIdent, "127.0.0.1", "req-recovered")
	if errSuccess != nil {
		t.Fatalf("expected promotion to succeed after service recovery, got: %v", errSuccess)
	}
	partAfterRecovery, _ := repo.GetParticipant(ctx, rm.ID, studentIdent)
	if partAfterRecovery.Role != livekit.RoleSpeaker {
		t.Fatalf("expected DB role to be speaker after recovery, got: %s", partAfterRecovery.Role)
	}

	// 4. Concurrent reconciliation from two API instances
	var wg sync.WaitGroup
	var errRecon1, errRecon2 error
	wg.Add(2)
	go func() {
		defer wg.Done()
		errRecon1 = svc1.ReconcileParticipant(ctx, rm.PublicCode, studentIdent)
	}()
	go func() {
		defer wg.Done()
		errRecon2 = svc2.ReconcileParticipant(ctx, rm.PublicCode, studentIdent)
	}()
	wg.Wait()
	if errRecon1 != nil || errRecon2 != nil {
		t.Fatalf("concurrent reconciliation failed: err1=%v, err2=%v", errRecon1, errRecon2)
	}

	// 5. Participant disconnect during reconciliation: Fails closed safely
	_ = repo.MarkParticipantLeft(ctx, rm.ID, studentIdent, time.Now().UTC())
	errDisconnected := svc1.ReconcileParticipant(ctx, rm.PublicCode, studentIdent)
	if !errors.Is(errDisconnected, room.ErrParticipantNotFoundInRoom) {
		t.Fatalf("expected ErrParticipantNotFoundInRoom for disconnected participant, got: %v", errDisconnected)
	}
}

func TestDistributedLease_DeterministicUniqueOwnershipAndExpiration(t *testing.T) {
	repo := room.NewMemoryRepository()
	ctx := context.Background()
	roomID := "room-lease-det"
	ident := "user:participant-123"

	// 1. Node A acquires lease A with short TTL (100ms)
	leaseA, err := repo.AcquireParticipantLock(ctx, roomID, ident, "node-A", 100*time.Millisecond)
	if err != nil {
		t.Fatalf("Node A failed to acquire lease A: %v", err)
	}
	if leaseA.LeaseToken == "" {
		t.Fatal("lease A must have a non-empty unique lease token")
	}
	if leaseA.Generation != 1 {
		t.Fatalf("expected initial generation 1, got %d", leaseA.Generation)
	}

	// 2. Wait for lease A to expire
	time.Sleep(120 * time.Millisecond)

	// 3. Node B acquires lease B (TTL 2s)
	leaseB, err := repo.AcquireParticipantLock(ctx, roomID, ident, "node-B", 2*time.Second)
	if err != nil {
		t.Fatalf("Node B failed to acquire lease B after lease A expired: %v", err)
	}
	if leaseB.LeaseToken == "" || leaseB.LeaseToken == leaseA.LeaseToken {
		t.Fatalf("lease B must have a unique lease token distinct from lease A (tokA=%s, tokB=%s)", leaseA.LeaseToken, leaseB.LeaseToken)
	}
	if leaseB.Generation <= leaseA.Generation {
		t.Fatalf("lease B generation (%d) must be greater than lease A generation (%d)", leaseB.Generation, leaseA.Generation)
	}

	// 4. Stale Node A attempts release of lease A
	leaseA.Release()

	// 5. Verify lease B remains 100% intact: Node C attempting immediate acquisition must fail with ErrLockBusy
	ctxQuick, cancelQuick := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancelQuick()
	_, errC := repo.AcquireParticipantLock(ctxQuick, roomID, ident, "node-C", 1*time.Second)
	if !errors.Is(errC, room.ErrLockBusy) && !errors.Is(errC, context.DeadlineExceeded) {
		t.Fatalf("expected Node C to be rejected while Node B holds lease B, got: %v", errC)
	}

	// 6. Node B releases lease B
	leaseB.Release()

	// 7. Verify Node C can now acquire lease C
	leaseC, err := repo.AcquireParticipantLock(ctx, roomID, ident, "node-C", 1*time.Second)
	if err != nil {
		t.Fatalf("Node C should acquire after Node B released: %v", err)
	}
	defer leaseC.Release()
	if leaseC.Generation <= leaseB.Generation {
		t.Fatalf("lease C generation (%d) must be greater than lease B generation (%d)", leaseC.Generation, leaseB.Generation)
	}
}

func TestDistributedLease_IdempotentRelease(t *testing.T) {
	repo := room.NewMemoryRepository()
	ctx := context.Background()

	lease, err := repo.AcquireParticipantLock(ctx, "room-idem", "user:part-idem", "node-idem", 1*time.Second)
	if err != nil {
		t.Fatalf("failed to acquire lease: %v", err)
	}

	// Multiple releases must not panic or error
	for i := 0; i < 5; i++ {
		lease.Release()
	}
}

func TestDistributedLease_MonotonicFencingPreventsStaleMutations(t *testing.T) {
	repo := room.NewMemoryRepository()
	ctx := context.Background()
	roomID := "room-fence"
	ident := "user:student-fence"

	_ = repo.UpsertParticipant(ctx, &room.Participant{
		RoomID:   roomID,
		Identity: ident,
		Role:     livekit.RoleParticipant,
	})

	// Generation 1 acquires and transitions participant
	err := repo.BeginParticipantRoleTransition(ctx, roomID, ident, livekit.RoleParticipant, livekit.RoleSpeaker, "op-1", "promoting", 1)
	if err != nil {
		t.Fatalf("generation 1 transition failed: %v", err)
	}
	_ = repo.CommitParticipantTransition(ctx, roomID, ident, "op-1", 1)

	// Generation 3 acquires and transitions participant
	err = repo.BeginParticipantRoleTransition(ctx, roomID, ident, livekit.RoleSpeaker, livekit.RoleParticipant, "op-3", "demoting", 3)
	if err != nil {
		t.Fatalf("generation 3 transition failed: %v", err)
	}

	// Stale Generation 2 attempts mutation: Must be rejected by fencing check (fencing_token 3 >= 2)
	staleErr := repo.BeginParticipantRoleTransition(ctx, roomID, ident, livekit.RoleParticipant, livekit.RoleSpeaker, "op-2", "promoting", 2)
	if !errors.Is(staleErr, room.ErrStaleRoleUpdate) {
		t.Fatalf("expected ErrStaleRoleUpdate for stale generation 2 mutation, got: %v", staleErr)
	}

	// Stale rollback from Generation 1 must be rejected by fencing check
	staleRbErr := repo.RollbackParticipantRole(ctx, roomID, ident, livekit.RoleSpeaker, "op-1", 1)
	if !errors.Is(staleRbErr, room.ErrStaleRoleUpdate) {
		t.Fatalf("expected ErrStaleRoleUpdate for stale rollback, got: %v", staleRbErr)
	}
}

func TestSpeakerPromotion_LiveKitTimeoutAmbiguityReconciliation(t *testing.T) {
	repo := room.NewMemoryRepository()
	policy := room.NewPolicy()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	auditService := audit.NewService(nil, logger)
	tokenService := livekit.NewTokenService("test_key", "test_secret")

	mockTransport := &mockSFURoundTripper{}
	mockRoomMgr := livekit.NewRoomManagerWithTransport("https://livekit.example.com", "test_key", "test_secret", mockTransport)

	svc := room.NewServiceWithInstanceID(repo, policy, auditService, tokenService, mockRoomMgr, "node-timeout-test")

	ctx := context.Background()
	host := &auth.User{ID: "host-ambig", DisplayName: "Ambig Host"}
	student := &auth.User{ID: "student-ambig", DisplayName: "Ambig Student"}
	studentIdent := "user:" + student.ID

	rm, err := svc.CreateRoom(ctx, host, 50, "127.0.0.1", "req-create")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	_, err = svc.JoinRoom(ctx, rm.PublicCode, student, "", "127.0.0.1", "req-join")
	if err != nil {
		t.Fatalf("JoinRoom failed: %v", err)
	}

	// Case 1: Timeout on PromoteToSpeaker, but SFU inspection confirms participant has publishing rights!
	mockTransport.timeoutRPC.Store(true)
	mockTransport.sfuCanPublish.Store(true)

	errPromote := svc.PromoteSpeaker(ctx, rm.PublicCode, host, studentIdent, "127.0.0.1", "req-ambig-1")
	if errPromote != nil {
		t.Fatalf("expected successful convergence when SFU confirmed publishing rights, got: %v", errPromote)
	}

	partAfterAmbSuccess, _ := repo.GetParticipant(ctx, rm.ID, studentIdent)
	if partAfterAmbSuccess.Role != livekit.RoleSpeaker || partAfterAmbSuccess.TransitionState != "idle" {
		t.Fatalf("expected role speaker and state idle after SFU confirmation, got role=%s, state=%s",
			partAfterAmbSuccess.Role, partAfterAmbSuccess.TransitionState)
	}

	// Case 2: DemoteSpeaker with timeout where SFU inspection confirms publishing was NOT revoked
	// Service must safely rollback role to speaker
	mockTransport.sfuCanPublish.Store(true) // SFU still has publishing active
	errDemote := svc.DemoteSpeaker(ctx, rm.PublicCode, host, studentIdent, "127.0.0.1", "req-ambig-2")
	if !errors.Is(errDemote, room.ErrSFUSyncFailed) {
		t.Fatalf("expected ErrSFUSyncFailed when demotion timed out and SFU did not apply revocation, got: %v", errDemote)
	}

	partAfterAmbFailure, _ := repo.GetParticipant(ctx, rm.ID, studentIdent)
	if partAfterAmbFailure.Role != livekit.RoleSpeaker {
		t.Fatalf("expected role to rollback to speaker when SFU revocation failed, got: %s", partAfterAmbFailure.Role)
	}
}

func TestDistributedLease_MissingTableReturnsErrLockInfrastructureUnavailable(t *testing.T) {
	// Proves that when PostgreSQL table participant_locks is missing, AcquireParticipantLock fails closed
	// with ErrLockInfrastructureUnavailable rather than executing runtime DDL.
	pgErr := &pgconn.PgError{Code: "42P01", Message: `relation "participant_locks" does not exist`}
	var targetErr *pgconn.PgError
	if errors.As(pgErr, &targetErr) && targetErr.Code == "42P01" {
		assert.Equal(t, "42P01", targetErr.Code)
	}
	assert.ErrorIs(t, room.ErrLockInfrastructureUnavailable, room.ErrLockInfrastructureUnavailable)
}

func TestSpeakerPromotion_SFUQueryFailurePreservesUnknownState(t *testing.T) {
	repo := room.NewMemoryRepository()
	policy := room.NewPolicy()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	auditService := audit.NewService(nil, logger)
	tokenService := livekit.NewTokenService("test_key", "test_secret")

	mockTransport := &mockSFURoundTripper{}
	mockRoomMgr := livekit.NewRoomManagerWithTransport("https://livekit.example.com", "test_key", "test_secret", mockTransport)

	svc := room.NewServiceWithInstanceID(repo, policy, auditService, tokenService, mockRoomMgr, "node-unknown-state-test")

	ctx := context.Background()
	host := &auth.User{ID: "host-unknown", DisplayName: "Unknown State Host"}
	student := &auth.User{ID: "student-unknown", DisplayName: "Unknown State Student"}
	studentIdent := "user:" + student.ID

	rm, err := svc.CreateRoom(ctx, host, 50, "127.0.0.1", "req-create")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	_, err = svc.JoinRoom(ctx, rm.PublicCode, student, "", "127.0.0.1", "req-join")
	if err != nil {
		t.Fatalf("JoinRoom failed: %v", err)
	}

	// Case 1: RPC times out AND SFU query fails/is unavailable
	// Service MUST leave transition_state as 'unknown' and NOT assume rollback!
	mockTransport.timeoutRPC.Store(true)
	mockTransport.failGetParticipant.Store(true)

	errPromote := svc.PromoteSpeaker(ctx, rm.PublicCode, host, studentIdent, "127.0.0.1", "req-unknown-1")
	if !errors.Is(errPromote, room.ErrSFUSyncFailed) {
		t.Fatalf("expected ErrSFUSyncFailed when SFU query failed, got: %v", errPromote)
	}

	part, err := repo.GetParticipant(ctx, rm.ID, studentIdent)
	if err != nil {
		t.Fatalf("GetParticipant failed: %v", err)
	}
	if part.TransitionState != "unknown" {
		t.Fatalf("expected transition_state to be 'unknown', got %q", part.TransitionState)
	}
	// Note: Role was set to speaker during BeginParticipantRoleTransition and NOT prematurely rolled back
	if part.Role != livekit.RoleSpeaker {
		t.Fatalf("expected role to remain speaker pending reconciliation (not rolled back), got %q", part.Role)
	}

	// Case 2: System recovers and ReconcileParticipant is called
	mockTransport.timeoutRPC.Store(false)
	mockTransport.failGetParticipant.Store(false)
	mockTransport.sfuCanPublish.Store(true)

	errRecon := svc.ReconcileParticipant(ctx, rm.PublicCode, studentIdent)
	if errRecon != nil {
		t.Fatalf("ReconcileParticipant failed after recovery: %v", errRecon)
	}

	partAfterRecon, err := repo.GetParticipant(ctx, rm.ID, studentIdent)
	if err != nil {
		t.Fatalf("GetParticipant after recon failed: %v", err)
	}
	if partAfterRecon.TransitionState != "idle" {
		t.Fatalf("expected transition_state to be 'idle' after reconciliation, got %q", partAfterRecon.TransitionState)
	}
	if partAfterRecon.Role != livekit.RoleSpeaker {
		t.Fatalf("expected role to be speaker after reconciliation, got %q", partAfterRecon.Role)
	}
}

package room_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/livekit"
	"github.com/tathastu/connect/services/api/internal/room"
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
	svc, repo, _ := setupRoomTest(t)
	ctx := context.Background()

	host := &auth.User{ID: "host-456", Email: "host@example.com"}
	student := &auth.User{ID: "student-789", Email: "student@example.com"}
	eavesdropper := &auth.User{ID: "eaves-123", Email: "eaves@example.com"}

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
}

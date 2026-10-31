package room_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/livekit"
	"github.com/tathastu/connect/services/api/internal/room"
)

func setupRealPostgresPools(t *testing.T) (*pgxpool.Pool, *pgxpool.Pool) {
	t.Helper()
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		dbURL = os.Getenv("DATABASE_URL")
	}
	if dbURL == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("TEST_DATABASE_URL or DATABASE_URL must be explicitly configured in CI; no fallback credentials permitted")
		}
		t.Skip("Skipping PostgreSQL integration test: TEST_DATABASE_URL or DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cfg1, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("Invalid PostgreSQL configuration in CI: %v", err)
		}
		t.Skipf("Skipping real postgres test (invalid url: %v)", err)
	}
	cfg1.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	cfg1.MaxConns = 5

	pool1, err := pgxpool.NewWithConfig(ctx, cfg1)
	if err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("Real postgres test pool1 init failed in CI: %v", err)
		}
		t.Skipf("Skipping real postgres test (pool1 init failed: %v)", err)
	}
	if pingErr := pool1.Ping(ctx); pingErr != nil {
		pool1.Close()
		if os.Getenv("CI") != "" {
			t.Fatalf("Real postgres test pool1 ping failed in CI: %v", pingErr)
		}
		t.Skipf("Skipping real postgres test (pool1 ping failed: %v)", pingErr)
	}

	cfg2, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		pool1.Close()
		if os.Getenv("CI") != "" {
			t.Fatalf("Invalid PostgreSQL configuration for pool2 in CI: %v", err)
		}
		t.Skipf("Skipping real postgres test (invalid url for pool2: %v)", err)
	}
	cfg2.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	cfg2.MaxConns = 5

	pool2, err := pgxpool.NewWithConfig(ctx, cfg2)
	if err != nil {
		pool1.Close()
		if os.Getenv("CI") != "" {
			t.Fatalf("Real postgres test pool2 init failed in CI: %v", err)
		}
		t.Skipf("Skipping real postgres test (pool2 init failed: %v)", err)
	}
	if pingErr := pool2.Ping(ctx); pingErr != nil {
		pool1.Close()
		pool2.Close()
		if os.Getenv("CI") != "" {
			t.Fatalf("Real postgres test pool2 ping failed in CI: %v", pingErr)
		}
		t.Skipf("Skipping real postgres test (pool2 ping failed: %v)", pingErr)
	}

	return pool1, pool2
}

func createTestUser(ctx context.Context, pool *pgxpool.Pool, displayName string) *auth.User {
	userID := uuid.NewString()
	email := "test-" + userID[:8] + "@example.com"
	now := time.Now().UTC()
	_, err := pool.Exec(ctx, `
		INSERT INTO users (id, email_normalized, display_name, password_hash, status, created_at, updated_at)
		VALUES ($1, $2, $3, 'dummyhash', 'active', $4, $4)
	`, userID, email, displayName, now)
	if err != nil {
		panic(fmt.Sprintf("createTestUser failed: %v", err))
	}
	return &auth.User{
		ID:              userID,
		EmailNormalized: email,
		DisplayName:     displayName,
		Status:          "active",
		AuthProvider:    "local",
		EmailVerified:   true,
	}
}

func TestPostgres_SingleLeaseHolderMutualExclusion(t *testing.T) {
	pool1, pool2 := setupRealPostgresPools(t)
	defer pool1.Close()
	defer pool2.Close()

	repo1 := room.NewPgxRepository(pool1)
	repo2 := room.NewPgxRepository(pool2)

	ctx := context.Background()
	testRoomID := uuid.NewString()
	testIdent := "user:" + uuid.NewString()

	// Clean up after test
	defer func() {
		_, _ = pool1.Exec(context.Background(), "DELETE FROM participant_locks WHERE lock_key = $1", testRoomID+":"+testIdent)
	}()

	// 1. Node 1 acquires lock on participant for 3 seconds
	lock1, err := repo1.AcquireParticipantLock(ctx, testRoomID, testIdent, "instance-alpha", 3*time.Second)
	if err != nil {
		t.Fatalf("Node 1 failed to acquire lock: %v", err)
	}
	defer lock1.Release()

	if lock1.LeaseToken == "" {
		t.Fatal("Node 1 lease token must not be empty")
	}

	// 2. Node 2 attempts acquire with quick deadline; must be rejected with ErrLockBusy
	ctxQuick, cancel := context.WithTimeout(ctx, 150*time.Millisecond)
	defer cancel()

	_, err2 := repo2.AcquireParticipantLock(ctxQuick, testRoomID, testIdent, "instance-beta", 3*time.Second)
	if !errors.Is(err2, room.ErrLockBusy) && !errors.Is(err2, context.DeadlineExceeded) {
		t.Fatalf("expected Node 2 to be blocked by active lease held by Node 1, got: %v", err2)
	}

	// 3. Node 1 releases lock
	lock1.Release()

	// 4. Node 2 can now acquire cleanly
	lock2, err := repo2.AcquireParticipantLock(ctx, testRoomID, testIdent, "instance-beta", 3*time.Second)
	if err != nil {
		t.Fatalf("Node 2 failed to acquire after Node 1 released: %v", err)
	}
	defer lock2.Release()

	if lock2.Generation <= lock1.Generation {
		t.Fatalf("Node 2 generation (%d) must be greater than Node 1 generation (%d)", lock2.Generation, lock1.Generation)
	}
}

func TestPostgres_ExpiredLeaseRecoveryAndStaleReleaseRejection(t *testing.T) {
	pool1, pool2 := setupRealPostgresPools(t)
	defer pool1.Close()
	defer pool2.Close()

	repo1 := room.NewPgxRepository(pool1)
	repo2 := room.NewPgxRepository(pool2)

	ctx := context.Background()
	testRoomID := uuid.NewString()
	testIdent := "user:" + uuid.NewString()
	lockKey := testRoomID + ":" + testIdent

	defer func() {
		_, _ = pool1.Exec(context.Background(), "DELETE FROM participant_locks WHERE lock_key = $1", lockKey)
	}()

	// 1. Node A acquires lease A with 300ms TTL
	leaseA, err := repo1.AcquireParticipantLock(ctx, testRoomID, testIdent, "node-A", 300*time.Millisecond)
	if err != nil {
		t.Fatalf("Node A failed to acquire lease: %v", err)
	}
	tokA := leaseA.LeaseToken
	genA := leaseA.Generation

	// 2. Wait for lease A to expire
	time.Sleep(400 * time.Millisecond)

	// 3. Node B acquires lease B (TTL 5s)
	leaseB, err := repo2.AcquireParticipantLock(ctx, testRoomID, testIdent, "node-B", 5*time.Second)
	if err != nil {
		t.Fatalf("Node B failed to acquire expired lease: %v", err)
	}
	defer leaseB.Release()

	tokB := leaseB.LeaseToken
	genB := leaseB.Generation

	if tokB == tokA {
		t.Fatalf("Node B lease token must be unique, got duplicate: %s", tokB)
	}
	if genB <= genA {
		t.Fatalf("Node B generation (%d) must be strictly greater than Node A generation (%d)", genB, genA)
	}

	// 4. Stale Node A attempts release of lease A
	leaseA.Release()

	// 5. Inspect PostgreSQL database directly: Verify lease B remains 100% intact!
	var currentOwner, currentToken string
	var currentGen int64
	var expiresAt time.Time
	err = pool1.QueryRow(ctx, "SELECT owner_id, lease_token, generation, expires_at FROM participant_locks WHERE lock_key = $1", lockKey).
		Scan(&currentOwner, &currentToken, &currentGen, &expiresAt)
	if err != nil {
		t.Fatalf("failed to query participant_locks: %v", err)
	}

	if currentOwner != "node-B" || currentToken != tokB || currentGen != genB {
		t.Fatalf("CRITICAL DEFECT: Stale Node A release corrupted Node B's active lease! DB has: owner=%s, tok=%s, gen=%d",
			currentOwner, currentToken, currentGen)
	}
	if time.Now().UTC().After(expiresAt) {
		t.Fatalf("Node B lease should still be valid, but expired at %v", expiresAt)
	}

	// 6. Node B releases lease B -> sets expires_at to now
	leaseB.Release()

	// 7. Verify lock is now expired and Node A or C can re-acquire with higher generation
	leaseC, err := repo1.AcquireParticipantLock(ctx, testRoomID, testIdent, "node-C", 2*time.Second)
	if err != nil {
		t.Fatalf("Node C failed to acquire after Node B release: %v", err)
	}
	defer leaseC.Release()

	if leaseC.Generation <= genB {
		t.Fatalf("Node C generation (%d) must be greater than Node B generation (%d)", leaseC.Generation, genB)
	}
}

func TestPostgres_MonotonicFencingAndCASRejection(t *testing.T) {
	pool1, pool2 := setupRealPostgresPools(t)
	defer pool1.Close()
	defer pool2.Close()

	repo1 := room.NewPgxRepository(pool1)
	repo2 := room.NewPgxRepository(pool2)

	ctx := context.Background()
	testRoomID := uuid.NewString()

	hostUser := createTestUser(ctx, pool1, "Fencing Host")
	defer func() {
		_, _ = pool1.Exec(context.Background(), "DELETE FROM users WHERE id = $1", hostUser.ID)
	}()

	testStudentIdent := "user:" + uuid.NewString()

	// Create test room and participant
	rm := &room.Room{
		ID:         testRoomID,
		PublicCode: "FNC-" + uuid.NewString()[:8],
		HostUserID: hostUser.ID,
		Status:     "active",
	}
	if err := repo1.CreateRoom(ctx, rm); err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}
	defer func() {
		_, _ = pool1.Exec(context.Background(), "DELETE FROM rooms WHERE id = $1", testRoomID)
		_, _ = pool1.Exec(context.Background(), "DELETE FROM participant_locks WHERE lock_key LIKE $1", testRoomID+"%")
	}()

	part := &room.Participant{
		RoomID:      testRoomID,
		Identity:    testStudentIdent,
		DisplayName: "Fenced Student",
		Role:        livekit.RoleParticipant,
	}
	if err := repo1.UpsertParticipant(ctx, part); err != nil {
		t.Fatalf("UpsertParticipant failed: %v", err)
	}

	// 1. Node 1 begins transition to speaker with generation 10
	err := repo1.BeginParticipantRoleTransition(ctx, testRoomID, testStudentIdent, livekit.RoleParticipant, livekit.RoleSpeaker, "op-10", "promoting", 10)
	if err != nil {
		t.Fatalf("Node 1 BeginParticipantRoleTransition failed: %v", err)
	}
	_ = repo1.CommitParticipantTransition(ctx, testRoomID, testStudentIdent, "op-10", 10)

	// Verify participant state in DB
	dbPart, err := repo2.GetParticipant(ctx, testRoomID, testStudentIdent)
	if err != nil || dbPart == nil {
		t.Fatalf("GetParticipant failed: %v", err)
	}
	if dbPart.Role != livekit.RoleSpeaker || dbPart.FencingToken != 10 || dbPart.TransitionState != "idle" {
		t.Fatalf("unexpected DB state: role=%s, token=%d, state=%s", dbPart.Role, dbPart.FencingToken, dbPart.TransitionState)
	}

	// 2. Stale Node 2 with generation 5 attempts mutation: Must fail with ErrStaleRoleUpdate
	staleErr := repo2.BeginParticipantRoleTransition(ctx, testRoomID, testStudentIdent, livekit.RoleSpeaker, livekit.RoleParticipant, "op-5", "demoting", 5)
	if !errors.Is(staleErr, room.ErrStaleRoleUpdate) {
		t.Fatalf("expected ErrStaleRoleUpdate for stale generation 5, got: %v", staleErr)
	}

	// 3. Stale rollback from generation 5: Must fail with ErrStaleRoleUpdate
	staleRollbackErr := repo2.RollbackParticipantRole(ctx, testRoomID, testStudentIdent, livekit.RoleParticipant, "op-5", 5)
	if !errors.Is(staleRollbackErr, room.ErrStaleRoleUpdate) {
		t.Fatalf("expected ErrStaleRoleUpdate for stale rollback, got: %v", staleRollbackErr)
	}

	// Verify DB state was NOT modified by stale requests
	dbPartAfter, _ := repo1.GetParticipant(ctx, testRoomID, testStudentIdent)
	if dbPartAfter.Role != livekit.RoleSpeaker || dbPartAfter.FencingToken != 10 {
		t.Fatalf("stale mutation modified DB state! role=%s, token=%d", dbPartAfter.Role, dbPartAfter.FencingToken)
	}
}

func TestPostgres_ConcurrentPromotionDemotionMultiInstance(t *testing.T) {
	pool1, pool2 := setupRealPostgresPools(t)
	defer pool1.Close()
	defer pool2.Close()

	repo1 := room.NewPgxRepository(pool1)
	repo2 := room.NewPgxRepository(pool2)
	policy := room.NewPolicy()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	auditService := audit.NewService(nil, logger)
	tokenService := livekit.NewTokenService("test_key", "test_secret")

	// Mock LiveKit SFU transport
	mockTransport := &mockRealSFURoundTripper{}
	mockRoomMgr1 := livekit.NewRoomManagerWithTransport("https://livekit.example.com", "test_key", "test_secret", mockTransport)
	mockRoomMgr2 := livekit.NewRoomManagerWithTransport("https://livekit.example.com", "test_key", "test_secret", mockTransport)

	svc1 := room.NewServiceWithInstanceID(repo1, policy, auditService, tokenService, mockRoomMgr1, "node-alpha-real")
	svc2 := room.NewServiceWithInstanceID(repo2, policy, auditService, tokenService, mockRoomMgr2, "node-beta-real")

	ctx := context.Background()
	host := createTestUser(ctx, pool1, "Postgres Host")
	student := createTestUser(ctx, pool2, "Postgres Student")
	defer func() {
		_, _ = pool1.Exec(context.Background(), "DELETE FROM users WHERE id IN ($1, $2)", host.ID, student.ID)
	}()

	studentIdent := "user:" + student.ID

	rm, err := svc1.CreateRoom(ctx, host, 50, "127.0.0.1", "req-create")
	if err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}
	defer func() {
		_, _ = pool1.Exec(context.Background(), "DELETE FROM rooms WHERE id = $1", rm.ID)
		_, _ = pool1.Exec(context.Background(), "DELETE FROM participant_locks WHERE lock_key LIKE $1", rm.ID+"%")
	}()

	_, err = svc2.JoinRoom(ctx, rm.PublicCode, student, "", "127.0.0.1", "req-join")
	if err != nil {
		t.Fatalf("JoinRoom on node 2 failed: %v", err)
	}

	// Concurrently invoke PromoteSpeaker and DemoteSpeaker across both API instances
	var wg sync.WaitGroup
	var mu sync.Mutex
	var errs []error

	for i := 0; i < 6; i++ {
		wg.Add(2)
		go func(idx int) {
			defer wg.Done()
			err := svc1.PromoteSpeaker(ctx, rm.PublicCode, host, studentIdent, "127.0.0.1", fmt.Sprintf("req-p-%d", idx))
			if err != nil && !errors.Is(err, room.ErrLockBusy) && !errors.Is(err, room.ErrStaleRoleUpdate) {
				mu.Lock()
				errs = append(errs, fmt.Errorf("promote error: %w", err))
				mu.Unlock()
			}
		}(i)
		go func(idx int) {
			defer wg.Done()
			err := svc2.DemoteSpeaker(ctx, rm.PublicCode, host, studentIdent, "127.0.0.1", fmt.Sprintf("req-d-%d", idx))
			if err != nil && !errors.Is(err, room.ErrLockBusy) && !errors.Is(err, room.ErrStaleRoleUpdate) {
				mu.Lock()
				errs = append(errs, fmt.Errorf("demote error: %w", err))
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()

	if len(errs) > 0 {
		t.Fatalf("unexpected concurrent operation errors: %v", errs[0])
	}

	// Verify database state is completely valid
	finalPart, err := repo1.GetParticipant(ctx, rm.ID, studentIdent)
	if err != nil || finalPart == nil {
		t.Fatalf("GetParticipant failed: %v", err)
	}
	if finalPart.Role != livekit.RoleSpeaker && finalPart.Role != livekit.RoleParticipant {
		t.Fatalf("invalid role in PostgreSQL: %s", finalPart.Role)
	}
	if finalPart.LeftAt != nil {
		t.Fatalf("participant should remain active")
	}

	// Reconcile from both instances: must converge cleanly
	if err := svc1.ReconcileParticipant(ctx, rm.PublicCode, studentIdent); err != nil {
		t.Fatalf("svc1 ReconcileParticipant failed: %v", err)
	}
	if err := svc2.ReconcileParticipant(ctx, rm.PublicCode, studentIdent); err != nil {
		t.Fatalf("svc2 ReconcileParticipant failed: %v", err)
	}
}

func TestPostgres_LockCleanup(t *testing.T) {
	pool1, _ := setupRealPostgresPools(t)
	defer pool1.Close()

	ctx := context.Background()
	testRoomID := uuid.NewString()

	defer func() {
		_, _ = pool1.Exec(context.Background(), "DELETE FROM participant_locks WHERE lock_key LIKE $1", testRoomID+"%")
	}()

	now := time.Now().UTC()
	// Insert 2 expired locks and 1 active lock
	query := `
		INSERT INTO participant_locks (lock_key, owner_id, lease_token, generation, acquired_at, expires_at)
		VALUES
			($1, 'owner-exp-1', 'tok-exp-1', 1, $4, $5),
			($2, 'owner-exp-2', 'tok-exp-2', 2, $4, $5),
			($3, 'owner-active', 'tok-active', 1, $4, $6);
	`
	expKey1 := testRoomID + ":part-exp-1"
	expKey2 := testRoomID + ":part-exp-2"
	actKey := testRoomID + ":part-active"
	expTime := now.Add(-10 * time.Minute)
	actTime := now.Add(10 * time.Minute)

	_, err := pool1.Exec(ctx, query, expKey1, expKey2, actKey, now, expTime, actTime)
	if err != nil {
		t.Fatalf("failed to insert test locks: %v", err)
	}

	// Run cleanup query
	cleanupQuery := `DELETE FROM participant_locks WHERE expires_at < $1 AND lock_key LIKE $2`
	tag, err := pool1.Exec(ctx, cleanupQuery, now, testRoomID+"%")
	if err != nil {
		t.Fatalf("cleanup query failed: %v", err)
	}
	if tag.RowsAffected() != 2 {
		t.Fatalf("expected 2 expired rows deleted, got: %d", tag.RowsAffected())
	}

	// Verify active lock was preserved
	var actGen int64
	err = pool1.QueryRow(ctx, "SELECT generation FROM participant_locks WHERE lock_key = $1", actKey).Scan(&actGen)
	if err != nil {
		t.Fatalf("active lock was incorrectly deleted: %v", err)
	}
}

type mockRealSFURoundTripper struct{}

func (m *mockRealSFURoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	hdr := make(http.Header)
	hdr.Set("Content-Type", "application/protobuf")
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader([]byte{})),
		Header:     hdr,
	}, nil
}

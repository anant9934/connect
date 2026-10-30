package notes_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tathastu/connect/services/api/internal/notes"
	"github.com/tathastu/connect/services/api/internal/room"
)

type mockRoomValidator struct {
	allowedIdentities map[string]bool // key: roomCode + ":" + identity
	roomIDs           map[string]string
}

func newMockRoomValidator() *mockRoomValidator {
	return &mockRoomValidator{
		allowedIdentities: make(map[string]bool),
		roomIDs:           make(map[string]string),
	}
}

func (m *mockRoomValidator) ValidateRoomAccess(ctx context.Context, publicCode, callerIdentity string) (string, bool, error) {
	key := publicCode + ":" + callerIdentity
	if m.allowedIdentities[key] {
		roomID := m.roomIDs[publicCode]
		if roomID == "" {
			roomID = "room-" + publicCode
		}
		isHost := strings.HasPrefix(callerIdentity, "user:host")
		return roomID, isHost, nil
	}
	return "", false, errors.New("unauthorized room access")
}

func TestNotesService_OptimisticConcurrency(t *testing.T) {
	repo := notes.NewMemoryRepository()
	validator := newMockRoomValidator()
	validator.allowedIdentities["RM-1234:user:host-1"] = true
	validator.allowedIdentities["RM-1234:guest:user-2"] = true
	validator.roomIDs["RM-1234"] = "room-uuid-1"

	svc := notes.NewService(repo, validator, nil)
	ctx := context.Background()

	// 1. Get default note
	note, err := svc.GetNote(ctx, "RM-1234", "user:host-1")
	require.NoError(t, err)
	assert.Equal(t, 1, note.Revision)
	assert.Equal(t, "Meeting Notes", note.Title)
	assert.Empty(t, note.Content)

	// 2. User A updates with expectedRevision = 1
	updatedA, err := svc.UpdateNote(ctx, "RM-1234", "user:host-1", "Architecture Review", "Discussed storage design.", 1)
	require.NoError(t, err)
	assert.Equal(t, 2, updatedA.Revision)
	assert.Equal(t, "Architecture Review", updatedA.Title)
	assert.Equal(t, "Discussed storage design.", updatedA.Content)

	// 3. User B tries to update with stale expectedRevision = 1 -> Must fail with ErrRevisionConflict
	_, err = svc.UpdateNote(ctx, "RM-1234", "guest:user-2", "Conflicting Title", "Conflicting changes", 1)
	assert.ErrorIs(t, err, notes.ErrRevisionConflict)

	// 4. User B updates with expectedRevision = 2 -> Must succeed and increment to 3
	updatedB, err := svc.UpdateNote(ctx, "RM-1234", "guest:user-2", "Architecture Review v2", "Discussed storage design and quarantine workflow.", 2)
	require.NoError(t, err)
	assert.Equal(t, 3, updatedB.Revision)
	assert.Equal(t, "guest:user-2", updatedB.UpdatedByIdentity)
}

func TestNotesService_ContentSizeLimit(t *testing.T) {
	repo := notes.NewMemoryRepository()
	validator := newMockRoomValidator()
	validator.allowedIdentities["RM-1234:user:host-1"] = true
	svc := notes.NewService(repo, validator, nil)
	ctx := context.Background()

	oversizedContent := strings.Repeat("A", notes.MaxContentLength+1)
	_, err := svc.UpdateNote(ctx, "RM-1234", "user:host-1", "Big Note", oversizedContent, 1)
	assert.ErrorIs(t, err, notes.ErrContentTooLarge)
}

func TestNotesService_TitleLengthLimit(t *testing.T) {
	repo := notes.NewMemoryRepository()
	validator := newMockRoomValidator()
	validator.allowedIdentities["RM-1234:user:host-1"] = true
	svc := notes.NewService(repo, validator, nil)
	ctx := context.Background()

	oversizedTitle := strings.Repeat("X", notes.MaxTitleLength+1)
	_, err := svc.UpdateNote(ctx, "RM-1234", "user:host-1", oversizedTitle, "Valid content", 1)
	assert.ErrorIs(t, err, notes.ErrInvalidTitle)
}

func TestNotesService_UnauthorizedAccess(t *testing.T) {
	repo := notes.NewMemoryRepository()
	validator := newMockRoomValidator()
	// No allowed identities
	svc := notes.NewService(repo, validator, nil)
	ctx := context.Background()

	_, err := svc.GetNote(ctx, "RM-1234", "attacker-identity")
	assert.ErrorIs(t, err, notes.ErrUnauthorized)

	_, err = svc.UpdateNote(ctx, "RM-1234", "attacker-identity", "Hack", "Injected", 1)
	assert.ErrorIs(t, err, notes.ErrUnauthorized)
}

func TestNotesHandler_HTTPIntegration(t *testing.T) {
	repo := notes.NewMemoryRepository()
	validator := newMockRoomValidator()
	validator.allowedIdentities["ROOM-TEST:guest:valid-guest"] = true
	svc := notes.NewService(repo, validator, nil)
	handler := notes.NewHandler(svc)

	r := chi.NewRouter()
	handler.RegisterRoutes(r)

	validToken, err := room.GenerateGuestToken("ROOM-TEST", "guest:valid-guest", time.Hour)
	require.NoError(t, err)

	// GET Notes with valid guest token
	req := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/ROOM-TEST/notes", nil)
	req.Header.Set("X-Guest-Token", validToken)
	req.Header.Set("X-Participant-Identity", "guest:valid-guest")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp notes.NoteResponse
	err = json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.Equal(t, 1, resp.Note.Revision)

	// PUT Notes update
	updatePayload := notes.UpdateNoteRequest{
		Title:            "Updated Notes",
		Content:          "Item 1: Deploy securely.",
		ExpectedRevision: 1,
	}
	body, _ := json.Marshal(updatePayload)
	reqPut := httptest.NewRequest(http.MethodPut, "/api/v1/rooms/ROOM-TEST/notes", bytes.NewReader(body))
	reqPut.Header.Set("X-Guest-Token", validToken)
	reqPut.Header.Set("X-Participant-Identity", "guest:valid-guest")
	reqPut.Header.Set("Content-Type", "application/json")
	wPut := httptest.NewRecorder()
	r.ServeHTTP(wPut, reqPut)

	assert.Equal(t, http.StatusOK, wPut.Code)
	var respPut notes.NoteResponse
	err = json.Unmarshal(wPut.Body.Bytes(), &respPut)
	require.NoError(t, err)
	assert.Equal(t, 2, respPut.Note.Revision)

	// PUT Notes with Conflict (stale revision 1)
	reqConflict := httptest.NewRequest(http.MethodPut, "/api/v1/rooms/ROOM-TEST/notes", bytes.NewReader(body))
	reqConflict.Header.Set("X-Guest-Token", validToken)
	reqConflict.Header.Set("X-Participant-Identity", "guest:valid-guest")
	reqConflict.Header.Set("Content-Type", "application/json")
	wConflict := httptest.NewRecorder()
	r.ServeHTTP(wConflict, reqConflict)

	assert.Equal(t, http.StatusConflict, wConflict.Code)

	// Unauthorized spoofing attempt: header claiming user identity without auth session -> 401 Unauthorized
	reqSpoof := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/ROOM-TEST/notes", nil)
	reqSpoof.Header.Set("X-Participant-Identity", "user:admin")
	wSpoof := httptest.NewRecorder()
	r.ServeHTTP(wSpoof, reqSpoof)
	assert.Equal(t, http.StatusUnauthorized, wSpoof.Code)

	// Raw guest header spoofing attempt without cryptographic token -> 401 Unauthorized
	reqRawSpoof := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/ROOM-TEST/notes", nil)
	reqRawSpoof.Header.Set("X-Participant-Identity", "guest:valid-guest")
	wRawSpoof := httptest.NewRecorder()
	r.ServeHTTP(wRawSpoof, reqRawSpoof)
	assert.Equal(t, http.StatusUnauthorized, wRawSpoof.Code)

	// Unauthorized guest not admitted/in room -> 403 Forbidden
	strangerToken, err := room.GenerateGuestToken("ROOM-TEST", "guest:stranger", time.Hour)
	require.NoError(t, err)
	reqForbidden := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/ROOM-TEST/notes", nil)
	reqForbidden.Header.Set("X-Guest-Token", strangerToken)
	wForbidden := httptest.NewRecorder()
	r.ServeHTTP(wForbidden, reqForbidden)
	assert.Equal(t, http.StatusForbidden, wForbidden.Code)
}

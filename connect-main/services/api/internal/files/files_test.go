package files_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tathastu/connect/services/api/internal/files"
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

func createValidPPTXData() []byte {
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	f, _ := zw.Create("[Content_Types].xml")
	_, _ = f.Write([]byte("<Types></Types>"))
	f2, _ := zw.Create("ppt/presentation.xml")
	_, _ = f2.Write([]byte("<presentation></presentation>"))
	_ = zw.Close()
	return buf.Bytes()
}

func TestFilesService_ValidationAndUpload(t *testing.T) {
	repo := files.NewMemoryRepository()
	storage := files.NewMemoryStorageProvider()
	scanner := files.NewHeuristicScanner()
	validator := newMockRoomValidator()
	validator.allowedIdentities["RM-1234:user:host-1"] = true
	validator.roomIDs["RM-1234"] = "room-uuid-1"

	svc := files.NewService(repo, storage, scanner, validator, nil)
	ctx := context.Background()

	// 1. Upload valid PDF
	pdfData := []byte("%PDF-1.4\n%Valid test PDF stream\n%%EOF")
	filePDF, err := svc.UploadFile(ctx, "RM-1234", "user:host-1", "test.pdf", pdfData)
	require.NoError(t, err)
	assert.Equal(t, "pdf", filePDF.FileType)
	assert.Equal(t, files.ScanStatusAvailable, filePDF.ScanStatus)

	// 2. Upload valid PPTX
	pptxData := createValidPPTXData()
	filePPTX, err := svc.UploadFile(ctx, "RM-1234", "user:host-1", "deck.pptx", pptxData)
	require.NoError(t, err)
	assert.Equal(t, "pptx", filePPTX.FileType)
	assert.Equal(t, files.ScanStatusAvailable, filePPTX.ScanStatus)

	// 3. Upload spoofed file: EXE disguised as PDF (magic bytes mismatch)
	spoofedData := []byte("MZ\x90\x00FakePEHeaderDisguisedAsPdf")
	_, err = svc.UploadFile(ctx, "RM-1234", "user:host-1", "malware.pdf", spoofedData)
	assert.Error(t, err)

	// 4. Upload TXT with XSS payload -> scanner must reject
	xssData := []byte("Hello <script>alert(1)</script> World")
	_, err = svc.UploadFile(ctx, "RM-1234", "user:host-1", "notes.txt", xssData)
	assert.Error(t, err)

	// 5. Filename path traversal sanitization
	cleanTxt := []byte("Regular meeting notes plain text.")
	fileTraversal, err := svc.UploadFile(ctx, "RM-1234", "user:host-1", "../../../etc/passwd.txt", cleanTxt)
	require.NoError(t, err)
	assert.Equal(t, "passwd.txt", fileTraversal.SanitizedFilename)
	assert.NotContains(t, fileTraversal.SanitizedFilename, "..")
}

func TestFilesService_DownloadAndCrossRoomIsolation(t *testing.T) {
	repo := files.NewMemoryRepository()
	storage := files.NewMemoryStorageProvider()
	scanner := files.NewHeuristicScanner()
	validator := newMockRoomValidator()
	validator.allowedIdentities["RM-1:user:alice"] = true
	validator.allowedIdentities["RM-2:user:bob"] = true
	validator.roomIDs["RM-1"] = "room-uuid-1"
	validator.roomIDs["RM-2"] = "room-uuid-2"

	svc := files.NewService(repo, storage, scanner, validator, nil)
	ctx := context.Background()

	// Alice uploads in RM-1
	pngData := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00}
	file, err := svc.UploadFile(ctx, "RM-1", "user:alice", "diagram.png", pngData)
	require.NoError(t, err)

	// Alice can download
	retrieved, data, err := svc.DownloadFile(ctx, "RM-1", file.ID, "user:alice")
	require.NoError(t, err)
	assert.Equal(t, pngData, data)
	assert.Equal(t, "diagram.png", retrieved.SanitizedFilename)

	// Bob in RM-2 tries to download Alice's file -> must be blocked
	_, _, err = svc.DownloadFile(ctx, "RM-2", file.ID, "user:bob")
	assert.ErrorIs(t, err, files.ErrUnauthorized)
}

func TestFilesHandler_HTTPIntegration(t *testing.T) {
	repo := files.NewMemoryRepository()
	storage := files.NewMemoryStorageProvider()
	scanner := files.NewHeuristicScanner()
	validator := newMockRoomValidator()
	validator.allowedIdentities["RM-HTTP:guest:participant-1"] = true
	validator.roomIDs["RM-HTTP"] = "room-uuid-http"

	svc := files.NewService(repo, storage, scanner, validator, nil)
	handler := files.NewHandler(svc)

	r := chi.NewRouter()
	handler.RegisterRoutes(r)

	// 1. Multipart Upload
	body := new(bytes.Buffer)
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "presentation.txt")
	require.NoError(t, err)
	_, _ = part.Write([]byte("Agenda:\n1. Metrics\n2. Rollout"))
	_ = writer.Close()

	validToken, err := room.GenerateGuestToken("RM-HTTP", "guest:participant-1", time.Hour)
	require.NoError(t, err)

	// 0. Raw spoof without guest token must be rejected (401 Unauthorized)
	reqSpoof := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/RM-HTTP/files", nil)
	reqSpoof.Header.Set("X-Participant-Identity", "guest:participant-1")
	wSpoof := httptest.NewRecorder()
	r.ServeHTTP(wSpoof, reqSpoof)
	assert.Equal(t, http.StatusUnauthorized, wSpoof.Code)

	reqUpload := httptest.NewRequest(http.MethodPost, "/api/v1/rooms/RM-HTTP/files/upload", body)
	reqUpload.Header.Set("Content-Type", writer.FormDataContentType())
	reqUpload.Header.Set("X-Guest-Token", validToken)
	reqUpload.Header.Set("X-Participant-Identity", "guest:participant-1")
	wUpload := httptest.NewRecorder()
	r.ServeHTTP(wUpload, reqUpload)

	assert.Equal(t, http.StatusCreated, wUpload.Code)
	var uploadResp files.FileUploadResponse
	err = json.Unmarshal(wUpload.Body.Bytes(), &uploadResp)
	require.NoError(t, err)
	fileID := uploadResp.File.ID
	assert.NotEmpty(t, fileID)

	// 2. List Files
	reqList := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/RM-HTTP/files", nil)
	reqList.Header.Set("X-Guest-Token", validToken)
	reqList.Header.Set("X-Participant-Identity", "guest:participant-1")
	wList := httptest.NewRecorder()
	r.ServeHTTP(wList, reqList)

	assert.Equal(t, http.StatusOK, wList.Code)
	var listResp files.FileListResponse
	err = json.Unmarshal(wList.Body.Bytes(), &listResp)
	require.NoError(t, err)
	assert.Len(t, listResp.Files, 1)

	// 3. Download File
	reqDownload := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/RM-HTTP/files/"+fileID+"/download", nil)
	reqDownload.Header.Set("X-Guest-Token", validToken)
	reqDownload.Header.Set("X-Participant-Identity", "guest:participant-1")
	wDownload := httptest.NewRecorder()
	r.ServeHTTP(wDownload, reqDownload)

	assert.Equal(t, http.StatusOK, wDownload.Code)
	assert.Contains(t, wDownload.Header().Get("Content-Disposition"), "attachment; filename=\"presentation.txt\"")
	assert.Equal(t, "text/plain", wDownload.Header().Get("Content-Type"))
	assert.Equal(t, "Agenda:\n1. Metrics\n2. Rollout", wDownload.Body.String())
}

func TestProductionScanner_EICAR(t *testing.T) {
	scanner := files.NewProductionScanner(false, "", 0)
	file := &files.MeetingFile{
		OriginalFilename: "eicar.txt",
		FileType:         "txt",
	}
	eicarPayload := []byte("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")

	status, result, err := scanner.Scan(context.Background(), file, eicarPayload)
	require.NoError(t, err)
	assert.Equal(t, files.ScanStatusRejected, status)
	assert.Contains(t, result, "EICAR test malware signature detected")
}

func TestProductionScanner_DangerousPayloads(t *testing.T) {
	scanner := files.NewProductionScanner(false, "", 0)

	// Windows PE binary header
	peFile := &files.MeetingFile{OriginalFilename: "app.txt", FileType: "txt"}
	status, _, _ := scanner.Scan(context.Background(), peFile, []byte("MZ\x90\x00\x03\x00\x00\x00"))
	assert.Equal(t, files.ScanStatusRejected, status)

	// Linux ELF binary header
	elfFile := &files.MeetingFile{OriginalFilename: "binary.txt", FileType: "txt"}
	status, _, _ = scanner.Scan(context.Background(), elfFile, []byte("\x7fELF\x02\x01\x01\x00"))
	assert.Equal(t, files.ScanStatusRejected, status)

	// Embedded XSS script in text
	xssFile := &files.MeetingFile{OriginalFilename: "notes.txt", FileType: "txt"}
	status, _, _ = scanner.Scan(context.Background(), xssFile, []byte("Hello <script>alert(1)</script>"))
	assert.Equal(t, files.ScanStatusRejected, status)

	// Shell script
	shFile := &files.MeetingFile{OriginalFilename: "run.txt", FileType: "txt"}
	status, _, _ = scanner.Scan(context.Background(), shFile, []byte("#!/bin/bash\nrm -rf /"))
	assert.Equal(t, files.ScanStatusRejected, status)
}

func TestR2StorageProvider_ConfigValidation(t *testing.T) {
	ctx := context.Background()

	// Missing endpoint
	_, err := files.NewR2StorageProvider(ctx, files.R2StorageConfig{
		Bucket:          "b",
		AccessKeyID:     "k",
		SecretAccessKey: "s",
	})
	assert.Error(t, err)

	// Missing bucket
	_, err = files.NewR2StorageProvider(ctx, files.R2StorageConfig{
		Endpoint:        "https://r2.cloudflarestorage.com",
		AccessKeyID:     "k",
		SecretAccessKey: "s",
	})
	assert.Error(t, err)

	// Missing credentials
	_, err = files.NewR2StorageProvider(ctx, files.R2StorageConfig{
		Endpoint: "https://r2.cloudflarestorage.com",
		Bucket:   "b",
	})
	assert.Error(t, err)
}

func TestFiles_CrossRoomPrivilegeIsolation(t *testing.T) {
	repo := files.NewMemoryRepository()
	storage := files.NewMemoryStorageProvider()
	scanner := files.NewProductionScanner(false, "", 0)
	validator := newMockRoomValidator()

	// Register room 1 and room 2 with separate authorized participants
	validator.allowedIdentities["ROOM-A:user:alice"] = true
	validator.roomIDs["ROOM-A"] = "room-uuid-a"

	validator.allowedIdentities["ROOM-B:user:bob"] = true
	validator.roomIDs["ROOM-B"] = "room-uuid-b"

	svc := files.NewService(repo, storage, scanner, validator, nil)

	// Alice uploads file to Room A
	fileA, err := svc.UploadFile(context.Background(), "ROOM-A", "user:alice", "roadmap.txt", []byte("Q4 Milestones"))
	require.NoError(t, err)
	assert.Equal(t, files.ScanStatusAvailable, fileA.ScanStatus)

	// Bob in Room B attempts to download Alice's file from Room A -> REJECTED (Unauthorized)
	_, _, err = svc.DownloadFile(context.Background(), "ROOM-B", fileA.ID, "user:bob")
	assert.ErrorIs(t, err, files.ErrUnauthorized)

	// Bob attempts to delete Alice's file from Room A -> REJECTED (Unauthorized)
	err = svc.DeleteFile(context.Background(), "ROOM-B", fileA.ID, "user:bob")
	assert.ErrorIs(t, err, files.ErrUnauthorized)
}

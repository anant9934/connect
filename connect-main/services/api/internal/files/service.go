package files

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/tathastu/connect/services/api/internal/audit"
)

type RoomValidator interface {
	ValidateRoomAccess(ctx context.Context, publicCode, callerIdentity string) (roomID string, isHost bool, err error)
}

type Service struct {
	repo          Repository
	storage       StorageProvider
	scanner       Scanner
	roomValidator RoomValidator
	auditService  *audit.Service
}

func NewService(repo Repository, storage StorageProvider, scanner Scanner, roomValidator RoomValidator, auditService *audit.Service) *Service {
	return &Service{
		repo:          repo,
		storage:       storage,
		scanner:       scanner,
		roomValidator: roomValidator,
		auditService:  auditService,
	}
}

func (s *Service) UploadFile(ctx context.Context, roomCode, callerIdentity, originalFilename string, data []byte) (*MeetingFile, error) {
	roomID, isHost, err := s.roomValidator.ValidateRoomAccess(ctx, roomCode, callerIdentity)
	if err != nil {
		return nil, ErrUnauthorized
	}

	// 1. Validate file size
	sizeBytes := int64(len(data))
	if sizeBytes == 0 || sizeBytes > MaxFileSizeBytes {
		return nil, ErrFileTooLarge
	}

	// 2. Sanitize filename
	sanitized, err := SanitizeFilename(originalFilename)
	if err != nil {
		return nil, err
	}

	// 3. Format and magic byte validation
	format, err := ValidateFileFormat(sanitized, data)
	if err != nil {
		return nil, err
	}

	// 4. Calculate SHA256 checksum
	hash := sha256.Sum256(data)
	shaHex := hex.EncodeToString(hash[:])

	// 5. Generate secure random storage key
	fileID := uuid.NewString()
	storageKey := fmt.Sprintf("rooms/%s/files/%s_%s", roomID, fileID, sanitized)

	// 6. Persist file bytes to isolated private storage
	if err := s.storage.Store(ctx, storageKey, data); err != nil {
		return nil, fmt.Errorf("storage persistence failed: %w", err)
	}

	now := time.Now().UTC()
	meetingFile := &MeetingFile{
		ID:                 fileID,
		RoomID:             roomID,
		StorageKey:         storageKey,
		OriginalFilename:   originalFilename,
		SanitizedFilename:  sanitized,
		FileType:           format.FileType,
		MimeType:           format.MimeType,
		SizeBytes:          sizeBytes,
		SHA256Hash:         shaHex,
		ScanStatus:         ScanStatusQuarantined,
		ScanResult:         "Quarantined: awaiting security scan",
		UploadedByIdentity: callerIdentity,
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	// 7. Persist file record in quarantine state
	if err := s.repo.CreateFile(ctx, meetingFile); err != nil {
		_ = s.storage.Delete(ctx, storageKey)
		return nil, err
	}

	// 8. Mandatory scanning workflow: Explicit state transition QUARANTINED -> SCANNING
	_ = s.repo.UpdateScanStatus(ctx, fileID, ScanStatusScanning, "Security scan in progress")
	meetingFile.ScanStatus = ScanStatusScanning

	scanStatus, scanResult, scanErr := s.scanner.Scan(ctx, meetingFile, data)
	if scanErr != nil || scanStatus != ScanStatusAvailable {
		// Fail-closed: If scanner is down, keep quarantined; if malicious, mark rejected
		finalStatus := ScanStatusRejected
		if errors.Is(scanErr, ErrScannerUnavailable) {
			finalStatus = ScanStatusQuarantined
		}
		_ = s.repo.UpdateScanStatus(ctx, fileID, finalStatus, scanResult)
		meetingFile.ScanStatus = finalStatus
		meetingFile.ScanResult = scanResult
		if finalStatus == ScanStatusQuarantined {
			return nil, ErrFileQuarantined
		}
		return nil, ErrFileRejected
	}

	// Update SCANNING -> AVAILABLE
	meetingFile.ScanStatus = ScanStatusAvailable
	meetingFile.ScanResult = scanResult
	if err := s.repo.UpdateScanStatus(ctx, fileID, ScanStatusAvailable, scanResult); err != nil {
		return nil, err
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: "room.file_uploaded",
			Severity:  "INFO",
			ActorID:   callerIdentity,
			RoomID:    roomID,
			Metadata: map[string]any{
				"fileId":   fileID,
				"filename": sanitized,
				"fileType": format.FileType,
				"size":     sizeBytes,
				"isHost":   isHost,
			},
		})
	}

	return meetingFile, nil
}

func (s *Service) ListFiles(ctx context.Context, roomCode, callerIdentity string) ([]*MeetingFile, error) {
	roomID, _, err := s.roomValidator.ValidateRoomAccess(ctx, roomCode, callerIdentity)
	if err != nil {
		return nil, ErrUnauthorized
	}

	files, err := s.repo.GetFilesByRoomID(ctx, roomID)
	if err != nil {
		return nil, err
	}

	// Filter out files that are not available (unless uploaded by caller)
	var filtered []*MeetingFile
	for _, f := range files {
		if f.ScanStatus == ScanStatusAvailable || f.UploadedByIdentity == callerIdentity {
			filtered = append(filtered, f)
		}
	}
	return filtered, nil
}

func (s *Service) DownloadFile(ctx context.Context, roomCode, fileID, callerIdentity string) (*MeetingFile, []byte, error) {
	roomID, _, err := s.roomValidator.ValidateRoomAccess(ctx, roomCode, callerIdentity)
	if err != nil {
		return nil, nil, ErrUnauthorized
	}

	file, err := s.repo.GetFileByID(ctx, fileID)
	if err != nil {
		return nil, nil, ErrFileNotFound
	}

	// Verify file belongs to room (horizontal privilege isolation)
	if file.RoomID != roomID {
		return nil, nil, ErrUnauthorized
	}

	// Verify file status
	if file.ScanStatus == ScanStatusDeleted {
		return nil, nil, ErrFileNotFound
	}
	if file.ScanStatus == ScanStatusRejected {
		return nil, nil, ErrFileRejected
	}
	if file.ScanStatus != ScanStatusAvailable {
		return nil, nil, ErrFileQuarantined
	}

	data, err := s.storage.Get(ctx, file.StorageKey)
	if err != nil {
		return nil, nil, ErrStorageFailure
	}

	if s.auditService != nil {
		s.auditService.Record(ctx, audit.AuditParams{
			EventType: "room.file_downloaded",
			Severity:  "INFO",
			ActorID:   callerIdentity,
			RoomID:    roomID,
			Metadata: map[string]any{
				"fileId":   file.ID,
				"filename": file.SanitizedFilename,
			},
		})
	}

	return file, data, nil
}

func (s *Service) DeleteFile(ctx context.Context, roomCode, fileID, callerIdentity string) error {
	roomID, isHost, err := s.roomValidator.ValidateRoomAccess(ctx, roomCode, callerIdentity)
	if err != nil {
		return ErrUnauthorized
	}

	file, err := s.repo.GetFileByID(ctx, fileID)
	if err != nil {
		return ErrFileNotFound
	}

	if file.RoomID != roomID {
		return ErrUnauthorized
	}

	// Only host or the uploader can delete
	if !isHost && file.UploadedByIdentity != callerIdentity {
		return ErrUnauthorized
	}

	if err := s.storage.Delete(ctx, file.StorageKey); err != nil {
		// Log but proceed to mark deleted in database
	}

	return s.repo.DeleteFile(ctx, fileID)
}

package files

import (
	"errors"
	"time"
)

var (
	ErrFileNotFound         = errors.New("file not found")
	ErrFileTooLarge         = errors.New("file size exceeds maximum limit (25 MB)")
	ErrInvalidFileType      = errors.New("file type not allowed or signature mismatch")
	ErrInvalidFilename      = errors.New("invalid or unsafe filename")
	ErrFileQuarantined      = errors.New("file is in quarantine undergoing verification")
	ErrFileRejected         = errors.New("file was rejected due to failed safety scan")
	ErrUnauthorized         = errors.New("unauthorized to access meeting files")
	ErrStorageFailure       = errors.New("failed to store or retrieve file")
	ErrRoomCapacityExceeded = errors.New("meeting file quota reached (max 100 files)")
)

const (
	MaxFileSizeBytes   int64 = 25 * 1024 * 1024 // 25 MB ceiling
	MaxFilesPerMeeting int   = 100
)

type ScanStatus string

const (
	ScanStatusPending     ScanStatus = "pending"
	ScanStatusQuarantined ScanStatus = "quarantined"
	ScanStatusScanning    ScanStatus = "scanning"
	ScanStatusAvailable   ScanStatus = "available"
	ScanStatusRejected    ScanStatus = "rejected"
	ScanStatusDeleted     ScanStatus = "deleted"
)

type MeetingFile struct {
	ID                 string     `json:"id"`
	RoomID             string     `json:"roomId"`
	StorageKey         string     `json:"-"` // Never expose internal storage key
	OriginalFilename   string     `json:"originalFilename"`
	SanitizedFilename  string     `json:"sanitizedFilename"`
	FileType           string     `json:"fileType"`
	MimeType           string     `json:"mimeType"`
	SizeBytes          int64      `json:"sizeBytes"`
	SHA256Hash         string     `json:"sha256Hash"`
	ScanStatus         ScanStatus `json:"scanStatus"`
	ScanResult         string     `json:"scanResult,omitempty"`
	UploadedByIdentity string     `json:"uploadedByIdentity"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

type FileListResponse struct {
	Files []*MeetingFile `json:"files"`
}

type FileUploadResponse struct {
	File *MeetingFile `json:"file"`
}

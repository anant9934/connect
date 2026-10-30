package notes

import (
	"errors"
	"time"
)

var (
	ErrNoteNotFound     = errors.New("note not found")
	ErrRevisionConflict = errors.New("note revision conflict")
	ErrContentTooLarge  = errors.New("note content exceeds maximum permitted size")
	ErrInvalidTitle     = errors.New("invalid note title")
	ErrUnauthorized     = errors.New("unauthorized to access notes")
)

const (
	MaxTitleLength   = 200
	MaxContentLength = 50000 // 50 KB ceiling for plain-text meeting notes
)

type MeetingNote struct {
	ID                string    `json:"id"`
	RoomID            string    `json:"roomId"`
	Title             string    `json:"title"`
	Content           string    `json:"content"`
	Revision          int       `json:"revision"`
	CreatedByIdentity string    `json:"createdByIdentity"`
	UpdatedByIdentity string    `json:"updatedByIdentity"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type UpdateNoteRequest struct {
	Title            string `json:"title"`
	Content          string `json:"content"`
	ExpectedRevision int    `json:"expectedRevision"`
}

type NoteResponse struct {
	Note *MeetingNote `json:"note"`
}

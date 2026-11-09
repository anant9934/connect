package room

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tathastu/connect/services/api/internal/model"
)

const (
	minMeetingNumber = 10_000_000_000
	maxMeetingNumber = 99_999_999_999
)

var meetingNumberPattern = regexp.MustCompile(`^[0-9]{11}$`)

// GenerateMeetingNumber returns a random 11-digit meeting number.
func GenerateMeetingNumber() (int64, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(maxMeetingNumber-minMeetingNumber+1))
	if err != nil {
		return 0, fmt.Errorf("failed to generate meeting number: %w", err)
	}
	return minMeetingNumber + n.Int64(), nil
}

// ParseMeetingNumber accepts 11 digits with optional spaces or hyphens ("842 9103 8417").
func ParseMeetingNumber(raw string) (int64, bool) {
	cleaned := strings.NewReplacer(" ", "", "-", "").Replace(strings.TrimSpace(raw))
	if !meetingNumberPattern.MatchString(cleaned) {
		return 0, false
	}
	n, err := strconv.ParseInt(cleaned, 10, 64)
	return n, err == nil
}

// FormatMeetingNumber groups a meeting number as 3-4-4 digits for reading out.
func FormatMeetingNumber(n int64) string {
	s := strconv.FormatInt(n, 10)
	if len(s) != 11 {
		return ""
	}
	return s[:3] + " " + s[3:7] + " " + s[7:]
}

// ResolveMeetingNumber handles GET /api/v1/rooms/by-number/{number}. It returns only the
// room's code; the caller then uses the normal code routes. Numbers are easier to guess than
// codes, so lookups are limited per address.
func (h *Handlers) ResolveMeetingNumber(w http.ResponseWriter, r *http.Request) {
	number, ok := ParseMeetingNumber(chi.URLParam(r, "number"))
	if !ok {
		model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "No meeting has that number.")
		return
	}
	if h.limiter != nil {
		allowed, err := h.limiter.Allow(r.Context(), "meeting_number:"+extractIP(r), 30, time.Minute)
		if err != nil || !allowed {
			w.Header().Set("Retry-After", "60")
			model.SendJSONError(w, r, http.StatusTooManyRequests, "TOO_MANY_REQUESTS", "Too many lookups. Please wait a minute.")
			return
		}
	}
	code, err := h.service.CodeByMeetingNumber(r.Context(), number)
	if err != nil {
		if errors.Is(err, ErrRoomNotFound) {
			model.SendJSONError(w, r, http.StatusNotFound, "ROOM_NOT_FOUND", "No meeting has that number.")
			return
		}
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not look up that meeting.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"publicCode": code})
}

package meetings

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

const (
	calendarLookBack = 30 * 24 * time.Hour
	calendarMaxItems = 500
	icsLineLimit     = 75
)

// CalendarEvent is one meeting in a calendar file.
type CalendarEvent struct {
	ID, PublicCode, Status, HostName string
	Title                            *string
	Start, End                       time.Time
}

// icsEscape applies the RFC 5545 text rules, so a title cannot add calendar properties.
func icsEscape(value string) string {
	return strings.NewReplacer(`\`, `\\`, `;`, `\;`, `,`, `\,`, "\r\n", `\n`, "\n", `\n`, "\r", `\n`).Replace(value)
}

// icsLine folds at 75 octets without splitting a character, as RFC 5545 requires.
func icsLine(out *strings.Builder, line string) {
	limit := icsLineLimit
	for len(line) > limit {
		cut := limit
		for cut > 0 && !utf8.RuneStart(line[cut]) {
			cut--
		}
		out.WriteString(line[:cut])
		out.WriteString("\r\n ")
		line = line[cut:]
		limit = icsLineLimit - 1
	}
	out.WriteString(line)
	out.WriteString("\r\n")
}

// RenderCalendar builds an iCalendar file. Times are UTC, so every calendar shows the right instant.
func RenderCalendar(events []CalendarEvent, origin string, now time.Time) string {
	const stamp = "20060102T150405Z"
	var out strings.Builder
	for _, line := range []string{"BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tathastu//Connect//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"} {
		icsLine(&out, line)
	}
	for _, event := range events {
		title := "Meeting " + event.PublicCode
		if event.Title != nil && *event.Title != "" {
			title = *event.Title
		}
		link := strings.TrimRight(origin, "/") + "/room/" + event.PublicCode + "/preview"
		status := "CONFIRMED"
		if event.Status == "cancelled" {
			status = "CANCELLED"
		}
		icsLine(&out, "BEGIN:VEVENT")
		icsLine(&out, "UID:"+event.ID+"@connect")
		icsLine(&out, "DTSTAMP:"+now.UTC().Format(stamp))
		icsLine(&out, "DTSTART:"+event.Start.UTC().Format(stamp))
		icsLine(&out, "DTEND:"+event.End.UTC().Format(stamp))
		icsLine(&out, "SUMMARY:"+icsEscape(title))
		icsLine(&out, "DESCRIPTION:"+icsEscape(fmt.Sprintf("Host: %s\nJoin: %s", event.HostName, link)))
		icsLine(&out, "URL:"+link)
		icsLine(&out, "STATUS:"+status)
		icsLine(&out, "END:VEVENT")
	}
	icsLine(&out, "END:VCALENDAR")
	return out.String()
}

func (h *Handler) loadCalendar(ctx context.Context, room *string, from time.Time) ([]CalendarEvent, error) {
	var events []CalendarEvent
	err := database.WithAuthContext(ctx, h.pool, database.SessionTokenHash(ctx), nil, func(tx pgx.Tx, _ *database.AuthContext) error {
		rows, err := tx.Query(ctx, `
			SELECT id::text, public_code, title, status, starts_at, ends_at, host_name
			FROM connect_auth.meeting_calendar($1::uuid, $2, $3)
		`, room, from, calendarMaxItems)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e CalendarEvent
			if err := rows.Scan(&e.ID, &e.PublicCode, &e.Title, &e.Status, &e.Start, &e.End, &e.HostName); err != nil {
				return err
			}
			events = append(events, e)
		}
		return rows.Err()
	})
	return events, err
}

func (h *Handler) sendCalendar(w http.ResponseWriter, filename string, events []CalendarEvent) {
	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, filename))
	w.Header().Set("Cache-Control", "private, no-store")
	_, _ = w.Write([]byte(RenderCalendar(events, h.publicOrigin, time.Now())))
}

// calendar exports one meeting. A meeting the caller may not see is reported as not found.
func (h *Handler) calendar(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := uuid.Parse(id); err != nil {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This meeting is unavailable.")
		return
	}
	events, err := h.loadCalendar(r.Context(), &id, time.Time{})
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not export this meeting.")
		return
	}
	if len(events) == 0 {
		model.SendJSONError(w, r, http.StatusNotFound, "NOT_FOUND", "This meeting has no scheduled time to export.")
		return
	}
	h.sendCalendar(w, "meeting.ics", events)
}

// calendarAll exports the caller's meetings from a month ago onward, so recent changes also reach calendars.
func (h *Handler) calendarAll(w http.ResponseWriter, r *http.Request) {
	events, err := h.loadCalendar(r.Context(), nil, time.Now().Add(-calendarLookBack))
	if err != nil {
		model.SendJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Could not export your meetings.")
		return
	}
	h.sendCalendar(w, "meetings.ics", events)
}

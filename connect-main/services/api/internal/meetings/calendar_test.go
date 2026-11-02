package meetings

import (
	"strings"
	"testing"
	"time"
)

func TestRenderCalendar(t *testing.T) {
	start := time.Date(2026, 3, 8, 10, 0, 0, 0, time.FixedZone("IST", 5*3600+1800))
	hostile := "Physics, part 1; \\intro\r\nATTENDEE:mailto:someone@example.test"
	long := strings.Repeat("अ", 60)
	out := RenderCalendar([]CalendarEvent{
		{ID: "a", PublicCode: "ABCD-EFGH-JK", Status: "scheduled", HostName: "Host", Title: &hostile, Start: start, End: start.Add(time.Hour)},
		{ID: "b", PublicCode: "BBBB-EFGH-JK", Status: "cancelled", HostName: "Host", Title: &long, Start: start, End: start.Add(time.Hour)},
		{ID: "c", PublicCode: "CCCC-EFGH-JK", Status: "scheduled", HostName: "Host", Start: start, End: start.Add(time.Hour)},
	}, "https://connect.example/", start)

	if !strings.HasPrefix(out, "BEGIN:VCALENDAR\r\n") || !strings.HasSuffix(out, "END:VCALENDAR\r\n") {
		t.Errorf("not a calendar: %q", out[:40])
	}
	if strings.Contains(strings.ReplaceAll(out, "\r\n", ""), "\n") {
		t.Error("bare line feed")
	}
	if !strings.Contains(out, "DTSTART:20260308T043000Z") {
		t.Errorf("start not in UTC: %s", out)
	}
	if strings.Contains(out, "\r\nATTENDEE:") {
		t.Error("a title added a calendar property")
	}
	unfolded := strings.ReplaceAll(out, "\r\n ", "")
	if !strings.Contains(unfolded, `SUMMARY:Physics\, part 1\; \\intro\nATTENDEE:mailto:someone@example.test`) {
		t.Errorf("escaping: %s", unfolded)
	}
	if !strings.Contains(unfolded, "SUMMARY:"+long) {
		t.Error("folding changed the title")
	}
	if !strings.Contains(unfolded, "STATUS:CANCELLED") || !strings.Contains(unfolded, "SUMMARY:Meeting CCCC-EFGH-JK") {
		t.Errorf("status or fallback title: %s", unfolded)
	}
	if !strings.Contains(unfolded, "URL:https://connect.example/room/ABCD-EFGH-JK/preview") {
		t.Errorf("link: %s", unfolded)
	}
	for _, line := range strings.Split(out, "\r\n") {
		if len(line) > 75 {
			t.Errorf("line of %d octets: %q", len(line), line)
		}
		if line != strings.ToValidUTF8(line, "") {
			t.Errorf("folding split a character: %q", line)
		}
	}
}

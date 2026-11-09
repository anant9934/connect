package ai

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestBuildMeetingTranscript(t *testing.T) {
	start := time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)
	lines := []meetingLine{
		{"Prof. Rao", start.Add(-30 * time.Second), "Before the recording"},
		{"Prof. Rao", start.Add(75 * time.Second), "Aaj hum heaps padhenge"},
		{"Prof. Rao", start.Add(time.Hour + 2*time.Minute + 3*time.Second), "Last point"},
	}
	answer := "Because most nodes are near the bottom"
	doubts := []meetingDoubt{{"Why is build-heap O(n)?", &answer, "resolved"}, {"Is a heap sorted?", nil, "open"}}
	text := buildMeetingTranscript(lines, doubts, &start)
	for _, want := range []string{"Prof. Rao: Before the recording\n", "[01:15] Prof. Rao: Aaj hum heaps padhenge", "[1:02:03] Prof. Rao: Last point", "Q (resolved): Why is build-heap O(n)? Answer: Because", "Q (open): Is a heap sorted? (no answer recorded)"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q in:\n%s", want, text)
		}
	}
	if strings.Contains(text, "[00:00] Prof. Rao: Before") {
		t.Error("lines before the recording must not get a time")
	}
	// Without a recording, times count from the first line.
	if got := buildMeetingTranscript(lines[1:2], nil, nil); !strings.HasPrefix(got, "[00:00] ") {
		t.Errorf("no recording: %q", got)
	}
	long := []meetingLine{}
	for i := 0; i < 3000; i++ {
		long = append(long, meetingLine{"T", start, strings.Repeat("word ", 20)})
	}
	if got := buildMeetingTranscript(long, nil, &start); len(got) > maxMeetingTranscriptChars {
		t.Errorf("transcript not bounded: %d", len(got))
	}
}

func TestValidateEditedKeepsSource(t *testing.T) {
	h := &Handler{}
	old, _ := json.Marshal(LectureSummary{Title: "A", Overview: "B", Source: &SummarySource{RoomID: "room-1"}})
	edited := `{"title":"A, edited","overview":"B","source":{"roomId":"forged"},"revisionNotes":["new note"]}`
	out, err := h.validateEdited(&Artifact{ArtifactType: "lecture_summary", Content: old}, json.RawMessage(edited))
	if err != nil {
		t.Fatal(err)
	}
	var s LectureSummary
	_ = json.Unmarshal(out, &s)
	if s.Source == nil || s.Source.RoomID != "room-1" || s.Title != "A, edited" || len(s.RevisionNotes) != 1 {
		t.Errorf("edited summary: %+v", s)
	}
	if _, err := h.validateEdited(&Artifact{ArtifactType: "practice_quiz"}, json.RawMessage(`{"questions":[]}`)); err == nil {
		t.Error("an empty quiz should be refused")
	}
	if _, err := h.validateEdited(&Artifact{ArtifactType: "study_plan"}, json.RawMessage(`{}`)); err == nil {
		t.Error("unsupported types are not editable")
	}
}

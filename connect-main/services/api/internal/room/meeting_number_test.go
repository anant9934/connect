package room

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestMeetingNumberFormat(t *testing.T) {
	for i := 0; i < 200; i++ {
		n, err := GenerateMeetingNumber()
		if err != nil {
			t.Fatal(err)
		}
		if n < minMeetingNumber || n > maxMeetingNumber {
			t.Fatalf("out of range: %d", n)
		}
		parsed, ok := ParseMeetingNumber(FormatMeetingNumber(n))
		if !ok || parsed != n {
			t.Fatalf("round trip %d -> %q -> %d", n, FormatMeetingNumber(n), parsed)
		}
	}
	if got := FormatMeetingNumber(84291038417); got != "842 9103 8417" {
		t.Errorf("format: %q", got)
	}
	for _, bad := range []string{"", "1234567890", "123456789012", "ABCD-EFGH-JK", "842 9103 841x"} {
		if _, ok := ParseMeetingNumber(bad); ok {
			t.Errorf("accepted %q", bad)
		}
	}
	if n, ok := ParseMeetingNumber(" 842-9103-8417 "); !ok || n != 84291038417 {
		t.Errorf("hyphenated: %d %v", n, ok)
	}
}

func TestResolveMeetingNumber(t *testing.T) {
	repo := NewMemoryRepository()
	rm := &Room{PublicCode: "ABCD-EFGH-JK", HostUserID: "u1"}
	if err := repo.CreateRoom(context.Background(), rm); err != nil {
		t.Fatal(err)
	}
	h := &Handlers{service: &Service{repo: repo}}
	router := chi.NewRouter()
	router.Get("/by-number/{number}", h.ResolveMeetingNumber)

	get := func(path string) (*httptest.ResponseRecorder, map[string]any) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		var body map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return rec, body
	}
	rec, body := get("/by-number/" + strings.ReplaceAll(FormatMeetingNumber(rm.MeetingNumber), " ", "-"))
	if rec.Code != http.StatusOK || body["publicCode"] != "ABCD-EFGH-JK" {
		t.Errorf("resolve: %d %v", rec.Code, body)
	}
	other := rm.MeetingNumber + 1
	if other > maxMeetingNumber {
		other = minMeetingNumber
	}
	if rec, _ := get("/by-number/" + strconv.FormatInt(other, 10)); rec.Code != http.StatusNotFound {
		t.Errorf("unknown number: %d", rec.Code)
	}
	if rec, _ := get("/by-number/12345"); rec.Code != http.StatusNotFound {
		t.Errorf("short number: %d", rec.Code)
	}
}

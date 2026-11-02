package institution

import (
	"testing"
	"time"
)

func TestExpand_KeepsLocalTimeAcrossDaylightSaving(t *testing.T) {
	ny, _ := time.LoadLocation("America/New_York")
	// US clocks moved forward on 8 March 2026.
	start := time.Date(2026, 3, 2, 9, 0, 0, 0, ny)
	got, err := ExpandOccurrences(start, start.Add(time.Hour), "America/New_York", &Recurrence{Weekdays: []int{1}, Until: "2026-03-16"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 Mondays, got %d", len(got))
	}
	for i, o := range got {
		local := o.Start.In(ny)
		if local.Hour() != 9 || local.Weekday() != time.Monday {
			t.Fatalf("occurrence %d is at %v", i, local)
		}
		if o.End.Sub(o.Start) != time.Hour {
			t.Fatalf("occurrence %d lasts %v", i, o.End.Sub(o.Start))
		}
	}
	if got[0].Start.UTC().Hour() != 14 || got[1].Start.UTC().Hour() != 13 {
		t.Fatalf("UTC should shift across the change: %v, %v", got[0].Start.UTC(), got[1].Start.UTC())
	}
}

func TestExpand_NonexistentLocalTimeMovesForward(t *testing.T) {
	ny, _ := time.LoadLocation("America/New_York")
	start := time.Date(2026, 3, 1, 2, 30, 0, 0, ny) // 2:30 does not exist on 8 March
	got, err := ExpandOccurrences(start, start.Add(time.Hour), "America/New_York", &Recurrence{Weekdays: []int{0}, Until: "2026-03-15"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[1].End.Sub(got[1].Start) != time.Hour {
		t.Fatalf("unexpected occurrences: %+v", got)
	}
}

func TestExpand_ZoneWithoutDaylightSaving(t *testing.T) {
	ist, _ := time.LoadLocation("Asia/Kolkata")
	start := time.Date(2026, 1, 5, 10, 0, 0, 0, ist)
	got, err := ExpandOccurrences(start, start.Add(time.Hour), "Asia/Kolkata", &Recurrence{Weekdays: []int{1, 3}, Until: "2026-01-14"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 4 {
		t.Fatalf("expected 4 classes, got %d", len(got))
	}
}

func TestExpand_Rejections(t *testing.T) {
	start := time.Date(2026, 1, 5, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	cases := map[string]func() error{
		"unknown zone": func() error { _, err := ExpandOccurrences(start, end, "Mars/Base", nil); return err },
		"end first":    func() error { _, err := ExpandOccurrences(end, start, "UTC", nil); return err },
		"too long":     func() error { _, err := ExpandOccurrences(start, start.Add(25*time.Hour), "UTC", nil); return err },
		"no weekdays": func() error {
			_, err := ExpandOccurrences(start, end, "UTC", &Recurrence{Until: "2026-02-01"})
			return err
		},
		"bad weekday": func() error {
			_, err := ExpandOccurrences(start, end, "UTC", &Recurrence{Weekdays: []int{7}, Until: "2026-02-01"})
			return err
		},
		"bad date": func() error {
			_, err := ExpandOccurrences(start, end, "UTC", &Recurrence{Weekdays: []int{1}, Until: "soon"})
			return err
		},
		"too many": func() error {
			_, err := ExpandOccurrences(start, end, "UTC", &Recurrence{Weekdays: []int{0, 1, 2, 3, 4, 5, 6}, Until: "2030-01-01"})
			return err
		},
		"none generated": func() error {
			_, err := ExpandOccurrences(start, end, "UTC", &Recurrence{Weekdays: []int{0}, Until: "2026-01-06"})
			return err
		},
	}
	for name, run := range cases {
		if run() == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

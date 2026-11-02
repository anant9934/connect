package institution

import (
	"errors"
	"sort"
	"time"
)

// MaxOccurrences bounds one request, so a typo in an end date cannot create years of classes.
const MaxOccurrences = 200

// Recurrence repeats a class on weekdays until a date in the class's own time zone.
type Recurrence struct {
	Weekdays []int  `json:"weekdays"` // 0 is Sunday
	Until    string `json:"until"`    // YYYY-MM-DD, inclusive
}

// Occurrence is one scheduled class, as absolute instants.
type Occurrence struct {
	Start time.Time
	End   time.Time
}

// ExpandOccurrences keeps each class at the same wall-clock time, so across a daylight saving
// change the instant shifts and the local time does not. A local time that does not exist that
// day moves forward, as time.Date does; an ambiguous one takes the earlier instant.
func ExpandOccurrences(start, end time.Time, zone string, rec *Recurrence) ([]Occurrence, error) {
	loc, err := time.LoadLocation(zone)
	if err != nil || zone == "" {
		return nil, errors.New("unknown time zone")
	}
	if !end.After(start) {
		return nil, errors.New("a class must end after it starts")
	}
	duration := end.Sub(start)
	if duration > 24*time.Hour {
		return nil, errors.New("a class can last at most 24 hours")
	}
	if rec == nil {
		return []Occurrence{{Start: start, End: end}}, nil
	}
	if len(rec.Weekdays) == 0 {
		return nil, errors.New("choose at least one weekday")
	}
	until, err := time.ParseInLocation("2006-01-02", rec.Until, loc)
	if err != nil {
		return nil, errors.New("the repeat end date must be YYYY-MM-DD")
	}
	days := map[time.Weekday]bool{}
	for _, d := range rec.Weekdays {
		if d < 0 || d > 6 {
			return nil, errors.New("weekdays must be 0 (Sunday) to 6 (Saturday)")
		}
		days[time.Weekday(d)] = true
	}

	local := start.In(loc)
	hour, minute, second := local.Clock()
	var result []Occurrence
	for day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc); !day.After(until); day = day.AddDate(0, 0, 1) {
		if !days[day.Weekday()] {
			continue
		}
		occurrenceStart := time.Date(day.Year(), day.Month(), day.Day(), hour, minute, second, 0, loc)
		if occurrenceStart.Before(start) {
			continue
		}
		if len(result) == MaxOccurrences {
			return nil, errors.New("this schedule creates too many classes; choose an earlier end date")
		}
		result = append(result, Occurrence{Start: occurrenceStart.UTC(), End: occurrenceStart.Add(duration).UTC()})
	}
	if len(result) == 0 {
		return nil, errors.New("this schedule creates no classes")
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Start.Before(result[j].Start) })
	return result, nil
}

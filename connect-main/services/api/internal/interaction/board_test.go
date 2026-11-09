package interaction

import (
	"strings"
	"testing"
)

func TestValidBody(t *testing.T) {
	for body, want := range map[string]bool{
		"Why O(log n)?":          true,
		"two\nlines":             true,
		"":                       false,
		"   ":                    false,
		"tab\there":              false,
		strings.Repeat("a", 500): true,
		strings.Repeat("a", 501): false,
		strings.Repeat("é", 500): true,
		"bell\a":                 false,
	} {
		if got := validBody(body); got != want {
			t.Errorf("validBody(%q) = %v", body, got)
		}
	}
	if boardTools["rect"] != 2 || boardTools["note"] != 1 || boardTools["pen"] != 0 {
		t.Error("point counts")
	}
}

func TestPointBounds(t *testing.T) {
	outside := [][]float64{{-2.5, 3.2}}
	lo, hi := pointBounds("whiteboard")
	if !validPointsIn(outside, lo, hi) {
		t.Error("the whiteboard should accept points beyond its first view")
	}
	lo, hi = pointBounds("slide:00000000-0000-0000-0000-000000000000:1")
	if validPointsIn(outside, lo, hi) {
		t.Error("slide annotations must stay on the page")
	}
	if validPointsIn([][]float64{{9, 0}}, whiteboardMin, whiteboardMax) {
		t.Error("the whiteboard is large, not unbounded")
	}
	if boardTools["math"] != 1 {
		t.Error("math blocks have one point")
	}
}

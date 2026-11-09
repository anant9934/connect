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

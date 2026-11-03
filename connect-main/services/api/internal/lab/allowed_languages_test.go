package lab

import "testing"

func TestDefaultAllowedLanguages(t *testing.T) {
	if got := defaultAllowedLanguages(nil); len(got) == 0 {
		t.Fatal("omitted allowed_languages must default to a non-empty list, not NULL")
	}
	in := []string{"python"}
	if got := defaultAllowedLanguages(in); len(got) != 1 || got[0] != "python" {
		t.Fatalf("explicit languages must be kept, got %v", got)
	}
}

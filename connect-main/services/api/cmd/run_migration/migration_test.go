package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMigrationFiles(t *testing.T) {
	// Create a temporary directory with test SQL files
	tempDir, err := os.MkdirTemp("", "migration_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	testFiles := []string{
		"000003_third.sql",
		"000001_first.sql",
		"000002_second.sql",
		"readme.txt", // Non-SQL file should be ignored
	}

	for _, fname := range testFiles {
		err := os.WriteFile(filepath.Join(tempDir, fname), []byte("-- migration content"), 0644)
		if err != nil {
			t.Fatalf("failed to create test file %s: %v", fname, err)
		}
	}

	migrations, err := LoadMigrationFiles(tempDir)
	if err != nil {
		t.Fatalf("LoadMigrationFiles failed: %v", err)
	}

	if len(migrations) != 3 {
		t.Fatalf("expected 3 migrations, got %d", len(migrations))
	}

	// Verify alphanumeric sort order
	expectedOrder := []string{"000001_first", "000002_second", "000003_third"}
	for i, m := range migrations {
		if m.Version != expectedOrder[i] {
			t.Errorf("at index %d, expected version %s, got %s", i, expectedOrder[i], m.Version)
		}
	}
}

func TestFindMigrationDir(t *testing.T) {
	dir, err := FindMigrationDir()
	if err != nil {
		t.Fatalf("FindMigrationDir failed: %v", err)
	}

	files, err := LoadMigrationFiles(dir)
	if err != nil {
		t.Fatalf("failed to load migrations from discovered dir %s: %v", dir, err)
	}

	if len(files) < 8 {
		t.Errorf("expected at least 8 migrations in Connect repo, found %d", len(files))
	}
}

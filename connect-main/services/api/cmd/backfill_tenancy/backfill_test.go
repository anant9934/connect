package main

import (
	"testing"

	"github.com/google/uuid"
)

func TestClassifyRoom_Institutional(t *testing.T) {
	sessionID := uuid.New().String()
	hostID := uuid.New().String()

	wsType, orgID, isLocked := ClassifyRoom(&sessionID, &hostID, false)
	if wsType != "institutional" {
		t.Errorf("expected institutional, got %s", wsType)
	}
	if orgID != nil {
		t.Errorf("expected nil orgID (retained from parent class session), got %v", orgID)
	}
	if isLocked {
		t.Error("expected isLocked to be false")
	}
}

func TestClassifyRoom_PersonalCommons(t *testing.T) {
	hostID := uuid.New().String()

	wsType, orgID, isLocked := ClassifyRoom(nil, &hostID, true)
	if wsType != "personal_commons" {
		t.Errorf("expected personal_commons, got %s", wsType)
	}
	if orgID == nil || *orgID != CommonsOrgID {
		t.Errorf("expected orgID %s, got %v", CommonsOrgID, orgID)
	}
	if isLocked {
		t.Error("expected isLocked to be false")
	}
}

func TestClassifyRoom_PersonalWorkspace(t *testing.T) {
	hostID := uuid.New().String()

	wsType, orgID, isLocked := ClassifyRoom(nil, &hostID, false)
	if wsType != "personal_workspace" {
		t.Errorf("expected personal_workspace, got %s", wsType)
	}
	if orgID != nil {
		t.Errorf("expected nil orgID for private personal workspace, got %v", orgID)
	}
	if isLocked {
		t.Error("expected isLocked to be false")
	}
}

func TestClassifyRoom_QuarantineUnclassified(t *testing.T) {
	// Missing host and missing session -> Corrupted/unattributable historical record
	wsType, orgID, isLocked := ClassifyRoom(nil, nil, false)
	if wsType != "quarantine_unclassified" {
		t.Errorf("expected quarantine_unclassified, got %s", wsType)
	}
	if orgID != nil {
		t.Errorf("expected nil orgID for quarantined record (NEVER exposed in Commons), got %v", orgID)
	}
	if !isLocked {
		t.Error("expected quarantined room to be locked (isLocked = true)")
	}
}

func TestClassifyRoom_EmptyStringsTreatedAsNil(t *testing.T) {
	emptyStr := ""
	wsType, orgID, isLocked := ClassifyRoom(&emptyStr, &emptyStr, false)
	if wsType != "quarantine_unclassified" {
		t.Errorf("expected quarantine_unclassified for empty strings, got %s", wsType)
	}
	if !isLocked {
		t.Error("expected isLocked to be true")
	}
	if orgID != nil {
		t.Errorf("expected nil orgID, got %v", orgID)
	}
}

func TestClassifyRoom_AmbiguousFlagQuarantines(t *testing.T) {
	hostID := uuid.New().String()
	// Even with a valid hostID, if isAmbiguous is true, it MUST quarantine
	wsType, orgID, isLocked := ClassifyRoom(nil, &hostID, false, true)
	if wsType != "quarantine_unclassified" {
		t.Errorf("expected quarantine_unclassified for ambiguous record, got %s", wsType)
	}
	if !isLocked {
		t.Error("expected quarantined room to be locked (isLocked = true)")
	}
	if orgID != nil {
		t.Errorf("expected nil orgID, got %v", orgID)
	}
}

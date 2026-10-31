package auth_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
)

// computeHMAC computes the exact HMAC-SHA256 signature mirroring PostgreSQL connect_auth.authenticate_session.
func computeHMAC(secret []byte, userID, orgID string, isSuper bool, xid string, exp int64) string {
	payload := fmt.Sprintf("%s|%s|%t|%s|%d", userID, orgID, isSuper, xid, exp)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

// verifyHMACContext simulates the PL/pgSQL verification functions (current_user_id, current_org_id, is_super_admin).
func verifyHMACContext(secret []byte, userID, orgID string, isSuper bool, currentXID string, claimXID string, exp int64, sig string) (bool, string) {
	if userID == "" || claimXID == "" || exp == 0 || sig == "" {
		return false, "missing required context fields"
	}
	if currentXID != claimXID {
		return false, "transaction ID mismatch (cross-transaction replay)"
	}
	if time.Now().Unix() > exp {
		return false, "context expired"
	}
	expected := computeHMAC(secret, userID, orgID, isSuper, claimXID, exp)
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return false, "cryptographic signature mismatch (tampering detected)"
	}
	return true, ""
}

func TestAttackScenario_TamperUserID(t *testing.T) {
	secret := []byte("test_secret_key_32_bytes_long_12")
	realUser := uuid.New().String()
	attackerUser := uuid.New().String()
	xid := "1005"
	exp := time.Now().Add(10 * time.Minute).Unix()

	// Legitimate signature generated for realUser
	sig := computeHMAC(secret, realUser, "", false, xid, exp)

	// Attacker tampers with user ID
	valid, reason := verifyHMACContext(secret, attackerUser, "", false, xid, xid, exp, sig)
	if valid {
		t.Fatal("SECURITY FAILURE: Attacker successfully spoofed user ID with legitimate signature!")
	}
	if reason != "cryptographic signature mismatch (tampering detected)" {
		t.Errorf("unexpected failure reason: %s", reason)
	}
}

func TestAttackScenario_TamperOrganizationID(t *testing.T) {
	secret := []byte("test_secret_key_32_bytes_long_12")
	user := uuid.New().String()
	legitOrg := uuid.New().String()
	victimOrg := uuid.New().String()
	xid := "1006"
	exp := time.Now().Add(10 * time.Minute).Unix()

	// Signature generated for legitOrg
	sig := computeHMAC(secret, user, legitOrg, false, xid, exp)

	// Attacker substitutes victimOrg
	valid, reason := verifyHMACContext(secret, user, victimOrg, false, xid, xid, exp, sig)
	if valid {
		t.Fatal("SECURITY FAILURE: Attacker successfully escalated to victim organization!")
	}
	if reason != "cryptographic signature mismatch (tampering detected)" {
		t.Errorf("unexpected failure reason: %s", reason)
	}
}

func TestAttackScenario_SuperAdminEscalation(t *testing.T) {
	secret := []byte("test_secret_key_32_bytes_long_12")
	user := uuid.New().String()
	xid := "1007"
	exp := time.Now().Add(10 * time.Minute).Unix()

	// Signature generated for normal user (isSuper = false)
	sig := computeHMAC(secret, user, "", false, xid, exp)

	// Attacker flips isSuper = true
	valid, reason := verifyHMACContext(secret, user, "", true, xid, xid, exp, sig)
	if valid {
		t.Fatal("SECURITY FAILURE: Attacker successfully escalated to platform super-admin!")
	}
	if reason != "cryptographic signature mismatch (tampering detected)" {
		t.Errorf("unexpected failure reason: %s", reason)
	}
}

func TestAttackScenario_CrossTransactionReplay(t *testing.T) {
	secret := []byte("test_secret_key_32_bytes_long_12")
	user := uuid.New().String()
	tx1 := "1008"
	tx2 := "1009" // Different transaction in PgBouncer pool
	exp := time.Now().Add(10 * time.Minute).Unix()

	// Valid context from Transaction 1
	sig := computeHMAC(secret, user, "", false, tx1, exp)

	// Replayed in Transaction 2
	valid, reason := verifyHMACContext(secret, user, "", false, tx2, tx1, exp, sig)
	if valid {
		t.Fatal("SECURITY FAILURE: Stale transaction context successfully replayed across pooler boundary!")
	}
	if reason != "transaction ID mismatch (cross-transaction replay)" {
		t.Errorf("unexpected failure reason: %s", reason)
	}
}

func TestAttackScenario_ExpiredContext(t *testing.T) {
	secret := []byte("test_secret_key_32_bytes_long_12")
	user := uuid.New().String()
	xid := "1010"
	expiredTimestamp := time.Now().Add(-5 * time.Second).Unix()

	// Valid signature for an expired timestamp
	sig := computeHMAC(secret, user, "", false, xid, expiredTimestamp)

	valid, reason := verifyHMACContext(secret, user, "", false, xid, xid, expiredTimestamp, sig)
	if valid {
		t.Fatal("SECURITY FAILURE: Expired context accepted!")
	}
	if reason != "context expired" {
		t.Errorf("unexpected failure reason: %s", reason)
	}
}

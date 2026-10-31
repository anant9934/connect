package auth_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
)

// serializePayload mirrors PostgreSQL connect_auth.serialize_hmac_payload.
func serializePayload(userID, orgID string, isSuper bool, role, nonce, xid string, exp int64) string {
	superStr := "false"
	if isSuper {
		superStr = "true"
	}
	expStr := strconv.FormatInt(exp, 10)
	return fmt.Sprintf("%d:%s|%d:%s|%d:%s|%d:%s|%d:%s|%d:%s|%d:%s",
		len(userID), userID,
		len(orgID), orgID,
		len(superStr), superStr,
		len(role), role,
		len(nonce), nonce,
		len(xid), xid,
		len(expStr), expStr,
	)
}

// computeHMAC computes the exact HMAC-SHA256 signature mirroring PostgreSQL connect_auth.authenticate_session.
func computeHMAC(secret []byte, userID, orgID string, isSuper bool, role, nonce, xid string, exp int64) string {
	payload := serializePayload(userID, orgID, isSuper, role, nonce, xid, exp)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

// verifyHMACContext simulates the PL/pgSQL verification functions (current_user_id, current_org_id, is_super_admin, current_role).
func verifyHMACContext(secret []byte, userID, orgID string, isSuper bool, role, nonce, currentXID string, claimXID string, exp int64, sig string) (bool, string) {
	if userID == "" || claimXID == "" || exp == 0 || sig == "" || nonce == "" {
		return false, "missing required context fields"
	}
	if currentXID != claimXID {
		return false, "transaction ID mismatch (cross-transaction replay)"
	}
	if time.Now().Unix() > exp {
		return false, "context expired"
	}
	expected := computeHMAC(secret, userID, orgID, isSuper, role, nonce, claimXID, exp)
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return false, "cryptographic signature mismatch (tampering detected)"
	}
	return true, ""
}

func TestAttackScenario_TamperUserID(t *testing.T) {
	secret := []byte("test_secret_key_32_bytes_long_12")
	realUser := uuid.New().String()
	attackerUser := uuid.New().String()
	nonce := "a1b2c3d4e5f60718"
	xid := "1005"
	exp := time.Now().Add(10 * time.Minute).Unix()

	// Legitimate signature generated for realUser
	sig := computeHMAC(secret, realUser, "", false, "", nonce, xid, exp)

	// Attacker tampers with user ID
	valid, reason := verifyHMACContext(secret, attackerUser, "", false, "", nonce, xid, xid, exp, sig)
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
	nonce := "a1b2c3d4e5f60718"
	xid := "1006"
	exp := time.Now().Add(10 * time.Minute).Unix()

	// Signature generated for legitOrg
	sig := computeHMAC(secret, user, legitOrg, false, "institution_member", nonce, xid, exp)

	// Attacker substitutes victimOrg
	valid, reason := verifyHMACContext(secret, user, victimOrg, false, "institution_member", nonce, xid, xid, exp, sig)
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
	nonce := "a1b2c3d4e5f60718"
	xid := "1007"
	exp := time.Now().Add(10 * time.Minute).Unix()

	// Signature generated for normal user (isSuper = false)
	sig := computeHMAC(secret, user, "", false, "", nonce, xid, exp)

	// Attacker flips isSuper = true
	valid, reason := verifyHMACContext(secret, user, "", true, "", nonce, xid, xid, exp, sig)
	if valid {
		t.Fatal("SECURITY FAILURE: Attacker successfully escalated to platform super-admin!")
	}
	if reason != "cryptographic signature mismatch (tampering detected)" {
		t.Errorf("unexpected failure reason: %s", reason)
	}
}

func TestAttackScenario_TamperRole(t *testing.T) {
	secret := []byte("test_secret_key_32_bytes_long_12")
	user := uuid.New().String()
	org := uuid.New().String()
	nonce := "a1b2c3d4e5f60718"
	xid := "1008"
	exp := time.Now().Add(10 * time.Minute).Unix()

	// Signature generated for student role
	sig := computeHMAC(secret, user, org, false, "student", nonce, xid, exp)

	// Attacker elevates role to institution_admin
	valid, reason := verifyHMACContext(secret, user, org, false, "institution_admin", nonce, xid, xid, exp, sig)
	if valid {
		t.Fatal("SECURITY FAILURE: Attacker successfully elevated role to institution_admin!")
	}
	if reason != "cryptographic signature mismatch (tampering detected)" {
		t.Errorf("unexpected failure reason: %s", reason)
	}
}

func TestAttackScenario_TamperNonce(t *testing.T) {
	secret := []byte("test_secret_key_32_bytes_long_12")
	user := uuid.New().String()
	org := uuid.New().String()
	nonceReal := "a1b2c3d4e5f60718"
	nonceForged := "9999888877776666"
	xid := "1009"
	exp := time.Now().Add(10 * time.Minute).Unix()

	// Signature generated with nonceReal
	sig := computeHMAC(secret, user, org, false, "institution_admin", nonceReal, xid, exp)

	// Attacker substitutes nonceForged
	valid, reason := verifyHMACContext(secret, user, org, false, "institution_admin", nonceForged, xid, xid, exp, sig)
	if valid {
		t.Fatal("SECURITY FAILURE: Attacker substituted nonce!")
	}
	if reason != "cryptographic signature mismatch (tampering detected)" {
		t.Errorf("unexpected failure reason: %s", reason)
	}
}

func TestAttackScenario_CrossTransactionReplay(t *testing.T) {
	secret := []byte("test_secret_key_32_bytes_long_12")
	user := uuid.New().String()
	nonce := "a1b2c3d4e5f60718"
	tx1 := "1010"
	tx2 := "1011" // Different transaction in PgBouncer pool
	exp := time.Now().Add(10 * time.Minute).Unix()

	// Valid context from Transaction 1
	sig := computeHMAC(secret, user, "", false, "", nonce, tx1, exp)

	// Replayed in Transaction 2
	valid, reason := verifyHMACContext(secret, user, "", false, "", nonce, tx2, tx1, exp, sig)
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
	nonce := "a1b2c3d4e5f60718"
	xid := "1012"
	expiredTimestamp := time.Now().Add(-5 * time.Second).Unix()

	// Valid signature for an expired timestamp
	sig := computeHMAC(secret, user, "", false, "", nonce, xid, expiredTimestamp)

	valid, reason := verifyHMACContext(secret, user, "", false, "", nonce, xid, xid, expiredTimestamp, sig)
	if valid {
		t.Fatal("SECURITY FAILURE: Expired context accepted!")
	}
	if reason != "context expired" {
		t.Errorf("unexpected failure reason: %s", reason)
	}
}

func TestAttackScenario_DelimiterAmbiguityResistance(t *testing.T) {
	secret := []byte("test_secret_key_32_bytes_long_12")
	user := uuid.New().String()
	nonce := "a1b2c3d4e5f60718"
	xid := "1013"
	exp := time.Now().Add(10 * time.Minute).Unix()

	// Legitimate user context with empty org
	sig := computeHMAC(secret, user, "", false, "institution_member", nonce, xid, exp)

	// Attacker attempts to forge a context by injecting delimiter manipulation
	// into the role field to impersonate another organization
	fakeRole := "institution_member|injected"
	valid, _ := verifyHMACContext(secret, user, "", false, fakeRole, nonce, xid, xid, exp, sig)
	if valid {
		t.Fatal("SECURITY FAILURE: Delimiter injection succeeded in forging signature!")
	}

	// Verify that length prefixing produces different payloads for shifted inputs
	p1 := serializePayload("ab", "c", false, "role", nonce, xid, exp)
	p2 := serializePayload("a", "bc", false, "role", nonce, xid, exp)
	if p1 == p2 {
		t.Fatalf("SECURITY FAILURE: Serialized payloads collided: %s == %s", p1, p2)
	}
}

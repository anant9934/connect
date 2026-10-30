package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2id configuration parameters tuned for ~100-300ms verification time.
const (
	argonMemory      = 64 * 1024 // 64 MB
	argonIterations  = 3
	argonParallelism = 2
	argonSaltLength  = 16
	argonKeyLength   = 32
)

var (
	ErrInvalidHash         = errors.New("invalid argon2id password hash format")
	ErrIncompatibleVersion = errors.New("incompatible argon2id version")
)

// Precomputed dummy hash for constant-time comparison against non-existent users (enumeration protection).
var dummyHash string

func init() {
	salt := make([]byte, argonSaltLength)
	// Deterministic fixed salt for dummy calculation
	for i := range salt {
		salt[i] = byte(i)
	}
	hash := argon2.IDKey([]byte("dummy-tathastu-constant-time-placeholder"), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)
	dummyHash = fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argonMemory,
		argonIterations,
		argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)
}

// HashPassword hashes a plaintext password using Argon2id with cryptographically secure random salt.
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("failed to generate random salt: %w", err)
	}

	hash := argon2.IDKey([]byte(password), salt, argonIterations, argonMemory, argonParallelism, argonKeyLength)

	encoded := fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argonMemory,
		argonIterations,
		argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)

	return encoded, nil
}

// VerifyPassword securely validates a plaintext password against an encoded Argon2id hash.
func VerifyPassword(password, encodedHash string) (bool, error) {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 {
		return false, ErrInvalidHash
	}

	if parts[1] != "argon2id" {
		return false, ErrInvalidHash
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, ErrIncompatibleVersion
	}

	var memory uint32
	var iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return false, ErrInvalidHash
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, ErrInvalidHash
	}

	expectedHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, ErrInvalidHash
	}

	keyLen := len(expectedHash)
	if keyLen <= 0 || keyLen > 1024 {
		return false, ErrInvalidHash
	}
	computedHash := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(keyLen)) // #nosec G115

	// Constant-time comparison to prevent timing attacks
	if subtle.ConstantTimeCompare(computedHash, expectedHash) == 1 {
		return true, nil
	}

	return false, nil
}

// VerifyDummyPassword executes an identical Argon2id computation for non-existent users
// to neutralize timing attacks and protect against user enumeration.
func VerifyDummyPassword(password string) {
	_, _ = VerifyPassword(password, dummyHash)
}

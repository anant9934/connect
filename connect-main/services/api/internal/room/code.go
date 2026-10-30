package room

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
)

// Crockford Base32 characters excluding I, L, O, U to avoid visual ambiguity and accidental profanities.
const crockfordCharset = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// GeneratePublicCode generates a cryptographically secure, human-friendly 10-character code
// formatted as ABCD-EFGH-JK.
func GeneratePublicCode() (string, error) {
	chars := make([]byte, 10)
	charsetLen := big.NewInt(int64(len(crockfordCharset)))

	for i := 0; i < 10; i++ {
		idx, err := rand.Int(rand.Reader, charsetLen)
		if err != nil {
			return "", fmt.Errorf("failed to generate random code: %w", err)
		}
		chars[i] = crockfordCharset[idx.Int64()]
	}

	// Format: ABCD-EFGH-JK
	return fmt.Sprintf("%s-%s-%s", string(chars[0:4]), string(chars[4:8]), string(chars[8:10])), nil
}

// NormalizeCode strips hyphens and spaces, converting to uppercase.
func NormalizeCode(code string) string {
	cleaned := strings.ToUpper(strings.TrimSpace(code))
	cleaned = strings.ReplaceAll(cleaned, "-", "")
	cleaned = strings.ReplaceAll(cleaned, " ", "")
	if len(cleaned) == 10 {
		return fmt.Sprintf("%s-%s-%s", cleaned[0:4], cleaned[4:8], cleaned[8:10])
	}
	return cleaned
}

// IsValidCodeFormat checks if the code follows Crockford Base32 format.
func IsValidCodeFormat(code string) bool {
	raw := strings.ReplaceAll(strings.ReplaceAll(strings.ToUpper(code), "-", ""), " ", "")
	if len(raw) < 6 || len(raw) > 16 {
		return false
	}
	for i := 0; i < len(raw); i++ {
		if !strings.ContainsRune(crockfordCharset, rune(raw[i])) {
			return false
		}
	}
	return true
}

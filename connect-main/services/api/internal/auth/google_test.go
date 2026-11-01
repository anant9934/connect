package auth

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tathastu/connect/services/api/internal/audit"
)

func TestGoogleSignIn_FailsClosedAndChecksAudience(t *testing.T) {
	claims := map[string]string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(claims)
	}))
	defer server.Close()

	repo := NewMemoryRepository()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := NewService(repo, audit.NewService(nil, logger), time.Hour, time.Hour)
	svc.SetGoogleTokenInfoURL(server.URL)
	valid := map[string]string{"iss": "accounts.google.com", "aud": "ours", "sub": "s1", "email": "victim@example.test", "email_verified": "true"}

	claims = valid
	if _, err := svc.GoogleAuth(context.Background(), "t", "", ""); err == nil {
		t.Fatal("no configured client IDs must refuse every token")
	}

	svc.SetGoogleClientIDs([]string{"ours"})
	if _, err := repoSignup(repo, "victim@example.test"); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]map[string]string{
		"another application": {"aud": "attacker"},
		"another issuer":      {"iss": "https://evil.example"},
		"unverified email":    {"email_verified": "false"},
	} {
		claims = map[string]string{}
		for k, v := range valid {
			claims[k] = v
		}
		for k, v := range change {
			claims[k] = v
		}
		if _, err := svc.GoogleAuth(context.Background(), "t", "", ""); err == nil {
			t.Errorf("%s: token was accepted", name)
		}
	}
	u, err := repo.GetUserByEmail(context.Background(), "victim@example.test")
	if err != nil {
		t.Fatal(err)
	}
	if u.GoogleID != nil {
		t.Fatal("a refused token linked the existing account")
	}

	claims = valid
	if _, err := svc.GoogleAuth(context.Background(), "t", "", ""); err != nil {
		t.Fatalf("valid token refused: %v", err)
	}
}

func repoSignup(repo Repository, email string) (*User, error) {
	u := &User{EmailNormalized: email, DisplayName: "Victim", PasswordHash: "x"}
	return u, repo.CreateUser(context.Background(), u)
}

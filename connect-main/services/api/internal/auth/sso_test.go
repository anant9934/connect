package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
)

// fakeIdP is an OpenID Connect provider that signs ID tokens with a test RSA key.
type fakeIdP struct {
	srv      *httptest.Server
	key      *rsa.PrivateKey
	claims   map[string]any // overrides for the next token
	lastCode string
	nonce    string
	verifier string
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeIdP{key: key, claims: map[string]any{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"issuer": f.srv.URL, "authorization_endpoint": f.srv.URL + "/authorize", "token_endpoint": f.srv.URL + "/token", "jwks_uri": f.srv.URL + "/jwks"})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kid": "k1", "kty": "RSA", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("code") != f.lastCode || r.Form.Get("client_secret") != "s3cret" || r.Form.Get("code_verifier") == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.verifier = r.Form.Get("code_verifier")
		claims := jwt.MapClaims{"iss": f.srv.URL, "aud": "client-1", "sub": "u1", "email": "asha@anant.edu", "email_verified": true,
			"nonce": f.nonce, "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix()}
		for k, v := range f.claims {
			claims[k] = v
		}
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		tok.Header["kid"] = "k1"
		signed, _ := tok.SignedString(key)
		_ = json.NewEncoder(w).Encode(map[string]string{"id_token": signed, "access_token": "x"})
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func ssoRouter(h *Handlers) http.Handler {
	r := chi.NewRouter()
	r.Get("/api/v1/auth/sso/providers", h.SSOProviders)
	r.Get("/api/v1/auth/sso/{org}/start", h.SSOStart)
	r.Get("/api/v1/auth/sso/{org}/callback", h.SSOCallback)
	return r
}

// signIn runs start, the provider's redirect back, and the callback; it returns the callback response.
func signIn(t *testing.T, router http.Handler, idp *fakeIdP, mutate func(state *string)) *httptest.ResponseRecorder {
	t.Helper()
	start := httptest.NewRecorder()
	router.ServeHTTP(start, httptest.NewRequest(http.MethodGet, "/api/v1/auth/sso/anant-university/start?redirect=/study", nil))
	if start.Code != http.StatusFound {
		t.Fatalf("start: %d %s", start.Code, start.Body)
	}
	loc, _ := url.Parse(start.Header().Get("Location"))
	q := loc.Query()
	if q.Get("code_challenge_method") != "S256" || q.Get("redirect_uri") != "https://meet.example/api/v1/auth/sso/anant-university/callback" {
		t.Fatalf("authorize request: %v", q)
	}
	idp.nonce = q.Get("nonce")
	idp.lastCode = "code-123"
	state := q.Get("state")
	if mutate != nil {
		mutate(&state)
	}
	cb := httptest.NewRequest(http.MethodGet, "/api/v1/auth/sso/anant-university/callback?code=code-123&state="+url.QueryEscape(state), nil)
	for _, c := range start.Result().Cookies() {
		cb.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, cb)
	return rec
}

func TestSSOFlow(t *testing.T) {
	idp := newFakeIdP(t)
	repo := NewMemoryRepository()
	svc := NewService(repo, nil, time.Hour, time.Hour)
	ctx := context.Background()
	if _, err := svc.Signup(ctx, SignupDTO{Email: "asha@anant.edu", Password: "password-123", DisplayName: "Asha"}, "", ""); err != nil {
		t.Fatal(err)
	}
	repo.SetSSOMember("anant-university", "asha@anant.edu")
	sso, err := NewSSO([]*SSOProvider{{OrgSlug: "Anant-University", Issuer: idp.srv.URL, ClientID: "client-1", clientSecret: "s3cret", AllowedDomains: []string{"anant.edu"}}},
		"https://meet.example", []byte(strings.Repeat("k", 32)), false, nil)
	if err != nil {
		t.Fatal(err)
	}
	h := &Handlers{service: svc, sso: sso}
	router := ssoRouter(h)

	rec := signIn(t, router, idp, nil)
	if rec.Code != http.StatusFound || rec.Header().Get("Location") != "/study" {
		t.Fatalf("callback: %d %s", rec.Code, rec.Header().Get("Location"))
	}
	var session string
	for _, c := range rec.Result().Cookies() {
		if c.Name == CookieDev && c.Value != "" {
			session = c.Value
		}
	}
	if _, _, err := svc.ValidateSession(ctx, session); err != nil {
		t.Errorf("SSO should start a real session: %v", err)
	}

	fail := func(name, want string, mutate func(*string), claims map[string]any) {
		t.Helper()
		idp.claims = claims
		rec := signIn(t, router, idp, mutate)
		if loc := rec.Header().Get("Location"); loc != "/sign-in?sso_error="+want {
			t.Errorf("%s: redirected to %q, want error %s", name, loc, want)
		}
		for _, c := range rec.Result().Cookies() {
			if c.Name == CookieDev && c.Value != "" {
				t.Errorf("%s: a session cookie was set", name)
			}
		}
	}
	fail("forged state", "state_mismatch", func(s *string) { *s = "forged" }, nil)
	fail("wrong audience", "token_invalid", nil, map[string]any{"aud": "someone-else"})
	fail("wrong nonce", "token_invalid", nil, map[string]any{"nonce": "replayed"})
	fail("expired token", "token_invalid", nil, map[string]any{"exp": time.Now().Add(-time.Hour).Unix()})
	fail("unverified email", "token_invalid", nil, map[string]any{"email_verified": false})
	fail("other domain", "token_invalid", nil, map[string]any{"email": "eve@gmail.com"})
	fail("not a member", "not_a_member", nil, map[string]any{"email": "ravi@anant.edu"})

	// Open redirects are refused.
	if got := safeRedirect("//evil.example"); got != "/" {
		t.Errorf("safeRedirect: %q", got)
	}
	if got := safeRedirect("https://evil.example"); got != "/" {
		t.Errorf("safeRedirect: %q", got)
	}
	providers := httptest.NewRecorder()
	router.ServeHTTP(providers, httptest.NewRequest(http.MethodGet, "/api/v1/auth/sso/providers", nil))
	if !strings.Contains(providers.Body.String(), "anant-university") || strings.Contains(providers.Body.String(), "s3cret") {
		t.Errorf("providers: %s", providers.Body)
	}
}

func TestNewSSOValidation(t *testing.T) {
	p := func() []*SSOProvider {
		return []*SSOProvider{{OrgSlug: "u", Issuer: "https://idp", ClientID: "c", clientSecret: "s"}}
	}
	if _, err := NewSSO(p(), "https://app", []byte("short"), true, nil); err == nil {
		t.Error("a short state secret should be refused")
	}
	if _, err := NewSSO(p(), "http://app", []byte(strings.Repeat("k", 32)), true, nil); err == nil {
		t.Error("production needs an https app origin")
	}
	noSecret := []*SSOProvider{{OrgSlug: "u", Issuer: "https://idp", ClientID: "c"}}
	if _, err := NewSSO(noSecret, "https://app", []byte(strings.Repeat("k", 32)), true, nil); err == nil {
		t.Error("a provider without a secret should be left out, leaving none")
	}
}

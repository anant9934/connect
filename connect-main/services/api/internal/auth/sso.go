package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/tathastu/connect/services/api/internal/model"
)

// University single sign-on with OpenID Connect: authorization code flow with PKCE, a nonce and
// a signed state cookie, and ID token signatures checked against the provider's published keys.
// It signs in only people who already have an account and an active membership in that
// institution; it never creates accounts. Works with Google Workspace, Microsoft Entra ID, Okta
// and Keycloak. SAML is not supported.
//
// Configuration (environment):
//   SSO_PROVIDERS     JSON list: [{"orgSlug","label","issuer","clientId","clientSecretEnv",
//                     "allowedDomains":[...],"trustEmail":false}]
//   <clientSecretEnv> each provider's client secret, kept out of the JSON
//   SSO_STATE_SECRET  at least 32 characters, signs the short-lived state cookie
//   PUBLIC_APP_ORIGIN the web app origin; the callback is <origin>/api/v1/auth/sso/<slug>/callback

// SSOProvider is one institution's identity provider.
type SSOProvider struct {
	OrgSlug         string   `json:"orgSlug"`
	Label           string   `json:"label"`
	Issuer          string   `json:"issuer"`
	ClientID        string   `json:"clientId"`
	ClientSecretEnv string   `json:"clientSecretEnv"`
	AllowedDomains  []string `json:"allowedDomains"`
	// TrustEmail accepts an email without email_verified, for providers (such as Entra ID) that
	// only issue verified institutional addresses. Leave false unless that is true.
	TrustEmail   bool `json:"trustEmail"`
	clientSecret string
}

// SSO serves the single sign-on routes.
type SSO struct {
	providers    map[string]*SSOProvider
	appOrigin    string
	stateKey     []byte
	isProduction bool
	client       *http.Client
	now          func() time.Time

	mu        sync.Mutex
	discovery map[string]*oidcDiscovery
	keys      map[string]map[string]any // jwks uri -> kid -> public key
}

type oidcDiscovery struct {
	Issuer        string `json:"issuer"`
	AuthEndpoint  string `json:"authorization_endpoint"`
	TokenEndpoint string `json:"token_endpoint"`
	JWKSURI       string `json:"jwks_uri"`
	fetched       time.Time
}

const (
	ssoStateCookie = "tc_sso_state"
	ssoStateTTL    = 10 * time.Minute
	ssoCachePeriod = time.Hour
)

// LoadSSOFromEnv returns the configured single sign-on, or nil when it is not set up.
func LoadSSOFromEnv(isProduction bool) *SSO {
	raw := strings.TrimSpace(os.Getenv("SSO_PROVIDERS"))
	if raw == "" {
		return nil
	}
	var list []*SSOProvider
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		slog.Error("sso_config_invalid", slog.String("error", err.Error()))
		return nil
	}
	for _, p := range list {
		p.clientSecret = os.Getenv(p.ClientSecretEnv)
	}
	sso, err := NewSSO(list, os.Getenv("PUBLIC_APP_ORIGIN"), []byte(os.Getenv("SSO_STATE_SECRET")), isProduction, nil)
	if err != nil {
		slog.Error("sso_disabled", slog.String("error", err.Error()))
		return nil
	}
	return sso
}

// NewSSO validates the configuration. Providers without a client secret are left out.
func NewSSO(list []*SSOProvider, appOrigin string, stateKey []byte, isProduction bool, client *http.Client) (*SSO, error) {
	if len(stateKey) < 32 {
		return nil, errors.New("SSO_STATE_SECRET must be at least 32 characters")
	}
	appOrigin = strings.TrimRight(appOrigin, "/")
	if appOrigin == "" || (isProduction && !strings.HasPrefix(appOrigin, "https://")) {
		return nil, errors.New("PUBLIC_APP_ORIGIN must be set (https in production)")
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	s := &SSO{providers: map[string]*SSOProvider{}, appOrigin: appOrigin, stateKey: stateKey, isProduction: isProduction, client: client,
		now: time.Now, discovery: map[string]*oidcDiscovery{}, keys: map[string]map[string]any{}}
	for _, p := range list {
		p.OrgSlug = strings.ToLower(strings.TrimSpace(p.OrgSlug))
		if p.OrgSlug == "" || p.Issuer == "" || p.ClientID == "" || p.clientSecret == "" {
			slog.Warn("sso_provider_skipped", slog.String("org", p.OrgSlug))
			continue
		}
		if isProduction && !strings.HasPrefix(p.Issuer, "https://") {
			return nil, fmt.Errorf("issuer for %s must use https", p.OrgSlug)
		}
		if p.Label == "" {
			p.Label = "Sign in with your university account"
		}
		s.providers[p.OrgSlug] = p
	}
	if len(s.providers) == 0 {
		return nil, errors.New("no usable SSO providers")
	}
	return s, nil
}

func (s *SSO) callbackURL(slug string) string {
	return s.appOrigin + "/api/v1/auth/sso/" + url.PathEscape(slug) + "/callback"
}

func randomString(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// safeRedirect allows only a path on this site, never another origin.
func safeRedirect(path string) string {
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || strings.HasPrefix(path, "/\\") || strings.ContainsAny(path, "\r\n") {
		return "/"
	}
	return path
}

type ssoState struct {
	Slug     string `json:"g"`
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Redirect string `json:"r"`
	Expires  int64  `json:"e"`
}

func (s *SSO) sign(payload []byte) string {
	mac := hmac.New(sha256.New, s.stateKey)
	mac.Write(payload)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *SSO) encodeState(st ssoState) string {
	payload, _ := json.Marshal(st)
	enc := base64.RawURLEncoding.EncodeToString(payload)
	return enc + "." + s.sign([]byte(enc))
}

func (s *SSO) decodeState(v string) (*ssoState, error) {
	parts := strings.SplitN(v, ".", 2)
	if len(parts) != 2 || !hmac.Equal([]byte(s.sign([]byte(parts[0]))), []byte(parts[1])) {
		return nil, errors.New("bad state signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, err
	}
	var st ssoState
	if err := json.Unmarshal(raw, &st); err != nil {
		return nil, err
	}
	if s.now().Unix() > st.Expires {
		return nil, errors.New("state expired")
	}
	return &st, nil
}

func (s *SSO) getJSON(ctx context.Context, u string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: status %d", u, res.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(out)
}

func (s *SSO) discover(ctx context.Context, p *SSOProvider) (*oidcDiscovery, error) {
	s.mu.Lock()
	cached := s.discovery[p.Issuer]
	s.mu.Unlock()
	if cached != nil && s.now().Sub(cached.fetched) < ssoCachePeriod {
		return cached, nil
	}
	var d oidcDiscovery
	if err := s.getJSON(ctx, strings.TrimRight(p.Issuer, "/")+"/.well-known/openid-configuration", &d); err != nil {
		return nil, err
	}
	if strings.TrimRight(d.Issuer, "/") != strings.TrimRight(p.Issuer, "/") || d.AuthEndpoint == "" || d.TokenEndpoint == "" || d.JWKSURI == "" {
		return nil, errors.New("discovery document does not match the issuer")
	}
	d.fetched = s.now()
	s.mu.Lock()
	s.discovery[p.Issuer] = &d
	s.mu.Unlock()
	return &d, nil
}

func b64Int(v string) (*big.Int, error) {
	b, err := base64.RawURLEncoding.DecodeString(v)
	if err != nil {
		return nil, err
	}
	return new(big.Int).SetBytes(b), nil
}

// publicKey returns the provider's signing key with this kid, fetching the key set again when
// the kid is new (providers rotate keys).
func (s *SSO) publicKey(ctx context.Context, jwksURI, kid string) (any, error) {
	s.mu.Lock()
	key, ok := s.keys[jwksURI][kid]
	s.mu.Unlock()
	if ok {
		return key, nil
	}
	var doc struct {
		Keys []struct {
			Kid, Kty, Use, N, E, Crv, X, Y string
		} `json:"keys"`
	}
	if err := s.getJSON(ctx, jwksURI, &doc); err != nil {
		return nil, err
	}
	fresh := map[string]any{}
	for _, k := range doc.Keys {
		if k.Use != "" && k.Use != "sig" {
			continue
		}
		switch k.Kty {
		case "RSA":
			n, err1 := b64Int(k.N)
			e, err2 := b64Int(k.E)
			if err1 == nil && err2 == nil {
				fresh[k.Kid] = &rsa.PublicKey{N: n, E: int(e.Int64())}
			}
		case "EC":
			x, err1 := b64Int(k.X)
			y, err2 := b64Int(k.Y)
			if err1 == nil && err2 == nil && k.Crv == "P-256" {
				fresh[k.Kid] = &ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}
			}
		}
	}
	s.mu.Lock()
	s.keys[jwksURI] = fresh
	s.mu.Unlock()
	if key, ok := fresh[kid]; ok {
		return key, nil
	}
	return nil, errors.New("unknown signing key")
}

type idClaims struct {
	Email         string `json:"email"`
	EmailVerified any    `json:"email_verified"`
	Nonce         string `json:"nonce"`
	jwt.RegisteredClaims
}

func verified(v any) bool {
	switch b := v.(type) {
	case bool:
		return b
	case string:
		return b == "true"
	}
	return false
}

// verifyIDToken checks the signature, issuer, audience, expiry and nonce, and returns the email.
func (s *SSO) verifyIDToken(ctx context.Context, p *SSOProvider, d *oidcDiscovery, raw, nonce string) (string, error) {
	var claims idClaims
	_, err := jwt.ParseWithClaims(raw, &claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		return s.publicKey(ctx, d.JWKSURI, kid)
	}, jwt.WithValidMethods([]string{"RS256", "ES256"}), jwt.WithIssuer(d.Issuer), jwt.WithAudience(p.ClientID),
		jwt.WithExpirationRequired(), jwt.WithLeeway(60*time.Second), jwt.WithTimeFunc(s.now))
	if err != nil {
		return "", err
	}
	if claims.Nonce == "" || !hmac.Equal([]byte(claims.Nonce), []byte(nonce)) {
		return "", errors.New("nonce mismatch")
	}
	email := strings.ToLower(strings.TrimSpace(claims.Email))
	if email == "" || !strings.Contains(email, "@") {
		return "", errors.New("no email in the ID token")
	}
	if !verified(claims.EmailVerified) && !p.TrustEmail {
		return "", errors.New("email not verified by the provider")
	}
	if len(p.AllowedDomains) > 0 {
		domain := email[strings.LastIndex(email, "@")+1:]
		allowed := false
		for _, d := range p.AllowedDomains {
			allowed = allowed || strings.EqualFold(domain, strings.TrimSpace(d))
		}
		if !allowed {
			return "", errors.New("email domain not allowed")
		}
	}
	return email, nil
}

// --- HTTP ---

// SSOProviders handles GET /api/v1/auth/sso/providers: which institutions offer single sign-on.
func (h *Handlers) SSOProviders(w http.ResponseWriter, r *http.Request) {
	out := []map[string]string{}
	if h.sso != nil {
		for slug, p := range h.sso.providers {
			out = append(out, map[string]string{"orgSlug": slug, "label": p.Label})
		}
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"providers": out})
}

func (h *Handlers) ssoFail(w http.ResponseWriter, r *http.Request, code string, err error) {
	if err != nil {
		slog.Warn("sso_failed", slog.String("reason", code), slog.String("error", err.Error()))
	}
	http.SetCookie(w, &http.Cookie{Name: ssoStateCookie, Value: "", Path: "/api/v1/auth/sso", MaxAge: -1, HttpOnly: true, Secure: h.isProduction, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, "/sign-in?sso_error="+url.QueryEscape(code), http.StatusFound)
}

// SSOStart handles GET /api/v1/auth/sso/{org}/start?redirect=/path.
func (h *Handlers) SSOStart(w http.ResponseWriter, r *http.Request) {
	if h.sso == nil {
		h.ssoFail(w, r, "not_configured", nil)
		return
	}
	slug := strings.ToLower(chi.URLParam(r, "org"))
	p, ok := h.sso.providers[slug]
	if !ok {
		h.ssoFail(w, r, "unknown_institution", nil)
		return
	}
	if h.limiter != nil {
		if allowed, err := h.limiter.Allow(r.Context(), "sso_start:"+extractIP(r), 30, time.Minute); err != nil || !allowed {
			h.ssoFail(w, r, "too_many_attempts", err)
			return
		}
	}
	d, err := h.sso.discover(r.Context(), p)
	if err != nil {
		h.ssoFail(w, r, "provider_unavailable", err)
		return
	}
	st := ssoState{Slug: slug, State: randomString(24), Nonce: randomString(24), Verifier: randomString(48),
		Redirect: safeRedirect(r.URL.Query().Get("redirect")), Expires: h.sso.now().Add(ssoStateTTL).Unix()}
	http.SetCookie(w, &http.Cookie{Name: ssoStateCookie, Value: h.sso.encodeState(st), Path: "/api/v1/auth/sso",
		MaxAge: int(ssoStateTTL.Seconds()), HttpOnly: true, Secure: h.isProduction, SameSite: http.SameSiteLaxMode})
	challenge := sha256.Sum256([]byte(st.Verifier))
	q := url.Values{
		"response_type":         {"code"},
		"client_id":             {p.ClientID},
		"redirect_uri":          {h.sso.callbackURL(slug)},
		"scope":                 {"openid email profile"},
		"state":                 {st.State},
		"nonce":                 {st.Nonce},
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(challenge[:])},
		"code_challenge_method": {"S256"},
	}
	sep := "?"
	if strings.Contains(d.AuthEndpoint, "?") {
		sep = "&"
	}
	http.Redirect(w, r, d.AuthEndpoint+sep+q.Encode(), http.StatusFound)
}

// SSOCallback handles GET /api/v1/auth/sso/{org}/callback from the identity provider.
func (h *Handlers) SSOCallback(w http.ResponseWriter, r *http.Request) {
	if h.sso == nil {
		h.ssoFail(w, r, "not_configured", nil)
		return
	}
	slug := strings.ToLower(chi.URLParam(r, "org"))
	p, ok := h.sso.providers[slug]
	if !ok {
		h.ssoFail(w, r, "unknown_institution", nil)
		return
	}
	if e := r.URL.Query().Get("error"); e != "" {
		h.ssoFail(w, r, "provider_refused", errors.New(e))
		return
	}
	cookie, err := r.Cookie(ssoStateCookie)
	if err != nil {
		h.ssoFail(w, r, "session_expired", err)
		return
	}
	st, err := h.sso.decodeState(cookie.Value)
	if err != nil || st.Slug != slug || !hmac.Equal([]byte(st.State), []byte(r.URL.Query().Get("state"))) {
		h.ssoFail(w, r, "state_mismatch", err)
		return
	}
	code := r.URL.Query().Get("code")
	if code == "" {
		h.ssoFail(w, r, "no_code", nil)
		return
	}
	d, err := h.sso.discover(r.Context(), p)
	if err != nil {
		h.ssoFail(w, r, "provider_unavailable", err)
		return
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {h.sso.callbackURL(slug)},
		"client_id": {p.ClientID}, "client_secret": {p.clientSecret}, "code_verifier": {st.Verifier}}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, d.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		h.ssoFail(w, r, "token_exchange_failed", err)
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	res, err := h.sso.client.Do(req)
	if err != nil {
		h.ssoFail(w, r, "token_exchange_failed", err)
		return
	}
	defer res.Body.Close()
	var tok struct {
		IDToken string `json:"id_token"`
	}
	if res.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&tok) != nil || tok.IDToken == "" {
		h.ssoFail(w, r, "token_exchange_failed", fmt.Errorf("token endpoint status %d", res.StatusCode))
		return
	}
	email, err := h.sso.verifyIDToken(r.Context(), p, d, tok.IDToken, st.Nonce)
	if err != nil {
		h.ssoFail(w, r, "token_invalid", err)
		return
	}
	userID, err := h.service.repo.UserIDForSSO(r.Context(), slug, email)
	if err != nil || userID == "" {
		h.ssoFail(w, r, "not_a_member", err)
		return
	}
	result, err := h.service.StartSessionForUser(r.Context(), userID, extractIP(r), getRequestID(r))
	if err != nil {
		h.ssoFail(w, r, "account_unavailable", err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: ssoStateCookie, Value: "", Path: "/api/v1/auth/sso", MaxAge: -1, HttpOnly: true, Secure: h.isProduction, SameSite: http.SameSiteLaxMode})
	SetSessionCookie(w, result.Token, h.isProduction, 7*24*time.Hour)
	http.Redirect(w, r, st.Redirect, http.StatusFound)
}

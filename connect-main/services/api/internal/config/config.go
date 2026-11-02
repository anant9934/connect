package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Environment constants
const (
	EnvDevelopment = "development"
	EnvStaging     = "staging"
	EnvProduction  = "production"
)

// Config holds validated application configuration.
type Config struct {
	AppEnv                 string
	Port                   int
	LogLevel               string
	DatabaseURL            string
	WorkerDatabaseURL      string
	WorkerDBMaxOpenConns   int32
	WorkerDBMaxIdleConns   int32
	DBMaxOpenConns         int32
	DBMaxIdleConns         int32
	DBConnMaxLifetime      time.Duration
	RedisURL               string
	RedisTLSEnabled        bool
	RateLimitEnabled       bool
	RateLimitRPS           int
	RateLimitBurst         int
	CORSAllowedOrigins     []string
	LiveKitURL             string
	LiveKitAPIKey          string
	LiveKitAPISecret       string
	PublicAppOrigin        string
	SessionIdleTimeout     time.Duration
	SessionAbsoluteTimeout time.Duration
	TathastuIntegrationURL string
	TathastuIssuer         string
	TathastuAudience       string
	GoogleClientIDs        []string

	// Cloud Object Storage (Cloudflare R2 / AWS S3)
	StorageProvider   string
	R2Endpoint        string
	R2Bucket          string
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2Region          string

	// Malware Scanner Configuration
	ClamAVEnabled bool
	ClamAVHost    string
	ClamAVPort    int

	// Hybrid WebRTC Media Configuration (Phase 5.2A)
	HybridMediaEnabled    bool
	P2PPilotEnabled       bool
	P2PDirectMediaEnabled bool
	ICEServers            []string

	// In-Process Background Worker Configuration (Free-Tier Zero Cost Mode)
	WorkerEnabled      bool
	WorkerConcurrency  int
	WorkerBatchSize    int
	WorkerPollInterval time.Duration
	WorkerLeaseTTL     time.Duration
}

// Load reads and validates configuration from environment variables.
func Load() (*Config, error) {
	return load(false)
}

// LoadWorker loads configuration for the standalone worker, which holds no API database setting.
func LoadWorker() (*Config, error) {
	cfg, err := load(true)
	if err != nil {
		return nil, err
	}
	if cfg.WorkerDatabaseURL == "" {
		return nil, errors.New("configuration error: WORKER_DATABASE_URL is required to run the worker; it never falls back to DATABASE_URL")
	}
	return cfg, nil
}

func load(forWorker bool) (*Config, error) {
	loadDotEnv()

	appEnv := getEnv("APP_ENV", EnvDevelopment)
	if appEnv != EnvDevelopment && appEnv != EnvStaging && appEnv != EnvProduction {
		return nil, fmt.Errorf("invalid APP_ENV: %s (must be development, staging, or production)", appEnv)
	}

	port, err := strconv.Atoi(getEnv("PORT", "8080"))
	if err != nil || port <= 0 || port > 65535 {
		return nil, fmt.Errorf("invalid PORT: must be between 1 and 65535")
	}

	corsOriginsRaw := getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
	var corsOrigins []string
	originSet := make(map[string]bool)
	for _, o := range strings.Split(corsOriginsRaw, ",") {
		trimmed := strings.TrimSpace(o)
		if trimmed != "" {
			lower := strings.ToLower(trimmed)
			if !originSet[lower] {
				originSet[lower] = true
				corsOrigins = append(corsOrigins, trimmed)
			}
		}
	}

	publicAppOrigin := getEnv("PUBLIC_APP_ORIGIN", "")
	if publicAppOrigin == "" {
		if appEnv == EnvProduction || appEnv == EnvStaging {
			publicAppOrigin = "https://connect.aitathastu.com"
		} else if len(corsOrigins) > 0 {
			publicAppOrigin = corsOrigins[0]
		} else {
			publicAppOrigin = "http://localhost:3000"
		}
	}

	// Always ensure publicAppOrigin is in allowed origins
	if publicAppOrigin != "" {
		lower := strings.ToLower(publicAppOrigin)
		if !originSet[lower] {
			originSet[lower] = true
			corsOrigins = append(corsOrigins, publicAppOrigin)
		}
	}

	// For staging and production, always include canonical domain and legacy domain for zero-downtime migration
	if appEnv == EnvProduction || appEnv == EnvStaging {
		for _, d := range []string{"https://connect.aitathastu.com", "https://connect-mauve-nine.vercel.app"} {
			lower := strings.ToLower(d)
			if !originSet[lower] {
				originSet[lower] = true
				corsOrigins = append(corsOrigins, d)
			}
		}
	}

	dbMaxOpen64, err := strconv.ParseInt(getEnv("DB_MAX_OPEN_CONNS", "25"), 10, 32)
	if err != nil || dbMaxOpen64 <= 0 || dbMaxOpen64 > 1000 {
		dbMaxOpen64 = 25
	}
	dbMaxOpen := int32(dbMaxOpen64)

	dbMaxIdle64, err := strconv.ParseInt(getEnv("DB_MAX_IDLE_CONNS", "10"), 10, 32)
	if err != nil || dbMaxIdle64 <= 0 || dbMaxIdle64 > 1000 {
		dbMaxIdle64 = 10
	}
	dbMaxIdle := int32(dbMaxIdle64)

	dbLifetimeSec, _ := strconv.Atoi(getEnv("DB_CONN_MAX_LIFETIME_SEC", "300"))

	rateLimitEnabled := getEnv("RATE_LIMIT_ENABLED", "true") == "true"
	rateLimitRPS, _ := strconv.Atoi(getEnv("RATE_LIMIT_RPS", "100"))
	rateLimitBurst, _ := strconv.Atoi(getEnv("RATE_LIMIT_BURST", "200"))

	idleTimeoutHours, _ := strconv.Atoi(getEnv("SESSION_IDLE_TIMEOUT_HOURS", "12"))
	if idleTimeoutHours <= 0 {
		idleTimeoutHours = 12
	}
	absTimeoutDays, _ := strconv.Atoi(getEnv("SESSION_ABSOLUTE_TIMEOUT_DAYS", "7"))
	if absTimeoutDays <= 0 {
		absTimeoutDays = 7
	}

	clamavPort, _ := strconv.Atoi(getEnv("CLAMAV_PORT", "3310"))

	cfg := &Config{
		AppEnv:                 appEnv,
		Port:                   port,
		LogLevel:               getEnv("LOG_LEVEL", "info"),
		WorkerDatabaseURL:      os.Getenv("WORKER_DATABASE_URL"),
		WorkerDBMaxOpenConns:   envInt32("WORKER_DB_MAX_OPEN_CONNS", 5),
		WorkerDBMaxIdleConns:   envInt32("WORKER_DB_MAX_IDLE_CONNS", 1),
		DatabaseURL:            getEnv("DATABASE_URL", "postgres://connect_app:connect_dev_password@localhost:5432/connect_db?sslmode=disable"),
		DBMaxOpenConns:         dbMaxOpen,
		DBMaxIdleConns:         dbMaxIdle,
		DBConnMaxLifetime:      time.Duration(dbLifetimeSec) * time.Second,
		RedisURL:               getEnv("REDIS_URL", "redis://localhost:6379/0"),
		RedisTLSEnabled:        getEnv("REDIS_TLS_ENABLED", "false") == "true",
		RateLimitEnabled:       rateLimitEnabled,
		RateLimitRPS:           rateLimitRPS,
		RateLimitBurst:         rateLimitBurst,
		CORSAllowedOrigins:     corsOrigins,
		LiveKitURL:             getEnv("LIVEKIT_URL", "http://localhost:7880"),
		LiveKitAPIKey:          getEnv("LIVEKIT_API_KEY", "devkey"),
		LiveKitAPISecret:       getEnv("LIVEKIT_API_SECRET", "devsecret"),
		PublicAppOrigin:        publicAppOrigin,
		SessionIdleTimeout:     time.Duration(idleTimeoutHours) * time.Hour,
		SessionAbsoluteTimeout: time.Duration(absTimeoutDays) * 24 * time.Hour,
		TathastuIntegrationURL: getEnv("TATHASTU_INTEGRATION_URL", "https://api.aitathastu.internal"),
		TathastuIssuer:         getEnv("TATHASTU_ISSUER", "https://auth.aitathastu.internal"),
		TathastuAudience:       getEnv("TATHASTU_AUDIENCE", "tathastu-connect-service"),
		GoogleClientIDs:        strings.Split(getEnv("GOOGLE_CLIENT_IDS", ""), ","),
		StorageProvider:        getEnv("STORAGE_PROVIDER", "local"),
		R2Endpoint:             getEnv("R2_ENDPOINT", ""),
		R2Bucket:               getEnv("R2_BUCKET", ""),
		R2AccessKeyID:          getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey:      getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2Region:               getEnv("R2_REGION", "auto"),
		ClamAVEnabled:          getEnv("CLAMAV_ENABLED", "false") == "true",
		ClamAVHost:             getEnv("CLAMAV_HOST", "localhost"),
		ClamAVPort:             clamavPort,
		HybridMediaEnabled:     getEnv("HYBRID_MEDIA_ENABLED", "false") == "true",
		P2PPilotEnabled:        getEnv("P2P_PILOT_ENABLED", "false") == "true",
		P2PDirectMediaEnabled:  getEnv("P2P_DIRECT_MEDIA_ENABLED", "false") == "true",
		ICEServers:             strings.Split(getEnv("WEBRTC_ICE_SERVERS", "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"), ","),
		WorkerEnabled:          getEnv("WORKER_ENABLED", "false") == "true",
		WorkerConcurrency:      1,
		WorkerBatchSize:        1,
		WorkerPollInterval:     5 * time.Second,
		WorkerLeaseTTL:         30 * time.Second,
	}

	if cStr := getEnv("WORKER_CONCURRENCY", "1"); cStr != "" {
		if c, err := strconv.Atoi(cStr); err == nil && c > 0 {
			cfg.WorkerConcurrency = c
		}
	}
	if bStr := getEnv("WORKER_BATCH_SIZE", "1"); bStr != "" {
		if b, err := strconv.Atoi(bStr); err == nil && b > 0 {
			cfg.WorkerBatchSize = b
		}
	}
	if pStr := getEnv("WORKER_POLL_INTERVAL", "5s"); pStr != "" {
		if d, err := time.ParseDuration(pStr); err == nil && d > 0 {
			cfg.WorkerPollInterval = d
		}
	}
	if lStr := getEnv("WORKER_LEASE_TTL", "30s"); lStr != "" {
		if d, err := time.ParseDuration(lStr); err == nil && d > 0 {
			cfg.WorkerLeaseTTL = d
		}
	}

	if forWorker {
		cfg.WorkerEnabled = cfg.WorkerDatabaseURL != ""
	}
	if err := validateDatabaseSeparation(cfg); err != nil {
		return nil, err
	}

	// A standalone worker serves no traffic, so API-only settings do not apply to it.
	if forWorker {
		cfg.WorkerEnabled = true
		cfg.DatabaseURL = ""
		if cfg.AppEnv == EnvProduction && cfg.StorageProvider == "r2" &&
			(cfg.R2Endpoint == "" || cfg.R2Bucket == "" || cfg.R2AccessKeyID == "" || cfg.R2SecretAccessKey == "") {
			return nil, errors.New("production configuration error: valid R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY required when STORAGE_PROVIDER=r2")
		}
		return cfg, nil
	}

	// Strict Production Security Gates: Fail closed if production missing critical secrets
	if cfg.AppEnv == EnvProduction {
		if cfg.DatabaseURL == "" || strings.Contains(cfg.DatabaseURL, "connect_dev_password") {
			return nil, errors.New("production configuration error: valid secure DATABASE_URL required")
		}
		if cfg.RedisURL == "" {
			return nil, errors.New("production configuration error: REDIS_URL required")
		}
		for _, o := range cfg.CORSAllowedOrigins {
			if o == "*" {
				return nil, errors.New("production configuration error: CORS wildcard '*' forbidden in production")
			}
		}
		if cfg.PublicAppOrigin == "" || !strings.HasPrefix(cfg.PublicAppOrigin, "https://") {
			return nil, errors.New("production configuration error: PUBLIC_APP_ORIGIN must use secure HTTPS")
		}
		if cfg.LiveKitAPIKey == "" || strings.Contains(cfg.LiveKitAPIKey, "placeholder") || cfg.LiveKitAPIKey == "devkey" {
			return nil, errors.New("production configuration error: valid secure LIVEKIT_API_KEY required")
		}
		if cfg.LiveKitAPISecret == "" || strings.Contains(cfg.LiveKitAPISecret, "placeholder") || cfg.LiveKitAPISecret == "devsecret" {
			return nil, errors.New("production configuration error: valid secure LIVEKIT_API_SECRET required")
		}
		if cfg.StorageProvider == "r2" {
			if cfg.R2Endpoint == "" || cfg.R2Bucket == "" || cfg.R2AccessKeyID == "" || cfg.R2SecretAccessKey == "" {
				return nil, errors.New("production configuration error: valid R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY required when STORAGE_PROVIDER=r2")
			}
		}
	}

	return cfg, nil
}

// validateDatabaseSeparation refuses configurations that blur the three database identities.
// The roles themselves are verified against the live connection at startup.
func validateDatabaseSeparation(cfg *Config) error {
	if cfg.WorkerEnabled && cfg.WorkerDatabaseURL == "" {
		return errors.New("configuration error: WORKER_DATABASE_URL is required when the worker is enabled; it never falls back to DATABASE_URL")
	}
	if cfg.WorkerDatabaseURL != "" && cfg.WorkerDatabaseURL == os.Getenv("DATABASE_URL") {
		return errors.New("configuration error: WORKER_DATABASE_URL must not be the same as DATABASE_URL")
	}
	if cfg.AppEnv == EnvProduction && os.Getenv("MIGRATION_DATABASE_URL") != "" {
		return errors.New("production configuration error: MIGRATION_DATABASE_URL must not be set on runtime services")
	}
	return nil
}

func envInt32(key string, defaultVal int32) int32 {
	parsed, err := strconv.ParseInt(os.Getenv(key), 10, 32)
	if err != nil || parsed <= 0 {
		return defaultVal
	}
	return int32(parsed)
}

func getEnv(key, defaultVal string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return val
	}
	return defaultVal
}

func loadDotEnv() {
	paths := []string{".env", "../../../../../.env", "../../../../.env", "../../../.env", "../../.env", "../.env"}
	for _, p := range paths {
		cleaned := filepath.Clean(p)
		// #nosec G304 -- local config paths are fixed internal constants
		data, err := os.ReadFile(cleaned)
		if err == nil {
			for _, line := range strings.Split(string(data), "\n") {
				line = strings.TrimSpace(line)
				if line == "" || strings.HasPrefix(line, "#") {
					continue
				}
				parts := strings.SplitN(line, "=", 2)
				if len(parts) == 2 {
					key := strings.TrimSpace(parts[0])
					val := strings.Trim(strings.TrimSpace(parts[1]), "\"'")
					if _, exists := os.LookupEnv(key); !exists {
						_ = os.Setenv(key, val)
					}
				}
			}
			return
		}
	}
}

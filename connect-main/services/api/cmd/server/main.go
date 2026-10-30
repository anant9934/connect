package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/files"
	"github.com/tathastu/connect/services/api/internal/handlers"
	"github.com/tathastu/connect/services/api/internal/livekit"
	"github.com/tathastu/connect/services/api/internal/meeting/p2p"
	"github.com/tathastu/connect/services/api/internal/notes"
	"github.com/tathastu/connect/services/api/internal/ratelimit"
	"github.com/tathastu/connect/services/api/internal/redis"
	"github.com/tathastu/connect/services/api/internal/room"
	"github.com/tathastu/connect/services/api/internal/server"
)

const buildVersion = "v0.1.0"

func main() {
	// 1. Initial logger setup
	logLevel := slog.LevelInfo
	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel})
	logger := slog.New(handler)
	slog.SetDefault(logger)

	logger.Info("application_initializing", slog.String("version", buildVersion))

	// 2. Load and validate environment configuration
	cfg, err := config.Load()
	if err != nil {
		logger.Error("configuration_validation_failed", slog.String("error", err.Error()))
		os.Exit(1) // Fail closed on invalid configuration
	}

	// 3. Database connection pool initialization
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var db *database.DB
	db, err = database.Connect(ctx, cfg)
	if err != nil {
		if cfg.AppEnv == config.EnvProduction {
			logger.Error("production_database_connection_failed", slog.String("error", err.Error()))
			os.Exit(1)
		}
		logger.Warn("database_connection_unavailable_dev_mode", slog.String("error", err.Error()))
	} else {
		logger.Info("database_connected_successfully")
		defer db.Close()
	}

	// 4. Redis connection initialization
	var rdb *redis.Client
	var limiter ratelimit.Limiter

	rdb, err = redis.Connect(ctx, cfg)
	if err != nil {
		if cfg.AppEnv == config.EnvProduction {
			logger.Error("production_redis_connection_failed", slog.String("error", err.Error()))
			os.Exit(1)
		}
		logger.Warn("redis_unavailable_using_dev_memory_limiter", slog.String("error", err.Error()))

		devLimiter, devErr := ratelimit.NewDevMemoryLimiter(cfg.AppEnv)
		if devErr != nil {
			logger.Error("failed_to_initialize_dev_limiter", slog.String("error", devErr.Error()))
			os.Exit(1)
		}
		limiter = devLimiter
	} else {
		logger.Info("redis_connected_successfully")
		defer func() { _ = rdb.Close() }()
		limiter = ratelimit.NewRedisLimiter(rdb.Rdb)
	}

	// 5. Initialize Repositories and Services
	var dbPool *pgxpool.Pool
	if db != nil {
		dbPool = db.Pool
	}

	auditService := audit.NewService(dbPool, logger)

	var authRepo auth.Repository
	if db != nil {
		authRepo = auth.NewPgxRepository(db.Pool)
	} else {
		logger.Warn("using_memory_auth_repository_dev_mode")
		authRepo = auth.NewMemoryRepository()
	}

	authService := auth.NewService(authRepo, auditService, cfg.SessionIdleTimeout, cfg.SessionAbsoluteTimeout)
	authHandler := auth.NewHandlers(authService, limiter, cfg.AppEnv == config.EnvProduction)

	var roomRepo room.Repository
	if db != nil {
		roomRepo = room.NewPgxRepository(db.Pool)
	} else {
		logger.Warn("using_memory_room_repository_dev_mode")
		roomRepo = room.NewMemoryRepository()
	}

	roomPolicy := room.NewPolicy()
	tokenService := livekit.NewTokenService(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
	roomManager := livekit.NewRoomManager(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
	room.SetGuestTokenSecret([]byte(cfg.LiveKitAPISecret))
	roomService := room.NewService(roomRepo, roomPolicy, auditService, tokenService, roomManager)
	roomHandler := room.NewHandlers(roomService, limiter, cfg.PublicAppOrigin, cfg.LiveKitURL)

	// Notes domain
	var notesRepo notes.Repository
	if db != nil {
		notesRepo = notes.NewPgxRepository(db.Pool)
	} else {
		notesRepo = notes.NewMemoryRepository()
	}
	notesService := notes.NewService(notesRepo, roomService, auditService)
	notesHandler := notes.NewHandler(notesService)

	// Files domain
	var filesRepo files.Repository
	var filesStorage files.StorageProvider
	if db != nil {
		filesRepo = files.NewPgxRepository(db.Pool)
	} else {
		filesRepo = files.NewMemoryRepository()
	}

	if cfg.StorageProvider == "r2" {
		r2Prov, err := files.NewR2StorageProvider(context.Background(), files.R2StorageConfig{
			Endpoint:        cfg.R2Endpoint,
			Bucket:          cfg.R2Bucket,
			AccessKeyID:     cfg.R2AccessKeyID,
			SecretAccessKey: cfg.R2SecretAccessKey,
			Region:          cfg.R2Region,
		})
		if err != nil {
			logger.Error("failed_to_initialize_r2_storage", slog.String("error", err.Error()))
			if cfg.AppEnv == config.EnvProduction {
				os.Exit(1)
			}
			filesStorage = files.NewMemoryStorageProvider()
		} else {
			logger.Info("cloud_r2_storage_initialized", slog.String("bucket", cfg.R2Bucket))
			filesStorage = r2Prov
		}
	} else if cfg.StorageProvider == "memory" {
		filesStorage = files.NewMemoryStorageProvider()
	} else {
		localStorage, err := files.NewLocalStorageProvider("data/storage/private")
		if err != nil {
			logger.Error("failed_to_initialize_local_storage", slog.String("error", err.Error()))
			filesStorage = files.NewMemoryStorageProvider()
		} else {
			filesStorage = localStorage
		}
	}

	filesScanner := files.NewProductionScanner(cfg.ClamAVEnabled, cfg.ClamAVHost, cfg.ClamAVPort)
	filesService := files.NewService(filesRepo, filesStorage, filesScanner, roomService, auditService)
	filesHandler := files.NewHandler(filesService)

	// Hybrid WebRTC P2P Signaling (Phase 5.2A)
	p2pHub := p2p.NewHub(logger)
	p2pHandler := p2p.NewHandler(cfg, logger, p2pHub, roomService, authService)

	var dbPinger handlers.Pinger
	if db != nil {
		dbPinger = db
	}
	var redisPinger handlers.Pinger
	if rdb != nil {
		redisPinger = rdb
	}
	healthHandler := handlers.NewHealthHandler(dbPinger, redisPinger, logger)
	systemHandler := handlers.NewSystemHandler(buildVersion)
	assertionHandler := handlers.NewAssertionHandler(cfg)

	// 6. Assemble Router and Hardened Server
	router := server.BuildRouter(cfg, logger, limiter, healthHandler, systemHandler, assertionHandler, authHandler, roomHandler, notesHandler, filesHandler, authService, p2pHandler)
	srv := server.New(cfg, logger, router)

	// 7. Channel for OS interruption signals
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	// 8. Start HTTP Server in background
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- srv.Start()
	}()

	logger.Info("server_ready_for_traffic", slog.Int("port", cfg.Port), slog.String("env", cfg.AppEnv))

	// 9. Block until interrupt signal or unrecoverable error
	select {
	case err := <-serverErrors:
		logger.Error("server_listener_error", slog.String("error", err.Error()))
		os.Exit(1)
	case sig := <-stop:
		logger.Info("shutdown_signal_received", slog.String("signal", sig.String()))

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()

		if err := srv.Shutdown(shutdownCtx); err != nil {
			logger.Error("graceful_shutdown_failed", slog.String("error", err.Error()))
			_ = fmt.Errorf("forced shutdown: %w", err)
			os.Exit(1)
		}
		logger.Info("server_shutdown_completed_cleanly")
	}
}

package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tathastu/connect/services/api/internal/ai"
	"github.com/tathastu/connect/services/api/internal/attendance"
	"github.com/tathastu/connect/services/api/internal/audit"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/avatars"
	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/files"
	"github.com/tathastu/connect/services/api/internal/handlers"
	"github.com/tathastu/connect/services/api/internal/institution"
	"github.com/tathastu/connect/services/api/internal/interaction"
	"github.com/tathastu/connect/services/api/internal/lab"
	"github.com/tathastu/connect/services/api/internal/livekit"
	"github.com/tathastu/connect/services/api/internal/meeting/p2p"
	"github.com/tathastu/connect/services/api/internal/meetings"
	"github.com/tathastu/connect/services/api/internal/notes"
	"github.com/tathastu/connect/services/api/internal/notifications"
	"github.com/tathastu/connect/services/api/internal/ratelimit"
	"github.com/tathastu/connect/services/api/internal/redis"
	"github.com/tathastu/connect/services/api/internal/room"
	"github.com/tathastu/connect/services/api/internal/server"
	"github.com/tathastu/connect/services/api/internal/worker"
)

const buildVersion = "v0.1.0"

// enforceDatabaseIdentity stops a production process connected as anything but its own restricted
// role. Elsewhere it warns, so local setups without the roles keep working.
func enforceDatabaseIdentity(db *database.DB, role string, cfg *config.Config, logger *slog.Logger) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	err := database.VerifyRuntimeIdentity(ctx, db.Pool, role)
	if err == nil {
		logger.Info("database_identity_verified", slog.String("role", role))
		return
	}
	if cfg.AppEnv == config.EnvProduction {
		logger.Error("database_identity_rejected", slog.String("role", role), slog.String("error", err.Error()))
		os.Exit(1)
	}
	logger.Warn("database_identity_unverified_non_production", slog.String("role", role), slog.String("error", err.Error()))
}

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
		enforceDatabaseIdentity(db, database.RoleAPI, cfg, logger)
	}

	// The in-process worker has its own pool and role. A configured worker that cannot connect
	// stops startup: running without it would silently lose background work.
	var workerDB *database.DB
	if cfg.WorkerEnabled && db != nil {
		workerCtx, workerCtxCancel := context.WithTimeout(context.Background(), 20*time.Second)
		workerDB, err = database.ConnectWorker(workerCtx, cfg)
		workerCtxCancel()
		if err != nil {
			logger.Error("worker_database_connection_failed", slog.String("error", err.Error()))
			os.Exit(1)
		}
		defer workerDB.Close()
		enforceDatabaseIdentity(workerDB, database.RoleWorker, cfg, logger)
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
	authService.SetGoogleClientIDs(cfg.GoogleClientIDs)
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
	var notesRooms notes.RoomValidator = roomService
	if db != nil {
		notesRepo = notes.NewPgxRepository(db.Pool)
		notesRooms = notes.NewPgxRoomValidator(db.Pool)
	} else {
		notesRepo = notes.NewMemoryRepository()
	}
	notesService := notes.NewService(notesRepo, notesRooms, auditService)
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
	filesService := files.NewService(filesRepo, filesStorage, filesScanner, notesRooms, auditService)
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

	var livekitWebhook http.Handler
	if db != nil && db.Pool != nil {
		livekitWebhook = attendance.NewWebhookHandler(cfg.LiveKitAPIKey, cfg.LiveKitAPISecret, attendance.NewPgxSessionStore(db.Pool), logger)
	}

	// 6. Assemble Router and Hardened Server
	var institutionHandler *institution.Handler
	var interactionHandler *interaction.Handler
	var notificationsHandler *notifications.Handler
	var meetingsHandler *meetings.Handler
	var labHandler *lab.Handler
	var aiHandler *ai.Handler
	var aiService *ai.Service
	if db != nil {
		institutionHandler = institution.NewHandler(db.Pool, auditService)
		interactionHandler = interaction.NewHandler(db.Pool, roomService, limiter, auditService)
		notificationsHandler = notifications.NewHandler(db.Pool)
		meetingsHandler = meetings.NewHandler(db.Pool, cfg.PublicAppOrigin)
		labHandler = lab.NewHandler(db.Pool, auditService)

		// Real providers only; the mock provider is never registered in production
		// and is never used as a fallback.
		aiRegistry := ai.NewDefaultModelRegistry()
		aiRouter := ai.BuildRouter(aiRegistry, ai.LoadKeyPoolsFromEnv(), cfg.AppEnv != config.EnvProduction)
		logger.Info("ai_router_configured", slog.Int("real_providers", aiRouter.ConfiguredProviderCount()))

		aiService = ai.NewService(aiRouter, aiRegistry, limiter, ai.ServiceConfig{
			DefaultModel:     ai.ModelGeminiFlash,
			DefaultFastModel: ai.ModelGeminiFlashLite,
		})
		aiHandler = ai.NewHandler(db.Pool, aiService)
	}
	router := server.BuildRouter(cfg, logger, limiter, healthHandler, systemHandler, assertionHandler, authHandler, roomHandler, notesHandler, filesHandler, authService, p2pHandler, livekitWebhook, institutionHandler, interactionHandler, notificationsHandler, meetingsHandler, avatars.NewHandler(authService, filesStorage), labHandler, aiHandler)
	srv := server.New(cfg, logger, router)

	// 7. Initialize In-Process Background Worker (if enabled)
	var workerRunner *worker.Runner
	var workerCancel context.CancelFunc
	workerDone := make(chan struct{})

	if workerDB != nil {
		runnerCfg := worker.DefaultRunnerConfig()
		hostname, _ := os.Hostname()
		if hostname == "" {
			hostname = "inproc"
		}
		runnerCfg.WorkerID = fmt.Sprintf("inproc-%s-%d", hostname, os.Getpid())
		runnerCfg.Concurrency = cfg.WorkerConcurrency
		runnerCfg.BatchSize = cfg.WorkerBatchSize
		runnerCfg.PollInterval = cfg.WorkerPollInterval
		runnerCfg.LeaseTTL = cfg.WorkerLeaseTTL
		runnerCfg.HeartbeatInterval = cfg.WorkerLeaseTTL / 3

		workerRegistry := worker.NewRegistry()
		worker.RegisterDefaultHandlers(workerRegistry, workerDB.Pool, filesStorage, logger)
		if aiService != nil {
			ai.RegisterAIHandlers(workerRegistry, workerDB.Pool, aiService, ai.NewRepository(), logger)
		}

		var err error
		workerRunner, err = worker.NewRunner(workerDB.Pool, workerRegistry, logger, runnerCfg)
		if err != nil {
			logger.Error("failed_to_initialize_inproc_worker", slog.String("error", err.Error()))
			os.Exit(1)
		}

		var workerCtx context.Context
		workerCtx, workerCancel = context.WithCancel(context.Background())
		// Finalise attendance for every class that has ended, even if nobody pressed "End for all".
		go worker.RunAttendanceSweep(workerCtx, workerDB.Pool, logger, worker.AttendanceSweepInterval)

		go func() {
			defer close(workerDone)
			logger.Info("inproc_worker_started",
				slog.String("worker_id", runnerCfg.WorkerID),
				slog.Int("concurrency", runnerCfg.Concurrency),
				slog.Duration("poll_interval", runnerCfg.PollInterval),
				slog.Duration("lease_ttl", runnerCfg.LeaseTTL),
			)
			if err := workerRunner.Run(workerCtx); err != nil && err != context.Canceled {
				logger.Error("inproc_worker_terminated_with_error", slog.String("error", err.Error()))
			}
		}()
	} else {
		close(workerDone)
		if !cfg.WorkerEnabled {
			logger.Info("inproc_worker_disabled_by_config")
		} else {
			logger.Warn("inproc_worker_disabled_no_database_pool")
		}
	}

	// 8. Channel for OS interruption signals
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	// 9. Start HTTP Server in background
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- srv.Start()
	}()

	logger.Info("server_ready_for_traffic", slog.Int("port", cfg.Port), slog.String("env", cfg.AppEnv))

	// 10. Block until interrupt signal or unrecoverable error
	select {
	case err := <-serverErrors:
		logger.Error("server_listener_error", slog.String("error", err.Error()))
		if workerCancel != nil {
			workerCancel()
			workerRunner.Stop()
			<-workerDone
		}
		workerDB.Close()
		db.Close()
		os.Exit(1)
	case sig := <-stop:
		logger.Info("shutdown_signal_received", slog.String("signal", sig.String()))

		// Phase 1: Stop accepting new background jobs and drain in-flight jobs
		if workerCancel != nil {
			logger.Info("stopping_inproc_worker")
			workerCancel()
			workerRunner.Stop()
		}

		// Phase 2: Shut down HTTP server gracefully
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()

		if err := srv.Shutdown(shutdownCtx); err != nil {
			logger.Error("graceful_shutdown_failed", slog.String("error", err.Error()))
			_ = fmt.Errorf("forced shutdown: %w", err)
		}

		// Phase 3: Wait for in-flight background jobs to complete
		select {
		case <-workerDone:
			logger.Info("inproc_worker_drained_successfully")
		case <-time.After(15 * time.Second):
			logger.Warn("inproc_worker_drain_timed_out")
		}

		logger.Info("server_and_worker_shutdown_completed_cleanly")
	}
}

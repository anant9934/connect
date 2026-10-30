package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/files"
	"github.com/tathastu/connect/services/api/internal/handlers"
	"github.com/tathastu/connect/services/api/internal/meeting/p2p"
	appmw "github.com/tathastu/connect/services/api/internal/middleware"
	"github.com/tathastu/connect/services/api/internal/notes"
	"github.com/tathastu/connect/services/api/internal/ratelimit"
	"github.com/tathastu/connect/services/api/internal/room"
)

// Server wraps the hardened net/http HTTP server.
type Server struct {
	httpServer *http.Server
	logger     *slog.Logger
}

// BuildRouter configures the Chi router and middleware chain.
func BuildRouter(
	cfg *config.Config,
	logger *slog.Logger,
	limiter ratelimit.Limiter,
	healthHandler *handlers.HealthHandler,
	systemHandler *handlers.SystemHandler,
	assertionHandler *handlers.AssertionHandler,
	authHandler *auth.Handlers,
	roomHandler *room.Handlers,
	notesHandler *notes.Handler,
	filesHandler *files.Handler,
	authService *auth.Service,
	p2pHandler *p2p.Handler,
) http.Handler {
	r := chi.NewRouter()

	// 1. Correlation & Context Propagation
	r.Use(appmw.RequestID)

	// 2. Safe Panic Recovery (Zero client leaks)
	r.Use(appmw.Recoverer(logger))

	// 3. Centralized HTTP Security Headers Policy
	r.Use(appmw.SecurityHeaders(appmw.SecurityHeadersConfig{
		IsProduction: cfg.AppEnv == config.EnvProduction,
	}))

	// 4. Strict CORS
	r.Use(appmw.CORS(cfg.CORSAllowedOrigins))

	// 5. Request Body Size Limit (1MB maximum)
	r.Use(appmw.BodySizeLimit(1024 * 1024))

	// 6. JSON Content-Type validation
	r.Use(appmw.RequireJSONContentType)

	// 7. Structured Access Logging
	r.Use(appmw.StructuredLogging(logger))

	// 8. Distributed Rate Limiting (if enabled)
	if cfg.RateLimitEnabled && limiter != nil {
		r.Use(ratelimit.Middleware(limiter, cfg.RateLimitRPS, time.Second))
	}

	// Health Endpoints (Lightweight, non-leaking probes)
	r.Get("/health/live", healthHandler.Live)
	r.Get("/health/ready", healthHandler.Ready)

	// Versioned v1 API Routes
	r.Route("/api/v1", func(api chi.Router) {
		api.Get("/system/status", systemHandler.Status)
		api.Post("/collab/validate-assertion", assertionHandler.ValidateAssertion)

		// Authentication Routes (state-changing protected by CSRF)
		api.Route("/auth", func(authRouter chi.Router) {
			if authHandler != nil {
				authRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/signup", authHandler.Signup)
				authRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/login", authHandler.Login)
				authRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/google", authHandler.GoogleAuth)
				authRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/logout", authHandler.Logout)
				authRouter.Get("/session", authHandler.Session)
			}
		})

		// User Profile & Account Management Routes
		api.Route("/users", func(usersRouter chi.Router) {
			if authHandler != nil && authService != nil {
				usersRouter.Route("/me", func(meRouter chi.Router) {
					meRouter.Use(appmw.RequireAuth(authService))

					meRouter.Get("/profile", authHandler.GetProfile)
					meRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Patch("/profile", authHandler.UpdateProfile)
					meRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/change-password", authHandler.ChangePassword)
					meRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/preferences", authHandler.UpdatePreferences)
					meRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/link-google", authHandler.LinkGoogle)
				})
			}
		})


		// Rooms Routes
		api.Route("/rooms", func(roomsRouter chi.Router) {
			if roomHandler != nil && authService != nil {
				// Create room requires authenticated session & CSRF check
				roomsRouter.With(
					appmw.CSRFProtection(cfg.CORSAllowedOrigins),
					appmw.RequireAuth(authService),
				).Post("/", roomHandler.Create)

				// Meeting history for authenticated users
				roomsRouter.With(
					appmw.RequireAuth(authService),
				).Get("/history", roomHandler.History)

				roomsRouter.Route("/{code}", func(roomDetail chi.Router) {
					// Room status lookup
					roomDetail.Get("/", roomHandler.Get)

					// Join room (Optional auth, guests permitted with display name)
					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.OptionalAuth(authService),
					).Post("/join", roomHandler.Join)

					// Leave room
					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.OptionalAuth(authService),
					).Post("/leave", roomHandler.Leave)

					// Waiting room admission flow
					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
					).Post("/admission/request", roomHandler.RequestAdmission)

					roomDetail.Get("/admission/status", roomHandler.GetAdmissionStatus)

					roomDetail.With(
						appmw.RequireAuth(authService),
					).Get("/admission/pending", roomHandler.GetPendingAdmissions)

					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/admission/decision", roomHandler.DecideAdmission)

					// Host participant management (Remove, Mute, Promote, Demote)
					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/participants/{identity}/remove", roomHandler.RemoveParticipant)

					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/participants/{identity}/mute", roomHandler.MuteParticipant)

					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/participants/{identity}/promote-speaker", roomHandler.PromoteSpeaker)

					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/participants/{identity}/demote-speaker", roomHandler.DemoteSpeaker)

					// Host actions: Lock, Unlock, End (Require authenticated session)
					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/lock", roomHandler.Lock)

					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/unlock", roomHandler.Unlock)

					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/end", roomHandler.End)

					// Participants list
					roomDetail.Get("/participants", roomHandler.Participants)

					// LiveKit token issue (Optional auth: authenticated user or room-scoped guest)
					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.OptionalAuth(authService),
					).Post("/token", roomHandler.Token)

					// WebRTC P2P Direct Media (Phase 5.2A)
					if p2pHandler != nil {
						roomDetail.With(
							appmw.OptionalAuth(authService),
						).Get("/p2p/config", p2pHandler.GetConfig)

						roomDetail.With(
							appmw.OptionalAuth(authService),
						).Get("/p2p/ws", p2pHandler.ServeWS)
					}

					// Notes routes
					if notesHandler != nil {
						roomDetail.With(
							appmw.OptionalAuth(authService),
						).Get("/notes", notesHandler.GetNotes)

						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Put("/notes", notesHandler.UpdateNotes)
					}

					// Files routes
					if filesHandler != nil {
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/files/upload", filesHandler.UploadFile)

						roomDetail.With(
							appmw.OptionalAuth(authService),
						).Get("/files", filesHandler.ListFiles)

						roomDetail.With(
							appmw.OptionalAuth(authService),
						).Get("/files/{id}/download", filesHandler.DownloadFile)

						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Delete("/files/{id}", filesHandler.DeleteFile)
					}
				})
			}
		})
	})

	return r
}

// New constructs a hardened Server instance with strict timeouts.
func New(cfg *config.Config, logger *slog.Logger, router http.Handler) *Server {
	addr := fmt.Sprintf(":%d", cfg.Port)

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,  // Slowloris mitigation
		ReadTimeout:       15 * time.Second, // Request body read limit
		WriteTimeout:      15 * time.Second, // Response write limit
		IdleTimeout:       60 * time.Second, // Keep-alive idle limit
		MaxHeaderBytes:    1 << 20,          // 1 MB max request headers
	}

	return &Server{
		httpServer: httpSrv,
		logger:     logger,
	}
}

// Start runs the HTTP listener.
func (s *Server) Start() error {
	s.logger.Info("http_server_starting", slog.String("addr", s.httpServer.Addr))
	err := s.httpServer.ListenAndServe()
	if err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("http server failure: %w", err)
	}
	return nil
}

// Shutdown gracefully terminates in-flight connections within the timeout.
func (s *Server) Shutdown(ctx context.Context) error {
	s.logger.Info("http_server_shutting_down")
	return s.httpServer.Shutdown(ctx)
}

package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/tathastu/connect/services/api/internal/ai"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/avatars"
	"github.com/tathastu/connect/services/api/internal/config"
	"github.com/tathastu/connect/services/api/internal/files"
	"github.com/tathastu/connect/services/api/internal/handlers"
	"github.com/tathastu/connect/services/api/internal/institution"
	"github.com/tathastu/connect/services/api/internal/interaction"
	"github.com/tathastu/connect/services/api/internal/lab"
	"github.com/tathastu/connect/services/api/internal/meeting/p2p"
	"github.com/tathastu/connect/services/api/internal/meetings"
	appmw "github.com/tathastu/connect/services/api/internal/middleware"
	"github.com/tathastu/connect/services/api/internal/notes"
	"github.com/tathastu/connect/services/api/internal/notifications"
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
	livekitWebhook http.Handler,
	institutionHandler *institution.Handler,
	interactionHandler *interaction.Handler,
	notificationsHandler *notifications.Handler,
	meetingsHandler *meetings.Handler,
	avatarsHandler *avatars.Handler,
	labHandler *lab.Handler,
	aiHandler ...*ai.Handler,
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

	// Health Endpoints (Lightweight, non-leaking probes, uninhibited by Redis rate limiting)
	r.Get("/health/live", healthHandler.Live)
	r.Get("/health/ready", healthHandler.Ready)

	// Versioned v1 API Routes
	r.Route("/api/v1", func(api chi.Router) {
		api.Get("/system/status", systemHandler.Status)
		api.Post("/collab/validate-assertion", assertionHandler.ValidateAssertion)

		// LiveKit webhooks authenticate by signature, not session or origin
		if livekitWebhook != nil {
			api.Method(http.MethodPost, "/livekit/webhook", livekitWebhook)
		}

		// Authentication Routes (state-changing protected by CSRF)
		api.Route("/auth", func(authRouter chi.Router) {
			if authHandler != nil {
				authRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/signup", authHandler.Signup)
				authRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/login", authHandler.Login)
				authRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/login/member", authHandler.MemberLogin)
				authRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/password/forgot", authHandler.ForgotPassword)
				authRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/password/reset", authHandler.ResetPassword)
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
					if avatarsHandler != nil {
						meRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Post("/avatar", avatarsHandler.Upload)
						meRouter.With(appmw.CSRFProtection(cfg.CORSAllowedOrigins)).Delete("/avatar", avatarsHandler.Remove)
					}
				})
				if avatarsHandler != nil {
					usersRouter.With(appmw.RequireAuth(authService)).Get("/{id}/avatar", avatarsHandler.Serve)
				}
			}
		})

		// Institution Management Routes (roles are enforced by the database)
		if institutionHandler != nil && authService != nil {
			api.Group(func(g chi.Router) {
				g.Use(appmw.CSRFProtection(cfg.CORSAllowedOrigins))
				g.Use(appmw.RequireAuth(authService))
				institutionHandler.RegisterRoutes(g)
			})
		}

		// Practical Learning & Programming Lab Routes
		if labHandler != nil && authService != nil {
			api.Group(func(g chi.Router) {
				g.Use(appmw.CSRFProtection(cfg.CORSAllowedOrigins))
				g.Use(appmw.RequireAuth(authService))
				labHandler.RegisterRoutes(g)
			})
		}

		// AI Learning Intelligence Routes
		var activeAIHandler *ai.Handler
		if len(aiHandler) > 0 {
			activeAIHandler = aiHandler[0]
		}
		if activeAIHandler != nil && authService != nil {
			api.Group(func(g chi.Router) {
				g.Use(appmw.CSRFProtection(cfg.CORSAllowedOrigins))
				g.Use(appmw.RequireAuth(authService))
				activeAIHandler.RegisterRoutes(g)
			})
		}

		if meetingsHandler != nil && authService != nil {
			api.Group(func(g chi.Router) {
				g.Use(appmw.RequireAuth(authService))
				meetingsHandler.RegisterRoutes(g)
			})
		}

		if notificationsHandler != nil && authService != nil {
			api.Group(func(g chi.Router) {
				g.Use(appmw.CSRFProtection(cfg.CORSAllowedOrigins))
				g.Use(appmw.RequireAuth(authService))
				notificationsHandler.RegisterRoutes(g)
			})
		}

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

				roomsRouter.With(
					appmw.RequireAuth(authService),
				).Get("/upcoming", roomHandler.Upcoming)

				// An 11-digit meeting number resolves to the room's code; rate-limited per address.
				roomsRouter.Get("/by-number/{number}", roomHandler.ResolveMeetingNumber)

				roomsRouter.Route("/{code}", func(roomDetail chi.Router) {
					// Room status lookup
					roomDetail.Get("/", roomHandler.Get)

					// Change or cancel a scheduled meeting (Host only)
					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Patch("/", roomHandler.Reschedule)

					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/cancel", roomHandler.Cancel)

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
						appmw.OptionalAuth(authService),
					).Post("/admission/request", roomHandler.RequestAdmission)

					roomDetail.With(
						appmw.OptionalAuth(authService),
					).Get("/admission/status", roomHandler.GetAdmissionStatus)

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

					// Co-hosts, host transfer and room permissions
					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/participants/{identity}/cohost", roomHandler.GrantCoHost)

					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Delete("/participants/{identity}/cohost", roomHandler.RevokeCoHost)

					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/participants/{identity}/transfer-host", roomHandler.TransferHost)

					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Put("/permissions", roomHandler.UpdatePermissions)

					roomDetail.With(
						appmw.CSRFProtection(cfg.CORSAllowedOrigins),
						appmw.RequireAuth(authService),
					).Post("/mute-all", roomHandler.MuteAll)

					roomDetail.With(
						appmw.OptionalAuth(authService),
					).Get("/me", roomHandler.Me)

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
					roomDetail.With(
						appmw.OptionalAuth(authService),
					).Get("/participants", roomHandler.Participants)

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

					// Chat, announcements, reactions and raised hands
					if interactionHandler != nil {
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/messages", interactionHandler.ListMessages)
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/live-state", interactionHandler.LiveState)
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/classroom", interactionHandler.GetClassroom)
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/board", interactionHandler.ListStrokes)
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/canvas", interactionHandler.GetCanvas)
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/transcript", interactionHandler.ListTranscript)
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/canvas/submissions", interactionHandler.ListSimulationAnswers)
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/breakouts", interactionHandler.GetBreakouts)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/breakouts", interactionHandler.OpenBreakouts)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/breakouts/assign", interactionHandler.AssignBreakout)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/breakouts/close", interactionHandler.CloseBreakouts)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Patch("/classroom", interactionHandler.UpdateClassroom)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/board/strokes", interactionHandler.PostStroke)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/board/remove", interactionHandler.RemoveStrokes)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/board/move", interactionHandler.MoveStroke)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/canvas/generate", interactionHandler.GenerateCanvas)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/canvas/save", interactionHandler.SaveCanvasDeck)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/transcript", interactionHandler.PostTranscript)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/transcript/audio", interactionHandler.PostTranscriptAudio)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/recordings", interactionHandler.SaveRecording)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Patch("/canvas", interactionHandler.UpdateCanvas)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Put("/canvas/slides/{index}", interactionHandler.EditCanvasSlide)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/canvas/submit", interactionHandler.SubmitSimulation)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/messages", interactionHandler.PostMessage)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/reactions", interactionHandler.PostReaction)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/activity", interactionHandler.ReportActivity)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.OptionalAuth(authService),
						).Post("/hand", interactionHandler.SetHand)
						roomDetail.With(
							appmw.CSRFProtection(cfg.CORSAllowedOrigins),
							appmw.RequireAuth(authService),
						).Delete("/participants/{identity}/hand", interactionHandler.LowerHand)

						roomDetail.With(appmw.OptionalAuth(authService)).Get("/polls", interactionHandler.ListPolls)
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/doubts", interactionHandler.ListDoubts)
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/leaderboard", interactionHandler.Leaderboard)
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/polls/{id}/scores", interactionHandler.PollScores)
						roomDetail.With(appmw.OptionalAuth(authService)).Get("/engagement", interactionHandler.RoomEngagement)
						for path, handler := range map[string]http.HandlerFunc{
							"/polls":               interactionHandler.CreatePoll,
							"/polls/{id}/respond":  interactionHandler.RespondPoll,
							"/polls/{id}/close":    interactionHandler.ClosePoll,
							"/doubts":              interactionHandler.AskDoubt,
							"/doubts/{id}/assign":  interactionHandler.AssignDoubt,
							"/doubts/{id}/answer":  interactionHandler.AnswerDoubt,
							"/doubts/{id}/resolve": interactionHandler.ResolveDoubt,
							"/doubts/{id}/vote":    interactionHandler.VoteDoubt,
						} {
							roomDetail.With(
								appmw.CSRFProtection(cfg.CORSAllowedOrigins),
								appmw.OptionalAuth(authService),
							).Post(path, handler)
						}
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

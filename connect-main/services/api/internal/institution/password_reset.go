package institution

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tathastu/connect/services/api/internal/auth"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

// issuePasswordReset handles POST /organizations/{org}/members/{user}/password-reset. An
// institution administrator gets a one-time code to give the member in person; it is shown
// once and stored only as a hash. Administrators and auditors cannot be reset this way.
func (h *Handler) issuePasswordReset(w http.ResponseWriter, r *http.Request) {
	target := chi.URLParam(r, "user")
	if _, err := uuid.Parse(target); err != nil {
		sendError(w, r, invalid("Unknown member."))
		return
	}
	code, hash, err := auth.GenerateResetCode()
	if err != nil {
		sendError(w, r, err)
		return
	}
	var expires time.Time
	err = h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		return tx.QueryRow(r.Context(), `SELECT connect_auth.issue_member_password_reset($1::uuid, $2::uuid, $3, $4)`,
			chi.URLParam(r, "org"), target, hash, auth.AdminResetMinutes).Scan(&expires)
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "CN409" {
		model.SendJSONError(w, r, http.StatusConflict, "SELF_CHANGE", pgErr.Message)
		return
	}
	if errors.As(err, &pgErr) && pgErr.Code == "42501" {
		model.SendJSONError(w, r, http.StatusForbidden, "FORBIDDEN", pgErr.Message)
		return
	}
	if err != nil {
		sendError(w, r, err)
		return
	}
	h.record(r.Context(), r, "institution.password_reset_issued", target)
	model.SendJSON(w, http.StatusCreated, map[string]any{"code": code, "expiresAt": expires.UTC().Format(time.RFC3339)})
}

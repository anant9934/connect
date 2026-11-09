package institution

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

// systemHealth handles GET /organizations/{org}/admin/health: live rooms, members, AI tokens
// this month and storage, for the institution's administrators and auditors.
func (h *Handler) systemHealth(w http.ResponseWriter, r *http.Request) {
	var raw []byte
	err := h.inOrg(r, func(tx pgx.Tx, _ *database.AuthContext) error {
		return tx.QueryRow(r.Context(), `SELECT connect_auth.org_system_health($1::uuid)`, chi.URLParam(r, "org")).Scan(&raw)
	})
	if err != nil {
		sendError(w, r, err)
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"health": json.RawMessage(raw)})
}

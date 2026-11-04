package interaction

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/tathastu/connect/services/api/internal/database"
	"github.com/tathastu/connect/services/api/internal/model"
)

// engagementColumns maps connect_auth.room_engagement output to the API's field names.
const engagementColumns = `user_id AS "userId", display_name AS "displayName", present, connected_seconds AS "connectedSeconds",
	messages, reactions, hands, doubts, polls_total AS "pollsTotal", polls_answered AS "pollsAnswered", quiz_points AS "quizPoints",
	coding_total AS "codingTotal", coding_submitted AS "codingSubmitted", visible_seconds AS "visibleSeconds",
	hidden_seconds AS "hiddenSeconds", reported, polls_ratio AS "pollsRatio", coding_ratio AS "codingRatio",
	interaction_ratio AS "interactionRatio", focus_ratio AS "focusRatio", score`

// RoomEngagement handles GET /rooms/{code}/engagement: each student's live engagement score and
// what it is made of. Only the host or a co-host may call it; the database checks this again.
func (h *Handler) RoomEngagement(w http.ResponseWriter, r *http.Request) {
	c, ok := h.resolve(w, r)
	if !ok {
		return
	}
	if !c.canRun() {
		model.SendJSONError(w, c.r, http.StatusForbidden, "FORBIDDEN", "Only the host or a co-host can see engagement.")
		return
	}
	var raw []byte
	err := database.InCallerContext(c.r.Context(), h.pool, c.roomID, func(tx pgx.Tx) error {
		return tx.QueryRow(c.r.Context(),
			`SELECT COALESCE(json_agg(t), '[]'::json) FROM (SELECT `+engagementColumns+` FROM connect_auth.room_engagement($1::uuid)) t`,
			c.roomID).Scan(&raw)
	})
	if err != nil {
		sendDBError(w, c.r, err, "Could not load engagement.")
		return
	}
	model.SendJSON(w, http.StatusOK, map[string]any{"students": json.RawMessage(raw)})
}

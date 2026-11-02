package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/tathastu/connect/services/api/internal/attendance"
)

// TestWorkflowDB_AttendanceSignals reconciles a class as connect_worker under a policy with every
// rule on, and checks each metric, the stored explanation, and that corrections survive.
func TestWorkflowDB_AttendanceSignals(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	admin := workflowPool(t, ctx, "TEST_DATABASE_URL")
	workerPool := workflowPool(t, ctx, "TEST_CONNECT_WORKER_URL")

	start := time.Date(2026, 2, 2, 10, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	w := addTenant(t, ctx, admin, start, end)
	if _, err := admin.Exec(ctx, `
		INSERT INTO attendance_policies (organization_id, version, min_present_ratio, min_partial_ratio, late_grace_seconds, early_leave_grace_seconds,
		                                 duration_weight, engagement_weight, browser_weight, engagement_target)
		VALUES ($1, 1, 0.75, 0.40, 300, 300, 0.6, 0.2, 0.2, 2)`, w.orgID); err != nil {
		t.Fatal(err)
	}

	attend := func(student string, from, to int) {
		t.Helper()
		if _, err := admin.Exec(ctx, `
			INSERT INTO participant_media_sessions (room_id, participant_sid, identity, user_id, joined_at, left_at)
			VALUES ($1, $2, $3, $4, $5, $6)`, w.roomID, "PA_"+student[:8], "user:"+student, student,
			start.Add(time.Duration(from)*time.Minute), start.Add(time.Duration(to)*time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	active, late, early, quiet, noBrowser, absent := enroll(t, ctx, admin, w), enroll(t, ctx, admin, w), enroll(t, ctx, admin, w), enroll(t, ctx, admin, w), enroll(t, ctx, admin, w), enroll(t, ctx, admin, w)
	attend(active, 0, 60)
	attend(late, 10, 60)
	attend(early, 0, 40)
	attend(quiet, 0, 60)
	attend(noBrowser, 0, 60)
	seenFor := func(student string, visible, hidden int) {
		t.Helper()
		if _, err := admin.Exec(ctx, `INSERT INTO browser_activity (room_id, user_id, visible_seconds, hidden_seconds) VALUES ($1, $2, $3, $4)`, w.roomID, student, visible, hidden); err != nil {
			t.Fatal(err)
		}
	}
	seenFor(active, 3600, 0)
	seenFor(late, 3000, 0)
	seenFor(early, 2400, 0)
	seenFor(quiet, 360, 3240)
	identity := func(id string) string { return "user:" + id }
	for i := 0; i < 2; i++ {
		if _, err := admin.Exec(ctx, `INSERT INTO meeting_reactions (room_id, identity, emoji) VALUES ($1, $2, '👍')`, w.roomID, identity(active)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := admin.Exec(ctx, `INSERT INTO meeting_hand_raises (room_id, identity) VALUES ($1, $2)`, w.roomID, identity(late)); err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, `INSERT INTO meeting_messages (room_id, sender_identity, sender_name, body, client_message_id) VALUES ($1, $2, 'M', 'hi', 'one'), ($1, $2, 'M', 'hi', 'two'), ($1, $2, 'M', 'hi', 'three')`, w.roomID, identity(late)); err != nil {
		t.Fatal(err)
	}

	reconcile := func() {
		t.Helper()
		if err := reconcileClassSession(ctx, workerPool, w.roomID, w.sessionID, w.orgID, w.batchID, start, end); err != nil {
			t.Fatal(err)
		}
	}
	reconcile()

	type outcome struct {
		status                string
		joinedLate, leftEarly bool
		duration, engagement  float64
		browser               *float64
		score                 float64
		calculation           attendance.Calculation
	}
	read := func(student string) outcome {
		t.Helper()
		var o outcome
		var raw []byte
		err := admin.QueryRow(ctx, `
			SELECT attendance_status, joined_late, left_early, duration_ratio::float8, engagement_ratio::float8, browser_ratio::float8, score::float8, calculation
			FROM attendance_records WHERE class_session_id = $1 AND student_user_id = $2`, w.sessionID, student).
			Scan(&o.status, &o.joinedLate, &o.leftEarly, &o.duration, &o.engagement, &o.browser, &o.score, &raw)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(raw, &o.calculation); err != nil {
			t.Fatal(err)
		}
		return o
	}
	near := func(a, b float64) bool { return a-b < 0.002 && b-a < 0.002 }

	cases := []struct {
		name, id, status      string
		duration, engagement  float64
		browser               *float64
		score                 float64
		joinedLate, leftEarly bool
	}{
		{"fully active", active, "present", 1, 1, ptr(1), 1, false, false},
		// 0.6*0.833 + 0.2*1 + 0.2*1 = 0.9, then the rule for joining late.
		{"late but engaged", late, "late", 50.0 / 60, 1, ptr(1), 0.9, true, false},
		// 0.6*0.667 + 0 + 0.2*1 = 0.6: already below present, and flagged.
		{"left early", early, "partial", 40.0 / 60, 0, ptr(1), 0.6, false, true},
		// 0.6*1 + 0 + 0.2*0.1 = 0.62: connected throughout, but the policy counts the other signals.
		{"connected but hidden and silent", quiet, "partial", 1, 0, ptr(0.1), 0.62, false, false},
		// (0.6*1 + 0) / 0.8 = 0.75: a missing browser report leaves the weighting, not the score.
		{"no browser report", noBrowser, "present", 1, 0, nil, 0.75, false, false},
		{"never connected", absent, "absent", 0, 0, nil, 0, false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := read(c.id)
			if got.status != c.status || got.joinedLate != c.joinedLate || got.leftEarly != c.leftEarly {
				t.Errorf("got %+v", got)
			}
			if !near(got.duration, c.duration) || !near(got.engagement, c.engagement) || !near(got.score, c.score) {
				t.Errorf("metrics %v %v %v, want %v %v %v", got.duration, got.engagement, got.score, c.duration, c.engagement, c.score)
			}
			if (got.browser == nil) != (c.browser == nil) || (c.browser != nil && !near(*got.browser, *c.browser)) {
				t.Errorf("browser %v, want %v", got.browser, c.browser)
			}
			if got.calculation.SessionSeconds != 3600 || got.calculation.MinPresent != 0.75 || got.calculation.DurationWeight != 0.6 {
				t.Errorf("explanation: %+v", got.calculation)
			}
		})
	}

	t.Run("a correction survives reconciling again", func(t *testing.T) {
		if _, err := admin.Exec(ctx, `UPDATE attendance_records SET attendance_status = 'present', is_overruled = true, original_status = 'partial', overrule_reason = 'Network outage on campus' WHERE class_session_id = $1 AND student_user_id = $2`, w.sessionID, quiet); err != nil {
			t.Fatal(err)
		}
		if _, err := admin.Exec(ctx, `UPDATE browser_activity SET visible_seconds = 0 WHERE user_id = $1`, quiet); err != nil {
			t.Fatal(err)
		}
		reconcile()
		if got := read(quiet); got.status != "present" {
			t.Errorf("reconciling overwrote a correction: %+v", got)
		}
	})

	t.Run("an older policy leaves earlier results alone until reconciled", func(t *testing.T) {
		var version int
		if err := admin.QueryRow(ctx, `SELECT policy_version FROM attendance_records WHERE class_session_id = $1 AND student_user_id = $2`, w.sessionID, active).Scan(&version); err != nil {
			t.Fatal(err)
		}
		if version != 1 {
			t.Error(fmt.Sprintf("policy version %d", version))
		}
	})
}

func ptr(v float64) *float64 { return &v }

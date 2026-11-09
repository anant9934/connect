-- Reverses migration 000033 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.live_sim_submit(UUID, JSONB);
DROP FUNCTION IF EXISTS connect_auth.live_canvas_edit_slide(UUID, INT, JSONB);
DROP FUNCTION IF EXISTS connect_auth.live_canvas_update(UUID, INT, TEXT, JSONB, BOOLEAN);
DROP FUNCTION IF EXISTS connect_auth.live_canvas_publish(UUID, TEXT, JSONB, INT, JSONB);
DROP TABLE IF EXISTS live_sim_submissions;
DROP TABLE IF EXISTS room_live_canvas;
DELETE FROM schema_metadata WHERE version = '000033_live_generated_canvas';

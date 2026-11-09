-- Reverses migration 000037 on a disposable database during verification.
DROP FUNCTION IF EXISTS connect_auth.save_live_deck(UUID);
DROP TABLE IF EXISTS room_saved_decks;
DELETE FROM schema_metadata WHERE version = '000037_saved_decks';

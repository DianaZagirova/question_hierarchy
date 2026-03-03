-- ============================================================
-- Migration 002: Wire users table to Telegram identity,
--   link node_feedback to users, widen session_state.state_key,
--   add community_sessions table, fix cleanup function
-- ============================================================
-- All statements are idempotent — safe to re-run on a live database.

-- 1. Users: add Telegram identity columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

-- 2. Node feedback: link to users table
ALTER TABLE node_feedback ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_node_feedback_user_id ON node_feedback(user_id);

-- 3. Session state: widen state_key from VARCHAR(50) to VARCHAR(100)
ALTER TABLE session_state ALTER COLUMN state_key TYPE VARCHAR(100);

-- 4. Community sessions: create if missing (ORM creates it, but canonical schema should too)
CREATE TABLE IF NOT EXISTS community_sessions (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(500) NOT NULL,
    author VARCHAR(200) DEFAULT 'Anonymous',
    goal_preview VARCHAR(500) DEFAULT '',
    session_data JSONB NOT NULL DEFAULT '{}',
    published_at TIMESTAMP NOT NULL DEFAULT NOW(),
    source_browser_session UUID,
    tags JSONB DEFAULT '[]',
    clone_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_community_sessions_published ON community_sessions(published_at DESC);

-- 5. Fix cleanup function: remove is_active condition so expired sessions are actually deleted
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM sessions
    WHERE expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

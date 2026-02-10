-- ============================================================
-- OMEGA-POINT — Database Initialization Schema
-- ============================================================
-- This script is automatically executed when PostgreSQL container starts
-- ============================================================

-- Enable UUID extension for generating session IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Sessions Table
-- Stores session metadata and lifecycle information
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_accessed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    session_metadata JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_accessed_at ON sessions(last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_sessions_is_active ON sessions(is_active);

-- ============================================================
-- Session State Table
-- Stores pipeline state and step outputs per session
-- ============================================================
CREATE TABLE IF NOT EXISTS session_state (
    id SERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    state_key VARCHAR(50) NOT NULL,
    state_data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(session_id, state_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_session_state_session_id ON session_state(session_id);
CREATE INDEX IF NOT EXISTS idx_session_state_state_key ON session_state(state_key);
CREATE INDEX IF NOT EXISTS idx_session_state_updated_at ON session_state(updated_at);

-- ============================================================
-- Session Versions Table
-- Stores saved snapshots of session state
-- ============================================================
CREATE TABLE IF NOT EXISTS session_versions (
    version_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    version_name VARCHAR(200) NOT NULL,
    snapshot_data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_session_versions_session_id ON session_versions(session_id);
CREATE INDEX IF NOT EXISTS idx_session_versions_created_at ON session_versions(created_at);

-- ============================================================
-- Cleanup Function
-- Automatically deletes expired sessions (called by cron job)
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM sessions
    WHERE expires_at < NOW() AND is_active = FALSE;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Update timestamp trigger
-- Automatically updates updated_at on session_state changes
-- ============================================================
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_session_state_timestamp
    BEFORE UPDATE ON session_state
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- Grant permissions (optional, for production security)
-- ============================================================
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO omegapoint;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO omegapoint;

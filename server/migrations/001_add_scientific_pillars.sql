-- Migration: Add scientific_pillars table with pgvector for Step 4 optimization
-- Requires: pgvector extension
-- Date: 2024-02-24

-- Enable pgvector extension (requires superuser or extension privileges)
CREATE EXTENSION IF NOT EXISTS vector;

-- Create scientific_pillars table for knowledge caching
CREATE TABLE IF NOT EXISTS scientific_pillars (
    -- Primary identification
    pillar_id VARCHAR(100) PRIMARY KEY,

    -- Core content
    title TEXT NOT NULL,
    mechanism TEXT,
    verified_effect TEXT,
    readiness_level VARCHAR(10) DEFAULT 'RL-1',

    -- Taxonomies (for fast filtering)
    domain_tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    spv_tags TEXT[] DEFAULT ARRAY[]::TEXT[],

    -- Source tracking (JSONB for flexible paper metadata)
    source_papers JSONB DEFAULT '[]'::JSONB,

    -- Semantic embeddings (384 dimensions for all-MiniLM-L6-v2)
    embeddings vector(384),

    -- Quality metrics
    citation_count INTEGER DEFAULT 0,
    quality_score FLOAT DEFAULT 0.5,
    usage_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP,

    -- Constraints
    CHECK (quality_score >= 0 AND quality_score <= 1),
    CHECK (readiness_level IN ('RL-1', 'RL-2', 'RL-3'))
);

-- Create indexes for fast queries

-- GIN indexes for array containment (domain/SPV filtering)
CREATE INDEX IF NOT EXISTS idx_pillars_domain_tags ON scientific_pillars USING GIN(domain_tags);
CREATE INDEX IF NOT EXISTS idx_pillars_spv_tags ON scientific_pillars USING GIN(spv_tags);

-- Full-text search index for title and mechanism
CREATE INDEX IF NOT EXISTS idx_pillars_fulltext ON scientific_pillars
USING GIN(to_tsvector('english', title || ' ' || COALESCE(mechanism, '')));

-- HNSW index for vector similarity search (faster than IVFFlat, no training needed)
-- m=16: number of connections per layer (higher = better recall, more memory)
-- ef_construction=64: size of dynamic candidate list (higher = better index quality)
CREATE INDEX IF NOT EXISTS idx_pillars_embeddings ON scientific_pillars
USING hnsw (embeddings vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- B-tree indexes for common filters
CREATE INDEX IF NOT EXISTS idx_pillars_quality ON scientific_pillars(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_pillars_usage ON scientific_pillars(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_pillars_citations ON scientific_pillars(citation_count DESC);
CREATE INDEX IF NOT EXISTS idx_pillars_created ON scientific_pillars(created_at DESC);

-- Partial index for high-quality pillars (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_pillars_high_quality ON scientific_pillars(quality_score DESC)
WHERE quality_score >= 0.7;

-- Comment the table
COMMENT ON TABLE scientific_pillars IS 'Cached scientific knowledge pillars with semantic search capabilities';
COMMENT ON COLUMN scientific_pillars.embeddings IS 'Semantic embeddings (384-dim) for similarity search';
COMMENT ON COLUMN scientific_pillars.source_papers IS 'Array of paper metadata: [{doi, pmid, title, citation_count, year}]';
COMMENT ON COLUMN scientific_pillars.quality_score IS 'Computed quality (0-1) based on citations, recency, completeness';
COMMENT ON COLUMN scientific_pillars.readiness_level IS 'Readiness level: RL-1 (basic science), RL-2 (preclinical), RL-3 (clinical)';

-- Grant permissions (adjust based on your user setup)
-- GRANT SELECT, INSERT, UPDATE ON scientific_pillars TO omegapoint;

-- Create a view for common queries (optional optimization)
CREATE OR REPLACE VIEW high_quality_pillars AS
SELECT * FROM scientific_pillars
WHERE quality_score >= 0.7
ORDER BY quality_score DESC, usage_count DESC;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Migration 001_add_scientific_pillars.sql completed successfully';
    RAISE NOTICE 'Tables created: scientific_pillars';
    RAISE NOTICE 'Indexes created: 9 indexes including HNSW vector index';
END $$;

"""
Optimized Knowledge Cache
- Hybrid search (keyword + semantic)
- PostgreSQL + pgvector for vector similarity
- Quality scoring and freshness boosting
- Efficient bulk operations
"""

import logging
import numpy as np
from typing import List, Dict, Optional, Tuple
from datetime import datetime
import json

logger = logging.getLogger(__name__)


class OptimizedKnowledgeCache:
    """
    Knowledge cache with hybrid retrieval:
    1. Keyword filtering (fast, using PostgreSQL GIN index)
    2. Semantic reranking (accurate, using pgvector)
    3. Quality + freshness scoring
    """

    def __init__(self, db_connection, embedding_model):
        """
        Args:
            db_connection: PostgreSQL connection (psycopg2 or SQLAlchemy)
            embedding_model: sentence-transformers model instance
        """
        self.db = db_connection
        self.model = embedding_model

    def search(self, query: str,
               domain_tags: Optional[List[str]] = None,
               spv_tags: Optional[List[str]] = None,
               top_k: int = 20,
               min_quality: float = 0.5) -> List[Dict]:
        """
        Hybrid search for cached pillars

        Args:
            query: Search query string
            domain_tags: Optional domain filter
            spv_tags: Optional SPV filter
            top_k: Number of results to return
            min_quality: Minimum quality score threshold

        Returns:
            List of matching pillars with relevance scores
        """
        # Handle empty query
        if not query or not query.strip():
            logger.warning("[Cache] Empty query provided")
            return []

        logger.info(f"[Cache] Searching: {query[:80]}")

        # Step 1: Keyword filtering (fast)
        candidates = self._keyword_search(query, domain_tags, spv_tags,
                                          candidate_limit=top_k * 5,
                                          min_quality=min_quality)

        if not candidates:
            logger.info("[Cache] No keyword matches found")
            return []

        logger.info(f"[Cache] Keyword filter: {len(candidates)} candidates")

        # Step 2: Semantic reranking (accurate)
        try:
            query_embedding = self.model.encode([query], normalize_embeddings=True)[0]
        except (IndexError, Exception) as e:
            logger.error(f"[Cache] Embedding error: {e}")
            return candidates[:top_k]  # Return keyword results without reranking
        reranked = self._semantic_rerank(candidates, query_embedding, top_k)

        logger.info(f"[Cache] Returning top {len(reranked)} results")

        return reranked

    def _keyword_search(self, query: str,
                        domain_tags: Optional[List[str]],
                        spv_tags: Optional[List[str]],
                        candidate_limit: int = 100,
                        min_quality: float = 0.5) -> List[Dict]:
        """
        Fast keyword-based filtering using PostgreSQL full-text search

        Uses:
        - GIN index on domain_tags and spv_tags for fast filtering
        - to_tsvector for full-text search on title/mechanism
        """
        # Extract keywords from query
        keywords = query.lower().split()
        search_terms = ' | '.join(keywords[:5])  # Top 5 keywords, OR logic

        # Build SQL query
        sql = """
        SELECT
            pillar_id, title, mechanism, verified_effect, readiness_level,
            domain_tags, spv_tags, source_papers, citation_count,
            usage_count, quality_score, created_at, last_used_at
        FROM scientific_pillars
        WHERE
            quality_score >= %s
            AND (
                to_tsvector('english', title || ' ' || COALESCE(mechanism, ''))
                @@ to_tsquery('english', %s)
                OR title ILIKE %s
            )
        """

        params = [min_quality, search_terms, f"%{keywords[0]}%"]

        # Add tag filters if provided
        if domain_tags:
            sql += " AND domain_tags && %s"
            params.append(domain_tags)

        if spv_tags:
            sql += " AND spv_tags && %s"
            params.append(spv_tags)

        # Order by quality and usage
        sql += """
        ORDER BY
            quality_score DESC,
            usage_count DESC,
            citation_count DESC
        LIMIT %s
        """
        params.append(candidate_limit)

        try:
            cursor = self.db.cursor()
            cursor.execute(sql, params)

            candidates = []
            for row in cursor.fetchall():
                candidate = {
                    'pillar_id': row[0],
                    'title': row[1],
                    'mechanism': row[2],
                    'verified_effect': row[3],
                    'readiness_level': row[4],
                    'domain_tags': row[5],
                    'spv_tags': row[6],
                    'source_papers': row[7],  # JSONB
                    'citation_count': row[8],
                    'usage_count': row[9],
                    'quality_score': row[10],
                    'created_at': row[11],
                    'last_used_at': row[12]
                }
                candidates.append(candidate)

            cursor.close()
            return candidates

        except Exception as e:
            logger.error(f"[Cache] Keyword search error: {e}")
            return []

    def _semantic_rerank(self, candidates: List[Dict],
                         query_embedding: np.ndarray,
                         top_k: int) -> List[Dict]:
        """
        Rerank candidates using semantic similarity + quality/freshness

        Final score = semantic_similarity * 0.6 + quality_score * 0.3 + freshness * 0.1
        """
        if not candidates:
            return []

        # Get candidate IDs for efficient vector retrieval
        candidate_ids = [c['pillar_id'] for c in candidates]

        # Fetch embeddings from database (optimized with pgvector)
        embeddings_dict = self._fetch_embeddings(candidate_ids)

        # Calculate scores
        scored = []
        for candidate in candidates:
            pillar_id = candidate['pillar_id']

            if pillar_id not in embeddings_dict:
                logger.warning(f"No embedding for {pillar_id}, skipping")
                continue

            embedding = embeddings_dict[pillar_id]

            # Semantic similarity (cosine)
            semantic_sim = float(np.dot(query_embedding, embedding))

            # Quality score
            quality = candidate['quality_score']

            # Freshness score (boost recent additions)
            freshness = self._calculate_freshness(candidate['created_at'])

            # Combined score
            final_score = (
                semantic_sim * 0.6 +
                quality * 0.3 +
                freshness * 0.1
            )

            candidate['relevance_score'] = final_score
            candidate['semantic_similarity'] = semantic_sim
            candidate['freshness_score'] = freshness

            scored.append(candidate)

        # Sort by final score
        scored.sort(key=lambda x: x['relevance_score'], reverse=True)

        return scored[:top_k]

    def _fetch_embeddings(self, pillar_ids: List[str]) -> Dict[str, np.ndarray]:
        """
        Fetch embeddings for multiple pillars (batch query)

        Returns:
            Dict mapping pillar_id to embedding array
        """
        if not pillar_ids:
            return {}

        try:
            sql = """
            SELECT pillar_id, embeddings
            FROM scientific_pillars
            WHERE pillar_id = ANY(%s)
            """

            cursor = self.db.cursor()
            cursor.execute(sql, (pillar_ids,))

            embeddings_dict = {}
            for row in cursor.fetchall():
                pillar_id = row[0]
                # pgvector returns embeddings as list
                embedding = np.array(row[1], dtype=np.float32)
                embeddings_dict[pillar_id] = embedding

            cursor.close()
            return embeddings_dict

        except Exception as e:
            logger.error(f"[Cache] Embedding fetch error: {e}")
            return {}

    def _calculate_freshness(self, created_at: datetime) -> float:
        """
        Calculate freshness score (0-1) based on age

        Recent (< 1 month): 1.0
        < 6 months: 0.8
        < 1 year: 0.6
        < 2 years: 0.4
        Older: 0.2
        """
        if not created_at:
            return 0.5

        age_days = (datetime.now() - created_at).days

        if age_days < 30:
            return 1.0
        elif age_days < 180:
            return 0.8
        elif age_days < 365:
            return 0.6
        elif age_days < 730:
            return 0.4
        else:
            return 0.2

    def store_pillars(self, pillars: List[Dict], embeddings: np.ndarray):
        """
        Store multiple pillars with embeddings (bulk operation)

        Args:
            pillars: List of pillar dicts
            embeddings: Array of embeddings (n_pillars, 384)
        """
        if not pillars or len(embeddings) == 0:
            return

        logger.info(f"[Cache] Storing {len(pillars)} pillars")

        try:
            # Prepare data for bulk insert
            values = []
            for i, pillar in enumerate(pillars):
                embedding = embeddings[i].tolist()

                values.append((
                    pillar['id'],
                    pillar.get('title', ''),
                    pillar.get('mechanism', ''),
                    pillar.get('verified_effect', ''),
                    pillar.get('readiness_level', 'RL-1'),
                    pillar.get('domain_tags', []),
                    pillar.get('spv_tags', []),
                    json.dumps(pillar.get('source_papers', [])),
                    embedding,
                    pillar.get('citation_count', 0),
                    pillar.get('quality_score', 0.5)
                ))

            # Bulk insert with ON CONFLICT DO UPDATE
            sql = """
            INSERT INTO scientific_pillars
            (pillar_id, title, mechanism, verified_effect, readiness_level,
             domain_tags, spv_tags, source_papers, embeddings,
             citation_count, quality_score, created_at, usage_count)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), 0)
            ON CONFLICT (pillar_id) DO UPDATE SET
                usage_count = scientific_pillars.usage_count + 1,
                last_used_at = NOW()
            """

            cursor = self.db.cursor()

            # Use execute_batch for efficiency (psycopg2.extras)
            try:
                from psycopg2.extras import execute_batch
                execute_batch(cursor, sql, values, page_size=100)
            except ImportError:
                # Fallback to executemany
                cursor.executemany(sql, values)

            self.db.commit()
            cursor.close()

            logger.info(f"[Cache] Successfully stored {len(pillars)} pillars")

        except Exception as e:
            logger.error(f"[Cache] Storage error: {e}")
            self.db.rollback()

    def update_usage(self, pillar_ids: List[str]):
        """
        Update usage count and last_used_at for pillars (bulk)
        """
        if not pillar_ids:
            return

        try:
            sql = """
            UPDATE scientific_pillars
            SET
                usage_count = usage_count + 1,
                last_used_at = NOW()
            WHERE pillar_id = ANY(%s)
            """

            cursor = self.db.cursor()
            cursor.execute(sql, (pillar_ids,))
            self.db.commit()
            cursor.close()

            logger.info(f"[Cache] Updated usage for {len(pillar_ids)} pillars")

        except Exception as e:
            logger.error(f"[Cache] Usage update error: {e}")
            self.db.rollback()

    def get_statistics(self) -> Dict:
        """Get cache statistics"""
        try:
            sql = """
            SELECT
                COUNT(*) as total_pillars,
                AVG(quality_score) as avg_quality,
                SUM(citation_count) as total_citations,
                MAX(created_at) as latest_addition,
                AVG(usage_count) as avg_usage
            FROM scientific_pillars
            """

            cursor = self.db.cursor()
            cursor.execute(sql)
            row = cursor.fetchone()
            cursor.close()

            return {
                'total_pillars': row[0],
                'avg_quality': round(float(row[1]) if row[1] else 0, 2),
                'total_citations': row[2] if row[2] else 0,
                'latest_addition': row[3],
                'avg_usage': round(float(row[4]) if row[4] else 0, 1)
            }

        except Exception as e:
            logger.error(f"[Cache] Statistics error: {e}")
            return {}


# Mock database connection for testing
class MockDB:
    """Mock database for testing without PostgreSQL"""

    def __init__(self):
        self.pillars = []

    def cursor(self):
        return self

    def execute(self, sql, params=None):
        pass

    def fetchall(self):
        return []

    def fetchone(self):
        return (0, 0.0, 0, None, 0.0)

    def commit(self):
        pass

    def rollback(self):
        pass

    def close(self):
        pass


# Example usage
if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    # Mock setup
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer('all-MiniLM-L6-v2')
    db = MockDB()

    cache = OptimizedKnowledgeCache(db, model)

    # Test search (will return empty with mock DB)
    results = cache.search(
        query="mitochondrial function aging",
        domain_tags=["mitochondria", "aging"],
        top_k=10
    )

    print(f"Found {len(results)} cached pillars")

    # Test statistics
    stats = cache.get_statistics()
    print(f"\nCache statistics: {stats}")

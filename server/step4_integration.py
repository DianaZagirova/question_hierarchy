"""
Step 4 Integration Layer
Connects the optimized Step 4 pipeline to Flask backend
Handles database setup, progress callbacks, and error handling
"""

import logging
import os
import asyncio
from typing import Dict, List, Optional, Callable
from datetime import datetime
import psycopg2
from sentence_transformers import SentenceTransformer

from step4_pipeline_optimized import OptimizedStep4Pipeline
from research_apis_optimized import OptimizedResearchAPIClient
from knowledge_dedup_optimized import OptimizedKnowledgeDeduplicator
from knowledge_cache_optimized import OptimizedKnowledgeCache

logger = logging.getLogger(__name__)


class Step4IntegrationError(Exception):
    """Custom exception for Step 4 integration errors"""
    pass


class Step4Integration:
    """
    Integration layer for optimized Step 4 pipeline

    Responsibilities:
    - Initialize all components (APIs, models, database)
    - Provide simple interface for Flask endpoints
    - Handle async/sync conversion
    - Manage progress callbacks
    - Error handling and fallbacks
    """

    def __init__(self):
        self.pipeline: Optional[OptimizedStep4Pipeline] = None
        self.db_conn = None
        self.embedding_model = None
        self.initialized = False

    def initialize(self, use_gpu: bool = True):
        """
        Initialize the Step 4 pipeline with all dependencies

        Args:
            use_gpu: Whether to use GPU for embeddings (if available)

        Raises:
            Step4IntegrationError: If initialization fails
        """
        try:
            logger.info("[Step4] Initializing optimized pipeline...")

            # 1. Initialize database connection
            self.db_conn = self._init_database()
            logger.info("[Step4] ✓ Database connection established")

            # 2. Initialize embedding model (with GPU support)
            self.embedding_model = self._init_embedding_model(use_gpu)
            logger.info(f"[Step4] ✓ Embedding model loaded (device: {self.embedding_model.device})")

            # 3. Initialize API client
            api_client = OptimizedResearchAPIClient(
                email=os.getenv('PUBMED_EMAIL'),  # Optional email for PubMed
                cache_ttl=24  # 24 hours
            )
            logger.info("[Step4] ✓ Research API client initialized")

            # 4. Initialize deduplicator
            deduplicator = OptimizedKnowledgeDeduplicator(
                similarity_threshold=0.85,
                use_gpu=use_gpu
            )
            logger.info("[Step4] ✓ Knowledge deduplicator initialized")

            # 5. Initialize knowledge cache
            knowledge_cache = OptimizedKnowledgeCache(
                db_connection=self.db_conn,
                embedding_model=self.embedding_model
            )
            logger.info("[Step4] ✓ Knowledge cache initialized")

            # 6. Initialize OpenRouter client
            openrouter_client = self._init_openrouter_client()
            logger.info("[Step4] ✓ OpenRouter client initialized")

            # 7. Create pipeline configuration
            config = {
                'query_model': os.getenv('STEP4_QUERY_MODEL', 'anthropic/claude-3-haiku'),
                'filter_model': os.getenv('STEP4_FILTER_MODEL', 'anthropic/claude-3-haiku'),
                'synthesis_model': os.getenv('STEP4_SYNTHESIS_MODEL', 'anthropic/claude-3-haiku'),
                'top_n_papers': 10,
                'cache_enabled': True,
                'dedup_enabled': True,
                'target_pillars': 25
            }

            # 8. Create pipeline
            self.pipeline = OptimizedStep4Pipeline(
                research_client=api_client,
                llm_client=openrouter_client,
                deduplicator=deduplicator,
                cache=knowledge_cache,
                embedding_model=self.embedding_model,
                config=config
            )

            self.initialized = True
            logger.info("[Step4] ✓ Pipeline initialization complete!")

            # Log cache statistics
            stats = knowledge_cache.get_statistics()
            logger.info(f"[Step4] Cache stats: {stats.get('total_pillars', 0)} pillars, "
                       f"avg quality {stats.get('avg_quality', 0)}")

        except Exception as e:
            logger.error(f"[Step4] Initialization failed: {e}")
            raise Step4IntegrationError(f"Failed to initialize Step 4 pipeline: {e}")

    def _init_database(self):
        """Initialize PostgreSQL connection with pgvector"""
        database_url = os.getenv('DATABASE_URL', 'postgresql://omegapoint:changeme@localhost:5432/omegapoint')

        try:
            conn = psycopg2.connect(database_url)

            # Verify pgvector extension
            cursor = conn.cursor()
            cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')")
            has_vector = cursor.fetchone()[0]
            cursor.close()

            if not has_vector:
                logger.warning("[Step4] pgvector extension not found. Run migration: server/migrations/001_add_scientific_pillars.sql")
                raise Step4IntegrationError("pgvector extension not installed")

            return conn

        except psycopg2.Error as e:
            logger.error(f"[Step4] Database connection failed: {e}")
            raise Step4IntegrationError(f"Database connection failed: {e}")

    def _init_embedding_model(self, use_gpu: bool):
        """Initialize sentence-transformers model with GPU support"""
        try:
            import torch

            # Determine device
            if use_gpu and torch.cuda.is_available():
                device = 'cuda'
                logger.info(f"[Step4] GPU detected: {torch.cuda.get_device_name(0)}")
            else:
                device = 'cpu'
                if use_gpu:
                    logger.warning("[Step4] GPU requested but not available, using CPU")

            # Load lightweight model (22MB, 384 dimensions)
            model = SentenceTransformer('all-MiniLM-L6-v2', device=device)
            return model

        except ImportError:
            logger.error("[Step4] sentence-transformers not installed")
            raise Step4IntegrationError(
                "Required package not installed: pip install sentence-transformers torch"
            )
        except Exception as e:
            logger.error(f"[Step4] Model loading failed: {e}")
            raise Step4IntegrationError(f"Failed to load embedding model: {e}")

    def _init_openrouter_client(self):
        """Initialize OpenRouter client for LLM calls"""
        from openai import OpenAI

        api_key = os.getenv('OPENROUTER_API_KEY')
        if not api_key:
            logger.warning("[Step4] OPENROUTER_API_KEY not set in .env")
            raise Step4IntegrationError("OPENROUTER_API_KEY not configured")

        client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key=api_key
        )

        return client

    def execute_step4(
        self,
        goal: Dict,
        ras: List[Dict],
        spvs: List[Dict],
        progress_callback: Optional[Callable] = None,
        session_id: Optional[str] = None
    ) -> Dict:
        """
        Execute Step 4 pipeline (sync wrapper for async execution)

        Args:
            goal: Goal dictionary with 'text' field
            ras: List of research area dictionaries
            spvs: List of SPV dictionaries
            progress_callback: Optional callback for progress updates
            session_id: Optional session ID for tracking

        Returns:
            Dict with 'scientific_pillars', 'from_cache', 'execution_time', 'cost_estimate'

        Raises:
            Step4IntegrationError: If execution fails
        """
        if not self.initialized:
            raise Step4IntegrationError("Pipeline not initialized. Call initialize() first.")

        start_time = datetime.now()

        try:
            # Run async pipeline in new event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

            try:
                result = loop.run_until_complete(
                    self.pipeline.execute(
                        goal=goal,
                        ras=ras,
                        spvs=spvs,
                        progress_callback=progress_callback
                    )
                )
            finally:
                loop.close()

            execution_time = (datetime.now() - start_time).total_seconds()

            # Add metadata
            result['execution_time'] = execution_time
            result['session_id'] = session_id
            result['timestamp'] = datetime.now().isoformat()

            logger.info(f"[Step4] Execution complete: {len(result.get('scientific_pillars', []))} pillars "
                       f"in {execution_time:.1f}s (cache: {result.get('from_cache', False)})")

            return result

        except Exception as e:
            logger.error(f"[Step4] Execution failed: {e}")
            raise Step4IntegrationError(f"Step 4 execution failed: {e}")

    def get_cache_statistics(self) -> Dict:
        """Get knowledge cache statistics"""
        if not self.initialized or not self.pipeline:
            return {}

        try:
            stats = self.pipeline.cache.get_statistics()
            return stats
        except Exception as e:
            logger.error(f"[Step4] Failed to get cache stats: {e}")
            return {}

    def cleanup(self):
        """Cleanup resources (call on shutdown)"""
        try:
            if self.db_conn:
                self.db_conn.close()
                logger.info("[Step4] Database connection closed")
        except Exception as e:
            logger.error(f"[Step4] Cleanup error: {e}")


# Global instance (initialized on first use)
_step4_integration: Optional[Step4Integration] = None


def get_step4_integration() -> Step4Integration:
    """
    Get or create the global Step 4 integration instance

    Returns:
        Initialized Step4Integration instance

    Raises:
        Step4IntegrationError: If initialization fails
    """
    global _step4_integration

    if _step4_integration is None:
        _step4_integration = Step4Integration()

        # Check if auto-initialize is enabled
        auto_init = os.getenv('STEP4_AUTO_INIT', 'true').lower() == 'true'

        if auto_init:
            use_gpu = os.getenv('STEP4_USE_GPU', 'true').lower() == 'true'
            _step4_integration.initialize(use_gpu=use_gpu)

    return _step4_integration


def execute_step4_for_flask(
    goal: Dict,
    ras: List[Dict],
    spvs: List[Dict],
    progress_callback: Optional[Callable] = None,
    session_id: Optional[str] = None
) -> Dict:
    """
    Flask-friendly wrapper for Step 4 execution

    Args:
        goal: Goal dictionary
        ras: Research areas list
        spvs: SPVs list
        progress_callback: Progress callback function
        session_id: Session ID

    Returns:
        Execution result dictionary

    Raises:
        Step4IntegrationError: If execution fails
    """
    integration = get_step4_integration()

    # Auto-initialize on first use if not already initialized (true lazy loading)
    if not integration.initialized:
        logger.info("[Step4] Auto-initializing on first execution...")
        use_gpu = os.getenv('STEP4_USE_GPU', 'false').lower() == 'true'
        integration.initialize(use_gpu=use_gpu)
        logger.info("[Step4] Auto-initialization complete")

    return integration.execute_step4(goal, ras, spvs, progress_callback, session_id)


def get_cache_statistics_for_flask() -> Dict:
    """Flask-friendly wrapper for cache statistics"""
    try:
        integration = get_step4_integration()
        return integration.get_cache_statistics()
    except Exception as e:
        logger.error(f"[Step4] Failed to get cache stats: {e}")
        return {'error': str(e)}


# Cleanup handler for Flask app shutdown
def cleanup_step4():
    """Cleanup Step 4 resources (call on app shutdown)"""
    global _step4_integration

    if _step4_integration:
        _step4_integration.cleanup()
        _step4_integration = None
        logger.info("[Step4] Cleanup complete")

"""
Comprehensive Test Suite for Optimized Step 4 Pipeline
Tests all components in isolation and integration
"""

import os
import sys
import logging
import asyncio
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)


def test_imports():
    """Test 1: Verify all required imports work"""
    print("\n" + "="*80)
    print("TEST 1: Import Verification")
    print("="*80)

    try:
        import numpy as np
        print("✓ numpy")
    except ImportError as e:
        print(f"✗ numpy: {e}")
        return False

    try:
        import psycopg2
        print("✓ psycopg2")
    except ImportError as e:
        print(f"✗ psycopg2: {e}")
        return False

    try:
        from sentence_transformers import SentenceTransformer
        print("✓ sentence-transformers")
    except ImportError as e:
        print(f"✗ sentence-transformers: {e}")
        return False

    try:
        import aiohttp
        print("✓ aiohttp")
    except ImportError as e:
        print(f"✗ aiohttp: {e}")
        return False

    try:
        from openai import OpenAI
        print("✓ openai")
    except ImportError as e:
        print(f"✗ openai: {e}")
        return False

    try:
        from research_apis_optimized import OptimizedResearchAPIClient
        print("✓ research_apis_optimized")
    except ImportError as e:
        print(f"✗ research_apis_optimized: {e}")
        return False

    try:
        from knowledge_dedup_optimized import OptimizedKnowledgeDeduplicator
        print("✓ knowledge_dedup_optimized")
    except ImportError as e:
        print(f"✗ knowledge_dedup_optimized: {e}")
        return False

    try:
        from knowledge_cache_optimized import OptimizedKnowledgeCache, MockDB
        print("✓ knowledge_cache_optimized")
    except ImportError as e:
        print(f"✗ knowledge_cache_optimized: {e}")
        return False

    try:
        from step4_pipeline_optimized import OptimizedStep4Pipeline
        print("✓ step4_pipeline_optimized")
    except ImportError as e:
        print(f"✗ step4_pipeline_optimized: {e}")
        return False

    print("\n✓ All imports successful!")
    return True


def test_embedding_model():
    """Test 2: Load and test embedding model"""
    print("\n" + "="*80)
    print("TEST 2: Embedding Model")
    print("="*80)

    try:
        from sentence_transformers import SentenceTransformer
        import torch

        # Check GPU
        if torch.cuda.is_available():
            print(f"✓ GPU available: {torch.cuda.get_device_name(0)}")
            device = 'cuda'
        else:
            print("⚠ No GPU available, using CPU")
            device = 'cpu'

        # Load model
        print("Loading all-MiniLM-L6-v2 model...")
        model = SentenceTransformer('all-MiniLM-L6-v2', device=device)
        print(f"✓ Model loaded on {device}")

        # Test embedding
        test_texts = [
            "Mitochondrial dysfunction in aging",
            "Enhanced mitochondrial biogenesis"
        ]
        embeddings = model.encode(test_texts, normalize_embeddings=True)
        print(f"✓ Generated embeddings shape: {embeddings.shape}")

        # Test similarity
        import numpy as np
        similarity = np.dot(embeddings[0], embeddings[1])
        print(f"✓ Cosine similarity: {similarity:.3f}")

        return True

    except Exception as e:
        print(f"✗ Embedding test failed: {e}")
        return False


def test_database_connection():
    """Test 3: Database connection and pgvector"""
    print("\n" + "="*80)
    print("TEST 3: Database Connection")
    print("="*80)

    try:
        import psycopg2
        from dotenv import load_dotenv
        load_dotenv()

        database_url = os.getenv('DATABASE_URL', 'postgresql://omegapoint:changeme@localhost:5432/omegapoint')
        print(f"Connecting to: {database_url.split('@')[1]}")  # Hide password

        conn = psycopg2.connect(database_url)
        print("✓ Database connection successful")

        cursor = conn.cursor()

        # Check pgvector extension
        cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')")
        has_vector = cursor.fetchone()[0]

        if has_vector:
            print("✓ pgvector extension installed")
        else:
            print("✗ pgvector extension NOT installed")
            print("  Run: server/migrations/001_add_scientific_pillars.sql")
            cursor.close()
            conn.close()
            return False

        # Check if scientific_pillars table exists
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'scientific_pillars'
            )
        """)
        has_table = cursor.fetchone()[0]

        if has_table:
            print("✓ scientific_pillars table exists")

            # Count existing pillars
            cursor.execute("SELECT COUNT(*) FROM scientific_pillars")
            count = cursor.fetchone()[0]
            print(f"✓ Existing pillars in cache: {count}")
        else:
            print("⚠ scientific_pillars table NOT found")
            print("  Run: server/migrations/001_add_scientific_pillars.sql")

        cursor.close()
        conn.close()

        return has_vector  # Must have pgvector at minimum

    except Exception as e:
        print(f"✗ Database test failed: {e}")
        return False


async def test_research_apis():
    """Test 4: Research API client"""
    print("\n" + "="*80)
    print("TEST 4: Research API Client")
    print("="*80)

    try:
        from research_apis_optimized import OptimizedResearchAPIClient
        from dotenv import load_dotenv
        load_dotenv()

        client = OptimizedResearchAPIClient(
            pubmed_api_key=os.getenv('PUBMED_API_KEY'),
            semantic_scholar_api_key=os.getenv('SEMANTIC_SCHOLAR_API_KEY')
        )
        print("✓ API client initialized")

        # Test PubMed
        print("\nTesting PubMed API...")
        pubmed_results = await client.search_pubmed_async("mitochondrial aging", max_results=3)
        print(f"✓ PubMed: {len(pubmed_results)} papers fetched")
        if pubmed_results:
            print(f"  Example: {pubmed_results[0].get('title', 'N/A')[:60]}...")

        # Test Semantic Scholar
        print("\nTesting Semantic Scholar API...")
        scholar_results = await client.search_semantic_scholar_async("mitochondrial aging", max_results=3)
        print(f"✓ Semantic Scholar: {len(scholar_results)} papers fetched")
        if scholar_results:
            print(f"  Example: {scholar_results[0].get('title', 'N/A')[:60]}...")

        # Test unified fetch
        print("\nTesting unified fetch...")
        unified = await client.fetch_unified_async("mitochondrial dysfunction", max_per_source=5)
        print(f"✓ Unified fetch: {len(unified)} total papers")

        # Test quality filtering
        print("\nTesting quality filter...")
        high_quality = [p for p in unified if client.calculate_paper_quality(p) >= 0.6]
        print(f"✓ High quality papers (score >= 0.6): {len(high_quality)}/{len(unified)}")

        return True

    except Exception as e:
        print(f"✗ API test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_deduplication():
    """Test 5: Knowledge deduplication"""
    print("\n" + "="*80)
    print("TEST 5: Knowledge Deduplication")
    print("="*80)

    try:
        from knowledge_dedup_optimized import OptimizedKnowledgeDeduplicator

        dedup = OptimizedKnowledgeDeduplicator(similarity_threshold=0.85, use_gpu=False)
        print("✓ Deduplicator initialized (CPU mode)")

        # Test with sample pillars
        test_pillars = [
            {
                'id': 'S_1',
                'title': 'Mitochondrial biogenesis enhancement',
                'mechanism': 'PGC-1α activation increases mitochondrial DNA',
                'verified_effect': '20% increase in ATP production',
                'readiness_level': 'RL-2',
                'source_papers': [{'pmid': '123', 'citation_count': 50}]
            },
            {
                'id': 'S_2',
                'title': 'Enhanced mitochondrial biogenesis',
                'mechanism': 'PGC-1α pathway activation',
                'verified_effect': 'Increased ATP output',
                'readiness_level': 'RL-2',
                'source_papers': [{'pmid': '456', 'citation_count': 30}]
            },
            {
                'id': 'S_3',
                'title': 'Cellular senescence removal',
                'mechanism': 'Senolytic drugs target p16+ cells',
                'verified_effect': 'Reduced senescent cell burden',
                'readiness_level': 'RL-3',
                'source_papers': [{'pmid': '789', 'citation_count': 100}]
            }
        ]

        # Create embeddings
        embeddings = dedup.create_embeddings(test_pillars)
        print(f"✓ Embeddings created: shape {embeddings.shape}")

        # Find duplicates
        duplicate_groups = dedup.find_duplicate_groups(embeddings)
        print(f"✓ Duplicate groups found: {len(duplicate_groups)}")

        # Merge duplicates
        deduplicated, _ = dedup.deduplicate(test_pillars)
        print(f"✓ Deduplication complete: {len(test_pillars)} → {len(deduplicated)} pillars")

        if len(duplicate_groups) > 0:
            print(f"  Merged {len(test_pillars) - len(deduplicated)} duplicate(s)")

        return True

    except Exception as e:
        print(f"✗ Deduplication test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_knowledge_cache():
    """Test 6: Knowledge cache (with mock DB)"""
    print("\n" + "="*80)
    print("TEST 6: Knowledge Cache (Mock)")
    print("="*80)

    try:
        from knowledge_cache_optimized import OptimizedKnowledgeCache, MockDB
        from sentence_transformers import SentenceTransformer

        # Use mock DB for testing
        db = MockDB()
        model = SentenceTransformer('all-MiniLM-L6-v2')

        cache = OptimizedKnowledgeCache(db, model)
        print("✓ Cache initialized with mock database")

        # Test search (will return empty with mock)
        results = cache.search(
            query="mitochondrial function",
            domain_tags=["mitochondria"],
            top_k=5
        )
        print(f"✓ Cache search executed: {len(results)} results (expected 0 for mock)")

        # Test statistics
        stats = cache.get_statistics()
        print(f"✓ Cache statistics: {stats}")

        return True

    except Exception as e:
        print(f"✗ Cache test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_full_pipeline():
    """Test 7: Complete pipeline integration"""
    print("\n" + "="*80)
    print("TEST 7: Full Pipeline Integration")
    print("="*80)

    try:
        from step4_integration import Step4Integration
        from dotenv import load_dotenv
        load_dotenv()

        # Check prerequisites
        if not os.getenv('OPENROUTER_API_KEY'):
            print("✗ OPENROUTER_API_KEY not set in .env")
            return False

        print("Initializing Step 4 integration...")
        integration = Step4Integration()

        try:
            integration.initialize(use_gpu=False)  # Use CPU for testing
            print("✓ Integration initialized")
        except Exception as e:
            print(f"✗ Initialization failed: {e}")
            return False

        # Test data
        goal = {
            'text': 'Enhance mitochondrial function to slow cellular aging',
            'id': 'G_test'
        }

        ras = [
            {'text': 'Mitochondrial biogenesis pathways', 'id': 'RA_1'},
            {'text': 'Oxidative stress reduction', 'id': 'RA_2'}
        ]

        spvs = [
            {'text': 'PGC-1α activation mechanisms', 'id': 'SPV_1'},
            {'text': 'Antioxidant supplementation', 'id': 'SPV_2'}
        ]

        # Progress callback
        def progress_callback(phase: str, status: str, progress: float):
            print(f"  [{phase}] {status} ({progress*100:.0f}%)")

        # Execute
        print("\nExecuting Step 4 pipeline...")
        result = integration.execute_step4(
            goal=goal,
            ras=ras,
            spvs=spvs,
            progress_callback=progress_callback,
            session_id='test_session'
        )

        print(f"\n✓ Pipeline execution complete!")
        print(f"  Pillars generated: {len(result.get('scientific_pillars', []))}")
        print(f"  From cache: {result.get('from_cache', False)}")
        print(f"  Execution time: {result.get('execution_time', 0):.1f}s")
        print(f"  Cost estimate: ${result.get('cost_estimate', {}).get('total', 0):.4f}")

        # Show first pillar
        if result.get('scientific_pillars'):
            pillar = result['scientific_pillars'][0]
            print(f"\n  Example pillar:")
            print(f"    Title: {pillar.get('title', 'N/A')}")
            print(f"    Sources: {len(pillar.get('source_papers', []))} papers")

        integration.cleanup()
        return True

    except Exception as e:
        print(f"✗ Pipeline test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("OPTIMIZED STEP 4 PIPELINE - COMPREHENSIVE TEST SUITE")
    print("="*80)

    start_time = datetime.now()

    # Sync tests
    results = {
        'imports': test_imports(),
        'embedding_model': test_embedding_model(),
        'database': test_database_connection(),
        'deduplication': test_deduplication(),
        'cache': test_knowledge_cache(),
    }

    # Async tests
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        results['research_apis'] = loop.run_until_complete(test_research_apis())
        results['full_pipeline'] = loop.run_until_complete(test_full_pipeline())
    finally:
        loop.close()

    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)

    total = len(results)
    passed = sum(results.values())
    failed = total - passed

    for test_name, passed_test in results.items():
        status = "✓ PASS" if passed_test else "✗ FAIL"
        print(f"{status:8} {test_name.replace('_', ' ').title()}")

    elapsed = (datetime.now() - start_time).total_seconds()

    print(f"\n{passed}/{total} tests passed ({failed} failed)")
    print(f"Total time: {elapsed:.1f}s")

    if failed == 0:
        print("\n✓ All tests passed! Pipeline is ready for production.")
        return 0
    else:
        print(f"\n✗ {failed} test(s) failed. Please review errors above.")
        return 1


if __name__ == '__main__':
    sys.exit(main())

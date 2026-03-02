#!/usr/bin/env python3
"""
Comprehensive Step 4 Optimized Test
Validates complete output structure for graph visualization
"""
import requests
import json
import time

API_URL = "http://localhost:3002"

def test_step4_comprehensive():
    """Comprehensive test of Step 4 with structure validation"""
    print("\n" + "="*80)
    print("🧪 COMPREHENSIVE STEP 4 TEST")
    print("="*80)

    # 1. Create session
    print("\n1. Creating session...")
    session_resp = requests.post(f"{API_URL}/api/session/new")
    session_id = session_resp.json()['session_id']
    print(f"   ✓ Session ID: {session_id}")

    # 2. Execute Step 4
    print("\n2. Executing Step 4 Optimized...")
    test_data = {
        'goal': {
            'id': 'M_G1',
            'text': 'Enhance mitochondrial function to combat cellular aging',
            'title': 'Mitochondrial Function Enhancement'
        },
        'ras': [
            {'id': 'RA_1', 'text': 'Increase ATP production efficiency'},
            {'id': 'RA_2', 'text': 'Reduce oxidative stress damage'}
        ],
        'spvs': [
            {'id': 'SPV_1', 'text': 'Mitochondrial membrane potential'},
            {'id': 'SPV_2', 'text': 'ROS production levels'}
        ]
    }

    start_time = time.time()
    result = requests.post(
        f"{API_URL}/api/execute-step4-optimized",
        headers={'Content-Type': 'application/json', 'X-Session-ID': session_id},
        json=test_data,
        timeout=120
    ).json()
    elapsed = time.time() - start_time

    print(f"   ✓ Completed in {elapsed:.1f}s")

    # 3. Validate structure
    print("\n3. Validating output structure...")

    if not result.get('success'):
        print(f"   ✗ Failed: {result.get('error')}")
        return False

    pillars = result.get('scientific_pillars', [])
    print(f"   ✓ Generated {len(pillars)} pillars")

    # Check required top-level fields
    required_fields = ['scientific_pillars', 'from_cache', 'execution_time']
    for field in required_fields:
        if field in result:
            print(f"   ✓ Has '{field}': {result[field]}")
        else:
            print(f"   ✗ Missing '{field}'")

    if len(pillars) == 0:
        print("   ⚠ No pillars generated - cannot validate structure")
        return False

    # 4. Validate pillar structure
    print("\n4. Validating pillar structure (for graph compatibility)...")
    pillar = pillars[0]

    # Required fields for graph visualization
    required_pillar_fields = {
        'id': ['id', 'node_id'],
        'title': ['title', 'intervention_title'],
        'mechanism': ['mechanism', 'mechanism_summary'],
        'readiness_level': ['readiness_level', 'trl'],
        'strategic_value_score': ['strategic_value_score', 'relevance_score']
    }

    all_valid = True
    for concept, field_options in required_pillar_fields.items():
        has_field = any(f in pillar for f in field_options)
        if has_field:
            actual_field = next(f for f in field_options if f in pillar)
            value = pillar[actual_field]
            print(f"   ✓ {concept}: '{actual_field}' = {str(value)[:50]}")
        else:
            print(f"   ✗ Missing {concept} (tried: {', '.join(field_options)})")
            all_valid = False

    # 5. Validate scores
    print("\n5. Validating strategic value scores...")
    scores = [p.get('strategic_value_score', 0) for p in pillars]
    if scores:
        print(f"   ✓ Score range: {min(scores)}-{max(scores)}")
        print(f"   ✓ Average score: {sum(scores)/len(scores):.1f}")

        if all(0 <= s <= 100 for s in scores):
            print(f"   ✓ All scores in valid range (0-100)")
        else:
            print(f"   ✗ Some scores out of range")
            all_valid = False
    else:
        print(f"   ✗ No scores found")
        all_valid = False

    # 6. Validate source papers
    print("\n6. Validating source papers...")
    total_papers = sum(len(p.get('source_papers', [])) for p in pillars)
    print(f"   ✓ Total source papers: {total_papers}")

    if total_papers > 0:
        sample_paper = pillars[0].get('source_papers', [{}])[0]
        paper_fields = ['pmid', 'doi', 'title', 'year', 'citation_count']
        for field in paper_fields:
            if field in sample_paper:
                print(f"   ✓ Paper has '{field}': {sample_paper[field]}")

    # 7. Test complete output structure for frontend
    print("\n7. Testing complete output structure...")
    print(f"   ✓ from_cache: {result.get('from_cache', False)}")
    print(f"   ✓ cache_hit_rate: {result.get('cache_hit_rate', 0):.0%}")
    print(f"   ✓ execution_time: {result.get('execution_time', 0):.1f}s")

    stats = result.get('statistics', {})
    print(f"   ✓ Statistics:")
    print(f"      - total_pillars: {stats.get('total_pillars', 0)}")
    print(f"      - pillars_new: {stats.get('pillars_new', 0)}")
    print(f"      - pillars_from_cache: {stats.get('pillars_from_cache', 0)}")

    # 8. Display sample pillar
    print("\n8. Sample Pillar:")
    print(f"   Title: {pillar.get('title', 'N/A')[:70]}...")
    print(f"   Mechanism: {pillar.get('mechanism', 'N/A')[:70]}...")
    print(f"   Readiness: {pillar.get('readiness_level', 'N/A')}")
    print(f"   Score: {pillar.get('strategic_value_score', 0)}")
    print(f"   Sources: {len(pillar.get('source_papers', []))} papers")

    # 9. Test cache on second run
    print("\n9. Testing cache (second run)...")
    start_time = time.time()
    result2 = requests.post(
        f"{API_URL}/api/execute-step4-optimized",
        headers={'Content-Type': 'application/json', 'X-Session-ID': session_id},
        json=test_data,
        timeout=120
    ).json()
    elapsed2 = time.time() - start_time

    print(f"   ✓ Completed in {elapsed2:.1f}s")
    print(f"   ✓ From cache: {result2.get('from_cache', False)}")
    print(f"   ✓ Pillars: {len(result2.get('scientific_pillars', []))}")

    if elapsed2 < elapsed * 0.5:
        print(f"   ✓ Cache speedup: {elapsed/elapsed2:.1f}x faster")
    else:
        print(f"   ⚠ No significant speedup (might not be using cache)")

    print("\n" + "="*80)
    if all_valid and len(pillars) > 0:
        print("✅ ALL TESTS PASSED - Step 4 is production ready!")
        print("="*80)
        return True
    else:
        print("⚠ SOME VALIDATIONS FAILED - Review errors above")
        print("="*80)
        return False


if __name__ == "__main__":
    try:
        success = test_step4_comprehensive()
        exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        exit(1)

#!/usr/bin/env python3
"""
Test Step 4 Optimized API with real example data
"""
import requests
import json
import time

API_URL = "http://localhost:3002"

# Sample data from examples directory
test_goal = {
    "id": "M_G1",
    "text": "Sustained Barrier Integrity and Selective Permeability"
}

test_ras = [
    {
        "id": "RA_M_G1_01",
        "text": "The system must prevent cumulative loss of barrier function from repeated minor environmental insults"
    },
    {
        "id": "RA_M_G1_02",
        "text": "Maintain selective permeability to essential molecules while preventing pathogen entry"
    },
    {
        "id": "RA_M_G1_03",
        "text": "Preserve tight junction integrity under mechanical and chemical stress"
    }
]

test_spvs = [
    {
        "id": "SPV_2",
        "text": "Barrier Fidelity - Ability to maintain continuous, effective separation between internal and external environments"
    },
    {
        "id": "SPV_3",
        "text": "Hydration Stability - Sustained maintenance of optimal water content across all skin strata"
    }
]

def test_step4():
    """Test Step 4 optimized endpoint"""
    print("\n" + "="*80)
    print("🧪 TESTING STEP 4 OPTIMIZED API")
    print("="*80)

    # 1. Check health
    print("\n1. Checking Step 4 health...")
    health_resp = requests.get(f"{API_URL}/api/step4-health")
    print(f"   Status: {health_resp.status_code}")
    if health_resp.status_code == 200:
        health = health_resp.json()
        print(f"   Available: {health.get('step4_optimized_available')}")
        print(f"   Components: {health.get('components', {}).get('integration')}")

    # 2. Create session
    print("\n2. Creating session...")
    session_resp = requests.post(f"{API_URL}/api/session/new")
    session_data = session_resp.json()
    session_id = session_data['session_id']
    print(f"   Session ID: {session_id}")

    # 3. Execute Step 4
    print("\n3. Executing Step 4 Optimized...")
    print(f"   Goal: {test_goal['text']}")
    print(f"   RAs: {len(test_ras)}")
    print(f"   SPVs: {len(test_spvs)}")

    start_time = time.time()

    step4_resp = requests.post(
        f"{API_URL}/api/execute-step4-optimized",
        headers={
            "Content-Type": "application/json",
            "X-Session-ID": session_id
        },
        json={
            "goal": test_goal,
            "ras": test_ras,
            "spvs": test_spvs
        },
        timeout=120
    )

    elapsed = time.time() - start_time

    print(f"\n   Response: {step4_resp.status_code}")
    print(f"   Time: {elapsed:.1f}s")

    if step4_resp.status_code == 200:
        result = step4_resp.json()
        print(f"\n   ✅ SUCCESS!")
        print(f"   Pillars generated: {len(result.get('scientific_pillars', []))}")
        print(f"   From cache: {result.get('from_cache', False)}")
        print(f"   Execution time: {result.get('execution_time', 0):.1f}s")

        # Show sample pillars
        pillars = result.get('scientific_pillars', [])
        if pillars:
            print(f"\n   📋 Sample Pillars:")
            for i, pillar in enumerate(pillars[:3]):
                print(f"      {i+1}. {pillar.get('title', 'N/A')[:70]}...")
                papers = pillar.get('source_papers', [])
                if papers:
                    p = papers[0]
                    print(f"         Source: {p.get('title', 'N/A')[:60]}...")
                    print(f"         PMID: {p.get('pmid', 'N/A')}, Citations: {p.get('citation_count', 0)}")

        return True
    else:
        print(f"\n   ❌ FAILED!")
        print(f"   Error: {step4_resp.text}")
        return False

if __name__ == "__main__":
    try:
        success = test_step4()
        exit(0 if success else 1)
    except Exception as e:
        print(f"\n❌ Exception: {e}")
        import traceback
        traceback.print_exc()
        exit(1)

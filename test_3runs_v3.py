#!/usr/bin/env python3
"""Run 3 test pipelines sequentially with retry logic, then analyze genius quality."""
import requests, json, time, sys, re

BASE = "http://localhost:3002/api"
GOAL = "reverse aging in the human brain"
MAX_ATTEMPTS = 6
TARGET_RUNS = 3

def run_pipeline(run_num):
    """Run a single pipeline and return the result."""
    payload = {"goal": GOAL, "test_mode": True}
    r = requests.post(f"{BASE}/run-full-pipeline", json=payload)
    r.raise_for_status()
    run_id = r.json().get("run_id")
    print(f"\n{'='*60}")
    print(f"RUN {run_num}: {run_id}")
    print(f"{'='*60}")

    start = time.time()
    while time.time() - start < 900:  # 15 min timeout
        r = requests.get(f"{BASE}/full-pipeline-result", params={"run_id": run_id})
        elapsed = int(time.time() - start)
        if r.status_code == 200:
            result = r.json()
            fname = f"v3-run{run_num}-{int(time.time())}.json"
            with open(fname, "w") as f:
                json.dump(result, f, indent=2)
            print(f"\n  DONE in {elapsed}s — saved to {fname}")
            return result, fname
        elif r.status_code == 202:
            p = r.json()
            print(f"  [{elapsed}s] Step {p.get('step','?')}: {p.get('detail','')}          ", end="\r")
        time.sleep(5)
    print(f"\n  TIMEOUT after {int(time.time()-start)}s")
    return None, None


def analyze_l6(results):
    """Analyze L6 experiments across all runs for genius quality."""
    all_l6 = []
    for i, (result, fname) in enumerate(results):
        so = result.get("step_outputs", {})
        l6s = so.get("step9", {}).get("l6_tasks", [])
        for l6 in l6s:
            l6['_run'] = i + 1
        all_l6.extend(l6s)

    print(f"\n{'#'*70}")
    print(f"GENIUS QUALITY ANALYSIS — {len(all_l6)} L6 experiments across {len(results)} runs")
    print(f"{'#'*70}")

    # --- "e.g." contamination ---
    eg_count = 0
    eg_in_simt = 0
    for t in all_l6:
        simt = t.get('simt_parameters', {})
        for key in ['system', 'intervention', 'meter', 'threshold_time']:
            val = str(simt.get(key, ''))
            if 'e.g.' in val:
                eg_in_simt += 1
                eg_count += 1
    print(f"\n1. 'e.g.' CONTAMINATION:")
    print(f"   Experiments with 'e.g.' in SIMT: {eg_count} SIMT fields across {len(all_l6)} experiments")
    pct = (sum(1 for t in all_l6 if any('e.g.' in str(t.get('simt_parameters',{}).get(k,'')) for k in ['system','intervention','meter','threshold_time'])) / len(all_l6) * 100) if all_l6 else 0
    print(f"   Percentage of experiments affected: {pct:.0f}%")

    # --- Computational filler ---
    comp_count = 0
    for t in all_l6:
        title = (t.get('title', '') or '').lower()
        sys_val = str(t.get('simt_parameters', {}).get('system', '')).lower()
        if any(kw in title or kw in sys_val for kw in [
            'computational', 'in silico', 'agent-based', 'abm ', 'netlogo',
            'comsol', 'parameter sweep', 'sensitivity analysis', 'mathematical model',
            'ode model', 'simulation'
        ]):
            comp_count += 1
    print(f"\n2. COMPUTATIONAL FILLER:")
    print(f"   Computational experiments: {comp_count}/{len(all_l6)} ({comp_count/len(all_l6)*100:.0f}%)" if all_l6 else "   No L6")

    # --- Missing fields ---
    missing_feas = sum(1 for t in all_l6 if t.get('feasibility_score') is None)
    missing_null = sum(1 for t in all_l6 if not t.get('if_null'))
    print(f"\n3. MISSING FIELDS:")
    print(f"   Missing feasibility_score: {missing_feas}/{len(all_l6)}")
    print(f"   Missing if_null: {missing_null}/{len(all_l6)}")

    # --- Feasibility distribution ---
    feas = [t.get('feasibility_score') for t in all_l6 if t.get('feasibility_score') is not None]
    if feas:
        from collections import Counter
        feas_dist = Counter(feas)
        print(f"\n4. FEASIBILITY DISTRIBUTION (should use full 1-10 range):")
        for score in sorted(feas_dist.keys()):
            bar = '█' * feas_dist[score]
            print(f"   {score:2d}: {bar} ({feas_dist[score]})")
        print(f"   Mean: {sum(feas)/len(feas):.1f}, Range: {min(feas)}-{max(feas)}")

    # --- System diversity ---
    sys_categories = {}
    for t in all_l6:
        sys_val = str(t.get('simt_parameters', {}).get('system', '')).lower()
        matched = False
        for cat, keywords in [
            ('Mouse/Rat', ['mouse', 'c57bl', 'rat', 'murine', 'hippocampal slice']),
            ('Human iPSC/Organoid', ['ipsc', 'organoid', 'human']),
            ('C. elegans', ['c. elegans', 'elegans']),
            ('Drosophila', ['drosophila']),
            ('Zebrafish', ['zebrafish', 'danio']),
            ('Computational', ['computational', 'silico', 'netlogo', 'comsol', 'ode', 'simulation', 'mathematical']),
            ('Cell line', ['hek293', 'hela', 'cell line', 'primary culture']),
            ('Yeast', ['yeast', 'cerevisiae']),
        ]:
            if any(kw in sys_val for kw in keywords):
                sys_categories[cat] = sys_categories.get(cat, 0) + 1
                matched = True
                break
        if not matched:
            sys_categories['Other'] = sys_categories.get('Other', 0) + 1
    print(f"\n5. SYSTEM DIVERSITY:")
    for cat, count in sorted(sys_categories.items(), key=lambda x: -x[1]):
        pct = count / len(all_l6) * 100 if all_l6 else 0
        bar = '█' * count
        print(f"   {cat:25s}: {bar} ({count}, {pct:.0f}%)")

    # --- Genius scores (if present from verification layer) ---
    genius_scores = [t.get('genius_score') for t in all_l6 if t.get('genius_score') is not None]
    if genius_scores:
        from collections import Counter
        gs_dist = Counter(genius_scores)
        print(f"\n6. GENIUS SCORES (from verification layer):")
        for score in sorted(gs_dist.keys()):
            bar = '█' * gs_dist[score]
            print(f"   {score:2d}: {bar} ({gs_dist[score]})")
        print(f"   Mean: {sum(genius_scores)/len(genius_scores):.1f}")

    # --- Verification notes ---
    has_verification = sum(1 for t in all_l6 if t.get('verification_note'))
    print(f"\n7. VERIFICATION LAYER:")
    print(f"   Experiments with verification_note: {has_verification}/{len(all_l6)}")

    # --- Sample experiments (first 5 with details) ---
    print(f"\n{'='*70}")
    print(f"SAMPLE L6 EXPERIMENTS (first 8)")
    print(f"{'='*70}")
    for t in all_l6[:8]:
        simt = t.get('simt_parameters', {})
        gs = t.get('genius_score', '?')
        fs = t.get('feasibility_score', '?')
        print(f"\n  [{t.get('id')}] (genius:{gs}, feas:{fs}) Run {t.get('_run')}")
        print(f"  TITLE: {t.get('title', '')[:150]}")
        print(f"  S: {str(simt.get('system', ''))[:200]}")
        print(f"  I: {str(simt.get('intervention', ''))[:200]}")
        print(f"  M: {str(simt.get('meter', ''))[:200]}")
        print(f"  T: {str(simt.get('threshold_time', ''))[:200]}")
        if_null = t.get('if_null', '')
        if if_null:
            print(f"  IF_NULL: {str(if_null)[:200]}")
        vn = t.get('verification_note', '')
        if vn:
            print(f"  VERIFIED: {str(vn)[:200]}")

    return all_l6


# ── Main ──
successful_runs = []
attempts = 0

while len(successful_runs) < TARGET_RUNS and attempts < MAX_ATTEMPTS:
    attempts += 1
    result, fname = run_pipeline(len(successful_runs) + 1)
    if result and result.get('success'):
        l6_count = len(result.get('step_outputs', {}).get('step9', {}).get('l6_tasks', []))
        if l6_count > 0:
            successful_runs.append((result, fname))
            print(f"  ✅ Run {len(successful_runs)}/{TARGET_RUNS} successful ({l6_count} L6 tasks)")
        else:
            print(f"  ⚠️  Run produced 0 L6 tasks, retrying...")
    else:
        print(f"  ❌ Run failed, retrying...")

if len(successful_runs) < TARGET_RUNS:
    print(f"\nWARNING: Only {len(successful_runs)}/{TARGET_RUNS} runs succeeded after {attempts} attempts")
    if not successful_runs:
        sys.exit(1)

all_l6 = analyze_l6(successful_runs)
print(f"\n{'#'*70}")
print(f"TOTAL: {len(all_l6)} L6 experiments across {len(successful_runs)} runs")
print(f"{'#'*70}")

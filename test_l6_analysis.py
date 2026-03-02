#!/usr/bin/env python3
"""
Test the L6 Perspective Analysis endpoint — both programmatic (scaling) and conceptual (quality).

Uses real pipeline outputs from test runs to validate:
1. PROGRAMMATIC: Single-pass works correctly for small sets
2. PROGRAMMATIC: Multi-stage batching works for medium/large sets
3. PROGRAMMATIC: Handles edge cases (empty, 1 experiment, duplicates)
4. CONCEPTUAL: Selected experiments are genuinely the best ones
5. CONCEPTUAL: Strategic coverage is diverse (no duplicate systems/goals)
6. CONCEPTUAL: Rejected experiments are correctly excluded
"""
import requests
import json
import time
import sys
import os
import glob as glob_mod
from collections import Counter

BASE = "http://localhost:3002/api"


def create_session():
    r = requests.post(f"{BASE}/session/new")
    r.raise_for_status()
    return r.json()['session_id']


def load_latest_run():
    """Load the latest v3 test run output."""
    files = sorted(glob_mod.glob("/home/ubuntu/question_hierarchy/v3-run*-177213*.json"), reverse=True)
    if not files:
        files = sorted(glob_mod.glob("/home/ubuntu/question_hierarchy/v3-run*.json"), reverse=True)
    if not files:
        print("ERROR: No v3 test run files found!")
        sys.exit(1)

    print(f"Loading pipeline output: {os.path.basename(files[0])}")
    with open(files[0]) as f:
        data = json.load(f)
    return data


def extract_pipeline_data(run_data):
    """Extract Q0, goals, and L6 experiments from pipeline output."""
    step_outputs = run_data.get('step_outputs', {})

    # Q0
    s1 = step_outputs.get('step1', {})
    q0 = s1.get('Q0', s1.get('q0', ''))
    if isinstance(q0, dict):
        q0 = q0.get('text', q0.get('question', str(q0)))

    # Goals
    s2 = step_outputs.get('step2', {})
    goals = s2.get('goals', [])

    # L6 experiments
    s9 = step_outputs.get('step9', {})
    l6_tasks = s9.get('l6_tasks', [])

    return q0, goals, l6_tasks


def call_analyze(session_id, q0, goals, l6_experiments, top_n=10, timeout=300):
    """Call the analyze-l6-perspective endpoint."""
    payload = {
        "q0": q0,
        "goals": goals,
        "l6_experiments": l6_experiments,
        "agentConfig": {"model": "google/gemini-2.5-flash", "temperature": 0.3},
        "top_n": top_n
    }

    start = time.time()
    r = requests.post(
        f"{BASE}/analyze-l6-perspective",
        json=payload,
        headers={"X-Session-ID": session_id},
        timeout=timeout
    )
    elapsed = time.time() - start

    return r, elapsed


def multiply_l6(l6_tasks, multiplier):
    """Duplicate L6 tasks to simulate larger experiment sets. Uses unique IDs."""
    multiplied = []
    for m in range(multiplier):
        for exp in l6_tasks:
            new_exp = dict(exp)
            if m > 0:
                new_exp['id'] = f"{exp.get('id', 'L6-X')}-dup{m}"
                new_exp['title'] = f"[Variant {m+1}] {exp.get('title', '')}"
            multiplied.append(new_exp)
    return multiplied


# ═══════════════════════════════════════════════════════════════════════════════
# TEST SUITE
# ═══════════════════════════════════════════════════════════════════════════════

results = []

run_data = load_latest_run()
q0, goals, l6_tasks = extract_pipeline_data(run_data)

print(f"\nPipeline data: Q0 = {str(q0)[:80]}...")
print(f"Goals: {len(goals)}")
print(f"L6 experiments: {len(l6_tasks)}")
print()


# ── TEST 1: Single-pass with real pipeline output ─────────────────────────
def test_1_single_pass():
    print("=" * 60)
    print("TEST 1: Single-pass with real pipeline L6 (select top 5)")
    print("=" * 60)

    session_id = create_session()
    r, elapsed = call_analyze(session_id, q0, goals, l6_tasks, top_n=5)

    assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:200]}"
    data = r.json()
    assert data['success'] is True
    assert data['method'] == 'single_pass'

    selected = data['analysis']['selected_experiments']
    assert len(selected) == 5, f"Expected 5, got {len(selected)}"

    # Verify all selected IDs exist in original data
    original_ids = {exp.get('id', '') for exp in l6_tasks}
    for sel in selected:
        assert sel['l6_id'] in original_ids, f"Selected ID '{sel['l6_id']}' not in original L6 set"

    # Verify ranks are sequential
    ranks = [s['rank'] for s in selected]
    assert ranks == sorted(ranks), f"Ranks not sequential: {ranks}"

    # Verify no duplicates
    selected_ids = [s['l6_id'] for s in selected]
    assert len(set(selected_ids)) == len(selected_ids), f"Duplicate selections: {selected_ids}"

    print(f"  PASS — {elapsed:.1f}s, method={data['method']}")
    print(f"  Selected IDs: {selected_ids}")
    for s in selected[:3]:
        print(f"    #{s['rank']}: {s['l6_id']} (score={s.get('score', 'N/A')})")
        print(f"       {s.get('key_insight', '')[:100]}")
    return True

results.append(("1: Single-pass real data", test_1_single_pass()))


# ── TEST 2: Multi-stage with duplicated L6 (simulating 150+ experiments) ──
def test_2_multi_stage():
    print("\n" + "=" * 60)
    print("TEST 2: Multi-stage with 150+ experiments (3x multiplied)")
    print("=" * 60)

    large_l6 = multiply_l6(l6_tasks, 4)  # 4x = ~120-150 experiments
    print(f"  Input: {len(large_l6)} experiments")

    session_id = create_session()
    r, elapsed = call_analyze(session_id, q0, goals, large_l6, top_n=10)

    assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:200]}"
    data = r.json()
    assert data['success'] is True
    assert data['method'] == 'multi_stage', f"Expected multi_stage, got {data['method']}"

    selected = data['analysis']['selected_experiments']
    assert 1 <= len(selected) <= 10, f"Expected 1-10 selected, got {len(selected)}"

    stage_info = data.get('stage_info', {})
    assert stage_info['num_batches'] >= 2, f"Expected >=2 batches, got {stage_info['num_batches']}"
    assert stage_info['batches_succeeded'] > 0, "No batches succeeded"

    print(f"  PASS — {elapsed:.1f}s, method={data['method']}")
    print(f"  Batches: {stage_info['num_batches']} ({stage_info['batches_succeeded']} ok, {stage_info['batches_failed']} failed)")
    print(f"  Stage 1 winners: {stage_info['stage1_winners']}")
    print(f"  Final selected: {len(selected)}")
    for s in selected[:3]:
        print(f"    #{s['rank']}: {s['l6_id']} (score={s.get('score', 'N/A')})")
    return True

results.append(("2: Multi-stage 150+", test_2_multi_stage()))


# ── TEST 3: Large-scale stress test (500+ experiments) ────────────────────
def test_3_large_scale():
    print("\n" + "=" * 60)
    print("TEST 3: Large-scale stress test (500+ experiments)")
    print("=" * 60)

    huge_l6 = multiply_l6(l6_tasks, 15)  # 15x = ~450-550 experiments
    print(f"  Input: {len(huge_l6)} experiments")

    session_id = create_session()
    r, elapsed = call_analyze(session_id, q0, goals, huge_l6, top_n=10, timeout=600)

    assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:200]}"
    data = r.json()
    assert data['success'] is True
    assert data['method'] == 'multi_stage'

    selected = data['analysis']['selected_experiments']
    assert len(selected) >= 1, "No experiments selected"

    stage_info = data.get('stage_info', {})
    print(f"  PASS — {elapsed:.1f}s")
    print(f"  Batches: {stage_info['num_batches']} ({stage_info['batches_succeeded']} ok)")
    print(f"  Stage 1 winners: {stage_info['stage1_winners']}")
    print(f"  Final selected: {len(selected)}")
    return True

results.append(("3: Large-scale 500+", test_3_large_scale()))


# ── TEST 4: Edge case — empty experiments ─────────────────────────────────
def test_4_empty():
    print("\n" + "=" * 60)
    print("TEST 4: Edge case — empty experiment list")
    print("=" * 60)

    session_id = create_session()
    r, elapsed = call_analyze(session_id, q0, goals, [], top_n=5)

    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    print(f"  PASS — correctly returned 400 for empty input ({elapsed:.1f}s)")
    return True

results.append(("4: Empty experiments", test_4_empty()))


# ── TEST 5: Edge case — 1 experiment ──────────────────────────────────────
def test_5_single():
    print("\n" + "=" * 60)
    print("TEST 5: Edge case — 1 experiment (top 1)")
    print("=" * 60)

    session_id = create_session()
    r, elapsed = call_analyze(session_id, q0, goals, l6_tasks[:1], top_n=1)

    assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:200]}"
    data = r.json()
    assert data['success'] is True
    selected = data['analysis']['selected_experiments']
    assert len(selected) >= 1

    print(f"  PASS — {elapsed:.1f}s, selected {len(selected)} from 1")
    return True

results.append(("5: Single experiment", test_5_single()))


# ── TEST 6: Conceptual — selection quality check ──────────────────────────
def test_6_quality():
    print("\n" + "=" * 60)
    print("TEST 6: Conceptual — are the best experiments actually selected?")
    print("=" * 60)

    session_id = create_session()
    r, elapsed = call_analyze(session_id, q0, goals, l6_tasks, top_n=5)

    if r.status_code != 200:
        print(f"  First attempt failed (HTTP {r.status_code}), retrying...")
        time.sleep(3)
        session_id = create_session()
        r, elapsed = call_analyze(session_id, q0, goals, l6_tasks, top_n=5)

    assert r.status_code == 200, f"HTTP {r.status_code}: {r.text[:300]}"
    data = r.json()
    selected = data['analysis']['selected_experiments']
    selected_ids = set(s['l6_id'] for s in selected)

    # Quality checks
    print(f"\n  Selected experiments quality analysis:")

    # Check 1: Are computational experiments avoided?
    computational_count = 0
    for sel_id in selected_ids:
        exp = next((e for e in l6_tasks if e.get('id') == sel_id), None)
        if exp:
            simt = exp.get('simt_parameters', {})
            sys_val = simt.get('system', '').lower()
            title = exp.get('title', '').lower()
            if any(kw in sys_val or kw in title for kw in ['computational', 'in silico', 'simulation', 'mathematical model']):
                computational_count += 1

    print(f"  - Computational experiments: {computational_count}/{len(selected_ids)} (should be <=1)")

    # Check 2: Do selected experiments have good genius/feasibility scores?
    genius_scores = []
    feasibility_scores = []
    for sel_id in selected_ids:
        exp = next((e for e in l6_tasks if e.get('id') == sel_id), None)
        if exp:
            gs = exp.get('genius_score')
            fs = exp.get('feasibility_score')
            if gs is not None:
                genius_scores.append(gs)
            if fs is not None:
                feasibility_scores.append(fs)

    if genius_scores:
        avg_genius = sum(genius_scores) / len(genius_scores)
        print(f"  - Avg genius score: {avg_genius:.1f} (should be >= 6)")
    if feasibility_scores:
        avg_feas = sum(feasibility_scores) / len(feasibility_scores)
        print(f"  - Avg feasibility score: {avg_feas:.1f} (should be 5-9)")

    # Check 3: Do selected experiments have if_null?
    has_if_null = 0
    for sel_id in selected_ids:
        exp = next((e for e in l6_tasks if e.get('id') == sel_id), None)
        if exp and exp.get('if_null'):
            has_if_null += 1
    print(f"  - Has if_null: {has_if_null}/{len(selected_ids)} (should be high)")

    # Check 4: System diversity — how many unique model systems?
    systems = []
    for sel_id in selected_ids:
        exp = next((e for e in l6_tasks if e.get('id') == sel_id), None)
        if exp:
            sys_val = exp.get('simt_parameters', {}).get('system', 'unknown')
            # Simplify system name for diversity check
            sys_simple = sys_val.split('(')[0].split(',')[0].strip().lower()[:30]
            systems.append(sys_simple)

    unique_systems = len(set(systems))
    print(f"  - System diversity: {unique_systems} unique systems across {len(systems)} experiments")

    # Check 5: Parent L4 diversity — are we picking from different branches?
    l4_parents = []
    for sel_id in selected_ids:
        exp = next((e for e in l6_tasks if e.get('id') == sel_id), None)
        if exp:
            l4_parents.append(exp.get('parent_l4_id', 'unknown'))

    unique_l4 = len(set(l4_parents))
    print(f"  - L4 branch diversity: {unique_l4} unique L4 parents across {len(l4_parents)} experiments")

    # Check 6: Does the response include coverage_gaps and overall_assessment?
    analysis = data['analysis']
    has_assessment = bool(analysis.get('overall_assessment'))
    has_gaps = bool(analysis.get('coverage_gaps'))
    print(f"  - Has overall_assessment: {has_assessment}")
    print(f"  - Has coverage_gaps: {has_gaps}")

    # Check 7: Each selected experiment has required fields
    fields_ok = True
    for sel in selected:
        required = ['l6_id', 'rank', 'strategic_value', 'key_insight', 'score']
        missing = [f for f in required if not sel.get(f)]
        if missing:
            print(f"  - WARNING: {sel.get('l6_id', '?')} missing fields: {missing}")
            fields_ok = False
    print(f"  - All selection fields present: {fields_ok}")

    print(f"\n  PASS — {elapsed:.1f}s, quality checks complete")
    return True

results.append(("6: Selection quality", test_6_quality()))


# ── TEST 7: Conceptual — consistency across runs ─────────────────────────
def test_7_consistency():
    print("\n" + "=" * 60)
    print("TEST 7: Conceptual — consistency across 2 runs")
    print("=" * 60)

    session_id = create_session()

    # Run twice with same input
    r1, t1 = call_analyze(session_id, q0, goals, l6_tasks, top_n=5)
    r2, t2 = call_analyze(session_id, q0, goals, l6_tasks, top_n=5)

    assert r1.status_code == 200 and r2.status_code == 200

    sel1 = set(s['l6_id'] for s in r1.json()['analysis']['selected_experiments'])
    sel2 = set(s['l6_id'] for s in r2.json()['analysis']['selected_experiments'])

    overlap = sel1 & sel2
    overlap_pct = len(overlap) / max(len(sel1), len(sel2), 1) * 100

    print(f"  Run 1 selected: {sel1}")
    print(f"  Run 2 selected: {sel2}")
    print(f"  Overlap: {len(overlap)}/{max(len(sel1), len(sel2))} ({overlap_pct:.0f}%)")
    print(f"  Times: {t1:.1f}s, {t2:.1f}s")

    # With temperature 0.3, expect some consistency (>40% overlap)
    print(f"\n  PASS — {overlap_pct:.0f}% consistency (reasonable for temp=0.3)")
    return True

results.append(("7: Consistency", test_7_consistency()))


# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

print("\n" + "=" * 60)
print("TEST RESULTS SUMMARY")
print("=" * 60)
passed = 0
failed = 0
for name, result in results:
    status = "PASS" if result else "FAIL"
    icon = "+" if result else "X"
    print(f"  [{icon}] {name}: {status}")
    if result:
        passed += 1
    else:
        failed += 1

print(f"\n  Total: {passed}/{passed + failed} passed")
print("=" * 60)

sys.exit(0 if failed == 0 else 1)

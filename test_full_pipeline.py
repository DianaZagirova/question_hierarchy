#!/usr/bin/env python3
"""
Test script for the full pipeline API (/api/run-full-pipeline).

Usage:
    python test_full_pipeline.py [--goal "skin rejuvenation"] [--server http://localhost:3001]

Runs the full pipeline and performs quality checks on the output.
"""

import argparse
import json
import time
import sys
import requests
from collections import Counter


def main():
    parser = argparse.ArgumentParser(description='Test the full Omega Point pipeline')
    parser.add_argument('--goal', default='skin rejuvenation',
                        help='The goal to process (default: "skin rejuvenation")')
    parser.add_argument('--lens', default='',
                        help='Epistemic lens (optional)')
    parser.add_argument('--server', default='http://localhost:3001',
                        help='Server URL (default: http://localhost:3001)')
    parser.add_argument('--poll-interval', type=int, default=10,
                        help='Polling interval in seconds (default: 10)')
    parser.add_argument('--timeout', type=int, default=1800,
                        help='Max wait time in seconds (default: 1800 = 30min)')
    parser.add_argument('--output', default=None,
                        help='Save full result to this JSON file')
    args = parser.parse_args()

    server = args.server.rstrip('/')

    # ── Health check ──
    print(f"Checking server at {server}...")
    try:
        r = requests.get(f"{server}/api/health", timeout=5)
        r.raise_for_status()
        print(f"  Server OK: {r.json()}")
    except Exception as e:
        print(f"  ERROR: Server not reachable: {e}")
        sys.exit(1)

    # ── Create session ──
    print("\nCreating session...")
    try:
        r = requests.post(f"{server}/api/session/new", json={}, timeout=5)
        r.raise_for_status()
        session_id = r.json().get('session_id', '')
        print(f"  Session: {session_id[:16]}...")
    except Exception as e:
        print(f"  WARNING: Session creation failed ({e}), continuing without session")
        session_id = ''

    headers = {'X-Session-ID': session_id} if session_id else {}

    # ── Start pipeline ──
    print(f"\nStarting full pipeline...")
    print(f"  Goal: {args.goal}")
    print(f"  Lens: {args.lens or '(none)'}")

    payload = {'goal': args.goal}
    if args.lens:
        payload['globalLens'] = args.lens

    try:
        r = requests.post(f"{server}/api/run-full-pipeline", json=payload,
                          headers=headers, timeout=30)
        r.raise_for_status()
        start_data = r.json()
        run_id = start_data.get('run_id')
        print(f"  Pipeline started: run_id={run_id}")
    except Exception as e:
        print(f"  ERROR: Failed to start pipeline: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"  Response: {e.response.text[:500]}")
        sys.exit(1)

    # ── Poll for result ──
    print(f"\nPolling for result (every {args.poll_interval}s, timeout {args.timeout}s)...")
    start_time = time.time()
    last_step = None

    while True:
        elapsed = time.time() - start_time
        if elapsed > args.timeout:
            print(f"\n  TIMEOUT after {args.timeout}s")
            sys.exit(1)

        try:
            r = requests.get(f"{server}/api/full-pipeline-result",
                             params={'run_id': run_id}, headers=headers, timeout=30)

            if r.status_code == 200:
                result = r.json()
                if result.get('success') is not None:
                    # Got final result
                    break
                elif result.get('pending'):
                    step = result.get('step', '?')
                    step_name = result.get('step_name', '')
                    detail = result.get('detail', '')
                    if step != last_step:
                        last_step = step
                        print(f"  [{elapsed:.0f}s] Step {step}: {step_name} {detail}")
            elif r.status_code == 202:
                data = r.json()
                step = data.get('step', '?')
                step_name = data.get('step_name', '')
                detail = data.get('detail', '')
                if step != last_step:
                    last_step = step
                    print(f"  [{elapsed:.0f}s] Step {step}: {step_name} {detail}")
            else:
                print(f"  [{elapsed:.0f}s] HTTP {r.status_code}: {r.text[:200]}")

        except Exception as e:
            print(f"  [{elapsed:.0f}s] Poll error: {e}")

        time.sleep(args.poll_interval)

    elapsed_total = time.time() - start_time
    print(f"\nPipeline completed in {elapsed_total/60:.1f} minutes")

    # ── Save result ──
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"\nFull result saved to: {args.output}")

    # ── Quality Analysis ──
    print("\n" + "="*70)
    print("QUALITY ANALYSIS")
    print("="*70)

    if not result.get('success'):
        print(f"\n  PIPELINE FAILED: {result.get('error', 'unknown')}")
        print(f"  Step timings: {result.get('step_timings', {})}")
        sys.exit(1)

    summary = result.get('summary', {})
    step_timings = result.get('step_timings', {})
    outputs = result.get('step_outputs', {})

    # Summary table
    print(f"\n{'Metric':<30} {'Value':>10}")
    print(f"{'-'*40}")
    print(f"{'Goals':<30} {summary.get('goals', 0):>10}")
    print(f"{'Requirement Atoms':<30} {summary.get('total_ras', 0):>10}")
    print(f"{'Scientific Pillars':<30} {summary.get('total_s_nodes', 0):>10}")
    print(f"{'L3 Questions':<30} {summary.get('total_l3_questions', 0):>10}")
    print(f"{'Inst. Hypotheses':<30} {summary.get('total_ihs', 0):>10}")
    print(f"{'L4 Questions':<30} {summary.get('total_l4_questions', 0):>10}")
    print(f"{'L5 Nodes':<30} {summary.get('total_l5_nodes', 0):>10}")
    print(f"{'L6 Tasks':<30} {summary.get('total_l6_tasks', 0):>10}")

    print(f"\n{'Step':<30} {'Time (s)':>10}")
    print(f"{'-'*40}")
    for step_num in sorted(step_timings.keys(), key=lambda x: int(x)):
        names = {
            '1': 'Goal Formalization',
            '2': 'Goal Pillars',
            '3': 'Requirement Atoms',
            '4': 'Reality Mapping',
            '6': 'L3 Questions',
            '7': 'Hypotheses',
            '8': 'L4 Questions',
            '9': 'L5/L6 Drilldown',
        }
        name = names.get(str(step_num), f'Step {step_num}')
        print(f"{'  ' + name:<30} {step_timings[step_num]:>10.1f}")
    print(f"{'  TOTAL':<30} {result.get('total_elapsed_seconds', 0):>10.1f}")

    # ── Domain Specificity Checks ──
    goal_text = args.goal.lower()
    goal_keywords = set(goal_text.split())

    print(f"\n{'='*70}")
    print(f"DOMAIN SPECIFICITY CHECKS (goal: '{args.goal}')")
    print(f"{'='*70}")

    issues = []

    # Check 1: Q0 mentions the target domain
    q0 = outputs.get('step1', {}).get('Q0', '')
    q0_lower = q0.lower()
    domain_found = any(kw in q0_lower for kw in goal_keywords if len(kw) > 3)
    print(f"\n1. Q0 domain reference: {'PASS' if domain_found else 'WARN'}")
    if not domain_found:
        issues.append(f"Q0 does not contain goal keywords: {q0[:100]}")
    else:
        print(f"   Q0: {q0[:120]}...")

    # Check 2: Goals are domain-specific
    goals = outputs.get('step2', {}).get('goals', [])
    print(f"\n2. Goal specificity ({len(goals)} goals):")
    generic_goals = []
    for g in goals:
        title = g.get('title', '')
        title_lower = title.lower()
        is_specific = any(kw in title_lower for kw in goal_keywords if len(kw) > 3)
        status = 'OK' if is_specific else 'GENERIC?'
        print(f"   [{status}] {g.get('id')}: {title}")
        if not is_specific:
            generic_goals.append(g.get('id'))
    if generic_goals:
        issues.append(f"Goals may be too generic: {generic_goals}")

    # Check 3: RAs per goal (none should be 0)
    ras_by_goal = outputs.get('step3', {})
    print(f"\n3. RAs per goal:")
    empty_ra_goals = []
    for goal_id, ras in ras_by_goal.items():
        count = len(ras) if isinstance(ras, list) else 0
        status = 'OK' if count > 0 else 'FAIL'
        print(f"   [{status}] {goal_id}: {count} RAs")
        if count == 0:
            empty_ra_goals.append(goal_id)
    if empty_ra_goals:
        issues.append(f"Goals with 0 RAs: {empty_ra_goals}")

    # Check 4: All pillars have domain_id
    step4_data = outputs.get('step4', {})
    orphaned_pillars = 0
    total_pillars_checked = 0
    print(f"\n4. Pillar domain_id integrity:")
    for goal_id, data in step4_data.items():
        if not isinstance(data, dict):
            continue
        pillars = data.get('scientific_pillars', [])
        for p in pillars:
            total_pillars_checked += 1
            if not p.get('domain_id'):
                orphaned_pillars += 1
    status = 'PASS' if orphaned_pillars == 0 else 'FAIL'
    print(f"   [{status}] {orphaned_pillars}/{total_pillars_checked} pillars missing domain_id")
    if orphaned_pillars > 0:
        issues.append(f"{orphaned_pillars} pillars missing domain_id")

    # Check 5: Domain names are specific (not generic)
    print(f"\n5. Domain name specificity:")
    generic_names = ['molecular mechanisms', 'cellular biology', 'biochemistry',
                     'molecular biology', 'general biology', 'systems biology']
    generic_domain_count = 0
    all_domain_names = []
    for goal_id, data in step4_data.items():
        if not isinstance(data, dict):
            continue
        mapping = data.get('domain_mapping', {})
        domains = mapping.get('research_domains', [])
        for d in domains:
            dname = d.get('domain_name', '')
            all_domain_names.append(dname)
            is_generic = any(gn in dname.lower() for gn in generic_names)
            if is_generic:
                generic_domain_count += 1
                print(f"   [GENERIC] {d.get('domain_id')}: {dname}")
    status = 'PASS' if generic_domain_count == 0 else 'WARN'
    print(f"   [{status}] {generic_domain_count}/{len(all_domain_names)} domains appear generic")

    # Check 6: Domain dedup effectiveness
    print(f"\n6. Domain deduplication:")
    name_counter = Counter()
    for name in all_domain_names:
        # Normalize for rough duplicate check
        key = ' '.join(sorted(name.lower().split()))
        name_counter[key] += 1
    duplicates = {k: v for k, v in name_counter.items() if v > 1}
    if duplicates:
        print(f"   [INFO] Potential remaining duplicates across goals:")
        for k, v in list(duplicates.items())[:5]:
            print(f"     {v}x: {k}")
    else:
        print(f"   [PASS] No obvious duplicates found")

    # Check 7: L3 questions exist for each goal
    l3s = outputs.get('step6', {}).get('l3_questions', [])
    print(f"\n7. L3 coverage:")
    l3_goals = Counter(l3.get('target_goal_id', 'unknown') for l3 in l3s)
    for g in goals:
        gid = g.get('id')
        count = l3_goals.get(gid, 0)
        status = 'OK' if count > 0 else 'MISSING'
        print(f"   [{status}] {gid}: {count} L3 questions")

    # ── Summary ──
    print(f"\n{'='*70}")
    if issues:
        print(f"ISSUES FOUND: {len(issues)}")
        for i, issue in enumerate(issues, 1):
            print(f"  {i}. {issue}")
    else:
        print("ALL CHECKS PASSED")
    print(f"{'='*70}")

    return 0 if not issues else 1


if __name__ == '__main__':
    sys.exit(main())

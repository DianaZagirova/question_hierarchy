#!/usr/bin/env python3
"""
Focused pipeline test: runs Steps 1→2→3→4→6→7→8→9 for a SINGLE goal
and SINGLE L3 question to save tokens. Calls each step directly.
"""

import json
import time
import sys
import requests
import hashlib

SERVER = "http://localhost:3002"
GOAL = "skin rejuvenation"
GLOBAL_LENS = ""
POLL_INTERVAL = 5
MAX_POLL = 600  # 10 min max per step

session_id = None
headers = {}


def create_session():
    global session_id, headers
    r = requests.post(f"{SERVER}/api/session/new", json={}, timeout=5)
    r.raise_for_status()
    session_id = r.json()['session_id']
    headers = {'X-Session-ID': session_id, 'Content-Type': 'application/json'}
    print(f"Session: {session_id[:16]}...")


def load_agents():
    """Load default agent configs from server."""
    r = requests.get(f"{SERVER}/api/default-agents", timeout=10)
    r.raise_for_status()
    agents_list = r.json()['agents']
    return {a['id']: a for a in agents_list}


def execute_single(step_id, agent, input_data):
    """Execute a single step (non-batch)."""
    r = requests.post(f"{SERVER}/api/execute-step", json={
        'stepId': step_id,
        'agentConfig': agent,
        'input': input_data,
        'globalLens': GLOBAL_LENS,
    }, headers=headers, timeout=300)
    r.raise_for_status()
    return r.json()


def execute_batch(step_id, agent, items, phase_info=None):
    """Execute a batch step and poll for result."""
    payload = {
        'stepId': step_id,
        'agentConfig': agent,
        'items': items,
        'globalLens': GLOBAL_LENS,
    }
    if phase_info:
        payload['phase_info'] = phase_info

    r = requests.post(f"{SERVER}/api/execute-step-batch", json=payload,
                      headers=headers, timeout=30)
    r.raise_for_status()

    # Poll for result
    start = time.time()
    while time.time() - start < MAX_POLL:
        time.sleep(POLL_INTERVAL)
        r = requests.get(f"{SERVER}/api/batch-result",
                         params={'step_id': step_id}, headers=headers, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if not data.get('pending'):
                return data
        elapsed = time.time() - start
        print(f"    ... polling ({elapsed:.0f}s)")

    raise TimeoutError(f"Batch step {step_id} timed out after {MAX_POLL}s")


def execute_step4_pipeline(goal_items, dm_agent, ds_agent):
    """Execute the pipelined Step 4 and poll for result."""
    r = requests.post(f"{SERVER}/api/execute-step4-pipeline", json={
        'goal_items': goal_items,
        'domain_mapper_agent': dm_agent,
        'domain_specialist_agent': ds_agent,
        'globalLens': GLOBAL_LENS,
    }, headers=headers, timeout=30)
    r.raise_for_status()

    start = time.time()
    while time.time() - start < MAX_POLL:
        time.sleep(POLL_INTERVAL)
        r = requests.get(f"{SERVER}/api/step4-result",
                         headers=headers, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if not data.get('pending'):
                return data
        elapsed = time.time() - start
        print(f"    ... polling ({elapsed:.0f}s)")

    raise TimeoutError(f"Step 4 pipeline timed out")


def minimal_goal(g):
    return {
        'id': g.get('id'),
        'title': g.get('title'),
        'catastrophe_primary': g.get('catastrophe_primary'),
        'bridge_tags': g.get('bridge_tags'),
    }


def minimal_ras(ras):
    return [{
        'ra_id': ra.get('ra_id'),
        'atom_title': ra.get('atom_title'),
        'requirement_statement': ra.get('requirement_statement'),
    } for ra in ras]


def filter_spvs_for_goal(goal, all_spvs):
    relevant_ids = [
        sp.get('spv_id')
        for sp in (goal.get('bridge_tags', {}).get('system_properties_required') or [])
    ]
    return {
        'system_properties': [
            spv for spv in all_spvs
            if (spv.get('id') or spv.get('ID')) in relevant_ids
        ]
    }


def enrich_goal(goal, all_spvs):
    enriched = dict(goal)
    if enriched.get('bridge_tags', {}).get('system_properties_required'):
        enriched['bridge_tags'] = dict(enriched['bridge_tags'])
        enriched['bridge_tags']['system_properties_required'] = [
            {
                **sp,
                'name': next((s.get('name') for s in all_spvs if (s.get('id') or s.get('ID')) == sp.get('spv_id')), None),
                'definition': next((s.get('definition') for s in all_spvs if (s.get('id') or s.get('ID')) == sp.get('spv_id')), None),
            }
            for sp in enriched['bridge_tags']['system_properties_required']
        ]
    return enriched


def main():
    print("="*70)
    print(f"FOCUSED PIPELINE TEST — Goal: '{GOAL}'")
    print(f"Single goal, single L3 decomposition to save tokens")
    print("="*70)

    create_session()
    agents = load_agents()
    pipeline_start = time.time()
    all_outputs = {}

    # ═══ STEP 1 ═══
    print(f"\n{'─'*70}")
    print("STEP 1: Goal Formalization")
    t = time.time()
    step1 = execute_single(1, agents['agent-initiator'], GOAL)
    q0 = step1.get('Q0', '')
    all_outputs['step1'] = step1
    print(f"  Time: {time.time()-t:.1f}s")
    print(f"  Q0: {q0[:200]}...")

    # ═══ STEP 2 ═══
    print(f"\n{'─'*70}")
    print("STEP 2: Goal Pillars + Bridge Lexicon")
    t = time.time()
    step2 = execute_single(2, agents['agent-immortalist'], {'step1': step1, 'goal': GOAL})
    goals = step2.get('goals', [])
    bridge = step2.get('bridge_lexicon', {})
    all_spvs = bridge.get('system_properties', [])
    all_fccs = bridge.get('failure_channels', [])
    all_outputs['step2'] = step2
    print(f"  Time: {time.time()-t:.1f}s")
    print(f"  Goals: {len(goals)}, SPVs: {len(all_spvs)}, FCCs: {len(all_fccs)}")
    for g in goals:
        print(f"    {g['id']}: {g.get('title', '?')}")

    # ═══ Pick ONE goal ═══
    selected_goal = goals[0]
    print(f"\n  >>> Selecting ONLY {selected_goal['id']}: {selected_goal.get('title')}")

    # ═══ STEP 3 ═══
    print(f"\n{'─'*70}")
    print(f"STEP 3: Requirement Atomization — {selected_goal['id']} only")
    t = time.time()
    step3_batch = execute_batch(3, agents['agent-requirement-engineer'], [{
        'goal_pillar': selected_goal,
        'step1': step1,
        'step2': {'bridge_lexicon': bridge},
        'goal': GOAL,
    }])
    # Extract RAs
    ras = []
    for r in (step3_batch.get('batch_results') or []):
        if r.get('success') and r.get('data'):
            ras = r['data'].get('requirement_atoms', r['data'].get('RAs', []))
    ras_by_goal = {selected_goal['id']: ras}
    all_outputs['step3'] = ras_by_goal
    print(f"  Time: {time.time()-t:.1f}s")
    print(f"  RAs for {selected_goal['id']}: {len(ras)}")
    for ra in ras[:3]:
        print(f"    {ra.get('ra_id', '?')}: {ra.get('atom_title', '?')}")
    if len(ras) > 3:
        print(f"    ... +{len(ras)-3} more")

    # ═══ STEP 4 ═══
    print(f"\n{'─'*70}")
    print(f"STEP 4: Reality Mapping (4a→dedup→4b) — {selected_goal['id']} only")
    t = time.time()

    goal_item = {
        'Q0_reference': q0,
        'target_goal': minimal_goal(selected_goal),
        'requirement_atoms': minimal_ras(ras),
        'bridge_lexicon': filter_spvs_for_goal(selected_goal, all_spvs),
        'goal': GOAL,
    }
    step4_result = execute_step4_pipeline([goal_item], agents['agent-domain-mapper'], agents['agent-biologist'])

    # Parse result
    goal_results = step4_result.get('goal_results', {})
    gr = goal_results.get('0', {})  # Index 0 = our single goal
    mapping = gr.get('mapping', {})
    domains = mapping.get('research_domains', [])
    scans = gr.get('scans', {})

    all_pillars = []
    for scan_data in scans.values():
        if scan_data and not scan_data.get('error'):
            all_pillars.extend(scan_data.get('scientific_pillars', []))

    step4_output = {
        selected_goal['id']: {
            'domain_mapping': mapping,
            'raw_domain_scans': {'domains': scans},
            'scientific_pillars': all_pillars,
        }
    }
    all_outputs['step4'] = step4_output
    print(f"  Time: {time.time()-t:.1f}s")
    print(f"  Domains: {len(domains)}")
    for d in domains:
        print(f"    {d.get('domain_id', '?')}: {d.get('domain_name', '?')} [{d.get('relevance_to_goal', '?')}]")
    print(f"  Total S-nodes: {len(all_pillars)}")
    print(f"  Dedup stats: {step4_result.get('dedup_stats', 'N/A')}")

    # Check orphaned pillars
    orphaned = sum(1 for p in all_pillars if not p.get('domain_id'))
    if orphaned:
        print(f"  WARNING: {orphaned} pillars missing domain_id!")

    # ═══ STEP 6 ═══
    print(f"\n{'─'*70}")
    print(f"STEP 6: L3 Question Generation — {selected_goal['id']}")
    t = time.time()

    enriched_goal = enrich_goal(selected_goal, all_spvs)
    step6_item = {
        'Q0_reference': q0,
        'goal_pillar': enriched_goal,
        'step2': step2,
        'step3': ras,
        'step4': {selected_goal['id']: step4_output[selected_goal['id']]},
        'step5': {selected_goal['id']: step4_output[selected_goal['id']]},
        'goal': GOAL,
    }
    step6_batch = execute_batch(6, agents['agent-l3-explorer'], [step6_item])

    l3_questions = []
    goal_analyses = {}
    for r in (step6_batch.get('batch_results') or []):
        if r.get('success') and r.get('data'):
            l3s = r['data'].get('l3_questions', r['data'].get('seed_questions', []))
            tgid = r['data'].get('target_goal_id', selected_goal['id'])
            for l3 in l3s:
                if not l3.get('target_goal_id'):
                    l3['target_goal_id'] = tgid
            l3_questions.extend(l3s)
            goal_analyses[tgid] = {
                'target_goal_title': r['data'].get('target_goal_title'),
                'cluster_status': r['data'].get('cluster_status'),
                'strategic_assessment': r['data'].get('strategic_assessment'),
            }

    all_outputs['step6'] = {'l3_questions': l3_questions, 'goal_analyses': goal_analyses}
    print(f"  Time: {time.time()-t:.1f}s")
    print(f"  L3 questions: {len(l3_questions)}")
    for l3 in l3_questions:
        print(f"    {l3.get('id', '?')}: {l3.get('text', '?')[:100]}...")

    # ═══ Pick ONE L3 ═══
    if not l3_questions:
        print("  ERROR: No L3 questions generated, cannot continue")
        _save_and_exit(all_outputs, pipeline_start)
        return

    selected_l3 = l3_questions[0]
    print(f"\n  >>> Selecting ONLY {selected_l3.get('id')}")

    # ═══ STEP 7 ═══
    print(f"\n{'─'*70}")
    print(f"STEP 7: Hypothesis Instantiation — {selected_l3.get('id')}")
    t = time.time()

    step7_item = {
        'Q0_reference': q0,
        'l3_question': selected_l3,
        'parent_goal': enriched_goal,
        'step3': ras,
        'step5': {selected_goal['id']: step4_output[selected_goal['id']]},
        'goal': GOAL,
    }
    step7_batch = execute_batch(7, agents['agent-instantiator'], [step7_item])

    all_ihs = []
    for r in (step7_batch.get('batch_results') or []):
        if r.get('success') and r.get('data'):
            ihs = r['data'].get('instantiation_hypotheses', r['data'].get('IHs', []))
            if not isinstance(ihs, list):
                ihs = [ihs]
            for ih in ihs:
                if not ih.get('parent_l3_id'):
                    ih['parent_l3_id'] = selected_l3.get('id')
            all_ihs.extend(ihs)

    all_outputs['step7'] = {'instantiation_hypotheses': all_ihs}
    print(f"  Time: {time.time()-t:.1f}s")
    print(f"  IHs: {len(all_ihs)}")
    for ih in all_ihs[:3]:
        print(f"    {ih.get('ih_id', '?')}: {ih.get('process_hypothesis', '?')[:100]}...")
    if len(all_ihs) > 3:
        print(f"    ... +{len(all_ihs)-3} more")

    # ═══ STEP 8 ═══
    print(f"\n{'─'*70}")
    print(f"STEP 8: Tactical Decomposition — {selected_l3.get('id')}")
    t = time.time()

    # Filter IHs to selected L3
    l3_id = selected_l3.get('id', '')
    l3_ihs = [ih for ih in all_ihs if ih.get('parent_l3_id') == l3_id or ih.get('l3_question_id') == l3_id]

    step8_item = {
        'Q0_reference': q0,
        'l3_question': selected_l3,
        'parent_goal': enriched_goal,
        'step3': ras,
        'step7': {'instantiation_hypotheses': l3_ihs},
        'step5': {selected_goal['id']: step4_output[selected_goal['id']]},
        'goal': GOAL,
    }
    step8_batch = execute_batch(8, agents['agent-explorer'], [step8_item])

    all_l4s = []
    for r in (step8_batch.get('batch_results') or []):
        if r.get('success') and r.get('data'):
            l4s = r['data'].get('l4_questions', r['data'].get('child_nodes_L4', []))
            for l4 in l4s:
                l4['parent_l3_id'] = l3_id
                l4['parent_goal_id'] = selected_goal['id']
            all_l4s.extend(l4s)

    all_outputs['step8'] = {'l4_questions': all_l4s}
    print(f"  Time: {time.time()-t:.1f}s")
    print(f"  L4 questions: {len(all_l4s)}")
    for l4 in all_l4s[:3]:
        print(f"    {l4.get('id', '?')}: {l4.get('text', '?')[:100]}...")
    if len(all_l4s) > 3:
        print(f"    ... +{len(all_l4s)-3} more")

    # ═══ STEP 9 — only first L4 ═══
    if not all_l4s:
        print("  No L4 questions, skipping Step 9")
        _save_and_exit(all_outputs, pipeline_start)
        return

    selected_l4 = all_l4s[0]
    print(f"\n  >>> Running Step 9 for ONLY {selected_l4.get('id')}")

    print(f"\n{'─'*70}")
    print(f"STEP 9: Execution Drilldown — {selected_l4.get('id')}")
    t = time.time()

    step9_item = {
        'Q0_reference': q0,
        'l4_question': selected_l4,
        'step3': ras,
        'goal': GOAL,
    }
    step9_batch = execute_batch(9, agents['agent-tactical-engineer'], [step9_item])

    all_l5 = []
    all_l6 = []
    for r in (step9_batch.get('batch_results') or []):
        if r.get('success') and r.get('data'):
            data = r['data']
            # Recover from raw_response if JSON parse failed server-side
            if data.get('raw_response') and not data.get('drill_branches'):
                raw = data['raw_response']
                print(f"    ⚠️  Recovering from raw_response ({len(raw)} chars)")
                try:
                    text = raw.strip()
                    if '```json' in text:
                        text = text.split('```json')[1].split('```')[0].strip()
                    elif '```' in text:
                        text = text.split('```')[1].split('```')[0].strip()
                    import re
                    text = re.sub(r',(\s*[}\]])', r'\1', text)
                    ob = text.count('{') - text.count('}')
                    oq = text.count('[') - text.count(']')
                    if ob > 0: text += '}' * ob
                    if oq > 0: text += ']' * oq
                    data = json.loads(text)
                    print(f"    ✅ Recovery successful: {list(data.keys())}")
                except Exception as e:
                    print(f"    ❌ Recovery failed: {e}")
            if data.get('drill_branches') and isinstance(data['drill_branches'], list):
                for branch in data['drill_branches']:
                    all_l5.append({
                        'id': branch.get('id'),
                        'type': branch.get('type'),
                        'text': branch.get('text'),
                        'rationale': branch.get('rationale'),
                        'parent_l4_id': data.get('l4_reference_id', selected_l4.get('id')),
                    })
                    for task in (branch.get('leaf_specs') or []):
                        all_l6.append({
                            **task,
                            'parent_l5_id': branch.get('id'),
                            'parent_l4_id': data.get('l4_reference_id', selected_l4.get('id')),
                        })
            elif data.get('l6_tasks'):
                all_l6.extend(data['l6_tasks'] if isinstance(data['l6_tasks'], list) else [])
            else:
                print(f"    ⚠️  No drill_branches or l6_tasks found (keys: {list(data.keys())})")

    all_outputs['step9'] = {'l5_nodes': all_l5, 'l6_tasks': all_l6}
    print(f"  Time: {time.time()-t:.1f}s")
    print(f"  L5 nodes: {len(all_l5)}, L6 tasks: {len(all_l6)}")
    for l5 in all_l5:
        print(f"    L5 {l5.get('id', '?')}: {l5.get('text', '?')[:100]}...")
    for l6 in all_l6[:3]:
        simt = l6.get('simt_parameters', {})
        print(f"    L6 {l6.get('id', '?')}: S={simt.get('system', '?')[:40]} I={simt.get('intervention', '?')[:40]}")
    if len(all_l6) > 3:
        print(f"    ... +{len(all_l6)-3} more")

    _save_and_exit(all_outputs, pipeline_start)


def _save_and_exit(all_outputs, pipeline_start):
    total = time.time() - pipeline_start
    print(f"\n{'='*70}")
    print(f"PIPELINE COMPLETE — {total/60:.1f} minutes")
    print(f"{'='*70}")

    # Save to file
    fname = f"pipeline-test-{int(time.time())}.json"
    with open(fname, 'w') as f:
        json.dump(all_outputs, f, indent=2)
    print(f"\nFull output saved to: {fname}")


if __name__ == '__main__':
    main()

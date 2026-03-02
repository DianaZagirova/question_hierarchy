#!/usr/bin/env python3
"""
Run 3 pipeline tests with different goals (1G, 1L3 each).
Save each result to a separate JSON file for analysis.
"""

import json
import time
import sys
import requests
import re

SERVER = "http://localhost:3002"
GLOBAL_LENS = ""
POLL_INTERVAL = 5
MAX_POLL = 600

GOALS = [
    "reverse aging in the human brain",
    "achieve complete photosynthesis efficiency in synthetic organisms",
    "engineer universal pathogen resistance in humans",
]


def create_session():
    r = requests.post(f"{SERVER}/api/session/new", json={}, timeout=5)
    r.raise_for_status()
    sid = r.json()['session_id']
    return sid, {'X-Session-ID': sid, 'Content-Type': 'application/json'}


def load_agents():
    r = requests.get(f"{SERVER}/api/default-agents", timeout=10)
    r.raise_for_status()
    return {a['id']: a for a in r.json()['agents']}


def execute_single(step_id, agent, input_data, headers):
    r = requests.post(f"{SERVER}/api/execute-step", json={
        'stepId': step_id, 'agentConfig': agent,
        'input': input_data, 'globalLens': GLOBAL_LENS,
    }, headers=headers, timeout=300)
    r.raise_for_status()
    return r.json()


def execute_batch(step_id, agent, items, headers, phase_info=None):
    payload = {'stepId': step_id, 'agentConfig': agent, 'items': items, 'globalLens': GLOBAL_LENS}
    if phase_info:
        payload['phase_info'] = phase_info
    r = requests.post(f"{SERVER}/api/execute-step-batch", json=payload, headers=headers, timeout=30)
    r.raise_for_status()
    start = time.time()
    while time.time() - start < MAX_POLL:
        time.sleep(POLL_INTERVAL)
        r = requests.get(f"{SERVER}/api/batch-result", params={'step_id': step_id}, headers=headers, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if not data.get('pending'):
                return data
        print(f"    ... polling ({time.time()-start:.0f}s)")
    raise TimeoutError(f"Batch step {step_id} timed out")


def execute_step4_pipeline(goal_items, dm_agent, ds_agent, headers):
    r = requests.post(f"{SERVER}/api/execute-step4-pipeline", json={
        'goal_items': goal_items, 'domain_mapper_agent': dm_agent,
        'domain_specialist_agent': ds_agent, 'globalLens': GLOBAL_LENS,
    }, headers=headers, timeout=30)
    r.raise_for_status()
    start = time.time()
    while time.time() - start < MAX_POLL:
        time.sleep(POLL_INTERVAL)
        r = requests.get(f"{SERVER}/api/step4-result", headers=headers, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if not data.get('pending'):
                return data
        print(f"    ... polling ({time.time()-start:.0f}s)")
    raise TimeoutError("Step 4 pipeline timed out")


def minimal_goal(g):
    return {k: g.get(k) for k in ('id', 'title', 'catastrophe_primary', 'bridge_tags')}


def minimal_ras(ras):
    return [{'ra_id': r.get('ra_id'), 'atom_title': r.get('atom_title'),
             'requirement_statement': r.get('requirement_statement')} for r in ras]


def filter_spvs(goal, all_spvs):
    ids = [sp.get('spv_id') for sp in (goal.get('bridge_tags', {}).get('system_properties_required') or [])]
    return {'system_properties': [s for s in all_spvs if (s.get('id') or s.get('ID')) in ids]}


def enrich_goal(goal, all_spvs):
    e = dict(goal)
    if e.get('bridge_tags', {}).get('system_properties_required'):
        e['bridge_tags'] = dict(e['bridge_tags'])
        e['bridge_tags']['system_properties_required'] = [
            {**sp, 'name': next((s.get('name') for s in all_spvs if (s.get('id') or s.get('ID')) == sp.get('spv_id')), None),
             'definition': next((s.get('definition') for s in all_spvs if (s.get('id') or s.get('ID')) == sp.get('spv_id')), None)}
            for sp in e['bridge_tags']['system_properties_required']
        ]
    return e


def try_recover(data):
    """Client-side raw_response recovery."""
    if not data.get('raw_response'):
        return data
    raw = data['raw_response']
    print(f"    ⚠️  Attempting raw_response recovery ({len(raw)} chars)")
    text = raw.strip()
    if '```json' in text:
        text = text.split('```json')[1].split('```')[0].strip()
    elif '```' in text:
        text = text.split('```')[1].split('```')[0].strip()
    text = re.sub(r',(\s*[}\]])', r'\1', text)
    ob = text.count('{') - text.count('}')
    oq = text.count('[') - text.count(']')
    if ob > 0: text += '}' * ob
    if oq > 0: text += ']' * oq
    try:
        recovered = json.loads(text)
        print(f"    ✅ Recovery: {list(recovered.keys())}")
        return recovered
    except Exception as e:
        print(f"    ❌ Recovery failed: {e}")
        return data


def run_pipeline(goal_text, run_num):
    print(f"\n{'='*70}")
    print(f"RUN {run_num}/3 — Goal: '{goal_text}'")
    print(f"{'='*70}")

    sid, headers = create_session()
    agents = load_agents()
    t0 = time.time()
    out = {'goal': goal_text, 'run': run_num}

    # STEP 1
    print(f"\nSTEP 1: Goal Formalization")
    t = time.time()
    step1 = execute_single(1, agents['agent-initiator'], goal_text, headers)
    q0 = step1.get('Q0', '')
    out['step1'] = step1
    print(f"  {time.time()-t:.1f}s — Q0: {q0[:150]}...")

    # STEP 2
    print(f"\nSTEP 2: Goal Pillars + Bridge Lexicon")
    t = time.time()
    step2 = execute_single(2, agents['agent-immortalist'], {'step1': step1, 'goal': goal_text}, headers)
    goals = step2.get('goals', [])
    bridge = step2.get('bridge_lexicon', {})
    all_spvs = bridge.get('system_properties', [])
    out['step2'] = step2
    print(f"  {time.time()-t:.1f}s — Goals: {len(goals)}, SPVs: {len(all_spvs)}, FCCs: {len(bridge.get('failure_channels', []))}")
    for g in goals:
        cc = g.get('is_cross_cutting', 'N/A')
        print(f"    {g['id']}: {g.get('title', '?')} [cross_cutting={cc}]")

    if not goals:
        print("  ERROR: No goals produced!")
        out['error'] = 'No goals from Step 2'
        return out

    sel_goal = goals[0]
    print(f"  >>> Selected: {sel_goal['id']}: {sel_goal.get('title')}")

    # STEP 3
    print(f"\nSTEP 3: Requirement Atomization")
    t = time.time()
    s3 = execute_batch(3, agents['agent-requirement-engineer'], [{
        'goal_pillar': sel_goal, 'step1': step1,
        'step2': {'bridge_lexicon': bridge}, 'goal': goal_text,
    }], headers)
    ras = []
    for r in (s3.get('batch_results') or []):
        if r.get('success') and r.get('data'):
            d = r['data']
            if d.get('raw_response') and not d.get('requirement_atoms'):
                d = try_recover(d)
            ras = d.get('requirement_atoms', d.get('RAs', []))
    out['step3'] = {'goal_id': sel_goal['id'], 'ras': ras, 'count': len(ras)}
    print(f"  {time.time()-t:.1f}s — RAs: {len(ras)}")
    for ra in ras[:5]:
        print(f"    {ra.get('ra_id', '?')}: {ra.get('atom_title', '?')}")

    # STEP 4
    print(f"\nSTEP 4: Reality Mapping (4a→dedup→4b)")
    t = time.time()
    gi = {
        'Q0_reference': q0, 'target_goal': minimal_goal(sel_goal),
        'requirement_atoms': minimal_ras(ras),
        'bridge_lexicon': filter_spvs(sel_goal, all_spvs), 'goal': goal_text,
    }
    s4 = execute_step4_pipeline([gi], agents['agent-domain-mapper'], agents['agent-biologist'], headers)
    gr = s4.get('goal_results', {}).get('0', {})
    mapping = gr.get('mapping', {})
    domains = mapping.get('research_domains', [])
    scans = gr.get('scans', {})
    pillars = []
    for sd in scans.values():
        if sd and not sd.get('error'):
            pillars.extend(sd.get('scientific_pillars', []))
    s4out = {sel_goal['id']: {'domain_mapping': mapping, 'scientific_pillars': pillars}}
    out['step4'] = {'domains': len(domains), 'domain_names': [d.get('domain_name') for d in domains],
                    'pillars': len(pillars), 'dedup_stats': s4.get('dedup_stats'),
                    'full': s4out}
    print(f"  {time.time()-t:.1f}s — Domains: {len(domains)}, S-nodes: {len(pillars)}")
    for d in domains:
        print(f"    {d.get('domain_id', '?')}: {d.get('domain_name', '?')}")

    # STEP 6
    print(f"\nSTEP 6: L3 Question Generation")
    t = time.time()
    eg = enrich_goal(sel_goal, all_spvs)
    s6 = execute_batch(6, agents['agent-l3-explorer'], [{
        'Q0_reference': q0, 'goal_pillar': eg, 'step2': step2,
        'step3': ras, 'step4': s4out, 'step5': s4out, 'goal': goal_text,
    }], headers)
    l3s = []
    for r in (s6.get('batch_results') or []):
        if r.get('success') and r.get('data'):
            d = r['data']
            if d.get('raw_response') and not d.get('l3_questions') and not d.get('seed_questions'):
                d = try_recover(d)
            q = d.get('l3_questions', d.get('seed_questions', []))
            for l in q:
                if not l.get('target_goal_id'):
                    l['target_goal_id'] = d.get('target_goal_id', sel_goal['id'])
            l3s.extend(q)
    out['step6'] = {'count': len(l3s), 'questions': l3s}
    print(f"  {time.time()-t:.1f}s — L3 questions: {len(l3s)}")
    adversarial_count = 0
    for l in l3s:
        st = l.get('strategy_type', '')
        if 'adversarial' in str(st).lower():
            adversarial_count += 1
        print(f"    {l.get('id', '?')} [{l.get('strategy_used', '?')}] [type={st}]: {str(l.get('text', '?'))[:100]}...")
    print(f"  Adversarial questions: {adversarial_count}/{len(l3s)}")

    if not l3s:
        print("  ERROR: No L3 questions!")
        out['error'] = 'No L3s from Step 6'
        return out

    sel_l3 = l3s[0]
    print(f"  >>> Selected: {sel_l3.get('id')}")

    # STEP 7
    print(f"\nSTEP 7: Hypothesis Instantiation")
    t = time.time()
    s7 = execute_batch(7, agents['agent-instantiator'], [{
        'Q0_reference': q0, 'l3_question': sel_l3, 'parent_goal': eg,
        'step3': ras, 'step5': s4out, 'goal': goal_text,
    }], headers)
    ihs = []
    for r in (s7.get('batch_results') or []):
        if r.get('success') and r.get('data'):
            d = r['data']
            if d.get('raw_response') and not d.get('instantiation_hypotheses') and not d.get('IHs'):
                d = try_recover(d)
            h = d.get('instantiation_hypotheses', d.get('IHs', []))
            if not isinstance(h, list): h = [h]
            for ih in h:
                if not ih.get('parent_l3_id'):
                    ih['parent_l3_id'] = sel_l3.get('id')
            ihs.extend(h)
    out['step7'] = {'count': len(ihs), 'hypotheses': ihs}
    print(f"  {time.time()-t:.1f}s — IHs: {len(ihs)}")
    heretical = 0
    cross_domain = 0
    for ih in ihs:
        notes = str(ih.get('notes', '')) + str(ih.get('domain_category', ''))
        if 'heretical' in notes.lower():
            heretical += 1
        if 'cross' in notes.lower() or 'transfer' in notes.lower():
            cross_domain += 1
        print(f"    {ih.get('ih_id', '?')}: {str(ih.get('process_hypothesis', ih.get('title', '?')))[:100]}...")
    print(f"  Heretical: {heretical}, Cross-domain: {cross_domain}")

    # STEP 8
    print(f"\nSTEP 8: Tactical Decomposition")
    t = time.time()
    l3id = sel_l3.get('id', '')
    l3_ihs = [ih for ih in ihs if ih.get('parent_l3_id') == l3id or ih.get('l3_question_id') == l3id]
    s8 = execute_batch(8, agents['agent-explorer'], [{
        'Q0_reference': q0, 'l3_question': sel_l3, 'parent_goal': eg,
        'step3': ras, 'step7': {'instantiation_hypotheses': l3_ihs},
        'step5': s4out, 'goal': goal_text,
    }], headers)
    l4s = []
    for r in (s8.get('batch_results') or []):
        if r.get('success') and r.get('data'):
            d = r['data']
            if d.get('raw_response') and not d.get('l4_questions') and not d.get('child_nodes_L4'):
                d = try_recover(d)
            q = d.get('l4_questions', d.get('child_nodes_L4', []))
            for l4 in q:
                l4['parent_l3_id'] = l3id
                l4['parent_goal_id'] = sel_goal['id']
            l4s.extend(q)
    out['step8'] = {'count': len(l4s), 'questions': l4s}
    print(f"  {time.time()-t:.1f}s — L4 questions: {len(l4s)}")
    discrim = 0
    for l4 in l4s:
        tp = str(l4.get('question_type', l4.get('type', '')))
        if 'discrim' in tp.lower():
            discrim += 1
        print(f"    {l4.get('id', '?')} [{tp}]: {str(l4.get('text', '?'))[:100]}...")
    print(f"  Discriminator questions: {discrim}/{len(l4s)} (CLAUDE.md requires >=50%)")

    if not l4s:
        print("  ERROR: No L4 questions!")
        out['error'] = 'No L4s from Step 8'
        return out

    # STEP 9 — first L4 only
    sel_l4 = l4s[0]
    print(f"\nSTEP 9: Execution Drilldown — {sel_l4.get('id')}")
    t = time.time()
    s9 = execute_batch(9, agents['agent-tactical-engineer'], [{
        'Q0_reference': q0, 'l4_question': sel_l4, 'step3': ras, 'goal': goal_text,
    }], headers)
    l5s, l6s = [], []
    for r in (s9.get('batch_results') or []):
        if r.get('success') and r.get('data'):
            d = r['data']
            if d.get('raw_response') and not d.get('drill_branches'):
                d = try_recover(d)
            if d.get('drill_branches') and isinstance(d['drill_branches'], list):
                for br in d['drill_branches']:
                    l5s.append({'id': br.get('id'), 'text': br.get('text'), 'type': br.get('type'),
                                'parent_l4_id': d.get('l4_reference_id', sel_l4.get('id'))})
                    for task in (br.get('leaf_specs') or []):
                        l6s.append({**task, 'parent_l5_id': br.get('id'),
                                    'parent_l4_id': d.get('l4_reference_id', sel_l4.get('id'))})
    out['step9'] = {'l5_count': len(l5s), 'l6_count': len(l6s), 'l5_nodes': l5s, 'l6_tasks': l6s}
    print(f"  {time.time()-t:.1f}s — L5: {len(l5s)}, L6: {len(l6s)}")
    for l6 in l6s[:3]:
        simt = l6.get('simt_parameters', {})
        print(f"    L6 {l6.get('id', '?')}: S={str(simt.get('system', '?'))[:50]} I={str(simt.get('intervention', '?'))[:50]}")
    if len(l6s) > 3:
        print(f"    ... +{len(l6s)-3} more")

    # Check L6 for SIMT completeness
    simt_complete = 0
    for l6 in l6s:
        simt = l6.get('simt_parameters', {})
        has_all = all(simt.get(k) for k in ('system', 'intervention', 'meter', 'threshold'))
        if has_all:
            simt_complete += 1
    print(f"  SIMT complete: {simt_complete}/{len(l6s)}")

    out['total_time'] = round(time.time() - t0, 1)
    print(f"\n  Total time: {out['total_time']/60:.1f} min")
    return out


def main():
    all_results = []
    for i, goal in enumerate(GOALS):
        try:
            result = run_pipeline(goal, i + 1)
            all_results.append(result)
            fname = f"run{i+1}-{goal.split()[1] if len(goal.split()) > 1 else 'test'}-{int(time.time())}.json"
            with open(fname, 'w') as f:
                json.dump(result, f, indent=2)
            print(f"\n  Saved: {fname}")
        except Exception as e:
            print(f"\n  FATAL ERROR in run {i+1}: {e}")
            import traceback
            traceback.print_exc()
            all_results.append({'goal': goal, 'run': i+1, 'error': str(e)})

    # Summary
    print(f"\n\n{'='*70}")
    print("SUMMARY OF ALL 3 RUNS")
    print(f"{'='*70}")
    for r in all_results:
        print(f"\nRun {r.get('run')}: {r.get('goal')}")
        if r.get('error'):
            print(f"  ERROR: {r['error']}")
            continue
        s2 = r.get('step2', {})
        print(f"  Step 2: {len(s2.get('goals', []))} goals")
        cc = sum(1 for g in s2.get('goals', []) if g.get('is_cross_cutting'))
        print(f"    Cross-cutting goals: {cc}")
        print(f"  Step 3: {r.get('step3', {}).get('count', 0)} RAs")
        s4 = r.get('step4', {})
        print(f"  Step 4: {s4.get('domains', 0)} domains, {s4.get('pillars', 0)} S-nodes")
        s6 = r.get('step6', {})
        print(f"  Step 6: {s6.get('count', 0)} L3 questions")
        adv = sum(1 for q in s6.get('questions', []) if 'adversarial' in str(q.get('strategy_type', '')).lower())
        print(f"    Adversarial: {adv}")
        print(f"  Step 7: {r.get('step7', {}).get('count', 0)} IHs")
        print(f"  Step 8: {r.get('step8', {}).get('count', 0)} L4 questions")
        s9 = r.get('step9', {})
        print(f"  Step 9: {s9.get('l5_count', 0)} L5, {s9.get('l6_count', 0)} L6")
        print(f"  Time: {r.get('total_time', 0)/60:.1f} min")

    # Save combined
    with open('all_3runs_combined.json', 'w') as f:
        json.dump(all_results, f, indent=2)
    print(f"\nCombined results saved: all_3runs_combined.json")


if __name__ == '__main__':
    main()

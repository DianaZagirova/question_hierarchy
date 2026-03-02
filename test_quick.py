#!/usr/bin/env python3
"""Quick test: 1 goal, 1 L3 — minimal tokens, save output for analysis."""
import requests, json, time, sys

BASE = "http://localhost:3002/api"
GOAL = "reverse aging in the human brain"

def run():
    payload = {
        "goal": GOAL,
        "test_mode": True,  # LLM produces full-quality output, pipeline only decomposes 1G + 1L3
    }
    r = requests.post(f"{BASE}/run-full-pipeline", json=payload)
    r.raise_for_status()
    run_id = r.json().get("run_id")
    print(f"Run: {run_id}")

    start = time.time()
    while time.time() - start < 600:
        r = requests.get(f"{BASE}/full-pipeline-result", params={"run_id": run_id})
        elapsed = int(time.time() - start)
        if r.status_code == 200:
            result = r.json()
            fname = f"quick-test-{int(time.time())}.json"
            with open(fname, "w") as f:
                json.dump(result, f, indent=2)
            print(f"\nDONE in {elapsed}s — saved to {fname}")
            return result
        elif r.status_code == 202:
            p = r.json()
            print(f"  [{elapsed}s] Step {p.get('step','?')}: {p.get('detail','')}          ", end="\r")
        time.sleep(5)
    print("\nTIMEOUT!")
    return None

result = run()
if not result or not result.get("success"):
    print("FAILED")
    sys.exit(1)

so = result.get("step_outputs", {})
summary = result.get("summary", {})

print(f"\n{'='*70}")
print(f"PIPELINE RESULTS: {GOAL}")
print(f"{'='*70}")
print(f"Goals: {summary.get('goals')}, RAs: {summary.get('total_ras')}, S-nodes: {summary.get('total_s_nodes')}")
print(f"L3: {summary.get('total_l3_questions')}, IHs: {summary.get('total_ihs')}, L4: {summary.get('total_l4_questions')}")
print(f"L5: {summary.get('total_l5_nodes')}, L6: {summary.get('total_l6_tasks')}")

# Step 2
step2 = so.get("step2", {})
goals = step2.get("goals", [])
print(f"\n--- STEP 2: GOAL PILLARS ---")
for g in goals:
    cc = " [CROSS-CUTTING]" if g.get("is_cross_cutting") else ""
    print(f"  {g['id']}: {g['title']}{cc}")
    print(f"    Catastrophe: {str(g.get('catastrophe_primary',''))[:150]}")
    print(f"    TRIZ: {str(g.get('triz_contradiction',''))[:150]}")

# Step 3
step3 = so.get("step3", {})
print(f"\n--- STEP 3: REQUIREMENT ATOMS ---")
fs_set = set()
all_ras = []
for gid, ras in step3.items():
    for ra in ras:
        all_ras.append(ra)
        fs_set.add(ra.get("failure_shape", ""))
        print(f"  {ra.get('ra_id')}: {ra.get('atom_title')}")
        print(f"    FS: {ra.get('failure_shape')}, PC: {', '.join(ra.get('perturbation_classes', []))}")
        print(f"    Stmt: {ra.get('requirement_statement','')[:150]}")
maintain = sum(1 for ra in all_ras if ra.get('atom_title','').startswith(('Maintain','Preserve','Sustain','Ensure')))
print(f"  Total: {len(all_ras)}, Maintain-titles: {maintain}, Failure shapes: {len(fs_set)}")

# Step 4
step4 = so.get("step4", {})
print(f"\n--- STEP 4: S-NODES (top 8) ---")
all_p = []
for gid, gdata in step4.items():
    all_p.extend(gdata.get("scientific_pillars", []))
rl_counts = {}
for p in all_p:
    rl = p.get("readiness_level", "?")
    rl_counts[rl] = rl_counts.get(rl, 0) + 1
for p in all_p[:8]:
    print(f"  {p.get('id')}: {p.get('title')}")
    print(f"    RL: {p.get('readiness_level')}, Rel: {p.get('relationship_to_goal')}, Frag: {p.get('fragility_score')}")
    mech = str(p.get("mechanism",""))[:200]
    print(f"    Mech: {mech}")
print(f"  Total: {len(all_p)}, RL: {rl_counts}")

# Step 6
step6 = so.get("step6", {})
l3s = step6.get("l3_questions", [])
if not l3s:
    for gid, gdata in step6.items():
        if isinstance(gdata, dict):
            l3s.extend(gdata.get("seed_questions", gdata.get("l3_questions", [])))
print(f"\n--- STEP 6: L3 QUESTIONS ---")
for q in l3s:
    print(f"  {q.get('id')}: [{q.get('strategy_used','?')}]")
    print(f"    {q.get('text','')[:250]}")
print(f"  Total: {len(l3s)}")

# Step 7
step7 = so.get("step7", {})
ihs = step7.get("instantiation_hypotheses", [])
print(f"\n--- STEP 7: IHs ---")
heretical = []
cross_domain = []
for ih in ihs:
    ih_text = (str(ih.get("process_hypothesis","")) + " " + str(ih.get("notes",""))).lower()
    is_h = "heretical" in ih_text
    is_cd = "cross-domain" in ih_text or "cross_domain" in ih_text
    if is_h:
        heretical.append(ih)
    if is_cd:
        cross_domain.append(ih)
    tags = (" [HERETICAL]" if is_h else "") + (" [CROSS-DOMAIN]" if is_cd else "")
    print(f"  {ih.get('ih_id')}: [{ih.get('domain_category')}]{tags}")
    print(f"    {ih.get('process_hypothesis','')[:200]}")
has_checklist = sum(1 for ih in ihs if ih.get("heretical_checklist"))
has_cross_field = sum(1 for ih in ihs if ih.get("cross_field_source"))
print(f"  Total: {len(ihs)}, Heretical: {len(heretical)}, Cross-domain: {len(cross_domain)}")
print(f"  With heretical_checklist: {has_checklist}, With cross_field_source: {has_cross_field}")
# Competition matrix
comp_matrix = step7.get("competition_matrix", [])
if comp_matrix:
    print(f"  Competition matrix entries: {len(comp_matrix)}")
    for cm in comp_matrix[:3]:
        print(f"    {cm.get('ih_pair', [])}: {str(cm.get('distinguishing_observable', ''))[:120]}")
else:
    print(f"  Competition matrix: NOT PRESENT")

# Step 8
step8 = so.get("step8", {})
l4s = step8.get("l4_questions", [])
print(f"\n--- STEP 8: L4 QUESTIONS (first 5) ---")
disc = sum(1 for q in l4s if "DISCRIMINATOR" in str(q.get("type","")).upper())
for q in l4s[:5]:
    print(f"  {q.get('id')}: [{q.get('type')}]")
    print(f"    {q.get('text','')[:200]}")
print(f"  Total: {len(l4s)}, Discriminators: {disc}")

# Step 9
step9 = so.get("step9", {})
l6s = step9.get("l6_tasks", [])
l5s = step9.get("l5_nodes", [])
print(f"\n--- STEP 9: EXPERIMENTS (first 5) ---")
disc_exp = sum(1 for t in l6s if t.get("discovery_component"))
feas = [t.get("feasibility_score") for t in l6s if t.get("feasibility_score") is not None]
avg_f = sum(feas)/len(feas) if feas else 0
systems_used = {}
interventions_used = {}
for t in l6s:
    s = str(t.get("simt_parameters", {}).get("system", ""))[:50]
    # Crude system extraction
    for sys_name in ["C57BL/6J", "Drosophila", "C. elegans", "zebrafish", "organoid", "iPSC", "computational", "mathematical", "ODE", "agent-based"]:
        if sys_name.lower() in s.lower():
            systems_used[sys_name] = systems_used.get(sys_name, 0) + 1
    i = str(t.get("simt_parameters", {}).get("intervention", ""))[:80]
    for int_name in ["optogenetic", "CRISPR", "pharmacolog", "mechanical", "computational"]:
        if int_name.lower() in i.lower():
            interventions_used[int_name] = interventions_used.get(int_name, 0) + 1
has_if_null = sum(1 for t in l6s if t.get("if_null"))
for t in l6s[:5]:
    simt = t.get("simt_parameters", {})
    print(f"  {t.get('id')}: {t.get('title','')[:130]}")
    rat = t.get('rationale', '')
    if rat:
        print(f"    WHY: {str(rat)[:200]}")
    if_null = t.get('if_null', '')
    if if_null:
        print(f"    IF NULL: {str(if_null)[:200]}")
    print(f"    S: {str(simt.get('system',''))[:120]}")
    print(f"    I: {str(simt.get('intervention',''))[:120]}")
    print(f"    M: {str(simt.get('meter',''))[:120]}")
    print(f"    Feas: {t.get('feasibility_score')}, Disc: {t.get('discovery_component')}")
print(f"  Total L6: {len(l6s)}, L5: {len(l5s)}, Discovery: {disc_exp}")
print(f"  With if_null: {has_if_null}/{len(l6s)}")
print(f"  Avg feasibility: {avg_f:.1f}, Range: {min(feas) if feas else 0}-{max(feas) if feas else 0}")
print(f"  Systems: {systems_used}")
print(f"  Interventions: {interventions_used}")

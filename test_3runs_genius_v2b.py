#!/usr/bin/env python3
"""Run test pipelines until we have 3 successes, max 5 attempts."""
import requests, json, time, sys

BASE = "http://localhost:3002/api"
GOAL = "reverse aging in the human brain"

def run_pipeline(run_num):
    print(f"\n{'='*70}")
    print(f"ATTEMPT {run_num}")
    print(f"{'='*70}")
    payload = {"goal": GOAL, "test_mode": True}
    r = requests.post(f"{BASE}/run-full-pipeline", json=payload)
    r.raise_for_status()
    run_id = r.json().get("run_id")
    print(f"Run ID: {run_id}")

    start = time.time()
    while time.time() - start < 600:
        r = requests.get(f"{BASE}/full-pipeline-result", params={"run_id": run_id})
        elapsed = int(time.time() - start)
        if r.status_code == 200:
            result = r.json()
            fname = f"genius-v2-run{run_num}-{int(time.time())}.json"
            with open(fname, "w") as f:
                json.dump(result, f, indent=2)
            print(f"\nCompleted in {elapsed}s — saved to {fname}")
            if result.get("success"):
                print("SUCCESS")
                return fname, result
            else:
                print(f"PIPELINE FAILED: {result.get('error','')[:100]}")
                return None, None
        elif r.status_code == 202:
            p = r.json()
            print(f"  [{elapsed}s] Step {p.get('step','?')}: {p.get('detail','')}          ", end="\r")
        time.sleep(5)
    print("\nTIMEOUT!")
    return None, None

results = []
attempt = 0
while len(results) < 3 and attempt < 6:
    attempt += 1
    fname, result = run_pipeline(attempt)
    if fname and result:
        results.append((fname, result))
    time.sleep(2)

if len(results) < 3:
    print(f"\nWARNING: Only got {len(results)} successful runs out of {attempt} attempts")

print(f"\n\n{'='*70}")
print(f"GENIUS V2 ANALYSIS: {len(results)} SUCCESSFUL RUNS")
print(f"{'='*70}")

for idx, (fname, result) in enumerate(results):
    so = result.get("step_outputs", {})
    summary = result.get("summary", {})
    step9 = so.get("step9", {})
    l6s = step9.get("l6_tasks", [])
    l5s = step9.get("l5_nodes", [])
    step7 = so.get("step7", {})

    print(f"\n--- RUN {idx+1} ({fname}) ---")
    print(f"Goals: {summary.get('goals')}, S-nodes: {summary.get('total_s_nodes')}, L3: {summary.get('total_l3_questions')}, IHs: {summary.get('total_ihs')}, L4: {summary.get('total_l4_questions')}, L5: {summary.get('total_l5_nodes')}, L6: {summary.get('total_l6_tasks')}")

    has_if_null = sum(1 for t in l6s if t.get("if_null"))
    feas = [t.get("feasibility_score") for t in l6s if t.get("feasibility_score") is not None]
    avg_f = sum(feas)/len(feas) if feas else 0
    disc_exp = sum(1 for t in l6s if t.get("discovery_component"))
    print(f"  if_null: {has_if_null}/{len(l6s)}, Avg feasibility: {avg_f:.1f} ({min(feas) if feas else 0}-{max(feas) if feas else 0}), Discovery: {disc_exp}/{len(l6s)}")

    # System diversity
    systems_used = {}
    for t in l6s:
        s = str(t.get("simt_parameters", {}).get("system", "")).lower()
        for sys_name in ["C57BL/6J", "Drosophila", "C. elegans", "zebrafish", "organoid", "iPSC", "computational", "ODE", "agent-based", "cell-free", "human", "marmoset", "macaque", "ex vivo", "rat"]:
            if sys_name.lower() in s:
                systems_used[sys_name] = systems_used.get(sys_name, 0) + 1
    print(f"  Systems: {systems_used}")

    # Anti-patterns
    omics_def = comp_fill = eg_hedge = aged_young = 0
    for t in l6s:
        simt = t.get("simt_parameters", {})
        s_text = str(simt.get("system", "")).lower()
        i_text = str(simt.get("intervention", "")).lower()
        m_text = str(simt.get("meter", "")).lower()
        title = str(t.get("title", "")).lower()
        # Omics default
        if any(x in m_text for x in ["rna-seq", "proteomics", "proteome", "transcriptom"]) and any(x in i_text[:30] for x in ["no ", "passive", "no direct"]):
            omics_def += 1
        # Computational filler
        if any(x in s_text for x in ["computational", "agent-based", "ode", "simulation"]) and any(x in title for x in ["sensitivity", "parameter", "calibrat"]):
            comp_fill += 1
        # e.g. hedging
        for field in [simt.get("system",""), simt.get("intervention",""), simt.get("meter","")]:
            if "e.g." in str(field):
                eg_hedge += 1
                break
        # Aged vs young only
        if any(x in i_text[:30] for x in ["no ", "no direct", "passive"]) and any(x in s_text for x in ["aged", "old"]):
            aged_young += 1
    print(f"  Anti-patterns: omics={omics_def}, comp_filler={comp_fill}, eg_hedging={eg_hedge}, aged_vs_young={aged_young}")

    # Competition matrix
    comp = step7.get("competition_matrix", [])
    print(f"  Competition matrix: {len(comp)} entries")

    # Print ALL L6 experiments (titles + key details)
    print(f"\n  ALL {len(l6s)} L6 EXPERIMENTS:")
    for i, t in enumerate(l6s):
        simt = t.get("simt_parameters", {})
        disc = " [DISCOVERY]" if t.get("discovery_component") else ""
        fsc = t.get("feasibility_score", "?")
        if_n = "YES" if t.get("if_null") else "NO"
        print(f"    {i+1}. [{fsc}] {t.get('id','')}: {t.get('title','')[:130]}{disc} (if_null:{if_n})")
        # Show brief SIMT
        print(f"       S: {str(simt.get('system',''))[:80]}")
        print(f"       I: {str(simt.get('intervention',''))[:80]}")
        # Show if_null
        if t.get('if_null'):
            print(f"       NULL: {str(t['if_null'])[:150]}")
        print()

print(f"\nOutput files: {[r[0] for r in results]}")

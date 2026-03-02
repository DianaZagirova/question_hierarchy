#!/usr/bin/env python3
"""Run 3 sequential test pipelines and save outputs for genius analysis."""
import requests, json, time, sys

BASE = "http://localhost:3002/api"
GOAL = "reverse aging in the human brain"

def run_pipeline(run_num):
    print(f"\n{'='*70}")
    print(f"RUN {run_num}/3")
    print(f"{'='*70}")
    payload = {
        "goal": GOAL,
        "test_mode": True,
    }
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
            fname = f"genius-run{run_num}-{int(time.time())}.json"
            with open(fname, "w") as f:
                json.dump(result, f, indent=2)
            print(f"\nDONE in {elapsed}s — saved to {fname}")
            return fname, result
        elif r.status_code == 202:
            p = r.json()
            print(f"  [{elapsed}s] Step {p.get('step','?')}: {p.get('detail','')}          ", end="\r")
        time.sleep(5)
    print("\nTIMEOUT!")
    return None, None

results = []
for i in range(1, 4):
    fname, result = run_pipeline(i)
    if result and result.get("success"):
        results.append((fname, result))
    else:
        print(f"RUN {i} FAILED")
    # Small gap between runs
    time.sleep(2)

print(f"\n\n{'='*70}")
print(f"GENIUS ANALYSIS ACROSS {len(results)} RUNS")
print(f"{'='*70}")

for idx, (fname, result) in enumerate(results):
    so = result.get("step_outputs", {})
    summary = result.get("summary", {})
    step9 = so.get("step9", {})
    l6s = step9.get("l6_tasks", [])
    l5s = step9.get("l5_nodes", [])

    print(f"\n--- RUN {idx+1} ({fname}) ---")
    print(f"Goals: {summary.get('goals')}, S-nodes: {summary.get('total_s_nodes')}, L3: {summary.get('total_l3_questions')}, IHs: {summary.get('total_ihs')}, L4: {summary.get('total_l4_questions')}, L6: {summary.get('total_l6_tasks')}")

    # if_null coverage
    has_if_null = sum(1 for t in l6s if t.get("if_null"))
    print(f"  if_null: {has_if_null}/{len(l6s)}")

    # Feasibility
    feas = [t.get("feasibility_score") for t in l6s if t.get("feasibility_score") is not None]
    avg_f = sum(feas)/len(feas) if feas else 0
    print(f"  Avg feasibility: {avg_f:.1f}, Range: {min(feas) if feas else 0}-{max(feas) if feas else 0}")

    # Discovery
    disc_exp = sum(1 for t in l6s if t.get("discovery_component"))
    print(f"  Discovery experiments: {disc_exp}/{len(l6s)}")

    # System diversity
    systems_used = {}
    for t in l6s:
        s = str(t.get("simt_parameters", {}).get("system", "")).lower()
        for sys_name in ["C57BL/6J", "Drosophila", "C. elegans", "zebrafish", "organoid", "iPSC", "computational", "mathematical", "ODE", "agent-based", "cell-free", "reconstituted", "yeast", "human"]:
            if sys_name.lower() in s:
                systems_used[sys_name] = systems_used.get(sys_name, 0) + 1
    print(f"  Systems: {systems_used}")

    # Competition matrix
    step7 = so.get("step7", {})
    comp = step7.get("competition_matrix", [])
    print(f"  Competition matrix: {len(comp)} entries")

    # Print 3 best L6 experiments
    print(f"\n  TOP 5 L6 EXPERIMENTS:")
    for t in l6s[:5]:
        simt = t.get("simt_parameters", {})
        print(f"    {t.get('id')}: {t.get('title','')[:140]}")
        if t.get('if_null'):
            print(f"      IF NULL: {str(t['if_null'])[:180]}")
        print(f"      S: {str(simt.get('system',''))[:100]}")
        print(f"      I: {str(simt.get('intervention',''))[:100]}")
        print(f"      M: {str(simt.get('meter',''))[:100]}")
        print(f"      Feas: {t.get('feasibility_score')}")
        print()

print(f"\nAll output files: {[r[0] for r in results]}")

#!/usr/bin/env python3
"""
Test pipeline genius-level output quality.
Runs 3 different goals (1G, 1L3 each) and saves detailed output for analysis.
"""
import requests
import json
import time
import sys

BASE = "http://localhost:3002/api"

GOALS = [
    "reverse aging in the human brain",
    "achieve complete photosynthesis efficiency in synthetic organisms",
    "engineer universal pathogen resistance in humans",
]

def run_pipeline(goal, num_goals=1, num_l3=1):
    """Start pipeline and return run_id."""
    payload = {"goal": goal}
    if num_goals != 5 or num_l3 != 6:
        payload["agents"] = {
            "agent-immortalist": {"settings": {"nodeCount": {"min": num_goals, "max": num_goals, "default": num_goals}}},
            "agent-l3-explorer": {"settings": {"nodeCount": {"min": num_l3, "max": num_l3, "default": num_l3}}},
        }
    r = requests.post(f"{BASE}/run-full-pipeline", json=payload)
    r.raise_for_status()
    data = r.json()
    return data.get("run_id")

def poll_result(run_id, timeout=600):
    """Poll for pipeline completion."""
    start = time.time()
    while time.time() - start < timeout:
        r = requests.get(f"{BASE}/full-pipeline-result", params={"run_id": run_id})
        if r.status_code == 200:
            return r.json()
        elif r.status_code == 202:
            progress = r.json()
            step = progress.get("step", "?")
            detail = progress.get("detail", "")
            elapsed = int(time.time() - start)
            print(f"    [{elapsed}s] Step {step}: {detail}        ", end="\r")
        time.sleep(8)
    print("\n  TIMEOUT!")
    return None

def analyze_run(result, run_idx):
    """Analyze genius quality metrics of a pipeline run."""
    if not result or not result.get("success"):
        print(f"  Run {run_idx+1}: FAILED")
        return

    so = result.get("step_outputs", {})
    summary = result.get("summary", {})

    print(f"\n{'='*70}")
    print(f"RUN {run_idx+1}: {result.get('goal', '?')}")
    print(f"{'='*70}")
    print(f"  Goals: {summary.get('goals')}, RAs: {summary.get('total_ras')}, S-nodes: {summary.get('total_s_nodes')}")
    print(f"  L3: {summary.get('total_l3_questions')}, IHs: {summary.get('total_ihs')}, L4: {summary.get('total_l4_questions')}")
    print(f"  L5: {summary.get('total_l5_nodes')}, L6: {summary.get('total_l6_tasks')}")

    # Step 2: Check goals for non-trivial decomposition
    step2 = so.get("step2", {})
    goals = step2.get("goals", [])
    print(f"\n  --- STEP 2: GOAL PILLARS ---")
    cross_cutting = 0
    for g in goals:
        is_cc = g.get("is_cross_cutting", False)
        if is_cc:
            cross_cutting += 1
        cc_tag = " [CROSS-CUTTING]" if is_cc else ""
        print(f"    {g.get('id')}: {g.get('title')}{cc_tag}")
        print(f"      Catastrophe: {str(g.get('catastrophe_primary', ''))[:100]}")
    print(f"  Cross-cutting goals: {cross_cutting}/{len(goals)}")

    # Step 3: Check RAs for cascade requirements
    step3 = so.get("step3", {})
    print(f"\n  --- STEP 3: REQUIREMENT ATOMS ---")
    total_ras = 0
    cascade_ras = 0
    paradox_ras = 0
    for gid, ras in step3.items():
        for ra in ras:
            total_ras += 1
            title = ra.get("atom_title", "")
            fs = ra.get("failure_shape", "")
            pcs = ra.get("perturbation_classes", [])
            # Check for cascade/interaction indicators
            stmt = ra.get("requirement_statement", "").lower()
            if any(w in stmt for w in ["cascade", "trigger", "propagat", "downstream", "cross-", "inter-", "handoff", "coupling"]):
                cascade_ras += 1
            if any(w in fs.lower() for w in ["compensatory", "overshoot", "paradox", "runaway"]):
                paradox_ras += 1
            print(f"    {ra.get('ra_id')}: {title}")
            print(f"      FS: {fs}, PC: {', '.join(pcs) if isinstance(pcs, list) else pcs}")
    print(f"  Total RAs: {total_ras}, Cascade RAs: {cascade_ras}, Paradox RAs: {paradox_ras}")

    # Step 4: Check S-nodes for frontier vs textbook
    step4 = so.get("step4", {})
    print(f"\n  --- STEP 4: DOMAINS & S-NODES ---")
    total_pillars = 0
    rl1_count = 0
    for gid, gdata in step4.items():
        domains = gdata.get("domains", [])
        pillars = gdata.get("scientific_pillars", [])
        non_obvious = [d for d in domains if d.get("domain_category") == "adjacent_non_obvious"]
        print(f"    {gid}: {len(domains)} domains ({len(non_obvious)} adjacent/non-obvious), {len(pillars)} S-nodes")
        for d in domains:
            cat = d.get("domain_category", "?")
            print(f"      {d.get('domain_id')}: {d.get('domain_name')} [{cat}]")
        for p in pillars:
            total_pillars += 1
            rl = p.get("readiness_level", "?")
            if rl == "RL-1":
                rl1_count += 1
            rel = p.get("relationship_to_goal", "?")
            title = p.get("title", "?")
            # Check for frontier indicators
            mech = p.get("mechanism", "").lower()
            has_year = any(str(y) in mech for y in range(2022, 2027))
            frontier_tag = " [RECENT]" if has_year else ""
            contradiction_tag = " [CONTRADICTION]" if p.get("violation_risk") else ""
            print(f"      {p.get('id')}: {title} ({rl}, {rel}){frontier_tag}{contradiction_tag}")
    print(f"  Total S-nodes: {total_pillars}, RL-1 (frontier): {rl1_count}")

    # Step 6: Check L3 questions for paradigm-challenging
    step6 = so.get("step6", {})
    print(f"\n  --- STEP 6: L3 FRONTIER QUESTIONS ---")
    all_l3 = []
    if isinstance(step6, dict):
        for gid, gdata in step6.items():
            if isinstance(gdata, dict):
                qs = gdata.get("seed_questions", [])
                all_l3.extend(qs)
    adversarial = 0
    for q in all_l3:
        strat = q.get("strategy_used", "?")
        text = q.get("text", "?")
        if "ADVERSARIAL" in strat.upper():
            adversarial += 1
        # Check for assumption-inversion indicators
        inversion = any(w in text.lower() for w in ["what if", "opposite", "actually", "instead", "wrong", "paradox", "contradict", "reverse", "invert", "challenge"])
        inv_tag = " [INVERTS ASSUMPTION]" if inversion else ""
        print(f"    {q.get('id')}: [{strat}]{inv_tag}")
        print(f"      {text[:200]}")
    print(f"  Total L3: {len(all_l3)}, Adversarial: {adversarial}")

    # Step 7: Check IHs for heretical quality
    step7 = so.get("step7", {})
    ihs = step7.get("instantiation_hypotheses", [])
    print(f"\n  --- STEP 7: INSTANTIATION HYPOTHESES ---")
    heretical = 0
    cross_domain = 0
    for ih in ihs:
        notes = ih.get("notes", "").lower()
        domain_cat = ih.get("domain_category", "")
        process = ih.get("process_hypothesis", "")
        if "heretical" in notes:
            heretical += 1
        lens = ih.get("lens_origin", "")
        print(f"    {ih.get('ih_id')}: [{domain_cat}] [{lens}]")
        print(f"      {process[:200]}")
        if "heretical" in notes:
            print(f"      HERETICAL: {ih.get('notes', '')[:200]}")
    print(f"  Total IHs: {len(ihs)}, Heretical: {heretical}")

    # Step 8: Check L4 questions
    step8 = so.get("step8", {})
    l4s = step8.get("l4_questions", [])
    print(f"\n  --- STEP 8: L4 TACTICAL QUESTIONS ---")
    discriminators = 0
    for l4 in l4s:
        typ = l4.get("type", "?")
        if "DISCRIMINATOR" in typ.upper():
            discriminators += 1
        text = l4.get("text", "?")
        print(f"    {l4.get('id')}: [{typ}] {text[:200]}")
    print(f"  Total L4: {len(l4s)}, Discriminators: {discriminators}")

    # Step 9: Check L6 experiments
    step9 = so.get("step9", {})
    l6s = step9.get("l6_tasks", [])
    l5s = step9.get("l5_nodes", [])
    print(f"\n  --- STEP 9: EXPERIMENTS ---")
    discovery_count = 0
    multi_factorial = 0
    unique_l4_parents = set()
    for l6 in l6s:
        parent_l4 = l6.get("parent_l4_id", "?")
        unique_l4_parents.add(parent_l4)
        title = l6.get("title", "?")
        simt = l6.get("simt_parameters", {})
        disc = l6.get("discovery_component", False)
        if disc:
            discovery_count += 1
        # Check for multi-factorial indicators
        intervention = str(simt.get("intervention", "")).lower()
        if any(w in intervention for w in ["sequential", "factorial", "combination", "followed by", "then", "versus", "×", "x "]):
            multi_factorial += 1
        print(f"    {l6.get('id')}: (L4: {parent_l4}) disc={disc}")
        print(f"      Title: {title[:150]}")
        sys_preview = str(simt.get("system", ""))[:100]
        print(f"      S: {sys_preview}")
    print(f"  Total L6: {len(l6s)}, L5s: {len(l5s)}")
    print(f"  Discovery experiments: {discovery_count}")
    print(f"  Multi-factorial: {multi_factorial}")
    print(f"  Unique L4 parents covered: {len(unique_l4_parents)}")

    return {
        "goals": len(goals),
        "cross_cutting": cross_cutting,
        "total_ras": total_ras,
        "cascade_ras": cascade_ras,
        "paradox_ras": paradox_ras,
        "total_pillars": total_pillars,
        "rl1_pillars": rl1_count,
        "total_l3": len(all_l3),
        "adversarial_l3": adversarial,
        "total_ihs": len(ihs),
        "heretical_ihs": heretical,
        "total_l4": len(l4s),
        "discriminator_l4": discriminators,
        "total_l6": len(l6s),
        "discovery_l6": discovery_count,
        "multi_factorial_l6": multi_factorial,
        "unique_l4_parents": len(unique_l4_parents),
    }


def main():
    all_results = []
    all_metrics = []

    for i, goal in enumerate(GOALS):
        print(f"\n{'#'*70}")
        print(f"# STARTING RUN {i+1}/3: {goal}")
        print(f"{'#'*70}")

        run_id = run_pipeline(goal, num_goals=1, num_l3=1)
        print(f"  Run: {run_id}")
        print(f"  Polling for result...")

        result = poll_result(run_id, timeout=600)
        if result:
            all_results.append(result)
            metrics = analyze_run(result, i)
            all_metrics.append(metrics)

            # Save individual run
            fname = f"genius-run{i+1}-{int(time.time())}.json"
            with open(fname, "w") as f:
                json.dump(result, f, indent=2)
            print(f"\n  Saved: {fname}")
        else:
            print(f"  Run {i+1} FAILED to produce result")
            all_results.append(None)
            all_metrics.append(None)

    # Print summary
    print(f"\n\n{'='*70}")
    print(f"GENIUS TEST SUMMARY")
    print(f"{'='*70}")
    print(f"{'Metric':<30} {'Run 1':>8} {'Run 2':>8} {'Run 3':>8}")
    print(f"{'-'*54}")
    if all_metrics[0]:
        for key in all_metrics[0]:
            vals = [str(m.get(key, "N/A")) if m else "FAIL" for m in all_metrics]
            print(f"  {key:<28} {vals[0]:>8} {vals[1]:>8} {vals[2]:>8}")

    # Save combined
    combined_name = f"genius-all-combined-{int(time.time())}.json"
    with open(combined_name, "w") as f:
        json.dump({"results": [r for r in all_results if r], "metrics": [m for m in all_metrics if m]}, f, indent=2)
    print(f"\nCombined saved: {combined_name}")


if __name__ == "__main__":
    main()

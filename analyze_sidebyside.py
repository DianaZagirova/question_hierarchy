import json

V3_FILES = [
    ("V3-Run2", "v3-run2-1772129595.json"),
]
V2_FILES = [
    ("V2-Run1", "genius-v2-run1-1772127269.json"),
]

def load_l6(filepath):
    with open(filepath) as f:
        data = json.load(f)
    s9 = data.get("step_outputs", {}).get("step9", {})
    return s9.get("l6_tasks", [])

# Pick a typical V2 experiment with e.g. for comparison
v2_l6 = load_l6("genius-v2-run1-1772127269.json")
v3_l6 = load_l6("v3-run2-1772129595.json")

# Show a V2 experiment with e.g. usage
print("=" * 80)
print("  SIDE-BY-SIDE: V2 vs V3 Experiment Specificity")
print("=" * 80)

# Find a V2 experiment with e.g. in system/intervention
for l6 in v2_l6:
    simt = l6.get("simt_parameters", {})
    sys_text = str(simt.get("system", ""))
    int_text = str(simt.get("intervention", ""))
    if "e.g." in sys_text and "e.g." in int_text:
        print(f"\n  V2 EXAMPLE (with e.g.):")
        print(f"  Title: {l6.get('title')}")
        print(f"  SYSTEM: {sys_text[:500]}")
        print(f"  INTERVENTION: {int_text[:500]}")
        print(f"  Feasibility: {l6.get('feasibility_score')}")
        break

# Show a V3 experiment for comparison
for l6 in v3_l6:
    simt = l6.get("simt_parameters", {})
    sys_text = str(simt.get("system", ""))
    if "catalog" in sys_text.lower() or "jackson" in sys_text.lower():
        print(f"\n  V3 EXAMPLE (no e.g.):")
        print(f"  Title: {l6.get('title')}")
        print(f"  SYSTEM: {sys_text[:500]}")
        int_text = str(simt.get("intervention", ""))
        print(f"  INTERVENTION: {int_text[:500]}")
        print(f"  Feasibility: {l6.get('feasibility_score')}")
        print(f"  Genius Score: {l6.get('genius_score')}")
        print(f"  Verification Note: {str(l6.get('verification_note',''))[:300]}")
        break

# Check V2 experiments with "e.g." in critical decision points (where it makes the experiment vague)
print("\n\n" + "=" * 80)
print("  V2: WORST 'e.g.' OFFENDERS (vagueness in critical fields)")
print("=" * 80)
count = 0
for l6 in v2_l6:
    simt = l6.get("simt_parameters", {})
    eg_count = 0
    for field in ["system", "intervention", "meter"]:
        val = str(simt.get(field, ""))
        eg_count += val.lower().count("e.g.")
    if eg_count >= 2:
        print(f"\n  Title: {l6.get('title','')[:80]}")
        print(f"  e.g. count in SIMT: {eg_count}")
        for field in ["system", "intervention", "meter"]:
            val = str(simt.get(field, ""))
            if "e.g." in val.lower():
                # Extract context around e.g.
                idx = val.lower().index("e.g.")
                start = max(0, idx - 30)
                end = min(len(val), idx + 60)
                print(f"    {field}: ...{val[start:end]}...")
        count += 1
        if count >= 3:
            break

# Show some V3 "genius=6" experiments to understand what's mediocre
print("\n\n" + "=" * 80)
print("  V3: ALL genius_score=6 experiments (detailed)")
print("=" * 80)
all_v3 = []
for _, fpath in [("V3-Run1", "v3-run1-1772129354.json"), ("V3-Run2", "v3-run2-1772129595.json"), ("V3-Run3", "v3-run3-1772129910.json")]:
    all_v3.extend(load_l6(fpath))

genius6 = [l6 for l6 in all_v3 if l6.get("genius_score") == 6]
for l6 in genius6:
    print(f"\n  Title: {l6.get('title','')[:100]}")
    print(f"  Feasibility: {l6.get('feasibility_score')}")
    print(f"  Rationale: {str(l6.get('rationale',''))[:200]}")
    print(f"  Verification Note: {str(l6.get('verification_note',''))[:200]}")


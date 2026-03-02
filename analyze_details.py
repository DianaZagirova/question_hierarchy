import json
import re
from collections import Counter

V3_FILES = [
    ("V3-Run1", "v3-run1-1772129354.json"),
    ("V3-Run2", "v3-run2-1772129595.json"),
    ("V3-Run3", "v3-run3-1772129910.json"),
]

V2_FILES = [
    ("V2-Run1", "genius-v2-run1-1772127269.json"),
    ("V2-Run2", "genius-v2-run2-1772126256.json"),
    ("V2-Run3", "genius-v2-run3-1772126468.json"),
]

def load_l6(filepath):
    with open(filepath) as f:
        data = json.load(f)
    s9 = data.get("step_outputs", {}).get("step9", {})
    return s9.get("l6_tasks", [])

# V3 missing if_null details
print("=" * 80)
print("  V3: EXPERIMENTS WITH MISSING if_null")
print("=" * 80)
for run_name, fpath in V3_FILES:
    l6s = load_l6(fpath)
    for l6 in l6s:
        if not l6.get("if_null"):
            print(f"  [{run_name}] {l6.get('id')}: {l6.get('title','')[:80]}")
            print(f"    genius_score={l6.get('genius_score')}, feasibility={l6.get('feasibility_score')}")
            print(f"    verification_note: {str(l6.get('verification_note',''))[:150]}")

# V3 missing threshold/time
print("\n" + "=" * 80)
print("  V3: threshold and time field analysis")
print("=" * 80)
for run_name, fpath in V3_FILES:
    l6s = load_l6(fpath)
    missing_thresh = sum(1 for l6 in l6s if not l6.get("simt_parameters", {}).get("threshold"))
    missing_time = sum(1 for l6 in l6s if not l6.get("simt_parameters", {}).get("time"))
    print(f"  [{run_name}] Missing threshold: {missing_thresh}/{len(l6s)}, Missing time: {missing_time}/{len(l6s)}")

for run_name, fpath in V2_FILES:
    l6s = load_l6(fpath)
    missing_thresh = sum(1 for l6 in l6s if not l6.get("simt_parameters", {}).get("threshold"))
    missing_time = sum(1 for l6 in l6s if not l6.get("simt_parameters", {}).get("time"))
    print(f"  [{run_name}] Missing threshold: {missing_thresh}/{len(l6s)}, Missing time: {missing_time}/{len(l6s)}")

# Check for repetitive/permutation experiments
print("\n" + "=" * 80)
print("  V3: TITLE ANALYSIS - Potential Repetitiveness")
print("=" * 80)
for run_name, fpath in V3_FILES:
    l6s = load_l6(fpath)
    titles = [l6.get("title", "") for l6 in l6s]
    print(f"\n  [{run_name}] All titles:")
    for i, t in enumerate(titles):
        print(f"    {i+1}. {t[:120]}")

print("\n" + "=" * 80)
print("  V2: TITLE ANALYSIS - Potential Repetitiveness")
print("=" * 80)
for run_name, fpath in V2_FILES:
    l6s = load_l6(fpath)
    titles = [l6.get("title", "") for l6 in l6s]
    print(f"\n  [{run_name}] All titles:")
    for i, t in enumerate(titles):
        print(f"    {i+1}. {t[:120]}")

# Check if threshold/time are embedded in other fields
print("\n" + "=" * 80)
print("  V3 SAMPLE: Check if threshold/time content exists elsewhere")
print("=" * 80)
for run_name, fpath in V3_FILES:
    l6s = load_l6(fpath)
    for l6 in l6s[:2]:
        simt = l6.get("simt_parameters", {})
        print(f"\n  [{run_name}] {l6.get('id')}")
        print(f"    threshold field: {str(simt.get('threshold',''))[:200]}")
        print(f"    time field: {str(simt.get('time',''))[:200]}")
        # Check if threshold info is in meter
        meter = str(simt.get("meter", ""))
        if any(w in meter.lower() for w in ['p<', 'p <', 'significant', 'threshold', 'statistical']):
            print(f"    [FOUND threshold-like content in meter field]")
    break

# V2: e.g. examples
print("\n" + "=" * 80)
print("  V2: EXAMPLES OF 'e.g.' USAGE IN SIMT")
print("=" * 80)
count = 0
for run_name, fpath in V2_FILES:
    l6s = load_l6(fpath)
    for l6 in l6s:
        simt = l6.get("simt_parameters", {})
        for field in ["system", "intervention", "meter"]:
            val = str(simt.get(field, ""))
            if "e.g." in val.lower():
                # Find the e.g. context
                idx = val.lower().index("e.g.")
                start = max(0, idx - 40)
                end = min(len(val), idx + 80)
                context = val[start:end]
                print(f"  [{run_name}] {l6.get('id')} - {field}: ...{context}...")
                count += 1
                if count >= 10:
                    break
        if count >= 10:
            break
    if count >= 10:
        break


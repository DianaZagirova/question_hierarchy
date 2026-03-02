import json
import re

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

def print_experiment(l6, idx=None):
    prefix = f"[{idx}] " if idx is not None else ""
    print(f"\n  {prefix}TITLE: {l6.get('title', 'N/A')}")
    print(f"  ID: {l6.get('id', 'N/A')}")
    gs = l6.get('genius_score', 'N/A')
    fs = l6.get('feasibility_score', 'N/A')
    print(f"  Genius Score: {gs} | Feasibility: {fs}")
    
    simt = l6.get("simt_parameters", {})
    for field in ["system", "intervention", "meter", "threshold", "time"]:
        val = simt.get(field, "N/A")
        if val and len(str(val)) > 400:
            val = str(val)[:400] + "..."
        print(f"  {field.upper()}: {val}")
    
    ifnull = l6.get("if_null", "N/A")
    if ifnull and len(str(ifnull)) > 300:
        ifnull = str(ifnull)[:300] + "..."
    print(f"  IF_NULL: {ifnull}")
    
    vn = l6.get("verification_note", "N/A")
    if vn and len(str(vn)) > 300:
        vn = str(vn)[:300] + "..."
    print(f"  VERIFICATION_NOTE: {vn}")
    disc = l6.get("discovery_component", "N/A")
    if disc and len(str(disc)) > 200:
        disc = str(disc)[:200] + "..."
    print(f"  DISCOVERY: {disc}")

# Load all V3
v3_all = []
for run_name, fpath in V3_FILES:
    for l6 in load_l6(fpath):
        l6["_run"] = run_name
        v3_all.append(l6)

# Sort by genius_score
v3_with_score = [l6 for l6 in v3_all if l6.get("genius_score") is not None]
v3_with_score.sort(key=lambda x: float(x["genius_score"]) if isinstance(x["genius_score"], (int, float)) else float(str(x["genius_score"]).split('/')[0]), reverse=True)

print("=" * 80)
print("  TOP 5 BEST V3 EXPERIMENTS (by genius_score)")
print("=" * 80)
for i, l6 in enumerate(v3_with_score[:5]):
    print_experiment(l6, i+1)

print("\n\n" + "=" * 80)
print("  BOTTOM 5 WORST V3 EXPERIMENTS (by genius_score)")
print("=" * 80)
for i, l6 in enumerate(v3_with_score[-5:]):
    print_experiment(l6, i+1)

# Also print a few V2 experiments for comparison
v2_all = []
for run_name, fpath in V2_FILES:
    for l6 in load_l6(fpath):
        l6["_run"] = run_name
        v2_all.append(l6)

# Sort V2 by feasibility_score
v2_with_score = [l6 for l6 in v2_all if l6.get("feasibility_score") is not None]
v2_with_score.sort(key=lambda x: float(x["feasibility_score"]) if isinstance(x["feasibility_score"], (int, float)) else float(str(x["feasibility_score"]).split('/')[0]), reverse=True)

print("\n\n" + "=" * 80)
print("  SAMPLE V2 EXPERIMENTS (Top 3 by feasibility)")
print("=" * 80)
for i, l6 in enumerate(v2_with_score[:3]):
    print_experiment(l6, i+1)

print("\n\n" + "=" * 80)
print("  SAMPLE V2 EXPERIMENTS (Bottom 3 by feasibility)")
print("=" * 80)
for i, l6 in enumerate(v2_with_score[-3:]):
    print_experiment(l6, i+1)


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

# Check for "conventional" experiments (postdoc test)
def is_conventional(l6):
    """Detect experiments that a postdoc could design without pipeline context"""
    title = (l6.get("title","") or "").lower()
    text = json.dumps(l6).lower()
    
    conventional_patterns = [
        'dose-response',
        'characterization of baseline',
        'expression analysis',
        'basic characterization',
        'measurement of',  # simple measurement
        'quantification of',  # simple quantification
    ]
    
    # Check if experiment references pipeline context (IH, L3, L4, S_M, FCC, SPV)
    has_context = bool(re.search(r'(IH_|Q_L3_|S_M_|FCC_|SPV_)', text))
    
    is_conv = any(p in title for p in conventional_patterns) and not has_context
    return is_conv

# Postdoc test - check for experiments referencing pipeline context
def count_pipeline_references(l6):
    text = json.dumps(l6)
    refs = {
        'IH_': len(re.findall(r'IH_', text)),
        'Q_L3_': len(re.findall(r'Q_L3_', text)),
        'S_M_': len(re.findall(r'S_M_', text)),
        'FCC_': len(re.findall(r'FCC_', text)),
        'SPV_': len(re.findall(r'SPV_', text)),
    }
    return sum(refs.values())

print("=" * 80)
print("  PIPELINE CONTEXT REFERENCES")
print("=" * 80)

for version_name, file_list in [("V2", V2_FILES), ("V3", V3_FILES)]:
    all_l6 = []
    for _, fpath in file_list:
        all_l6.extend(load_l6(fpath))
    
    ref_counts = [count_pipeline_references(l6) for l6 in all_l6]
    with_refs = sum(1 for c in ref_counts if c > 0)
    avg_refs = sum(ref_counts) / len(ref_counts) if ref_counts else 0
    
    print(f"\n  {version_name}:")
    print(f"    Experiments with pipeline context refs: {with_refs}/{len(all_l6)} ({100*with_refs/max(len(all_l6),1):.1f}%)")
    print(f"    Average pipeline refs per experiment: {avg_refs:.1f}")
    
    conv = sum(1 for l6 in all_l6 if is_conventional(l6))
    print(f"    Potentially conventional experiments: {conv}/{len(all_l6)}")

# Repetitive permutation analysis 
print("\n" + "=" * 80)
print("  REPETITIVE EXPERIMENT DETECTION")
print("=" * 80)

for version_name, file_list in [("V2", V2_FILES), ("V3", V3_FILES)]:
    print(f"\n  {version_name}:")
    for run_name, fpath in file_list:
        l6s = load_l6(fpath)
        titles = [l6.get("title", "") for l6 in l6s]
        
        # Check for similar titles (share >70% words)
        similar_pairs = []
        for i in range(len(titles)):
            for j in range(i+1, len(titles)):
                words_i = set(titles[i].lower().split())
                words_j = set(titles[j].lower().split())
                if not words_i or not words_j:
                    continue
                overlap = len(words_i & words_j) / min(len(words_i), len(words_j))
                if overlap > 0.65:
                    similar_pairs.append((i+1, j+1, titles[i][:60], titles[j][:60], f"{overlap:.0%}"))
        
        print(f"    [{run_name}] Similar title pairs (>65% word overlap): {len(similar_pairs)}")
        for p in similar_pairs[:5]:
            print(f"      #{p[0]} vs #{p[1]} ({p[4]}): '{p[2]}...' vs '{p[3]}...'")

# Verification note analysis for V3
print("\n" + "=" * 80)
print("  V3: VERIFICATION NOTE ANALYSIS")
print("=" * 80)
all_v3 = []
for _, fpath in V3_FILES:
    all_v3.extend(load_l6(fpath))

vn_themes = Counter()
for l6 in all_v3:
    vn = (l6.get("verification_note", "") or "").lower()
    if "removed" in vn and "e.g" in vn:
        vn_themes["Removed e.g."] += 1
    if "hedging" in vn:
        vn_themes["Removed hedging"] += 1
    if "catalog" in vn or "vendor" in vn:
        vn_themes["Added catalog/vendor"] += 1
    if "specificity" in vn or "specific" in vn:
        vn_themes["Added specificity"] += 1
    if "feasibility" in vn:
        vn_themes["Adjusted feasibility"] += 1
    if not vn:
        vn_themes["No verification note"] += 1

print("  Verification action frequencies:")
for theme, cnt in vn_themes.most_common():
    print(f"    {theme}: {cnt}")

# Discovery component analysis
print("\n" + "=" * 80)
print("  DISCOVERY COMPONENT ANALYSIS")
print("=" * 80)
for version_name, file_list in [("V2", V2_FILES), ("V3", V3_FILES)]:
    all_l6 = []
    for _, fpath in file_list:
        all_l6.extend(load_l6(fpath))
    
    discovery_true = sum(1 for l6 in all_l6 if l6.get("discovery_component") == True or str(l6.get("discovery_component","")).lower() == "true")
    discovery_false = sum(1 for l6 in all_l6 if l6.get("discovery_component") == False or str(l6.get("discovery_component","")).lower() == "false")
    discovery_other = len(all_l6) - discovery_true - discovery_false
    print(f"\n  {version_name}:")
    print(f"    discovery=True: {discovery_true}/{len(all_l6)} ({100*discovery_true/max(len(all_l6),1):.1f}%)")
    print(f"    discovery=False: {discovery_false}/{len(all_l6)} ({100*discovery_false/max(len(all_l6),1):.1f}%)")
    print(f"    discovery=other/missing: {discovery_other}/{len(all_l6)}")


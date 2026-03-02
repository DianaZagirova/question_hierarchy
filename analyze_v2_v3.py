import json
import re
import sys
from collections import Counter, defaultdict

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

def has_eg(text):
    """Check for 'e.g.' in text"""
    if not text:
        return False
    return bool(re.search(r'\be\.g\.', str(text), re.IGNORECASE))

def is_computational(l6):
    """Heuristic: check if experiment is computational/in-silico"""
    text = json.dumps(l6).lower()
    comp_keywords = ['in silico', 'computational', 'simulation', 'mathematical model', 
                     'bioinformatic', 'machine learning', 'deep learning', 'neural network model',
                     'monte carlo', 'molecular dynamics simulation', 'bayesian', 'algorithm']
    return any(kw in text for kw in comp_keywords)

def count_eg_in_simt(l6):
    """Count e.g. occurrences in SIMT fields"""
    simt = l6.get("simt_parameters", {})
    count = 0
    for field in ["system", "intervention", "meter", "threshold", "time"]:
        val = simt.get(field, "")
        if has_eg(val):
            count += 1
    return count

def classify_system(l6):
    """Classify experiment system type"""
    simt = l6.get("simt_parameters", {})
    sys_text = (simt.get("system", "") or "").lower()
    
    if any(kw in sys_text for kw in ['patient', 'human subject', 'participant', 'volunteer', 'clinical trial']):
        return "Human/Clinical"
    if any(kw in sys_text for kw in ['mouse', 'mice', 'rat', 'primate', 'marmoset', 'drosophila', 'c. elegans', 'zebrafish', 'killifish']):
        return "Animal Model"
    if any(kw in sys_text for kw in ['organoid', 'cerebral organoid', 'brain organoid', 'organ-on-chip']):
        return "Organoid"
    if any(kw in sys_text for kw in ['slice', 'explant', 'organotypic']):
        return "Tissue/Slice"
    if any(kw in sys_text for kw in ['primary neuron', 'primary culture', 'astrocyte', 'microglia culture', 'ipsc', 'ips cell', 'hek293', 'sh-sy5y', 'cell line', 'cell culture', 'fibroblast']):
        return "Cell Culture"
    if any(kw in sys_text for kw in ['in silico', 'computational', 'simulation', 'dataset', 'database', 'cohort data']):
        return "Computational"
    if any(kw in sys_text for kw in ['recombinant', 'purified protein', 'in vitro', 'cell-free']):
        return "Biochemical/In Vitro"
    return "Other/Unclear"

def has_catalog_number(text):
    """Check for specific catalog numbers"""
    if not text:
        return False
    # Match patterns like #12345, Cat#, Sigma L2630, Addgene #44351, etc
    return bool(re.search(r'(#\d{3,}|[Cc]at\.?\s*#?\s*\d{3,}|[A-Z]\d{4,}|Addgene|Jackson Labs|ATCC|Sigma\s+[A-Z]\d+|Thermo\s+Fisher|Abcam\s+ab\d+|Cell Signaling\s+#?\d+)', str(text)))

def has_specific_dose(text):
    """Check for specific doses"""
    if not text:
        return False
    return bool(re.search(r'\d+\s*(mg|ug|ng|µg|µM|nM|mM|µL|mL|mg/kg|µg/mL|ng/mL|IU)', str(text)))

def has_sample_size(text):
    """Check for specific sample sizes"""
    if not text:
        return False
    return bool(re.search(r'n\s*[=≥>]\s*\d+|n\d+\s*=|sample size|per group|per condition|\d+\s*(mice|rats|animals|subjects|slices|wells|replicates)', str(text), re.IGNORECASE))

def is_factorial(l6):
    """Check if experiment is multi-factorial"""
    text = json.dumps(l6).lower()
    factorial_keywords = ['factorial', 'multi-factorial', '2x2', '2×2', '3x2', '2x3', 'crossed design',
                          'interaction effect', 'two-way anova', 'multi-variable', 'combinatorial']
    return any(kw in text for kw in factorial_keywords)

def is_permutation_experiment(l6):
    """Heuristic to detect repetitive permutation experiments"""
    title = (l6.get("title", "") or "").lower()
    # Check for titles that just vary one parameter
    permutation_patterns = ['dose-response', 'concentration series', 'time-course only',
                            'titration', 'dose escalation']
    return any(p in title for p in permutation_patterns)

def analyze_runs(file_list, version_name):
    all_l6 = []
    per_run = {}
    
    for run_name, fpath in file_list:
        l6_list = load_l6(fpath)
        per_run[run_name] = l6_list
        all_l6.extend(l6_list)
    
    print(f"\n{'='*80}")
    print(f"  {version_name} ANALYSIS")
    print(f"{'='*80}")
    
    # 1. Total L6 per run
    print(f"\n--- 1. Total L6 Experiments per Run ---")
    for run_name, l6_list in per_run.items():
        print(f"  {run_name}: {len(l6_list)}")
    print(f"  TOTAL across all runs: {len(all_l6)}")
    
    # 2. e.g. in SIMT fields
    print(f"\n--- 2. 'e.g.' in SIMT Fields ---")
    eg_count = 0
    eg_field_counts = Counter()
    for l6 in all_l6:
        simt = l6.get("simt_parameters", {})
        for field in ["system", "intervention", "meter", "threshold", "time"]:
            val = simt.get(field, "")
            if has_eg(val):
                eg_count += 1
                eg_field_counts[field] += 1
    total_fields = len(all_l6) * 5
    print(f"  Total SIMT fields with 'e.g.': {eg_count}/{total_fields} ({100*eg_count/max(total_fields,1):.1f}%)")
    for field, cnt in eg_field_counts.most_common():
        print(f"    {field}: {cnt}/{len(all_l6)} ({100*cnt/max(len(all_l6),1):.1f}%)")
    
    # Also count L6 experiments that have ANY e.g.
    l6_with_eg = sum(1 for l6 in all_l6 if count_eg_in_simt(l6) > 0)
    print(f"  L6 experiments with at least one 'e.g.': {l6_with_eg}/{len(all_l6)} ({100*l6_with_eg/max(len(all_l6),1):.1f}%)")
    
    # 3. Computational experiments
    print(f"\n--- 3. Computational Experiments ---")
    comp_count = sum(1 for l6 in all_l6 if is_computational(l6))
    print(f"  Computational: {comp_count}/{len(all_l6)} ({100*comp_count/max(len(all_l6),1):.1f}%)")
    
    # 4. Missing feasibility_score
    print(f"\n--- 4. Missing feasibility_score ---")
    missing_feas = sum(1 for l6 in all_l6 if l6.get("feasibility_score") is None)
    print(f"  Missing: {missing_feas}/{len(all_l6)}")
    
    # 5. Missing if_null
    print(f"\n--- 5. Missing if_null ---")
    missing_ifnull = sum(1 for l6 in all_l6 if not l6.get("if_null"))
    print(f"  Missing: {missing_ifnull}/{len(all_l6)}")
    
    # 6 & 7. Feasibility score distribution
    print(f"\n--- 6 & 7. Feasibility Score Distribution ---")
    feas_scores = [l6.get("feasibility_score") for l6 in all_l6 if l6.get("feasibility_score") is not None]
    if feas_scores:
        # Handle both numeric and string scores
        numeric_scores = []
        for s in feas_scores:
            if isinstance(s, (int, float)):
                numeric_scores.append(float(s))
            elif isinstance(s, str):
                try:
                    numeric_scores.append(float(s.split('/')[0]))
                except:
                    pass
        
        if numeric_scores:
            print(f"  Mean: {sum(numeric_scores)/len(numeric_scores):.2f}")
            print(f"  Min: {min(numeric_scores)}, Max: {max(numeric_scores)}")
            print(f"  Range: {min(numeric_scores)} - {max(numeric_scores)}")
            # Histogram
            hist = Counter()
            for s in numeric_scores:
                bucket = int(s) if s == int(s) else round(s, 1)
                hist[bucket] += 1
            print(f"  Distribution:")
            for bucket in sorted(hist.keys()):
                bar = '#' * hist[bucket]
                print(f"    {bucket:>5}: {bar} ({hist[bucket]})")
    else:
        print(f"  No feasibility scores found")
    
    # 8. System diversity
    print(f"\n--- 8. System Diversity ---")
    sys_cats = Counter(classify_system(l6) for l6 in all_l6)
    for cat, cnt in sys_cats.most_common():
        print(f"  {cat}: {cnt} ({100*cnt/max(len(all_l6),1):.1f}%)")
    
    # 9. Genius scores (V3 only)
    print(f"\n--- 9. Genius Scores ---")
    genius_scores = [l6.get("genius_score") for l6 in all_l6 if l6.get("genius_score") is not None]
    if genius_scores:
        numeric_genius = []
        for s in genius_scores:
            if isinstance(s, (int, float)):
                numeric_genius.append(float(s))
            elif isinstance(s, str):
                try:
                    numeric_genius.append(float(s.split('/')[0]))
                except:
                    pass
        if numeric_genius:
            print(f"  Count with genius_score: {len(numeric_genius)}/{len(all_l6)}")
            print(f"  Mean: {sum(numeric_genius)/len(numeric_genius):.2f}")
            print(f"  Min: {min(numeric_genius)}, Max: {max(numeric_genius)}")
            hist_g = Counter()
            for s in numeric_genius:
                bucket = int(s) if s == int(s) else round(s, 1)
                hist_g[bucket] += 1
            print(f"  Distribution:")
            for bucket in sorted(hist_g.keys()):
                bar = '#' * hist_g[bucket]
                print(f"    {bucket:>5}: {bar} ({hist_g[bucket]})")
    else:
        print(f"  No genius scores found (expected for {version_name})")
    
    # Specificity metrics
    print(f"\n--- Specificity Metrics ---")
    cat_count = sum(1 for l6 in all_l6 if has_catalog_number(json.dumps(l6.get("simt_parameters", {}))))
    dose_count = sum(1 for l6 in all_l6 if has_specific_dose(json.dumps(l6.get("simt_parameters", {}))))
    sample_count = sum(1 for l6 in all_l6 if has_sample_size(json.dumps(l6.get("simt_parameters", {}))))
    factorial_count = sum(1 for l6 in all_l6 if is_factorial(l6))
    
    print(f"  With catalog numbers: {cat_count}/{len(all_l6)} ({100*cat_count/max(len(all_l6),1):.1f}%)")
    print(f"  With specific doses: {dose_count}/{len(all_l6)} ({100*dose_count/max(len(all_l6),1):.1f}%)")
    print(f"  With sample sizes: {sample_count}/{len(all_l6)} ({100*sample_count/max(len(all_l6),1):.1f}%)")
    print(f"  Factorial/multi-variable designs: {factorial_count}/{len(all_l6)} ({100*factorial_count/max(len(all_l6),1):.1f}%)")
    
    return all_l6, per_run

# Run analysis for both versions
v2_all, v2_per_run = analyze_runs(V2_FILES, "V2 (Baseline)")
v3_all, v3_per_run = analyze_runs(V3_FILES, "V3 (Genius Verification)")


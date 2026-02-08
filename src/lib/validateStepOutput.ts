/**
 * Lightweight response validation per step.
 * Each validator checks that the critical fields exist and have the right shape.
 * Returns { valid: true } or { valid: false, reason: string }.
 */

type ValidationResult = { valid: true } | { valid: false; reason: string };

function ok(): ValidationResult {
  return { valid: true };
}

function fail(reason: string): ValidationResult {
  return { valid: false, reason };
}

function isNonEmptyObject(v: any): boolean {
  return v && typeof v === 'object' && Object.keys(v).length > 0;
}


const validators: Record<number, (output: any) => ValidationResult> = {
  // Step 1: Goal Formalization — expect an object with Q0
  1: (o) => {
    if (!o) return fail('Empty output');
    if (typeof o === 'string') return ok(); // legacy string format
    if (o.Q0 || o.q0 || o.question) return ok();
    return fail('Missing Q0/question field');
  },

  // Step 2: Goal Pillars Synthesis — expect goals array + bridge_lexicon
  2: (o) => {
    if (!isNonEmptyObject(o)) return fail('Empty output');
    if (!Array.isArray(o.goals)) return fail('Missing "goals" array');
    if (o.goals.length === 0) return fail('"goals" array is empty');
    if (!o.bridge_lexicon) return fail('Missing "bridge_lexicon"');
    return ok();
  },

  // Step 3: Requirement Atomization — expect object keyed by goal ID, each value is an array
  3: (o) => {
    if (!isNonEmptyObject(o)) return fail('Empty output');
    const values = Object.values(o);
    if (values.length === 0) return fail('No goal entries in RA output');
    const hasArrays = values.some((v: any) => Array.isArray(v));
    if (!hasArrays) return fail('Goal entries should be arrays of RAs');
    return ok();
  },

  // Step 4: Reality Mapping — expect object keyed by goal ID with scientific_pillars
  4: (o) => {
    if (!isNonEmptyObject(o)) return fail('Empty output');
    const firstGoal: any = Object.values(o)[0];
    if (!firstGoal) return fail('No goal entries');
    if (!firstGoal.scientific_pillars && !firstGoal.domain_mapping) {
      return fail('Missing scientific_pillars or domain_mapping in goal entry');
    }
    return ok();
  },

  // Step 5: Skipped — always valid
  5: () => ok(),

  // Step 6: Frontier Question Generation — expect l3_questions array
  6: (o) => {
    if (!isNonEmptyObject(o)) return fail('Empty output');
    if (!Array.isArray(o.l3_questions)) return fail('Missing "l3_questions" array');
    return ok();
  },

  // Step 7: Divergent Hypothesis Instantiation — expect instantiation_hypotheses array
  7: (o) => {
    if (!isNonEmptyObject(o)) return fail('Empty output');
    if (!Array.isArray(o.instantiation_hypotheses)) return fail('Missing "instantiation_hypotheses" array');
    return ok();
  },

  // Step 8: Tactical Decomposition — expect l4_questions array
  8: (o) => {
    if (!isNonEmptyObject(o)) return fail('Empty output');
    if (!Array.isArray(o.l4_questions)) return fail('Missing "l4_questions" array');
    return ok();
  },

  // Step 9: Execution Drilldown — expect l6_tasks array (l5_nodes optional)
  9: (o) => {
    if (!isNonEmptyObject(o)) return fail('Empty output');
    if (!Array.isArray(o.l6_tasks)) return fail('Missing "l6_tasks" array');
    return ok();
  },

  // Step 10: Common Experiment Synthesis — expect common_l6_results array
  10: (o) => {
    if (!isNonEmptyObject(o)) return fail('Empty output');
    if (!Array.isArray(o.common_l6_results)) return fail('Missing "common_l6_results" array');
    return ok();
  },
};

/**
 * Validate a step's output. Returns { valid, reason? }.
 * Unknown step IDs pass by default.
 */
export function validateStepOutput(stepId: number, output: any): ValidationResult {
  const validator = validators[stepId];
  if (!validator) return ok();
  return validator(output);
}

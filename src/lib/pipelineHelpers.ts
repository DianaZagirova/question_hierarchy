/**
 * Shared helpers for pipeline step execution.
 * Extracted from App.tsx to reduce duplication.
 */

import { PipelineStep, AgentConfig } from '@/types';

/** Enrich a goal pillar with full SPV definitions from the bridge lexicon */
export function enrichGoalWithSPVs(goal: any, allSPVs: any[]): any {
  const enrichedGoal = { ...goal };
  if (enrichedGoal.bridge_tags?.system_properties_required) {
    enrichedGoal.bridge_tags.system_properties_required =
      enrichedGoal.bridge_tags.system_properties_required.map((sp: any) => {
        const spvDef = allSPVs.find((spv: any) => (spv.id || spv.ID) === sp.spv_id);
        return {
          ...sp,
          name: spvDef?.name,
          definition: spvDef?.definition,
        };
      });
  }
  return enrichedGoal;
}

/** Extract goals from Step 2 output, optionally filtering to a single goal */
export function extractGoals(
  steps: PipelineStep[],
  selectedGoalId: string | null
): { goals: any[]; error?: string } {
  const step2Output = steps[1]?.output;
  let goals = step2Output?.goals || [];

  if (selectedGoalId) {
    goals = goals.filter((g: any) => g.id === selectedGoalId);
    if (goals.length === 0) {
      return { goals: [], error: `Selected goal ${selectedGoalId} not found` };
    }
  }

  if (goals.length === 0) {
    return { goals: [], error: 'No Goal Pillars found from Step 2' };
  }

  return { goals };
}

/** Extract bridge lexicon SPVs from Step 2 output */
export function extractBridgeLexicon(steps: PipelineStep[]) {
  const step2Output = steps[1]?.output;
  const bridgeLexicon = step2Output?.bridge_lexicon || {};
  const allSPVs: any[] = bridgeLexicon.system_properties || [];
  return { bridgeLexicon, allSPVs };
}

/** Extract L3 questions from Step 6, optionally filtering to a single L3 */
export function extractL3Questions(
  steps: PipelineStep[],
  selectedL3Id: string | null
): { l3Questions: any[]; error?: string } {
  const step6Output = steps[5]?.output;
  let l3Questions = step6Output?.l3_questions || step6Output?.seed_questions || [];

  if (selectedL3Id) {
    l3Questions = l3Questions.filter((l3: any) => l3.id === selectedL3Id);
    if (l3Questions.length === 0) {
      return { l3Questions: [], error: `Selected L3 ${selectedL3Id} not found` };
    }
  }

  if (l3Questions.length === 0) {
    return { l3Questions: [], error: 'No L3 questions found from Step 6' };
  }

  return { l3Questions };
}

/** Extract L4 questions from Step 8, optionally filtering to a single L4 */
export function extractL4Questions(
  steps: PipelineStep[],
  selectedL4Id: string | null
): { l4Questions: any[]; error?: string } {
  const step8Output = steps[7]?.output;
  let l4Questions = step8Output?.l4_questions || [];

  if (selectedL4Id) {
    l4Questions = l4Questions.filter((l4: any) => l4.id === selectedL4Id);
    if (l4Questions.length === 0) {
      return { l4Questions: [], error: `Selected L4 ${selectedL4Id} not found` };
    }
  }

  if (l4Questions.length === 0) {
    return { l4Questions: [], error: 'No L4 questions found from Step 8' };
  }

  return { l4Questions };
}

/** Create a minimal goal object for API payloads (reduces token usage) */
export function minimalGoal(goal: any) {
  return {
    id: goal.id,
    title: goal.title,
    catastrophe_primary: goal.catastrophe_primary,
    bridge_tags: goal.bridge_tags,
  };
}

/** Create minimal RA objects for API payloads */
export function minimalRAs(ras: any[]) {
  return ras.map((ra: any) => ({
    ra_id: ra.ra_id,
    atom_title: ra.atom_title,
    requirement_statement: ra.requirement_statement,
  }));
}

/** Truncate Q0 text to reduce API payload size */
export function truncateQ0(steps: PipelineStep[], maxLen = 1500): string {
  const q0Text = steps[0]?.output?.Q0 || '';
  return q0Text.length > maxLen ? q0Text.substring(0, maxLen) + '...[truncated]' : q0Text;
}

/** Filter bridge lexicon SPVs to only those referenced by a goal */
export function filterSPVsForGoal(goal: any, allSPVs: any[]) {
  const relevantIds = (goal.bridge_tags?.system_properties_required || []).map(
    (sp: any) => sp.spv_id
  );
  return {
    system_properties: allSPVs.filter((spv: any) =>
      relevantIds.includes(spv.id || spv.ID)
    ),
  };
}

/** Find an agent by ID, returning null if not found */
export function findAgent(agents: AgentConfig[], agentId: string): AgentConfig | null {
  return agents.find((a) => a.id === agentId) || null;
}

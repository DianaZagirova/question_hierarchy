/**
 * Step 8: Tactical Decomposition — batch process L3 questions into L4 tactical questions.
 */

import { PipelineStep, AgentConfig } from '@/types';
import { executeStepBatch } from '@/lib/api';
import { extractL3Questions, extractBridgeLexicon, enrichGoalWithSPVs, extractStep4ForGoal, fullQ0 } from '@/lib/pipelineHelpers';
import { createLogger } from '@/lib/logger';

const log = createLogger('Step8');

export async function runStep8(
  agent: AgentConfig,
  steps: PipelineStep[],
  currentGoal: string,
  selectedL3Id: string | null,
  signal: AbortSignal,
  globalLens: string
): Promise<any> {
  const { l3Questions, error } = extractL3Questions(steps, selectedL3Id);
  if (error) throw new Error(error);

  const step2Output = steps[1]?.output;
  const goals = step2Output?.goals || [];
  const { allSPVs } = extractBridgeLexicon(steps);

  const step3Output = steps[2]?.output; // RAs keyed by goal ID
  const step7Output = steps[6]?.output; // IHs from step 7
  const allIHs = step7Output?.instantiation_hypotheses || [];

  log.info(`Processing ${l3Questions.length} L3 question(s) for L4 generation`);

  const items = l3Questions.map((l3q: any) => {
    const parentGoalId = l3q.parent_goal_id || l3q.target_goal_id;
    const l3Id = l3q.id;
    const parentGoal = goals.find((g: any) => g.id === parentGoalId);
    const enrichedParentGoal = parentGoal ? enrichGoalWithSPVs(parentGoal, allSPVs) : null;
    const goalStep4Data = parentGoalId ? extractStep4ForGoal(steps, parentGoalId) : null;
    // Filter IHs to only those belonging to this L3 question
    const l3IHs = allIHs.filter((ih: any) => ih.parent_l3_id === l3Id || ih.l3_question_id === l3Id);
    return {
      Q0_reference: fullQ0(steps),
      l3_question: l3q,
      parent_goal: enrichedParentGoal,
      step3: parentGoalId ? (step3Output?.[parentGoalId] || []) : [],
      step7: { instantiation_hypotheses: l3IHs },
      step5: parentGoalId && goalStep4Data ? { [parentGoalId]: goalStep4Data } : steps[4]?.output,
      goal: currentGoal,
    };
  });

  const batchResult = await executeStepBatch(8, agent, items, signal, globalLens);

  const allL4Questions: any[] = [];
  batchResult.batch_results.forEach((result: any) => {
    if (result.success && result.data) {
      const l4s = result.data.l4_questions || result.data.child_nodes_L4 || [];
      // Use item_index to find the corresponding input item
      const itemIdx = result.item_index !== undefined ? result.item_index : 0;
      const inputItem = items[itemIdx];
      const parentL3Id = inputItem?.l3_question?.id;
      const parentGoalId = inputItem?.parent_goal?.id;

      // Enrich each L4 question with parent relationship metadata
      const enrichedL4s = l4s.map((l4: any) => ({
        ...l4,
        parent_l3_id: parentL3Id,
        parent_goal_id: parentGoalId,
      }));

      allL4Questions.push(...enrichedL4s);
    }
  });

  log.info(`Generated ${allL4Questions.length} L4 tactical questions`);

  return {
    l4_questions: allL4Questions,
    batch_summary: {
      l3_processed: l3Questions.length,
      l4_generated: allL4Questions.length,
      successful: batchResult.successful,
      failed: batchResult.failed,
    },
  };
}

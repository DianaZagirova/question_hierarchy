/**
 * Step 8: Tactical Decomposition — batch process L3 questions into L4 tactical questions.
 */

import { PipelineStep, AgentConfig } from '@/types';
import { executeStepBatch } from '@/lib/api';
import { extractL3Questions, extractBridgeLexicon, enrichGoalWithSPVs } from '@/lib/pipelineHelpers';
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

  log.info(`Processing ${l3Questions.length} L3 question(s) for L4 generation`);

  const items = l3Questions.map((l3q: any) => {
    const parentGoal = goals.find((g: any) => g.id === l3q.parent_goal_id);
    const enrichedParentGoal = parentGoal ? enrichGoalWithSPVs(parentGoal, allSPVs) : null;
    return {
      l3_question: l3q,
      parent_goal: enrichedParentGoal,
      step3: steps[2]?.output,
      step7: steps[6]?.output,
      step5: steps[4]?.output,
      goal: currentGoal,
    };
  });

  const batchResult = await executeStepBatch(8, agent, items, signal, globalLens);

  const allL4Questions: any[] = [];
  batchResult.batch_results.forEach((result: any) => {
    if (result.success && result.data) {
      const l4s = result.data.l4_questions || result.data.child_nodes_L4 || [];
      allL4Questions.push(...l4s);
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

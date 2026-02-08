/**
 * Step 7: Divergent Hypothesis Instantiation — batch process L3 questions into IHs.
 */

import { PipelineStep, AgentConfig } from '@/types';
import { executeStepBatch } from '@/lib/api';
import { extractL3Questions, extractBridgeLexicon, enrichGoalWithSPVs } from '@/lib/pipelineHelpers';
import { createLogger } from '@/lib/logger';

const log = createLogger('Step7');

export async function runStep7(
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

  log.info(`Processing ${l3Questions.length} L3 question(s) for IH generation`);

  const items = l3Questions.map((l3q: any) => {
    const parentGoal = goals.find((g: any) => g.id === l3q.parent_goal_id);
    const enrichedParentGoal = parentGoal ? enrichGoalWithSPVs(parentGoal, allSPVs) : null;
    return {
      l3_question: l3q,
      parent_goal: enrichedParentGoal,
      step3: steps[2]?.output,
      step5: steps[4]?.output,
      goal: currentGoal,
    };
  });

  const batchResult = await executeStepBatch(7, agent, items, signal, globalLens);

  const allIHs: any[] = [];
  batchResult.batch_results.forEach((result: any) => {
    if (result.success && result.data) {
      const ihs = result.data.instantiation_hypotheses || result.data.IHs || [];
      allIHs.push(...(Array.isArray(ihs) ? ihs : [ihs]));
    }
  });

  log.info(`Generated ${allIHs.length} instantiation hypotheses`);

  return {
    instantiation_hypotheses: allIHs,
    batch_summary: {
      l3_processed: l3Questions.length,
      ih_generated: allIHs.length,
      successful: batchResult.successful,
      failed: batchResult.failed,
    },
  };
}

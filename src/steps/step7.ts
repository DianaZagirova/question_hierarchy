/**
 * Step 7: Divergent Hypothesis Instantiation — batch process L3 questions into IHs.
 */

import { PipelineStep, AgentConfig } from '@/types';
import { executeStepBatch } from '@/lib/api';
import { extractL3Questions, extractBridgeLexicon, enrichGoalWithSPVs, extractSNodesForGoal, fullQ0 } from '@/lib/pipelineHelpers';
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
  const { bridgeLexicon, allSPVs } = extractBridgeLexicon(steps);

  const step3Output = steps[2]?.output; // RAs keyed by goal ID

  log.info(`Processing ${l3Questions.length} L3 question(s) for IH generation`);

  const items = l3Questions.map((l3q: any) => {
    const parentGoalId = l3q.parent_goal_id || l3q.target_goal_id;
    const parentGoal = goals.find((g: any) => g.id === parentGoalId);
    const enrichedParentGoal = parentGoal ? enrichGoalWithSPVs(parentGoal, allSPVs) : null;
    // Only pass scientific_pillars, not full step4 data (domain_mapping, raw_domain_scans)
    const sNodes = parentGoalId ? extractSNodesForGoal(steps, parentGoalId) : [];
    return {
      Q0_reference: fullQ0(steps),
      l3_question: l3q,
      parent_goal: enrichedParentGoal,
      step3: parentGoalId ? (step3Output?.[parentGoalId] || []) : [],
      bridge_lexicon: bridgeLexicon,
      step5: parentGoalId ? { [parentGoalId]: { scientific_pillars: sNodes } } : {},
      goal: currentGoal,
    };
  });

  const batchResult = await executeStepBatch(7, agent, items, signal, globalLens);

  if (batchResult.error) {
    throw new Error(batchResult.error || 'Batch execution failed');
  }

  const allIHs: any[] = [];
  (batchResult.batch_results || []).forEach((result: any) => {
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

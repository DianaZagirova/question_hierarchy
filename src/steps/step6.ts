/**
 * Step 6: Frontier Question Generation — batch process Goals into L3 questions.
 */

import { PipelineStep, AgentConfig } from '@/types';
import { executeStepBatch } from '@/lib/api';
import { extractGoals, extractBridgeLexicon, enrichGoalWithSPVs } from '@/lib/pipelineHelpers';
import { createLogger } from '@/lib/logger';

const log = createLogger('Step6');

export async function runStep6(
  agent: AgentConfig,
  steps: PipelineStep[],
  currentGoal: string,
  selectedGoalId: string | null,
  signal: AbortSignal,
  globalLens: string
): Promise<any> {
  const { goals, error } = extractGoals(steps, selectedGoalId);
  if (error) throw new Error(error);

  const { allSPVs } = extractBridgeLexicon(steps);

  log.info(`Processing ${goals.length} goal(s) for L3 question generation`);

  const step2Data = steps[1]?.output;
  const step3Data = steps[2]?.output;
  const step4Data = steps[3]?.output;

  const items = goals.map((goal: any) => {
    const enrichedGoal = enrichGoalWithSPVs(goal, allSPVs);
    return {
      goal_pillar: enrichedGoal,
      step2: step2Data,
      step3: step3Data,
      step4: step4Data,
      step5: step4Data, // Pass Step 4 as Step 5 since Judge is skipped
      goal: currentGoal,
    };
  });

  const batchResult = await executeStepBatch(6, agent, items, signal, globalLens);

  // Aggregate all L3 questions
  const existingL3s = selectedGoalId ? (steps[5]?.output?.l3_questions || []) : [];
  const allL3Questions: any[] = [...existingL3s];

  batchResult.batch_results.forEach((result: any) => {
    if (result.success && result.data) {
      const l3s = result.data.l3_questions || result.data.seed_questions || [];
      const targetGoalId = result.data.target_goal_id;

      // Add target_goal_id to each L3 question for graph visualization
      l3s.forEach((l3: any) => {
        if (targetGoalId && !l3.target_goal_id) {
          l3.target_goal_id = targetGoalId;
        }
      });

      allL3Questions.push(...l3s);
    } else {
      log.warn('Batch item failed:', result.error);
    }
  });

  log.info(`Generated ${allL3Questions.length} total L3 questions`);

  const existingSummary = selectedGoalId ? (steps[5]?.output?.batch_summary || {}) : {};
  return {
    l3_questions: allL3Questions,
    batch_summary: {
      goals_processed: (existingSummary.goals_processed || 0) + goals.length,
      l3_generated: allL3Questions.length,
      successful: (existingSummary.successful || 0) + batchResult.successful,
      failed: (existingSummary.failed || 0) + batchResult.failed,
    },
  };
}

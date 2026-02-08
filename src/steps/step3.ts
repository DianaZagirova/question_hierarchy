/**
 * Step 3: Requirement Atomization — batch process Goal Pillars into RAs.
 */

import { PipelineStep, AgentConfig } from '@/types';
import { executeStepBatch } from '@/lib/api';
import { extractGoals } from '@/lib/pipelineHelpers';
import { createLogger } from '@/lib/logger';

const log = createLogger('Step3');

export async function runStep3(
  agent: AgentConfig,
  steps: PipelineStep[],
  currentGoal: string,
  selectedGoalId: string | null,
  signal: AbortSignal,
  globalLens: string
): Promise<any> {
  const { goals, error } = extractGoals(steps, selectedGoalId);
  if (error) throw new Error(error);

  log.info(`Processing ${goals.length} goal(s) for Requirement Atomization`);

  const bridgeLexicon = steps[1]?.output?.bridge_lexicon || {};
  const items = goals.map((goal: any) => ({
    goal_pillar: goal,
    step1: steps[0]?.output,
    step2: { bridge_lexicon: bridgeLexicon },
    goal: currentGoal,
  }));

  const batchResult = await executeStepBatch(3, agent, items, signal, globalLens);

  // Aggregate results by goal ID
  const rasByGoal: Record<string, any[]> = selectedGoalId ? (steps[2]?.output || {}) : {};
  batchResult.batch_results.forEach((result: any, idx: number) => {
    if (result.success && result.data) {
      const goalId = goals[idx].id;
      const ras = result.data.requirement_atoms || result.data.RAs || [];
      rasByGoal[goalId] = Array.isArray(ras) ? ras : [ras];
    }
  });

  log.info(`Generated RAs for ${Object.keys(rasByGoal).length} goals`);
  return rasByGoal;
}

/**
 * Step 10: Common Experiment Synthesis — per L4 branch, try to unify L6 tasks.
 */

import { PipelineStep, AgentConfig } from '@/types';
import { executeStepBatch } from '@/lib/api';
import { createLogger } from '@/lib/logger';

const log = createLogger('Step10');

export async function runStep10(
  agent: AgentConfig,
  steps: PipelineStep[],
  currentGoal: string,
  signal: AbortSignal,
  globalLens: string
): Promise<any> {
  const step1Output = steps[0]?.output;
  const step8Output = steps[7]?.output;
  const step9Output = steps[8]?.output;

  // Get Q0 text
  let q0Text = '';
  if (step1Output) {
    if (typeof step1Output === 'string') q0Text = step1Output;
    else q0Text = step1Output.Q0 || step1Output.q0 || step1Output.question || '';
  }

  const l4Questions = step8Output?.l4_questions || [];
  const allL6Tasks = step9Output?.l6_tasks || [];

  if (l4Questions.length === 0) throw new Error('No L4 questions found from Step 8');
  if (allL6Tasks.length === 0) throw new Error('No L6 tasks found from Step 9');

  log.info(`Processing ${l4Questions.length} L4 branches for common experiment synthesis`);

  // Build batch items: one per L4, with all its L6 tasks
  const items = l4Questions
    .map((l4q: any) => {
      const l4Id = l4q.id;
      const l6ForThisL4 = allL6Tasks.filter((t: any) => t.parent_l4_id === l4Id);

      return {
        q0: q0Text,
        l4_question: l4q,
        l6_tasks: l6ForThisL4.map((t: any) => ({
          id: t.id,
          title: t.title,
          type: t.type,
          parent_l5_id: t.parent_l5_id,
          simt_parameters: t.simt_parameters,
          expected_impact: t.expected_impact,
        })),
        l6_count: l6ForThisL4.length,
        goal: currentGoal,
      };
    })
    .filter((item: any) => item.l6_count > 0);

  if (items.length === 0) throw new Error('No L4 branches have L6 tasks to synthesize');

  log.info(`Sending ${items.length} L4 branches to Convergence Critic`);

  const batchResult = await executeStepBatch(10, agent, items, signal, globalLens);

  const commonL6Results: any[] = [];
  batchResult.batch_results.forEach((result: any) => {
    if (result.success && result.data) {
      commonL6Results.push(result.data);
    }
  });

  const feasibleCount = commonL6Results.filter((r: any) => r.feasible).length;
  const notFeasibleCount = commonL6Results.filter((r: any) => !r.feasible).length;

  log.info(`Step 10 complete: ${feasibleCount} feasible, ${notFeasibleCount} not feasible`);

  return {
    common_l6_results: commonL6Results,
    batch_summary: {
      l4_processed: items.length,
      feasible: feasibleCount,
      not_feasible: notFeasibleCount,
      successful: batchResult.successful,
      failed: batchResult.failed,
    },
  };
}

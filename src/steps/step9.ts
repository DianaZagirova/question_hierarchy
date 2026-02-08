/**
 * Step 9: Execution Drilldown — batch process L4 questions into L5/L6 tasks.
 */

import { PipelineStep, AgentConfig } from '@/types';
import { executeStepBatch } from '@/lib/api';
import { extractL4Questions } from '@/lib/pipelineHelpers';
import { createLogger } from '@/lib/logger';

const log = createLogger('Step9');

export async function runStep9(
  agent: AgentConfig,
  steps: PipelineStep[],
  currentGoal: string,
  selectedL4Id: string | null,
  signal: AbortSignal,
  globalLens: string
): Promise<any> {
  const { l4Questions, error } = extractL4Questions(steps, selectedL4Id);
  if (error) throw new Error(error);

  log.info(`Processing ${l4Questions.length} L4 question(s) for L5/L6 drilldown`);

  const items = l4Questions.map((l4q: any) => ({
    l4_question: l4q,
    step3: steps[2]?.output,
    step5: steps[4]?.output,
    goal: currentGoal,
  }));

  const batchResult = await executeStepBatch(9, agent, items, signal, globalLens);

  // Aggregate results — preserve L5 and L6 hierarchy
  const allL5Nodes: any[] = [];
  const allL6Tasks: any[] = [];

  batchResult.batch_results.forEach((result: any) => {
    if (result.success && result.data) {
      // Hierarchical format (drill_branches with L5 nodes)
      if (result.data.drill_branches && Array.isArray(result.data.drill_branches)) {
        result.data.drill_branches.forEach((branch: any) => {
          allL5Nodes.push({
            id: branch.id,
            type: branch.type,
            text: branch.text,
            rationale: branch.rationale,
            parent_l4_id: result.data.l4_reference_id,
          });

          (branch.leaf_specs || []).forEach((task: any) => {
            allL6Tasks.push({
              ...task,
              parent_l5_id: branch.id,
              parent_l4_id: result.data.l4_reference_id,
            });
          });
        });
      }
      // Fallback: flat L6 tasks (legacy format)
      else if (result.data.l6_tasks) {
        const l6s = Array.isArray(result.data.l6_tasks) ? result.data.l6_tasks : [];
        allL6Tasks.push(...l6s);
      }
    }
  });

  log.info(`Generated ${allL5Nodes.length} L5 nodes and ${allL6Tasks.length} L6 tasks`);

  return {
    l5_nodes: allL5Nodes,
    l6_tasks: allL6Tasks,
    batch_summary: {
      l4_processed: l4Questions.length,
      l5_generated: allL5Nodes.length,
      l6_generated: allL6Tasks.length,
      successful: batchResult.successful,
      failed: batchResult.failed,
    },
  };
}

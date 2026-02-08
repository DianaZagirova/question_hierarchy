/**
 * Step 6: Frontier Question Generation — batch process Goals into L3 questions.
 */

import { PipelineStep, AgentConfig } from '@/types';
import { executeStepBatch } from '@/lib/api';
import { extractGoals, extractBridgeLexicon, enrichGoalWithSPVs, extractStep4ForGoal, extractSNodesForGoal, fullQ0 } from '@/lib/pipelineHelpers';
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
  const step3Output = steps[2]?.output; // RAs keyed by goal ID: { M_G1: [...], M_G2: [...] }

  // Filter out goals that have no S-nodes from Step 4
  const goalsWithSNodes = goals.filter((goal: any) => {
    const sNodes = extractSNodesForGoal(steps, goal.id);
    if (sNodes.length === 0) {
      log.warn(`Skipping goal ${goal.id} — no scientific pillars (S-nodes) found from Step 4`);
      return false;
    }
    return true;
  });

  if (goalsWithSNodes.length === 0) {
    throw new Error('No goals have scientific pillars (S-nodes) from Step 4. Run Step 4 first.');
  }

  if (goalsWithSNodes.length < goals.length) {
    log.warn(`${goals.length - goalsWithSNodes.length} goal(s) skipped due to missing S-nodes`);
  }

  const items = goalsWithSNodes.map((goal: any) => {
    const enrichedGoal = enrichGoalWithSPVs(goal, allSPVs);
    // Pass only this goal's Step 4 data — not S-nodes from other goals
    const goalStep4Data = extractStep4ForGoal(steps, goal.id);
    return {
      Q0_reference: fullQ0(steps),
      goal_pillar: enrichedGoal,
      step2: step2Data,
      step3: step3Output?.[goal.id] || [], // Only this goal's RAs
      step4: { [goal.id]: goalStep4Data },
      step5: { [goal.id]: goalStep4Data }, // Pass Step 4 as Step 5 since Judge is skipped
      goal: currentGoal,
    };
  });

  const batchResult = await executeStepBatch(6, agent, items, signal, globalLens);

  // Aggregate all L3 questions and per-goal analysis data
  const existingL3s = selectedGoalId ? (steps[5]?.output?.l3_questions || []) : [];
  const existingAnalysis = selectedGoalId ? (steps[5]?.output?.goal_analyses || {}) : {};
  const allL3Questions: any[] = [...existingL3s];
  const goalAnalyses: Record<string, any> = { ...existingAnalysis };

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

      // Preserve per-goal analysis data (strategic_assessment, bridge_alignment, etc.)
      if (targetGoalId) {
        goalAnalyses[targetGoalId] = {
          target_goal_title: result.data.target_goal_title,
          cluster_status: result.data.cluster_status,
          strategic_assessment: result.data.strategic_assessment,
          bridge_alignment: result.data.bridge_alignment,
        };
      }
    } else {
      log.warn('Batch item failed:', result.error);
    }
  });

  log.info(`Generated ${allL3Questions.length} total L3 questions`);

  const existingSummary = selectedGoalId ? (steps[5]?.output?.batch_summary || {}) : {};
  return {
    l3_questions: allL3Questions,
    goal_analyses: goalAnalyses,
    batch_summary: {
      goals_processed: (existingSummary.goals_processed || 0) + goals.length,
      l3_generated: allL3Questions.length,
      successful: (existingSummary.successful || 0) + batchResult.successful,
      failed: (existingSummary.failed || 0) + batchResult.failed,
    },
  };
}

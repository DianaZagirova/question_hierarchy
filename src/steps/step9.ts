/**
 * Step 9: Execution Drilldown — batch process L4 questions into L5/L6 tasks.
 */

import { PipelineStep, AgentConfig } from '@/types';
import { executeStepBatch } from '@/lib/api';
import { extractL4Questions, extractSNodesForGoal, fullQ0 } from '@/lib/pipelineHelpers';
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

  const step3Output = steps[2]?.output; // RAs keyed by goal ID
  const step6Output = steps[5]?.output; // L3 questions
  const allL3s = step6Output?.l3_questions || step6Output?.seed_questions || [];
  const step7Output = steps[6]?.output; // IHs from Step 7
  const allIHs = step7Output?.instantiation_hypotheses || [];
  const step2Output = steps[1]?.output;
  const goals = step2Output?.goals || [];
  const bridgeLexicon = step2Output?.bridge_lexicon || {};

  log.info(`Processing ${l4Questions.length} L4 question(s) for L5/L6 drilldown`);

  const items = l4Questions.map((l4q: any) => {
    // Trace parent: L4 -> parent L3 -> parent Goal
    const parentL3Id = l4q.parent_l3_id || l4q.l3_question_id;
    const parentL3 = allL3s.find((l3: any) => l3.id === parentL3Id);
    const parentGoalId = parentL3?.parent_goal_id || parentL3?.target_goal_id || l4q.parent_goal_id;
    const parentGoal = goals.find((g: any) => g.id === parentGoalId);

    // IHs for this L4's parent L3 — compressed to essential fields
    const l3IHs = allIHs
      .filter((ih: any) => ih.parent_l3_id === parentL3Id || ih.l3_question_id === parentL3Id)
      .map((ih: any) => ({
        ih_id: ih.ih_id,
        process_hypothesis: ih.process_hypothesis,
        discriminating_prediction: ih.discriminating_prediction,
        target_spv: ih.target_spv,
      }));

    // S-node context — structured objects matching backend expectation (top 10)
    const sNodes = parentGoalId ? extractSNodesForGoal(steps, parentGoalId) : [];
    const scientificContext = sNodes.slice(0, 10).map((s: any) => ({
      id: s.id,
      title: s.title,
      mechanism: (s.mechanism || '').substring(0, 120),
      readiness_level: s.readiness_level || '',
    }));

    // Filter SPVs for this goal
    const allSPVs = bridgeLexicon.system_properties || [];
    const requiredSPVIds = (parentGoal?.bridge_tags?.system_properties_required || []).map(
      (sp: any) => sp.spv_id
    );
    const filteredSPVs = requiredSPVIds.length > 0
      ? allSPVs.filter((spv: any) => requiredSPVIds.includes(spv.id || spv.ID))
      : allSPVs.slice(0, 5);

    return {
      Q0_reference: fullQ0(steps),
      l4_question: l4q,
      parent_l3_question: parentL3 ? { id: parentL3.id, text: parentL3.text } : null,
      instantiation_hypotheses: l3IHs,
      parent_goal_title: parentGoal?.title || '',
      scientific_context: scientificContext,
      bridge_lexicon: { system_properties: filteredSPVs },
      step3: parentGoalId ? (step3Output?.[parentGoalId] || []) : [],
      goal: currentGoal,
    };
  });

  const batchResult = await executeStepBatch(9, agent, items, signal, globalLens);

  // Handle error response
  if (batchResult.error) {
    throw new Error(batchResult.error || 'Batch execution failed');
  }

  // Aggregate results — preserve L5 and L6 hierarchy
  const allL5Nodes: any[] = [];
  const allL6Tasks: any[] = [];

  (batchResult.batch_results || []).forEach((result: any) => {
    if (result.success && result.data) {
      let data = result.data;

      // Recover from raw_response if JSON parse failed server-side
      if (data.raw_response && !data.drill_branches) {
        log.warn('Attempting recovery from raw_response');
        try {
          let text = data.raw_response.trim();
          if (text.includes('```json')) {
            text = text.split('```json')[1].split('```')[0].trim();
          } else if (text.includes('```')) {
            text = text.split('```')[1].split('```')[0].trim();
          }
          // Remove trailing commas before ] or }
          text = text.replace(/,(\s*[}\]])/g, '$1');
          // Fix truncated JSON
          const openBraces = (text.match(/{/g) || []).length - (text.match(/}/g) || []).length;
          const openBrackets = (text.match(/\[/g) || []).length - (text.match(/]/g) || []).length;
          if (openBraces > 0) text += '}'.repeat(openBraces);
          if (openBrackets > 0) text += ']'.repeat(openBrackets);
          data = JSON.parse(text);
          log.info('Recovery from raw_response successful');
        } catch (e) {
          log.error('Recovery from raw_response failed:', e);
        }
      }

      // Hierarchical format (drill_branches with L5 nodes)
      if (data.drill_branches && Array.isArray(data.drill_branches)) {
        data.drill_branches.forEach((branch: any) => {
          allL5Nodes.push({
            id: branch.id,
            type: branch.type,
            text: branch.text,
            rationale: branch.rationale,
            parent_l4_id: data.l4_reference_id,
          });

          (branch.leaf_specs || []).forEach((task: any) => {
            // Normalize SIMT keys
            if (task.simt_parameters) {
              const simt = task.simt_parameters;
              if (simt.measurement && !simt.meter) { simt.meter = simt.measurement; delete simt.measurement; }
              if (simt.measure && !simt.meter) { simt.meter = simt.measure; delete simt.measure; }
              if (simt.target && !simt.threshold_time) { simt.threshold_time = simt.target; delete simt.target; }
              if (simt.threshold && !simt.threshold_time) { simt.threshold_time = simt.threshold; delete simt.threshold; }
            }

            allL6Tasks.push({
              ...task,
              parent_l5_id: branch.id,
              parent_l4_id: data.l4_reference_id,
            });
          });
        });
      }
      // Fallback: flat L6 tasks (legacy format)
      else if (data.l6_tasks) {
        const l6s = Array.isArray(data.l6_tasks) ? data.l6_tasks : [];
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

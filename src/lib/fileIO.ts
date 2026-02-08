/**
 * File import/export utilities for pipeline data.
 * Extracted from App.tsx.
 */

import { PipelineStep, AgentConfig } from '@/types';
import { enrichGoalWithSPVs } from './pipelineHelpers';
import { createLogger } from './logger';

const log = createLogger('FileIO');

/** Download a JSON blob as a file */
function downloadJSON(data: any, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Load a complete pipeline JSON file and apply it to the store */
export function loadPipelineJSON(
  file: File,
  callbacks: {
    setGoal: (goal: string) => void;
    updateStepStatus: (stepId: number, status: any, output?: any, error?: string) => void;
    clearSelections: () => void;
  }
) {
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const json = JSON.parse(event.target?.result as string);

      // Validate structure
      const validationErrors: string[] = [];
      if (!json.goal || typeof json.goal !== 'string') {
        validationErrors.push('Missing or invalid "goal" field');
      }
      if (!json.steps || !Array.isArray(json.steps)) {
        validationErrors.push('Missing or invalid "steps" array');
      }
      if (validationErrors.length > 0) {
        alert('Invalid pipeline JSON:\n' + validationErrors.join('\n'));
        return;
      }

      // Validate each step
      const stepErrors = json.steps
        .map((step: any, idx: number) => {
          const errors: string[] = [];
          if (!step.id) errors.push(`Step ${idx}: missing id`);
          if (!step.name) errors.push(`Step ${idx}: missing name`);
          if (
            step.status &&
            !['pending', 'running', 'completed', 'error', 'skipped'].includes(step.status)
          ) {
            errors.push(`Step ${idx}: invalid status "${step.status}"`);
          }
          return errors;
        })
        .flat();

      if (stepErrors.length > 0) {
        alert('Step validation errors:\n' + stepErrors.join('\n'));
        return;
      }

      // Apply
      callbacks.setGoal(json.goal);
      json.steps.forEach((loadedStep: any) => {
        callbacks.updateStepStatus(
          loadedStep.id,
          loadedStep.status || 'pending',
          loadedStep.output || null,
          loadedStep.error || undefined
        );
      });
      callbacks.clearSelections();

      const completedCount = json.steps.filter((s: any) => s.status === 'completed').length;
      alert(`Successfully loaded pipeline: "${json.goal}"\n${completedCount} completed steps`);
      log.info(`Loaded pipeline with ${completedCount} completed steps`);
    } catch (error) {
      alert('Error parsing JSON: ' + (error as Error).message);
    }
  };
  reader.readAsText(file);
}

/** Save current pipeline state to a JSON file */
export function saveToFile(
  currentGoal: string,
  steps: PipelineStep[],
  agents: AgentConfig[]
) {
  const data = {
    goal: currentGoal,
    timestamp: new Date().toISOString(),
    steps: steps.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      output: s.output,
      timestamp: s.timestamp,
    })),
    agents,
  };
  downloadJSON(data, `omega-point-${Date.now()}.json`);
  log.info('Pipeline saved to file');
}

/** Save inputs and outputs for verification/debugging */
export function saveInputsOutputs(
  currentGoal: string,
  steps: PipelineStep[],
  selectedGoalId: string | null
) {
  const checkData: any = {
    timestamp: new Date().toISOString(),
    goal: currentGoal,
    steps: {},
  };

  steps.forEach((step) => {
    if (!step.output) return;

    const stepData: any = {
      id: step.id,
      name: step.name,
      status: step.status,
      output: step.output,
    };

    if (step.id === 1) {
      stepData.input = currentGoal;
    } else if (step.id === 2) {
      stepData.input = { goal: currentGoal, step1: steps[0]?.output };
    } else if (step.id === 3) {
      const step2Output = steps[1]?.output;
      const goals = step2Output?.goals || [];
      const bridgeLexicon = step2Output?.bridge_lexicon || {};
      stepData.input_per_goal = goals.map((goal: any) => ({
        goal_pillar: goal,
        step1: steps[0]?.output,
        step2: { bridge_lexicon: bridgeLexicon },
        goal: currentGoal,
      }));
    } else if (step.id === 4) {
      const step2Output = steps[1]?.output;
      const step3Output = steps[2]?.output;
      const bridgeLexicon = step2Output?.bridge_lexicon || {};
      let goals = step2Output?.goals || [];
      let filteredStep3 = step3Output;

      if (selectedGoalId) {
        goals = goals.filter((g: any) => g.id === selectedGoalId);
        if (step3Output && typeof step3Output === 'object') {
          filteredStep3 = { [selectedGoalId]: step3Output[selectedGoalId] || [] };
        }
      }

      stepData.input = {
        goal: currentGoal,
        step1: steps[0]?.output,
        step2: {
          goals,
          bridge_lexicon: { system_properties: bridgeLexicon.system_properties || [] },
        },
        step3: filteredStep3,
      };
    } else if (step.id === 5) {
      const step2Output = steps[1]?.output;
      const goals = step2Output?.goals || [];
      const bridgeLexicon = step2Output?.bridge_lexicon || {};
      const allSPVs = bridgeLexicon.system_properties || [];
      stepData.input_per_goal = goals.map((goal: any) => {
        const enrichedGoal = enrichGoalWithSPVs(goal, allSPVs);
        return {
          goal_pillar: enrichedGoal,
          step3: steps[2]?.output,
          step4: steps[3]?.output,
          goal: currentGoal,
        };
      });
    } else if (step.id === 6) {
      const step2Output = steps[1]?.output;
      const goals = step2Output?.goals || [];
      const bridgeLexicon = step2Output?.bridge_lexicon || {};
      const allSPVs = bridgeLexicon.system_properties || [];
      stepData.input_per_goal = goals.map((goal: any) => {
        const enrichedGoal = enrichGoalWithSPVs(goal, allSPVs);
        return {
          goal_pillar: enrichedGoal,
          step3: steps[2]?.output,
          step5: steps[4]?.output,
          goal: currentGoal,
        };
      });
    } else if (step.id === 7) {
      const step6Output = steps[5]?.output;
      const l3Questions = step6Output?.l3_questions || [];
      const step2Output = steps[1]?.output;
      const goals = step2Output?.goals || [];
      const bridgeLexicon = step2Output?.bridge_lexicon || {};
      const allSPVs = bridgeLexicon.system_properties || [];
      stepData.input_per_l3 = l3Questions.map((l3q: any) => {
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
    } else if (step.id === 8) {
      const step6Output = steps[5]?.output;
      const l3Questions = step6Output?.l3_questions || [];
      const step2Output = steps[1]?.output;
      const goals = step2Output?.goals || [];
      const bridgeLexicon = step2Output?.bridge_lexicon || {};
      const allSPVs = bridgeLexicon.system_properties || [];
      stepData.input_per_l3 = l3Questions.map((l3q: any) => {
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
    } else if (step.id === 9) {
      const step8Output = steps[7]?.output;
      const l4Questions = step8Output?.l4_questions || [];
      stepData.input_per_l4 = l4Questions.map((l4q: any) => ({
        l4_question: l4q,
        step3: steps[2]?.output,
        step5: steps[4]?.output,
        goal: currentGoal,
      }));
    }

    checkData.steps[`step${step.id}`] = stepData;
  });

  downloadJSON(
    checkData,
    `check_inputs_outputs_${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  );
  log.info('Inputs/outputs check file saved');
}

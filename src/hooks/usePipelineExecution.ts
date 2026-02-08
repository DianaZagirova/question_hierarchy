/**
 * Pipeline execution hook — orchestrates step running, aborting, and single-goal execution.
 * Extracted from App.tsx to keep the component focused on rendering.
 */

import { useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { createAbortController, abortStep, cleanupAbortController, executeStep } from '@/lib/api';
import { validateStepOutput } from '@/lib/validateStepOutput';
import { createLogger } from '@/lib/logger';
import {
  runDefaultStep,
  runStep3,
  runStep4,
  runStep4Phase,
  runStep6,
  runStep7,
  runStep8,
  runStep9,
  runStep10,
} from '@/steps';

const log = createLogger('Pipeline');

interface PipelineContext {
  selectedGoalId: string | null;
  selectedL3Id: string | null;
  selectedL4Id: string | null;
  globalLens: string;
}

export function usePipelineExecution(context: PipelineContext) {
  const {
    currentGoal,
    agents,
    steps,
    updateStepStatus,
    updateStep4Phase,
  } = useAppStore();

  const { selectedGoalId, selectedL3Id, selectedL4Id, globalLens } = context;

  // ─── Main step runner ───────────────────────────────────────────────
  const handleRunStep = useCallback(
    async (stepId: number) => {
      const step = steps.find((s) => s.id === stepId);
      if (!step) return;

      const agent = agents.find((a) => a.id === step.agentId);
      if (!agent || !agent.enabled) {
        updateStepStatus(stepId, 'error', null, 'Agent is disabled');
        return;
      }

      updateStepStatus(stepId, 'running');
      const controller = createAbortController(stepId);

      try {
        let output: any;

        // Step 5: permanently skipped
        if (stepId === 5) {
          log.info('Step 5 (Judge) is DISABLED — skipping');
          updateStepStatus(stepId, 'skipped', null, 'Step 5 Judge disabled - relationship assessment now in Step 4b');
          return;
        }

        // Step 3: Requirement Atomization
        if (stepId === 3) {
          output = await runStep3(agent, steps, currentGoal, selectedGoalId, controller.signal, globalLens);
        }
        // Step 4: Reality Mapping (2-phase)
        else if (stepId === 4) {
          output = await runStep4(agents, steps, currentGoal, selectedGoalId, controller.signal, globalLens, {
            updateStepStatus,
            updateStep4Phase: updateStep4Phase,
          });
        }
        // Step 6: Frontier Question Generation
        else if (stepId === 6) {
          output = await runStep6(agent, steps, currentGoal, selectedGoalId, controller.signal, globalLens);
        }
        // Step 7: Divergent Hypothesis Instantiation
        else if (stepId === 7) {
          output = await runStep7(agent, steps, currentGoal, selectedL3Id, controller.signal, globalLens);
        }
        // Step 8: Tactical Decomposition
        else if (stepId === 8) {
          output = await runStep8(agent, steps, currentGoal, selectedL3Id, controller.signal, globalLens);
        }
        // Step 9: Execution Drilldown
        else if (stepId === 9) {
          output = await runStep9(agent, steps, currentGoal, selectedL4Id, controller.signal, globalLens);
        }
        // Step 10: Common Experiment Synthesis
        else if (stepId === 10) {
          output = await runStep10(agent, steps, currentGoal, controller.signal, globalLens);
        }
        // Steps 1 & 2: Default single execution
        else {
          let input: any = step.input || currentGoal;
          if (stepId > 1) {
            const previousOutputs = steps.slice(0, stepId - 1).reduce((acc, s) => {
              if (s.output) acc[`step${s.id}`] = s.output;
              return acc;
            }, {} as Record<string, any>);
            input = { goal: currentGoal, ...previousOutputs };
          }
          output = await runDefaultStep(stepId, agent, input, controller.signal, globalLens);
        }

        // Validate output before accepting
        const validation = validateStepOutput(stepId, output);
        if (!validation.valid) {
          log.warn(`Step ${stepId} output validation failed: ${validation.reason}`);
          updateStepStatus(stepId, 'error', output, `Invalid response: ${validation.reason}`);
        } else {
          updateStepStatus(stepId, 'completed', output);
          log.info(`Step ${stepId} completed`);
        }
        cleanupAbortController(stepId);
      } catch (error: any) {
        if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
          updateStepStatus(stepId, 'pending');
        } else {
          log.error(`Step ${stepId} failed:`, error.message);
          updateStepStatus(stepId, 'error', null, error.message || 'Unknown error occurred');
        }
        cleanupAbortController(stepId);
      }
    },
    [steps, agents, currentGoal, selectedGoalId, selectedL3Id, selectedL4Id, globalLens, updateStepStatus, updateStep4Phase]
  );

  // ─── Abort a running step ──────────────────────────────────────────
  const handleAbortStep = useCallback(
    (stepId: number) => {
      abortStep(stepId);
      updateStepStatus(stepId, 'pending');
    },
    [updateStepStatus]
  );

  // ─── Run Step 4 phase independently ────────────────────────────────
  const handleRunStep4Phase = useCallback(
    async (phase: '4a' | '4b' | '4c') => {
      if (phase === '4c') return; // Phase 4c removed

      createAbortController(4);
      try {
        await runStep4Phase(phase, agents, steps, currentGoal, selectedGoalId, globalLens, {
          updateStepStatus,
          updateStep4Phase: updateStep4Phase,
        });
        cleanupAbortController(4);
      } catch (error: any) {
        if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
          updateStepStatus(4, 'running');
        } else {
          alert(`Error in Phase ${phase}: ${error.message}`);
        }
        cleanupAbortController(4);
      }
    },
    [agents, steps, currentGoal, selectedGoalId, globalLens, updateStepStatus, updateStep4Phase]
  );

  // ─── Run a step for a single goal ─────────────────────────────────
  const handleRunStepForSingleGoal = useCallback(
    async (stepId: number, goalId: string) => {
      const step = steps.find((s) => s.id === stepId);
      if (!step) return;

      const agent = agents.find((a) => a.id === step.agentId);
      if (!agent || !agent.enabled) {
        alert('Agent is disabled');
        return;
      }

      const step2Output = steps[1]?.output;
      const goals = step2Output?.goals || [];
      const targetGoal = goals.find((g: any) => g.id === goalId);
      if (!targetGoal) {
        alert(`Goal ${goalId} not found`);
        return;
      }

      updateStepStatus(stepId, 'running');
      const controller = createAbortController(stepId);

      try {
        const bridgeLexicon = step2Output?.bridge_lexicon || {};
        const allSPVs = bridgeLexicon.system_properties || [];
        const requiredSPVIds = (targetGoal.bridge_tags?.system_properties_required || []).map(
          (sp: any) => sp.spv_id
        );
        const filteredSPVs = allSPVs.filter((spv: any) =>
          requiredSPVIds.includes(spv.id || spv.ID)
        );

        // Step 5: permanently skipped
        if (stepId === 5) {
          log.info('Step 5 (Judge) is DISABLED — skipping');
          updateStepStatus(stepId, 'skipped', null, 'Step 5 Judge disabled');
          return;
        }

        // Step 3: Single goal RA generation
        if (stepId === 3) {
          const input = {
            goal_pillar: targetGoal,
            step1: steps[0]?.output,
            step2: { bridge_lexicon: bridgeLexicon },
            goal: currentGoal,
          };
          const result = await executeStep({
            stepId,
            agentConfig: agent,
            input,
            signal: controller.signal,
          });
          const existingRAs = steps[2]?.output || {};
          updateStepStatus(stepId, 'completed', {
            ...existingRAs,
            [goalId]: result.requirement_atoms || result.RAs || [],
          });
          alert(`Generated RAs for goal ${goalId}`);
        }
        // Step 6: Single goal L3 generation
        else if (stepId === 6) {
          // Check that S-nodes exist for this goal
          const step4Output = steps[3]?.output;
          const goalStep4Data = step4Output?.[goalId] || null;
          const goalSNodes = goalStep4Data?.scientific_pillars || [];
          if (goalSNodes.length === 0) {
            updateStepStatus(stepId, 'error', null, `No scientific pillars (S-nodes) found for goal ${goalId}. Run Step 4 first.`);
            cleanupAbortController(stepId);
            return;
          }
          const step3Output = steps[2]?.output;
          const input = {
            goal_pillar: targetGoal,
            step2: { bridge_lexicon: { system_properties: filteredSPVs } },
            step3: step3Output?.[goalId] || [], // Only this goal's RAs
            step4: { [goalId]: goalStep4Data },
            step5: { [goalId]: goalStep4Data },
            goal: currentGoal,
          };
          const result = await executeStep({
            stepId,
            agentConfig: agent,
            input,
            signal: controller.signal,
          });
          const existingL3s = steps[5]?.output?.l3_questions || [];
          const newL3s = result.l3_questions || result.seed_questions || [];
          const updatedL3s = [...existingL3s, ...newL3s];
          updateStepStatus(stepId, 'completed', {
            l3_questions: updatedL3s,
            batch_summary: {
              goals_processed: (steps[5]?.output?.batch_summary?.goals_processed || 0) + 1,
              l3_generated: updatedL3s.length,
              successful: (steps[5]?.output?.batch_summary?.successful || 0) + 1,
              failed: steps[5]?.output?.batch_summary?.failed || 0,
            },
          });
          alert(`Generated ${newL3s.length} L3 questions for goal ${goalId}`);
        } else {
          alert(`Single-goal execution not supported for step ${stepId}`);
        }

        cleanupAbortController(stepId);
      } catch (error: any) {
        if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
          updateStepStatus(stepId, 'pending');
        } else {
          updateStepStatus(stepId, 'error', null, error.message || 'Unknown error occurred');
        }
        cleanupAbortController(stepId);
      }
    },
    [steps, agents, currentGoal, updateStepStatus]
  );

  return {
    handleRunStep,
    handleAbortStep,
    handleRunStep4Phase,
    handleRunStepForSingleGoal,
  };
}

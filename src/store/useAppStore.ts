import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppState, AgentConfig, PipelineStep, ProjectVersion } from '@/types';
import { DEFAULT_AGENTS } from '@/config/agents';

interface AppStore extends AppState {
  // Actions
  setGoal: (goal: string) => void;
  updateAgent: (agentId: string, updates: Partial<AgentConfig>) => void;
  updateStepStatus: (stepId: number, status: PipelineStep['status'], output?: any, error?: string) => void;
  updateStep4Phase: (phase: 'phase4a_domain_mapping' | 'phase4b_domain_scans' | 'phase4c_integration', data: any) => void;
  resetPipeline: () => void;
  resetToDefaults: () => void;
  saveVersion: () => void;
  loadVersion: (versionId: string) => void;
  deleteVersion: (versionId: string) => void;
  skipStep: (stepId: number) => void;
  clearStep: (stepId: number) => void;
  setSelectedGoalId: (goalId: string | null) => void;
  setSelectedL3Id: (l3Id: string | null) => void;
  setSelectedL4Id: (l4Id: string | null) => void;
}

const initialSteps: PipelineStep[] = [
  { id: 1, name: 'Goal Formalization', agentId: 'agent-initiator', status: 'pending', input: null, output: null },
  { id: 2, name: 'Goal Pillars Synthesis', agentId: 'agent-immortalist', status: 'pending', input: null, output: null },
  { id: 3, name: 'Requirement Atomization', agentId: 'agent-requirement-engineer', status: 'pending', input: null, output: null },
  { id: 4, name: 'Reality Mapping', agentId: 'agent-biologist', status: 'pending', input: null, output: null },
  { id: 5, name: 'Strategic Matching', agentId: 'agent-judge', status: 'skipped', input: null, output: null }, // SKIPPED: Judge disabled, function integrated into Step 4b
  { id: 6, name: 'Frontier Question Generation', agentId: 'agent-l3-explorer', status: 'pending', input: null, output: null },
  { id: 7, name: 'Divergent Hypothesis Instantiation', agentId: 'agent-instantiator', status: 'pending', input: null, output: null },
  { id: 8, name: 'Tactical Decomposition', agentId: 'agent-explorer', status: 'pending', input: null, output: null },
  { id: 9, name: 'Execution Drilldown', agentId: 'agent-tactical-engineer', status: 'pending', input: null, output: null },
  { id: 10, name: 'Common Experiment Synthesis', agentId: 'agent-common-l6-synthesizer', status: 'pending', input: null, output: null },
];

const STORAGE_VERSION = 5; // v5: Added Step 10 (Common L6 Synthesis)

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      currentGoal: '',
      agents: DEFAULT_AGENTS,
      steps: initialSteps,
      versions: [],
      currentVersionId: null,
      selectedGoalId: null,
      selectedL3Id: null,
      selectedL4Id: null,
      storageVersion: STORAGE_VERSION,

      setGoal: (goal: string) => {
        set({ currentGoal: goal });
        // Update step 1 input
        set((state) => ({
          steps: state.steps.map((step) =>
            step.id === 1 ? { ...step, input: goal } : step
          ),
        }));
      },

      updateAgent: (agentId: string, updates: Partial<AgentConfig>) => {
        set((state) => ({
          agents: state.agents.map((agent) =>
            agent.id === agentId ? { ...agent, ...updates } : agent
          ),
        }));
      },

      updateStepStatus: (stepId: number, status: PipelineStep['status'], output?: any, error?: string) => {
        console.log(`[Store] updateStepStatus called: Step ${stepId} -> ${status}`);
        if (output && typeof output === 'object') {
          console.log(`[Store] Output keys:`, Object.keys(output).slice(0, 5));
          if ('phase' in output) console.log(`[Store] ⚠️  Output contains 'phase' property:`, output.phase);
          if ('progress' in output) console.log(`[Store] ⚠️  Output contains 'progress' property:`, output.progress);
        }

        // ⚠️ SAFEGUARD: Step 5 (Judge) must always remain 'skipped' (agent disabled)
        if (stepId === 5 && status !== 'skipped') {
          console.log(`[Store] ⚠️  Blocked attempt to change Step 5 status to '${status}' - keeping as 'skipped' (Judge disabled)`);
          return;
        }

        set((state) => ({
          steps: state.steps.map((step) =>
            step.id === stepId
              ? { ...step, status, output, error, timestamp: new Date() }
              : step
          ),
        }));
      },

      updateStep4Phase: (phase: 'phase4a_domain_mapping' | 'phase4b_domain_scans' | 'phase4c_integration', data: any) => {
        set((state) => ({
          steps: state.steps.map((step) =>
            step.id === 4
              ? {
                  ...step,
                  step4Phases: {
                    ...step.step4Phases,
                    [phase]: data
                  },
                  timestamp: new Date()
                }
              : step
          ),
        }));
      },

      skipStep: (stepId: number) => {
        // Step 5 is already permanently skipped, no need to change
        if (stepId === 5) {
          console.log(`[Store] Step 5 is permanently skipped (Judge disabled)`);
          return;
        }
        set((state) => ({
          steps: state.steps.map((step) =>
            step.id === stepId ? { ...step, status: 'skipped' } : step
          ),
        }));
      },

      clearStep: (stepId: number) => {
        // Step 5 cannot be cleared - it's permanently skipped (Judge disabled)
        if (stepId === 5) {
          console.log(`[Store] Cannot clear Step 5 - permanently skipped (Judge disabled)`);
          return;
        }
        set((state) => ({
          steps: state.steps.map((step) =>
            step.id === stepId ? { ...step, status: 'pending', output: null, error: undefined, timestamp: undefined } : step
          ),
        }));
      },

      resetPipeline: () => {
        set({
          steps: initialSteps,
          currentGoal: '',
        });
      },

      resetToDefaults: () => {
        set({
          agents: DEFAULT_AGENTS,
          steps: initialSteps,
          currentGoal: '',
          versions: [],
          currentVersionId: null,
        });
      },

      saveVersion: () => {
        const state = get();
        const newVersion: ProjectVersion = {
          id: `v-${Date.now()}`,
          timestamp: new Date(),
          goal: state.currentGoal,
          agentConfigs: state.agents,
          steps: state.steps,
          results: {
            q0: state.steps[0]?.output,
            goals: state.steps[1]?.output?.goals,
            bridge_lexicon: state.steps[1]?.output?.bridge_lexicon,
            requirement_atoms: state.steps[2]?.output,
            scientific_pillars: state.steps[3]?.output?.scientific_pillars,
            matching_edges: state.steps[4]?.output,
            l3_questions: state.steps[5]?.output,
            instantiation_hypotheses: state.steps[6]?.output,
            l4_questions: state.steps[7]?.output,
            l6_tasks: state.steps[8]?.output,
            common_l6: state.steps[9]?.output,
          },
        };

        set((state) => ({
          versions: [...state.versions, newVersion],
          currentVersionId: newVersion.id,
        }));
      },

      loadVersion: (versionId: string) => {
        const state = get();
        const version = state.versions.find((v) => v.id === versionId);
        if (version) {
          set({
            currentGoal: version.goal,
            agents: version.agentConfigs,
            steps: version.steps,
            currentVersionId: versionId,
          });
        }
      },

      deleteVersion: (versionId: string) => {
        set((state) => ({
          versions: state.versions.filter((v) => v.id !== versionId),
          currentVersionId: state.currentVersionId === versionId ? null : state.currentVersionId,
        }));
      },

      setSelectedGoalId: (goalId: string | null) => {
        set({ selectedGoalId: goalId });
      },

      setSelectedL3Id: (l3Id: string | null) => {
        set({ selectedL3Id: l3Id });
      },

      setSelectedL4Id: (l4Id: string | null) => {
        set({ selectedL4Id: l4Id });
      },
    }),
    {
      name: 'omega-point-storage',
      version: STORAGE_VERSION,
      migrate: (persistedState: any, version: number) => {
        // If stored version is older than current, reset agents to defaults
        if (version < STORAGE_VERSION) {
          console.log(`[Storage Migration] Upgrading from v${version} to v${STORAGE_VERSION}`);
          
          // Force Step 5 (Judge) to skipped status
          let migratedSteps = persistedState.steps?.map((step: any) => 
            step.id === 5 ? { ...step, status: 'skipped', output: null, error: undefined } : step
          ) || initialSteps;
          
          // Add Step 10 if missing
          if (!migratedSteps.find((s: any) => s.id === 10)) {
            migratedSteps = [...migratedSteps, { id: 10, name: 'Common Experiment Synthesis', agentId: 'agent-common-l6-synthesizer', status: 'pending', input: null, output: null }];
          }
          
          console.log('[Storage Migration] Step 5 (Judge) forced to skipped status');
          console.log('[Storage Migration] Resetting agents to defaults');
          
          return {
            ...persistedState,
            agents: DEFAULT_AGENTS,
            steps: migratedSteps,
            storageVersion: STORAGE_VERSION,
          };
        }
        return persistedState;
      },
    }
  )
);

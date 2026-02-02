import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppState, AgentConfig, PipelineStep, ProjectVersion } from '@/types';
import { DEFAULT_AGENTS } from '@/config/agents';

interface AppStore extends AppState {
  // Actions
  setGoal: (goal: string) => void;
  updateAgent: (agentId: string, updates: Partial<AgentConfig>) => void;
  updateStepStatus: (stepId: number, status: PipelineStep['status'], output?: any, error?: string) => void;
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
  { id: 5, name: 'Strategic Matching', agentId: 'agent-judge', status: 'pending', input: null, output: null },
  { id: 6, name: 'Frontier Question Generation', agentId: 'agent-l3-explorer', status: 'pending', input: null, output: null },
  { id: 7, name: 'Divergent Hypothesis Instantiation', agentId: 'agent-instantiator', status: 'pending', input: null, output: null },
  { id: 8, name: 'Tactical Decomposition', agentId: 'agent-explorer', status: 'pending', input: null, output: null },
  { id: 9, name: 'Execution Drilldown', agentId: 'agent-tactical-engineer', status: 'pending', input: null, output: null },
];

const STORAGE_VERSION = 2; // Increment this when agents schema changes

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
        set((state) => ({
          steps: state.steps.map((step) =>
            step.id === stepId
              ? { ...step, status, output, error, timestamp: new Date() }
              : step
          ),
        }));
      },

      skipStep: (stepId: number) => {
        set((state) => ({
          steps: state.steps.map((step) =>
            step.id === stepId ? { ...step, status: 'skipped' } : step
          ),
        }));
      },

      clearStep: (stepId: number) => {
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
          console.log('[Storage Migration] Resetting agents to include new Domain Mapper, Domain Specialist, and Knowledge Integrator');
          return {
            ...persistedState,
            agents: DEFAULT_AGENTS,
            storageVersion: STORAGE_VERSION,
          };
        }
        return persistedState;
      },
    }
  )
);

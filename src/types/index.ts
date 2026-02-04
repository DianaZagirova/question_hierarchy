// Agent Configuration Types
export interface AgentConfig {
  id: string;
  name: string;
  icon?: string; // Emoji icon representing the agent
  role: string;
  description?: string; // Brief description of what this agent does
  model: string;
  temperature: number;
  systemPrompt: string;
  lens?: string; // For Agent Immortalist (Step 2)
  enabled: boolean;
  settings?: {
    // Number of nodes to generate
    nodeCount?: {
      min: number;
      max: number;
      default: number;
    };
    // Available lenses (for Goal Pillars)
    availableLenses?: string[];
    selectedLens?: string;
    // Custom parameters
    customParams?: Record<string, any>;
  };
}

// Pipeline Step Types
export type StepStatus = 'pending' | 'running' | 'completed' | 'error' | 'skipped';

export interface Step4PhaseData {
  phase4a_domain_mapping?: any;  // Results from Phase 4a
  phase4b_domain_scans?: any;    // Results from Phase 4b
  phase4c_integration?: any;     // Results from Phase 4c (final)
}

export interface PipelineStep {
  id: number;
  name: string;
  agentId: string;
  status: StepStatus;
  input: any;
  output: any;
  error?: string;
  timestamp?: Date;
  step4Phases?: Step4PhaseData;  // Track Step 4 phase results separately
}

// Data Structure Types
export interface Q0 {
  text: string;
  timestamp: Date;
}

export interface BridgeLexicon {
  failure_channels: FailureChannel[];
  system_properties: SystemProperty[];
}

export interface FailureChannel {
  id: string;
  name: string;
  definition: string;
}

export interface SystemProperty {
  id: string;
  name: string;
  definition: string;
}

export interface GoalPillar {
  id: string;
  title: string;
  catastrophe_primary: string;
  failure_mode_simulation: string;
  state_definition: string;
  done_criteria: string;
  evidence_of_state: {
    meter_classes: string[];
    meter_status: string;
  };
  triz_contradiction: string;
  bridge_tags: {
    failure_channels: string[];
    system_properties_required: Array<{
      spv_id: string;
      importance: string;
    }>;
  };
}

export interface RequirementAtom {
  ra_id: string;
  atom_title: string;
  state_variable: string;
  failure_shape: string;
  perturbation_classes: string[];
  timescale: string;
  requirement_statement: string;
  done_criteria: string;
  meter_classes: string[];
  meter_status: string;
  multiple_realizability_check: string;
  notes?: string;
}

export interface ScientificPillar {
  id: string;
  node_type: string;
  front: string;
  title: string;
  mechanism: string;
  verified_effect: string;
  readiness_level: string;
  best_supported_model: string;
  human_context: {
    present: boolean;
    note: string;
  };
  capabilities: Array<{
    spv_id: string;
    effect_direction: string;
    rationale: string;
  }>;
  constraints: string[];
  known_failure_modes: string[];
  fundamental_assumptions: string[];
  fragility_score: number;
  research_momentum: string;
}

export interface MatchingEdge {
  source_s_id: string;
  relationship: 'solves' | 'partially_solves' | 'proxies_for' | 'violates' | 'enables_measurement_for';
  confidence_score: number;
  spv_alignment: string[];
  gap_analysis: {
    primary_delta: string;
    description: string;
  };
  assumption_risk: string;
  rationale: string;
}

export interface L3Question {
  id: string;
  strategy_used: string;
  text: string;
  rationale: string;
  discriminator_target: string;
}

export interface InstantiationHypothesis {
  ih_id: string;
  domain_category: string;
  process_hypothesis: string;
  lens_origin: string;
  maps_to_ra_ids: string[];
  target_spv: string;
  discriminating_prediction: string;
  meter_classes: string[];
  notes: string;
}

export interface L4Question {
  id: string;
  type: string;
  lens: string;
  text: string;
  distinguishes_ih_ids: string[];
  rationale: string;
}

export interface L6Task {
  id: string;
  type: string;
  title: string;
  simt_parameters: {
    system: string;
    intervention: string;
    meter: string;
    threshold_time: string;
  };
  expected_impact: string;
  spv_link: string;
}

// Project State Types
export interface ProjectVersion {
  id: string;
  timestamp: Date;
  goal: string;
  agentConfigs: AgentConfig[];
  steps: PipelineStep[];
  results: {
    q0?: Q0;
    goals?: GoalPillar[];
    bridge_lexicon?: BridgeLexicon;
    requirement_atoms?: Record<string, RequirementAtom[]>;
    scientific_pillars?: ScientificPillar[];
    matching_edges?: Record<string, MatchingEdge[]>;
    l3_questions?: Record<string, L3Question[]>;
    instantiation_hypotheses?: Record<string, InstantiationHypothesis[]>;
    l4_questions?: Record<string, L4Question[]>;
    l6_tasks?: Record<string, L6Task[]>;
  };
}

export interface AppState {
  currentGoal: string;
  agents: AgentConfig[];
  steps: PipelineStep[];
  versions: ProjectVersion[];
  currentVersionId: string | null;
  selectedGoalId?: string | null;
  selectedL3Id?: string | null;
  selectedL4Id?: string | null;
}

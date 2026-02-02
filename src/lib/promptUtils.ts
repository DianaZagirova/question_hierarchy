import { AgentConfig } from '@/types';

/**
 * Replace placeholders in agent system prompts with actual values from settings
 */
export function interpolatePrompt(agent: AgentConfig, globalLens?: string): string {
  let prompt = agent.systemPrompt;
  
  // Replace lens placeholder with priority: globalLens > selectedLens > agent.lens
  const effectiveLens = globalLens || agent.settings?.selectedLens || agent.lens;
  if (effectiveLens) {
    prompt = prompt.replace(/\{\{LENS\}\}/g, effectiveLens);
  }
  
  // Replace node count placeholders
  if (agent.settings?.nodeCount) {
    const { min, max } = agent.settings.nodeCount;
    
    // For Goal Pillars (Agent Immortalist)
    prompt = prompt.replace(/\{\{MIN_GOALS\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_GOALS\}\}/g, max.toString());
    
    // For Research Domains (Domain Mapper)
    prompt = prompt.replace(/\{\{MIN_DOMAINS\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_DOMAINS\}\}/g, max.toString());
    
    // For Scientific Pillars (Domain Specialist)
    prompt = prompt.replace(/\{\{MIN_PILLARS\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_PILLARS\}\}/g, max.toString());
    
    // For L3 Questions
    prompt = prompt.replace(/\{\{MIN_L3\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_L3\}\}/g, max.toString());
    
    // For Instantiation Hypotheses (IH)
    prompt = prompt.replace(/\{\{MIN_IH\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_IH\}\}/g, max.toString());
    
    // For L4 Questions
    prompt = prompt.replace(/\{\{MIN_L4\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_L4\}\}/g, max.toString());
    
    // For L5 Nodes
    prompt = prompt.replace(/\{\{MIN_L5\}\}/g, min.toString());
    prompt = prompt.replace(/\{\{MAX_L5\}\}/g, max.toString());
  }
  
  // Replace any custom parameters
  if (agent.settings?.customParams) {
    Object.entries(agent.settings.customParams).forEach(([key, value]) => {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      prompt = prompt.replace(placeholder, String(value));
    });
  }
  
  return prompt;
}

/**
 * Get the effective prompt for an agent (with interpolated values)
 */
export function getEffectivePrompt(agent: AgentConfig, globalLens?: string): string {
  return interpolatePrompt(agent, globalLens);
}

/**
 * Update agent settings and return updated agent
 */
export function updateAgentSettings(
  agent: AgentConfig,
  settings: Partial<AgentConfig['settings']>
): AgentConfig {
  return {
    ...agent,
    settings: {
      ...agent.settings,
      ...settings,
    },
  };
}

/**
 * Get node count range for an agent
 */
export function getNodeCountRange(agent: AgentConfig): { min: number; max: number; default: number } | null {
  return agent.settings?.nodeCount || null;
}

/**
 * Set node count for an agent
 */
export function setNodeCount(
  agent: AgentConfig,
  min: number,
  max: number,
  defaultValue?: number
): AgentConfig {
  return updateAgentSettings(agent, {
    nodeCount: {
      min,
      max,
      default: defaultValue ?? Math.floor((min + max) / 2),
    },
  });
}

/**
 * Set lens for an agent
 */
export function setLens(agent: AgentConfig, lens: string): AgentConfig {
  return {
    ...agent,
    lens,
    settings: {
      ...agent.settings,
      selectedLens: lens,
    },
  };
}

/**
 * Synchronize lens between multiple agents
 * Useful for keeping Immortalist and L3 Explorer in sync
 */
export function synchronizeLens(agents: AgentConfig[], lens: string): AgentConfig[] {
  return agents.map(agent => {
    // Only update agents that have lens settings
    if (agent.settings?.availableLenses) {
      return setLens(agent, lens);
    }
    return agent;
  });
}

/**
 * Get agents that support lens selection
 */
export function getLensEnabledAgents(agents: AgentConfig[]): AgentConfig[] {
  return agents.filter(agent => agent.settings?.availableLenses);
}

/**
 * Check if agents have synchronized lenses
 */
export function areLensesSynchronized(agents: AgentConfig[]): boolean {
  const lensAgents = getLensEnabledAgents(agents);
  if (lensAgents.length <= 1) return true;
  
  const firstLens = lensAgents[0].settings?.selectedLens;
  return lensAgents.every(agent => agent.settings?.selectedLens === firstLens);
}

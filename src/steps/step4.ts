/**
 * Step 4: Reality Mapping — 2-phase scientific knowledge collection.
 * Phase 4a: Domain Mapping → Phase 4b: Domain Scans (parallel)
 */

import { PipelineStep, AgentConfig } from '@/types';
import { executeStepBatch } from '@/lib/api';
import {
  extractGoals,
  minimalGoal,
  minimalRAs,
  fullQ0,
  filterSPVsForGoal,
  findAgent,
} from '@/lib/pipelineHelpers';
import { createLogger } from '@/lib/logger';

const log = createLogger('Step4');

type Step4Phase = 'phase4a_domain_mapping' | 'phase4b_domain_scans' | 'phase4c_integration';

export interface Step4Callbacks {
  updateStepStatus: (stepId: number, status: any, output?: any, error?: string) => void;
  updateStep4Phase: (phase: Step4Phase, data: any) => void;
}

export async function runStep4(
  agents: AgentConfig[],
  steps: PipelineStep[],
  currentGoal: string,
  selectedGoalId: string | null,
  signal: AbortSignal,
  globalLens: string,
  callbacks: Step4Callbacks
): Promise<any> {
  const step3Output = steps[2]?.output;
  const bridgeLexicon = steps[1]?.output?.bridge_lexicon || {};
  const filteredBridgeLexicon = {
    system_properties: bridgeLexicon.system_properties || [],
  };

  const { goals, error } = extractGoals(steps, selectedGoalId);
  if (error) throw new Error(error);

  // ===== PHASE 4a: DOMAIN MAPPING =====
  log.info(`Phase 4a: Domain Mapping for ${goals.length} goal(s)`);
  callbacks.updateStepStatus(4, 'running', { phase: '4a_domain_mapping', progress: 0 });

  const domainMapperAgent = findAgent(agents, 'agent-domain-mapper');
  if (!domainMapperAgent) {
    throw new Error('Domain Mapper agent not found. Try resetting to defaults or clearing browser cache.');
  }

  const domainMappingItems = goals.map((goal: any) => {
    const ras = step3Output?.[goal.id] || [];
    return {
      Q0_reference: fullQ0(steps),
      target_goal: minimalGoal(goal),
      requirement_atoms: minimalRAs(ras),
      bridge_lexicon: filterSPVsForGoal(goal, filteredBridgeLexicon.system_properties),
      goal: currentGoal,
    };
  });

  const domainMappingResult = await executeStepBatch(
    4, domainMapperAgent, domainMappingItems, signal, globalLens, { phase: '4a' }
  );

  const domainsByGoal: Record<string, any> = {};
  let totalDomainsIdentified = 0;

  domainMappingResult.batch_results.forEach((result: any, idx: number) => {
    const goalId = goals[idx].id;
    if (result.success && result.data) {
      domainsByGoal[goalId] = result.data;
      totalDomainsIdentified += (result.data.research_domains || []).length;
    } else {
      log.warn(`Phase 4a: Goal ${goalId} failed —`, result.error);
    }
  });

  log.info(`Phase 4a complete: ${totalDomainsIdentified} domains across ${Object.keys(domainsByGoal).length} goals`);
  callbacks.updateStep4Phase('phase4a_domain_mapping', domainsByGoal);

  // ===== PHASE 4b: DOMAIN-SPECIFIC SCANS =====
  let filteredDomainsByGoal = domainsByGoal;
  if (selectedGoalId) {
    filteredDomainsByGoal = {};
    if (domainsByGoal[selectedGoalId]) {
      filteredDomainsByGoal[selectedGoalId] = domainsByGoal[selectedGoalId];
    } else {
      throw new Error(`Selected goal ${selectedGoalId} has no domain mapping`);
    }
  }

  log.info(`Phase 4b: Domain Scans for ${Object.keys(filteredDomainsByGoal).length} goal(s)`);
  callbacks.updateStepStatus(4, 'running', {
    phase: '4b_domain_scans',
    progress: 50,
    domain_mapping: filteredDomainsByGoal,
  });

  const domainSpecialistAgent = findAgent(agents, 'agent-biologist');
  if (!domainSpecialistAgent) {
    throw new Error('Domain Specialist (agent-biologist) not found. Try resetting to defaults.');
  }

  const allDomainScanItems: any[] = [];
  Object.entries(filteredDomainsByGoal).forEach(([goalId, domainData]: [string, any]) => {
    const goal = goals.find((g: any) => g.id === goalId);
    const domains = domainData.research_domains || [];
    const ras = step3Output?.[goalId] || [];

    domains.forEach((domain: any) => {
      allDomainScanItems.push({
        Q0_reference: fullQ0(steps),
        target_goal: minimalGoal(goal),
        requirement_atoms: minimalRAs(ras),
        bridge_lexicon: filterSPVsForGoal(goal, filteredBridgeLexicon.system_properties),
        target_domain: domain,
        goal: currentGoal,
      });
    });
  });

  log.info(`Phase 4b: Executing ${allDomainScanItems.length} parallel domain scans`);

  const domainScanResult = await executeStepBatch(
    4, domainSpecialistAgent, allDomainScanItems, signal, globalLens, { phase: '4b' }
  );

  const domainScansByGoal: Record<string, any> = {};
  let totalSNodes = 0;

  domainScanResult.batch_results.forEach((result: any, idx: number) => {
    const item = allDomainScanItems[idx];
    const goalId = item.target_goal.id;
    const domainId = item.target_domain.domain_id;

    if (result.success && result.data) {
      if (!domainScansByGoal[goalId]) domainScansByGoal[goalId] = { domains: {} };
      domainScansByGoal[goalId].domains[domainId] = result.data;
      totalSNodes += result.data.scientific_pillars?.length || 0;
    } else {
      log.warn(`Phase 4b: ${domainId} for goal ${goalId} failed —`, result.error);
    }
  });

  log.info(`Phase 4b complete: ${totalSNodes} S-nodes from ${domainScanResult.successful} scans`);
  callbacks.updateStep4Phase('phase4b_domain_scans', domainScansByGoal);

  // ===== FINALIZE OUTPUT =====
  const finalOutput: Record<string, any> = {};
  let totalFinalSNodes = 0;

  Object.entries(domainScansByGoal).forEach(([goalId, data]: [string, any]) => {
    const domainScans = data.domains || {};
    const allSNodes: any[] = [];
    Object.values(domainScans).forEach((scan: any) => {
      allSNodes.push(...(scan.scientific_pillars || []));
    });

    finalOutput[goalId] = {
      domain_mapping: domainsByGoal[goalId],
      raw_domain_scans: data,
      scientific_pillars: allSNodes,
    };
    totalFinalSNodes += allSNodes.length;
  });

  log.info(`Step 4 complete: ${totalFinalSNodes} S-nodes across ${Object.keys(finalOutput).length} goals`);
  return finalOutput;
}

/**
 * Run a specific Step 4 phase independently (from the phase buttons in the UI).
 */
export async function runStep4Phase(
  phase: '4a' | '4b',
  agents: AgentConfig[],
  steps: PipelineStep[],
  currentGoal: string,
  selectedGoalId: string | null,
  globalLens: string,
  callbacks: Step4Callbacks
): Promise<void> {
  const step3Output = steps[2]?.output;
  const bridgeLexicon = steps[1]?.output?.bridge_lexicon || {};
  const filteredBridgeLexicon = { system_properties: bridgeLexicon.system_properties || [] };

  const { goals, error } = extractGoals(steps, selectedGoalId);
  if (error) { alert(error); return; }

  if (phase === '4a') {
    log.info('Running Phase 4a independently');
    callbacks.updateStepStatus(4, 'running', { phase: '4a_domain_mapping', progress: 0 });

    const domainMapperAgent = findAgent(agents, 'agent-domain-mapper');
    if (!domainMapperAgent) { alert('Domain Mapper agent not found'); return; }

    const items = goals.map((goal: any) => ({
      Q0_reference: steps[0]?.output?.Q0,
      target_goal: goal,
      requirement_atoms: step3Output?.[goal.id] || [],
      bridge_lexicon: filteredBridgeLexicon,
      goal: currentGoal,
    }));

    const result = await executeStepBatch(4, domainMapperAgent, items, undefined, globalLens, { phase: '4a' });

    const domainsByGoal: Record<string, any> = {};
    result.batch_results.forEach((r: any, idx: number) => {
      if (r.success && r.data) domainsByGoal[goals[idx].id] = r.data;
    });

    callbacks.updateStep4Phase('phase4a_domain_mapping', domainsByGoal);
    callbacks.updateStepStatus(4, 'running', { phase: '4a_complete', progress: 50 });
    alert(`Phase 4a completed! ${Object.keys(domainsByGoal).length} goals mapped to research domains.`);

  } else if (phase === '4b') {
    const step = steps.find((s) => s.id === 4);
    const domainsByGoal = step?.step4Phases?.phase4a_domain_mapping;
    if (!domainsByGoal) { alert('Phase 4a must be completed first'); return; }

    log.info('Running Phase 4b independently');
    callbacks.updateStepStatus(4, 'running', { phase: '4b_domain_scans', progress: 50 });

    const domainSpecialistAgent = findAgent(agents, 'agent-biologist');
    if (!domainSpecialistAgent) { alert('Domain Specialist agent not found'); return; }

    const allItems: any[] = [];
    Object.entries(domainsByGoal).forEach(([goalId, domainData]: [string, any]) => {
      const goal = goals.find((g: any) => g.id === goalId);
      (domainData.research_domains || []).forEach((domain: any) => {
        allItems.push({
          Q0_reference: steps[0]?.output?.Q0,
          target_goal: goal,
          requirement_atoms: step3Output?.[goalId] || [],
          bridge_lexicon: filteredBridgeLexicon,
          target_domain: domain,
          goal: currentGoal,
        });
      });
    });

    const result = await executeStepBatch(4, domainSpecialistAgent, allItems, undefined, globalLens, { phase: '4b' });

    const scansByGoal: Record<string, any> = {};
    result.batch_results.forEach((r: any, idx: number) => {
      const item = allItems[idx];
      const goalId = item.target_goal.id;
      const domainId = item.target_domain.domain_id;
      if (r.success && r.data) {
        if (!scansByGoal[goalId]) scansByGoal[goalId] = { domains: {} };
        scansByGoal[goalId].domains[domainId] = r.data;
      }
    });

    callbacks.updateStep4Phase('phase4b_domain_scans', scansByGoal);
    callbacks.updateStepStatus(4, 'running', { phase: '4b_complete', progress: 100 });
    alert(`Phase 4b completed! ${result.successful} domain scans completed.`);
  }
}

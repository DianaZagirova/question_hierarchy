/**
 * Default step execution: Steps 1 & 2 (single API call, no batching).
 */

import { AgentConfig } from '@/types';
import { executeStep } from '@/lib/api';
import { createLogger } from '@/lib/logger';

const log = createLogger('StepDefault');

export async function runDefaultStep(
  stepId: number,
  agent: AgentConfig,
  input: any,
  signal: AbortSignal,
  globalLens: string
): Promise<any> {
  const result = await executeStep({
    stepId,
    agentConfig: agent,
    input,
    signal,
    globalLens,
  });

  log.debug(`Step ${stepId} result keys:`, Object.keys(result || {}));

  if (!result || typeof result !== 'object') {
    throw new Error('Invalid response from server');
  }

  return result;
}

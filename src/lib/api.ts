import axios from 'axios';
import { AgentConfig } from '@/types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

/**
 * Wrap an async fn with up to MAX_RETRIES retries.
 * Aborted requests are never retried.
 */
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      // Never retry user-initiated aborts
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED' || signal?.aborted) {
        throw error;
      }
      lastError = error;
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[API] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error.message);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

export interface ExecuteStepParams {
  stepId: number;
  agentConfig: AgentConfig;
  input: any;
  previousOutputs?: any;
  signal?: AbortSignal;
  globalLens?: string;
}

// Store active abort controllers by step ID
const abortControllers = new Map<number, AbortController>();

export const executeStep = async (params: ExecuteStepParams): Promise<any> => {
  return withRetry(async () => {
    const response = await api.post('/api/execute-step', params, {
      signal: params.signal,
    });
    return response.data;
  }, params.signal);
};

export const executeStepBatch = async (
  stepId: number, 
  agentConfig: AgentConfig, 
  items: any[], 
  signal?: AbortSignal,
  globalLens?: string,
  phaseInfo?: { phase: '4a' | '4b' }
): Promise<any> => {
  return withRetry(async () => {
    const response = await api.post('/api/execute-step-batch', {
      stepId,
      agentConfig,
      items,
      globalLens,
      phase_info: phaseInfo,
    }, {
      signal,
    });
    return response.data;
  }, signal);
};

export const createAbortController = (stepId: number): AbortController => {
  // Abort any existing controller for this step
  const existing = abortControllers.get(stepId);
  if (existing) {
    existing.abort();
  }
  
  const controller = new AbortController();
  abortControllers.set(stepId, controller);
  return controller;
};

export const abortStep = (stepId: number): void => {
  const controller = abortControllers.get(stepId);
  if (controller) {
    controller.abort();
    abortControllers.delete(stepId);
  }
};

export const cleanupAbortController = (stepId: number): void => {
  abortControllers.delete(stepId);
};

// ─── Real-time batch progress via SSE ──────────────────────────────
export interface BatchProgress {
  step_id: number;
  completed: number;
  total: number;
  successful: number;
  failed: number;
  elapsed: number;   // seconds
  eta: number;       // seconds remaining
  percent: number;
  done?: boolean;
  timeout?: boolean;
  items?: Array<{ index: number; success: boolean; error?: string }>;
}

/**
 * Subscribe to real-time batch progress for a step via SSE.
 * Returns a cleanup function to close the connection.
 */
export const subscribeBatchProgress = (
  stepId: number,
  onProgress: (progress: BatchProgress) => void,
  onDone?: () => void,
): (() => void) => {
  const url = `${API_URL}/api/progress/${stepId}`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const data: BatchProgress = JSON.parse(event.data);
      onProgress(data);
      if (data.done) {
        eventSource.close();
        onDone?.();
      }
    } catch (e) {
      console.warn('[SSE] Failed to parse progress event:', e);
    }
  };

  eventSource.onerror = () => {
    // Connection lost or server closed — clean up silently
    eventSource.close();
    onDone?.();
  };

  return () => {
    eventSource.close();
  };
};

export const testConnection = async (): Promise<boolean> => {
  try {
    const response = await api.get('/api/health');
    return response.status === 200;
  } catch (error) {
    return false;
  }
};

export default api;

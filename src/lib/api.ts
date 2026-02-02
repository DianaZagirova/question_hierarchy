import axios from 'axios';
import { AgentConfig } from '@/types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
  const response = await api.post('/api/execute-step', params, {
    signal: params.signal,
  });
  return response.data;
};

export const executeStepBatch = async (
  stepId: number, 
  agentConfig: AgentConfig, 
  items: any[], 
  signal?: AbortSignal,
  globalLens?: string
): Promise<any> => {
  const response = await api.post('/api/execute-step-batch', {
    stepId,
    agentConfig,
    items,
    globalLens,
  }, {
    signal,
  });
  return response.data;
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

export const testConnection = async (): Promise<boolean> => {
  try {
    const response = await api.get('/api/health');
    return response.status === 200;
  } catch (error) {
    return false;
  }
};

export default api;

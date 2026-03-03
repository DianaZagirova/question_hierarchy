import axios from 'axios';
import { AgentConfig } from '@/types';
import { sessionManager } from './sessionManager';

// Production (Docker): VITE_API_URL="" -> use empty string for same-origin relative URLs
// Development: VITE_API_URL from .env or default to http://localhost:3002
const envApiUrl = import.meta.env.VITE_API_URL;
const API_URL = envApiUrl === '' ? '' : (envApiUrl || 'http://localhost:3002');

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Generous timeout for long-running batch operations (10 minutes)
  // Individual steps have their own backend timeouts (3-6 minutes)
  timeout: 600000, // 10 minutes in milliseconds
});

// Add request interceptor to inject session ID
api.interceptors.request.use(
  (config) => {
    const sessionId = sessionManager.getSessionId();
    if (sessionId) {
      config.headers['X-Session-ID'] = sessionId;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Add response interceptor to handle session errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Prevent infinite retry loop - only retry once per request
    if (originalRequest._retryCount) {
      console.error('Session retry failed, giving up');
      return Promise.reject(error);
    }

    if (
      error.response?.status === 401 &&
      error.response?.data?.error === 'Invalid session'
    ) {
      // Session expired or invalid, reinitialize
      console.warn('Session expired, reinitializing...');
      originalRequest._retryCount = 1; // Mark as retried

      await sessionManager.initialize();
      // Retry the request with new session
      return api.request(originalRequest);
    }
    return Promise.reject(error);
  }
);

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
  // Start the batch (returns immediately — runs in background on server)
  const startResponse = await api.post('/api/execute-step-batch', {
    stepId,
    agentConfig,
    items,
    globalLens,
    phase_info: phaseInfo,
  }, {
    signal,
  });

  if (!startResponse.data?.started) {
    throw new Error(startResponse.data?.error || 'Failed to start batch execution');
  }

  // Poll for result every 5 seconds
  const POLL_INTERVAL = 5000;
  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, POLL_INTERVAL);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });

    const resultResponse = await api.get(`/api/batch-result?step_id=${stepId}`, { signal });
    if (resultResponse.status === 200 && !resultResponse.data?.pending) {
      return resultResponse.data;
    }
  }
};

export const executeStep4Pipeline = async (
  goalItems: any[],
  domainMapperAgent: AgentConfig,
  domainSpecialistAgent: AgentConfig,
  signal?: AbortSignal,
  globalLens?: string,
): Promise<any> => {
  // Start the pipeline (returns immediately — runs in background on server)
  const startResponse = await api.post('/api/execute-step4-pipeline', {
    goal_items: goalItems,
    domain_mapper_agent: domainMapperAgent,
    domain_specialist_agent: domainSpecialistAgent,
    globalLens,
  }, {
    signal,
  });

  if (!startResponse.data?.started) {
    throw new Error(startResponse.data?.error || 'Failed to start Step 4 pipeline');
  }

  // Poll for result every 5 seconds
  const POLL_INTERVAL = 5000;
  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, POLL_INTERVAL);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });

    const resultResponse = await api.get('/api/step4-result', { signal });
    if (resultResponse.status === 200 && !resultResponse.data?.pending) {
      return resultResponse.data;
    }
  }
};

export const executeStep4Optimized = async (
  goal: any,
  ras: any[],
  spvs: any[],
  signal?: AbortSignal,
): Promise<any> => {
  // Call the optimized Step 4 endpoint (with research APIs and caching)
  const response = await api.post('/api/execute-step4-optimized', {
    goal,
    ras,
    spvs,
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
  // Include session_id as query parameter (SSE can't use custom headers)
  const sessionId = sessionManager.getSessionId();
  const url = `${API_URL}/api/progress/${stepId}?session_id=${sessionId}`;
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

// ─── Node Chat: Stream LLM chat about selected graph nodes ─────────
export interface NodeChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface NodeChatParams {
  selectedNodes: any[];
  messages: NodeChatMessage[];
  q0: string;
  goal: string;
  lens: string;
  model?: string;
  graphSummary?: string;
  l6AnalysisSummary?: string;
}

/**
 * Stream a chat response about selected graph nodes.
 * Calls onToken for each streamed token, onDone when complete.
 * Returns an abort function.
 */
export const streamNodeChat = (
  params: NodeChatParams,
  onToken: (token: string) => void,
  onDone: () => void,
  onError?: (error: string) => void,
): (() => void) => {
  const controller = new AbortController();
  const sessionId = sessionManager.getSessionId();

  fetch(`${API_URL}/api/node-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId && { 'X-Session-ID': sessionId }),
    },
    body: JSON.stringify(params),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok || !response.body) {
        onError?.(`HTTP ${response.status}`);
        onDone();
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.token) onToken(data.token);
            if (data.error) onError?.(data.error);
            if (data.done) { onDone(); return; }
          } catch { /* skip malformed */ }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError?.(err.message);
      }
      onDone();
    });

  return () => controller.abort();
};

// ─── Chat History Persistence ──────────────────────────────────────────

export const saveChatHistory = async (
  conversationId: string | null,
  messages: NodeChatMessage[],
  selectedNodeIds: string[],
): Promise<{ conversationId: string | null }> => {
  try {
    const sessionId = sessionManager.getSessionId();
    const res = await fetch(`${API_URL}/api/chat-history/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId && { 'X-Session-ID': sessionId }),
      },
      body: JSON.stringify({ conversationId, messages, selectedNodeIds }),
    });
    const data = await res.json();
    return { conversationId: data.conversationId || null };
  } catch {
    return { conversationId: null };
  }
};

export const archiveChatHistory = async (conversationId: string | null): Promise<void> => {
  if (!conversationId) return;
  try {
    const sessionId = sessionManager.getSessionId();
    await fetch(`${API_URL}/api/chat-history/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId && { 'X-Session-ID': sessionId }),
      },
      body: JSON.stringify({ conversationId }),
    });
  } catch { /* silent */ }
};

export const loadChatHistory = async (): Promise<{
  conversationId: string | null;
  messages: NodeChatMessage[];
  selectedNodeIds: string[];
}> => {
  try {
    const sessionId = sessionManager.getSessionId();
    const res = await fetch(`${API_URL}/api/chat-history/load`, {
      headers: {
        ...(sessionId && { 'X-Session-ID': sessionId }),
      },
    });
    const data = await res.json();
    return {
      conversationId: data.conversationId || null,
      messages: data.messages || [],
      selectedNodeIds: data.selectedNodeIds || [],
    };
  } catch {
    return { conversationId: null, messages: [], selectedNodeIds: [] };
  }
};

// ─── Full Pipeline: run all steps (1→2→3→4→6→7→8→9) on the backend ──
export interface FullPipelineProgress {
  pending: true;
  step: number;
  step_name: string;
  status: string;
  detail: string;
  elapsed: number;
  completed_steps?: string[];     // e.g. ["step1", "step2", ...]
  step_outputs?: Record<string, any>;  // completed step data for incremental rendering
}

export interface FullPipelineResult {
  success: boolean;
  run_id: string;
  goal: string;
  globalLens?: string;
  step_outputs: Record<string, any>;
  l6_analysis?: any;
  summary: Record<string, number>;
  step_timings: Record<string, number>;
  total_elapsed_seconds: number;
  error?: string;
}

/**
 * Start the full pipeline and poll until complete.
 * Calls onProgress while running, resolves with final result.
 */
export const runFullPipeline = async (
  goal: string,
  globalLens: string,
  agents: Record<string, any>,
  onProgress?: (progress: FullPipelineProgress) => void,
  signal?: AbortSignal,
): Promise<FullPipelineResult> => {
  // 1. Start pipeline
  const startResponse = await api.post('/api/run-full-pipeline', {
    goal,
    globalLens,
    agents,
  }, { signal });

  if (!startResponse.data?.started) {
    throw new Error(startResponse.data?.error || 'Failed to start full pipeline');
  }

  const runId = startResponse.data.run_id;

  // 2. Poll for result (max 30 minutes to prevent infinite polling)
  const POLL_INTERVAL = 2000;
  const MAX_POLL_TIME_MS = 30 * 60 * 1000; // 30 minutes
  const pollStartTime = Date.now();
  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    if (Date.now() - pollStartTime > MAX_POLL_TIME_MS) {
      throw new Error('Pipeline timed out after 30 minutes. Check server logs for details.');
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, POLL_INTERVAL);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });

    const resultResponse = await api.get(`/api/full-pipeline-result?run_id=${runId}`, { signal });

    if (resultResponse.status === 200 && !resultResponse.data?.pending) {
      return resultResponse.data as FullPipelineResult;
    }

    // Still running — report progress
    if (resultResponse.data?.pending && onProgress) {
      onProgress(resultResponse.data as FullPipelineProgress);
    }
  }
};

export const testConnection = async (): Promise<boolean> => {
  try {
    const response = await api.get('/api/health');
    return response.status === 200;
  } catch (error) {
    return false;
  }
};

// ─── Node Improvement: LLM-powered node data improvement ───────────
export interface NodeImprovementParams {
  nodeData: any;
  nodeType: string;
  nodeLabel: string;
  contextNodes: any[];
  q0: string;
  goal: string;
  lens: string;
  model: string;
  temperature: number;
  customPrompt?: string;
}

/**
 * Stream an LLM response to improve node data.
 * Returns an abort function.
 */
export const streamNodeImprovement = (
  params: NodeImprovementParams,
  onToken: (token: string) => void,
  onDone: () => void,
  onError?: (error: string) => void,
): (() => void) => {
  const controller = new AbortController();
  const sessionId = sessionManager.getSessionId();

  fetch(`${API_URL}/api/improve-node`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionId && { 'X-Session-ID': sessionId }),
    },
    body: JSON.stringify(params),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok || !response.body) {
        onError?.(`HTTP ${response.status}`);
        onDone();
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.token) onToken(data.token);
            if (data.error) onError?.(data.error);
            if (data.done) { onDone(); return; }
          } catch { /* skip malformed */ }
        }
      }
      onDone();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError?.(err.message);
      }
      onDone();
    });

  return () => controller.abort();
};

// ─── L6 Perspective Analysis ─────────────────────────────────────────

export interface L6AnalysisParams {
  q0: string;
  goals: any[];
  l6_experiments: any[];
  agentConfig: AgentConfig;
  top_n?: number;
}

export interface L6AnalysisResult {
  selected_experiments: Array<{
    l6_id: string;
    rank: number;
    strategic_value: string;
    impact_potential: string;
    key_insight: string;
    score: number;
  }>;
  overall_assessment: string;
}

/**
 * Analyze L6 experiments and select the most promising ones using LLM
 */
export const analyzeL6Perspective = async (params: L6AnalysisParams): Promise<{
  success: boolean;
  analysis: L6AnalysisResult;
  total_analyzed: number;
  selected_count: number;
}> => {
  const response = await api.post('/api/analyze-l6-perspective', params);
  return response.data;
};

// ─── Node Feedback ──────────────────────────────────────────────────────────

export interface SubmitFeedbackParams {
  node_id: string;
  node_type: string;
  user_session_id: string;
  node_label?: string;
  rating?: number;
  comment?: string;
  category?: string;
  author?: string;
}

export interface NodeFeedbackEntry {
  feedbackId: string;
  sessionId: string;
  userSessionId: string;
  nodeId: string;
  nodeType: string;
  nodeLabel: string | null;
  rating: number | null;
  comment: string | null;
  category: string | null;
  author: string | null;
  createdAt: string;
  updatedAt: string;
}

export const submitNodeFeedback = async (params: SubmitFeedbackParams): Promise<NodeFeedbackEntry> => {
  const response = await api.post('/api/feedback', params);
  return response.data.feedback;
};

export const getNodeFeedback = async (nodeId: string, userSessionId?: string): Promise<NodeFeedbackEntry[]> => {
  const params = new URLSearchParams({ node_id: nodeId });
  if (userSessionId) params.append('user_session_id', userSessionId);
  const response = await api.get(`/api/feedback?${params.toString()}`);
  return response.data.feedback || [];
};

export const getSessionFeedback = async (userSessionId: string): Promise<NodeFeedbackEntry[]> => {
  const response = await api.get(`/api/feedback/session/${userSessionId}`);
  return response.data.feedback || [];
};

export const getAllFeedback = async (): Promise<NodeFeedbackEntry[]> => {
  const response = await api.get('/api/feedback/all');
  return response.data.feedback || [];
};

export interface UpdateFeedbackParams {
  rating?: number;
  comment?: string;
  category?: string;
  author?: string;
}

export const updateNodeFeedback = async (feedbackId: string, params: UpdateFeedbackParams): Promise<NodeFeedbackEntry> => {
  const response = await api.put(`/api/feedback/${feedbackId}`, params);
  return response.data.feedback;
};

export const deleteNodeFeedback = async (feedbackId: string): Promise<void> => {
  await api.delete(`/api/feedback/${feedbackId}`);
};

// ─── Share to Telegram ──────────────────────────────────────────────────────

export interface ShareToTelegramParams {
  chat_id: number;
  summary: string;
  session_json: Record<string, any>;
  filename: string;
}

export const shareToTelegram = async (params: ShareToTelegramParams): Promise<{ ok: boolean }> => {
  const response = await api.post('/api/share/telegram', params);
  return response.data;
};

export default api;

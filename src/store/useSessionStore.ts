import { create } from 'zustand';
import { Session } from '@/types';
import { sessionManager } from '@/lib/sessionManager';
import { stateSync } from '@/lib/stateSync';
import * as sessionApi from '@/lib/sessionApi';

// Legacy localStorage keys for migration
const SESSION_INDEX_KEY = 'omega-point-sessions';
const SESSION_DATA_PREFIX = 'omega-point-session-';
const ACTIVE_SESSION_KEY = 'omega-point-active-session';
const MIGRATED_KEY = 'migrated_to_server_v2';

function getActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_KEY);
}

function setActiveSessionId(id: string) {
  localStorage.setItem(ACTIVE_SESSION_KEY, id);
}

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  isLoading: boolean;

  // Initialize: load sessions from server or migrate from localStorage
  initialize: () => Promise<string>;

  // Create a new session and switch to it
  createSession: (name?: string) => Promise<string>;

  // Switch to a different session (saves current first)
  switchSession: (sessionId: string) => Promise<void>;

  // Rename a session
  renameSession: (sessionId: string, newName: string) => Promise<void>;

  // Delete a session
  deleteSession: (sessionId: string) => Promise<void>;

  // Duplicate a session
  duplicateSession: (sessionId: string) => Promise<string>;

  // Update the goal preview for the active session
  updateActiveSessionMeta: (goalPreview: string) => Promise<void>;

  // Save current Zustand app state into the active session
  saveCurrentToSession: () => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  isLoading: false,

  initialize: async () => {
    set({ isLoading: true });

    try {
      // Initialize browser session with server
      await sessionManager.initialize();

      // Check if we need to migrate from localStorage
      const alreadyMigrated = localStorage.getItem(MIGRATED_KEY);

      if (!alreadyMigrated) {
        console.log('[SessionStore] Starting migration from localStorage to server...');
        await migrateLegacyData();
        localStorage.setItem(MIGRATED_KEY, 'true');
        console.log('[SessionStore] ✓ Migration complete');
      }

      // Load sessions from server
      const sessions = await sessionApi.getUserSessions();

      // If no sessions exist on server, create first one
      if (sessions.length === 0) {
        console.log('[SessionStore] No sessions found, creating first session...');
        const firstSession = await sessionApi.createUserSession('Session 1');
        set({ sessions: [firstSession], activeSessionId: firstSession.id, isLoading: false });
        setActiveSessionId(firstSession.id);
        return firstSession.id;
      }

      // Determine active session
      let activeId = getActiveSessionId();
      if (!activeId || !sessions.find(s => s.id === activeId)) {
        activeId = sessions[0].id;
        setActiveSessionId(activeId);
      }

      // Load active session data
      const sessionData = await sessionApi.getUserSessionData(activeId);
      if (sessionData) {
        // Apply session data to Zustand store
        await stateSync.loadFromObject(sessionData);
      } else {
        // New session with no data - reset to defaults
        console.log('[SessionStore] New session with no data, resetting to defaults');
        await stateSync.resetToDefault();
      }

      set({ sessions, activeSessionId: activeId, isLoading: false });
      return activeId;
    } catch (error) {
      console.error('[SessionStore] Initialization failed:', error);
      // Fallback to localStorage mode
      const fallbackId = await initializeFallbackMode();
      set({ isLoading: false });
      return fallbackId;
    }
  },

  createSession: async (name?: string) => {
    const state = get();

    try {
      // Save current session first
      await state.saveCurrentToSession();

      // Create new session on server
      const newSession = await sessionApi.createUserSession(name || `Session ${state.sessions.length + 1}`);

      // Update local state
      const updatedSessions = [...state.sessions, newSession];
      set({ sessions: updatedSessions, activeSessionId: newSession.id });
      setActiveSessionId(newSession.id);

      // Reload to start with clean state
      window.location.reload();

      return newSession.id;
    } catch (error) {
      console.error('[SessionStore] Failed to create session:', error);
      throw error;
    }
  },

  switchSession: async (sessionId: string) => {
    const state = get();
    if (sessionId === state.activeSessionId) return;

    try {
      // Save current session
      await state.saveCurrentToSession();

      // Load target session data
      const sessionData = await sessionApi.getUserSessionData(sessionId);

      // Update active session
      setActiveSessionId(sessionId);
      set({ activeSessionId: sessionId });

      // Apply session data or reset to defaults
      if (sessionData) {
        await stateSync.loadFromObject(sessionData);
      } else {
        // New session with no data - reset to defaults
        console.log('[SessionStore] Switching to session with no data, resetting to defaults');
        await stateSync.resetToDefault();
      }

      // Reload to apply new state
      window.location.reload();
    } catch (error) {
      console.error('[SessionStore] Failed to switch session:', error);
      throw error;
    }
  },

  renameSession: async (sessionId: string, newName: string) => {
    const state = get();

    try {
      await sessionApi.renameUserSession(sessionId, newName);

      // Update local state
      const updatedSessions = state.sessions.map(s =>
        s.id === sessionId ? { ...s, name: newName, updatedAt: new Date().toISOString() } : s
      );
      set({ sessions: updatedSessions });
    } catch (error) {
      console.error('[SessionStore] Failed to rename session:', error);
      throw error;
    }
  },

  deleteSession: async (sessionId: string) => {
    const state = get();

    if (state.sessions.length <= 1) {
      throw new Error('Cannot delete the last session');
    }

    try {
      await sessionApi.deleteUserSession(sessionId);

      // Update local state
      const updatedSessions = state.sessions.filter(s => s.id !== sessionId);

      // If deleting active session, switch to first remaining one
      if (sessionId === state.activeSessionId) {
        const newActiveId = updatedSessions[0].id;
        const sessionData = await sessionApi.getUserSessionData(newActiveId);

        setActiveSessionId(newActiveId);
        set({ sessions: updatedSessions, activeSessionId: newActiveId });

        if (sessionData) {
          await stateSync.loadFromObject(sessionData);
        }

        window.location.reload();
      } else {
        set({ sessions: updatedSessions });
      }
    } catch (error) {
      console.error('[SessionStore] Failed to delete session:', error);
      throw error;
    }
  },

  duplicateSession: async (sessionId: string) => {
    const state = get();

    try {
      // Save current session if duplicating active one
      if (sessionId === state.activeSessionId) {
        await state.saveCurrentToSession();
      }

      // Duplicate on server
      const newSession = await sessionApi.duplicateUserSession(sessionId);

      // Update local state
      const updatedSessions = [...state.sessions, newSession];
      set({ sessions: updatedSessions });

      return newSession.id;
    } catch (error) {
      console.error('[SessionStore] Failed to duplicate session:', error);
      throw error;
    }
  },

  updateActiveSessionMeta: async (goalPreview: string) => {
    const state = get();
    if (!state.activeSessionId) return;

    try {
      // Update locally
      const updatedSessions = state.sessions.map(s =>
        s.id === state.activeSessionId
          ? { ...s, goalPreview: goalPreview.substring(0, 80), updatedAt: new Date().toISOString() }
          : s
      );
      set({ sessions: updatedSessions });

      // Update on server (save with goalPreview)
      const currentState = await getCurrentZustandState();
      await sessionApi.updateUserSessionData(state.activeSessionId, {
        ...currentState,
        goalPreview: goalPreview.substring(0, 80),
      });
    } catch (error) {
      console.error('[SessionStore] Failed to update session meta:', error);
    }
  },

  saveCurrentToSession: async () => {
    const state = get();
    if (!state.activeSessionId) return;

    try {
      const currentState = await getCurrentZustandState();
      await sessionApi.updateUserSessionData(state.activeSessionId, currentState);
      console.log('[SessionStore] Session saved to server');
    } catch (error) {
      console.error('[SessionStore] Failed to save session:', error);
    }
  },
}));

// ─── Helper Functions ──────────────────────────────────────────────────────

/**
 * Get current state from Zustand store
 */
async function getCurrentZustandState(): Promise<any> {
  // Import useAppStore dynamically to avoid circular dependency
  const { useAppStore } = await import('./useAppStore');
  const state = useAppStore.getState();

  return {
    currentGoal: state.currentGoal,
    agents: state.agents,
    steps: state.steps,
    versions: state.versions,
  };
}

/**
 * Migrate legacy localStorage data to server
 */
async function migrateLegacyData() {
  try {
    // Load legacy sessions from localStorage
    const legacySessionsRaw = localStorage.getItem(SESSION_INDEX_KEY);
    if (!legacySessionsRaw) {
      console.log('[Migration] No legacy sessions found');
      return;
    }

    const legacySessions = JSON.parse(legacySessionsRaw);
    console.log(`[Migration] Found ${legacySessions.length} sessions to migrate`);

    for (const legacySession of legacySessions) {
      try {
        // Create session on server
        const newSession = await sessionApi.createUserSession(legacySession.name);
        console.log(`[Migration] Created session: ${newSession.name}`);

        // Load session data from localStorage
        const sessionDataKey = `${SESSION_DATA_PREFIX}${legacySession.id}`;
        const sessionDataRaw = localStorage.getItem(sessionDataKey);

        if (sessionDataRaw) {
          const sessionData = JSON.parse(sessionDataRaw);

          // Extract state from wrapped format
          const state = sessionData.state || sessionData;

          // Upload to server
          await sessionApi.updateUserSessionData(newSession.id, state);
          console.log(`[Migration] Migrated data for: ${newSession.name}`);
        }
      } catch (error) {
        console.error(`[Migration] Failed to migrate session ${legacySession.name}:`, error);
      }
    }

    console.log('[Migration] ✓ All sessions migrated successfully');
  } catch (error) {
    console.error('[Migration] Migration failed:', error);
    throw error;
  }
}

/**
 * Fallback to localStorage-only mode if server is unavailable
 */
async function initializeFallbackMode(): Promise<string> {
  console.warn('[SessionStore] Falling back to localStorage mode');

  const legacySessionsRaw = localStorage.getItem(SESSION_INDEX_KEY);
  let sessions: Session[] = [];
  let activeId: string | null = getActiveSessionId();

  if (legacySessionsRaw) {
    sessions = JSON.parse(legacySessionsRaw);
  }

  if (sessions.length === 0) {
    // Create first session
    const firstId = `s-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const firstSession: Session = {
      id: firstId,
      name: 'Session 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      goalPreview: '',
    };
    sessions = [firstSession];
    activeId = firstId;
    localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(sessions));
    setActiveSessionId(firstId);
  }

  if (!activeId || !sessions.find(s => s.id === activeId)) {
    activeId = sessions[0].id;
    setActiveSessionId(activeId);
  }

  return activeId;
}

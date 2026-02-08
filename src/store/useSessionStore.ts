import { create } from 'zustand';
import { Session } from '@/types';

const SESSION_INDEX_KEY = 'omega-point-sessions';
const SESSION_DATA_PREFIX = 'omega-point-session-';
const ACTIVE_SESSION_KEY = 'omega-point-active-session';

// Legacy key used by the old single-session store
const LEGACY_STORAGE_KEY = 'omega-point-storage';

function generateId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function loadSessionIndex(): Session[] {
  try {
    const raw = localStorage.getItem(SESSION_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessionIndex(sessions: Session[]) {
  localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(sessions));
}

function getActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_KEY);
}

function setActiveSessionId(id: string) {
  localStorage.setItem(ACTIVE_SESSION_KEY, id);
}

function getSessionStorageKey(sessionId: string): string {
  return `${SESSION_DATA_PREFIX}${sessionId}`;
}

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;

  // Initialize: migrate legacy data if needed, ensure at least one session exists
  initialize: () => string;

  // Create a new session and switch to it
  createSession: (name?: string) => string;

  // Switch to a different session (saves current first)
  switchSession: (sessionId: string) => void;

  // Rename a session
  renameSession: (sessionId: string, newName: string) => void;

  // Delete a session
  deleteSession: (sessionId: string) => void;

  // Duplicate a session
  duplicateSession: (sessionId: string) => string;

  // Update the goal preview for the active session
  updateActiveSessionMeta: (goalPreview: string) => void;

  // Save current Zustand app state into the active session's storage key
  saveCurrentToSession: () => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,

  initialize: () => {
    let sessions = loadSessionIndex();
    let activeId = getActiveSessionId();

    // If no sessions exist, check for legacy data and migrate
    if (sessions.length === 0) {
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
      const firstId = generateId();
      const now = new Date().toISOString();

      let goalPreview = '';
      if (legacyRaw) {
        try {
          const legacyData = JSON.parse(legacyRaw);
          goalPreview = (legacyData.state?.currentGoal || '').substring(0, 80);
          // Copy legacy data to the new session key
          localStorage.setItem(getSessionStorageKey(firstId), legacyRaw);
        } catch {
          // Corrupted legacy data — start fresh
        }
      }

      const firstSession: Session = {
        id: firstId,
        name: goalPreview ? goalPreview.substring(0, 40) || 'Session 1' : 'Session 1',
        createdAt: now,
        updatedAt: now,
        goalPreview,
      };

      sessions = [firstSession];
      activeId = firstId;
      saveSessionIndex(sessions);
      setActiveSessionId(firstId);

      // Point the Zustand persist store at this session's key
      if (legacyRaw) {
        // The legacy key already has the data; copy it to the session key
        // and also keep it at the legacy key so Zustand can rehydrate
        localStorage.setItem(getSessionStorageKey(firstId), legacyRaw);
      }
    }

    // If activeId is not in sessions, pick the first one
    if (!activeId || !sessions.find(s => s.id === activeId)) {
      activeId = sessions[0].id;
      setActiveSessionId(activeId);
    }

    // Point the Zustand persist store at the active session's data
    const sessionData = localStorage.getItem(getSessionStorageKey(activeId));
    if (sessionData) {
      localStorage.setItem(LEGACY_STORAGE_KEY, sessionData);
    }

    set({ sessions, activeSessionId: activeId });
    return activeId;
  },

  createSession: (name?: string) => {
    const state = get();

    // Save current session first
    state.saveCurrentToSession();

    const newId = generateId();
    const now = new Date().toISOString();
    const sessionName = name || `Session ${state.sessions.length + 1}`;

    const newSession: Session = {
      id: newId,
      name: sessionName,
      createdAt: now,
      updatedAt: now,
      goalPreview: '',
    };

    // Clear the legacy key so Zustand starts fresh
    localStorage.removeItem(LEGACY_STORAGE_KEY);

    const updatedSessions = [...state.sessions, newSession];
    saveSessionIndex(updatedSessions);
    setActiveSessionId(newId);

    set({ sessions: updatedSessions, activeSessionId: newId });

    // Force page reload to reinitialize Zustand with empty state
    window.location.reload();

    return newId;
  },

  switchSession: (sessionId: string) => {
    const state = get();
    if (sessionId === state.activeSessionId) return;

    // Save current session
    state.saveCurrentToSession();

    // Load target session data into the legacy key
    const targetData = localStorage.getItem(getSessionStorageKey(sessionId));
    if (targetData) {
      localStorage.setItem(LEGACY_STORAGE_KEY, targetData);
    } else {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    setActiveSessionId(sessionId);
    set({ activeSessionId: sessionId });

    // Reload to rehydrate Zustand from the new data
    window.location.reload();
  },

  renameSession: (sessionId: string, newName: string) => {
    const state = get();
    const updatedSessions = state.sessions.map(s =>
      s.id === sessionId ? { ...s, name: newName, updatedAt: new Date().toISOString() } : s
    );
    saveSessionIndex(updatedSessions);
    set({ sessions: updatedSessions });
  },

  deleteSession: (sessionId: string) => {
    const state = get();
    if (state.sessions.length <= 1) return; // Can't delete the last session

    const updatedSessions = state.sessions.filter(s => s.id !== sessionId);
    localStorage.removeItem(getSessionStorageKey(sessionId));
    saveSessionIndex(updatedSessions);

    // If deleting the active session, switch to the first remaining one
    if (sessionId === state.activeSessionId) {
      const newActiveId = updatedSessions[0].id;
      const targetData = localStorage.getItem(getSessionStorageKey(newActiveId));
      if (targetData) {
        localStorage.setItem(LEGACY_STORAGE_KEY, targetData);
      } else {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
      setActiveSessionId(newActiveId);
      set({ sessions: updatedSessions, activeSessionId: newActiveId });
      window.location.reload();
    } else {
      set({ sessions: updatedSessions });
    }
  },

  duplicateSession: (sessionId: string) => {
    const state = get();
    const sourceSession = state.sessions.find(s => s.id === sessionId);
    if (!sourceSession) return sessionId;

    // Save current first if duplicating the active session
    if (sessionId === state.activeSessionId) {
      state.saveCurrentToSession();
    }

    const newId = generateId();
    const now = new Date().toISOString();

    const newSession: Session = {
      id: newId,
      name: `${sourceSession.name} (copy)`,
      createdAt: now,
      updatedAt: now,
      goalPreview: sourceSession.goalPreview,
    };

    // Copy session data
    const sourceData = localStorage.getItem(getSessionStorageKey(sessionId));
    if (sourceData) {
      localStorage.setItem(getSessionStorageKey(newId), sourceData);
    }

    const updatedSessions = [...state.sessions, newSession];
    saveSessionIndex(updatedSessions);
    set({ sessions: updatedSessions });

    return newId;
  },

  updateActiveSessionMeta: (goalPreview: string) => {
    const state = get();
    if (!state.activeSessionId) return;

    const updatedSessions = state.sessions.map(s =>
      s.id === state.activeSessionId
        ? { ...s, goalPreview: goalPreview.substring(0, 80), updatedAt: new Date().toISOString() }
        : s
    );
    saveSessionIndex(updatedSessions);
    set({ sessions: updatedSessions });
  },

  saveCurrentToSession: () => {
    const state = get();
    if (!state.activeSessionId) return;

    const currentData = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (currentData) {
      localStorage.setItem(getSessionStorageKey(state.activeSessionId), currentData);
    }
  },
}));

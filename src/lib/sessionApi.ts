/**
 * API client for user session management (UI sessions)
 * Communicates with PostgreSQL backend instead of localStorage
 */

import { sessionManager } from './sessionManager';

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Build headers with X-Session-ID for browser session identification.
 * This is critical — without the header, the server can't identify the browser session,
 * causing 401 errors and infinite session creation loops.
 */
function getSessionHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  const sessionId = sessionManager.getSessionId();
  if (sessionId) {
    headers['X-Session-ID'] = sessionId;
  }
  return { ...headers, ...extra };
}

interface UserSession {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  goalPreview: string;
}

interface SessionData {
  [key: string]: any;
}

/**
 * Get all user sessions for the current browser session
 */
export async function getUserSessions(): Promise<UserSession[]> {
  const response = await fetch(`${API_BASE}/api/user-sessions`, {
    headers: getSessionHeaders(),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user sessions');
  }

  const data = await response.json();
  return data.sessions || [];
}

/**
 * Create a new user session
 */
export async function createUserSession(name?: string, author?: string): Promise<UserSession> {
  const response = await fetch(`${API_BASE}/api/user-sessions`, {
    method: 'POST',
    headers: getSessionHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify({ name, author }),
  });

  if (!response.ok) {
    throw new Error('Failed to create user session');
  }

  const data = await response.json();
  return data.session;
}

/**
 * Get data for a specific user session
 */
export async function getUserSessionData(userSessionId: string): Promise<SessionData | null> {
  const response = await fetch(`${API_BASE}/api/user-sessions/${userSessionId}`, {
    headers: getSessionHeaders(),
    credentials: 'include',
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error('Failed to fetch user session data');
  }

  const data = await response.json();
  return data.data;
}

/**
 * Update data for a specific user session
 */
export async function updateUserSessionData(userSessionId: string, data: SessionData): Promise<void> {
  const response = await fetch(`${API_BASE}/api/user-sessions/${userSessionId}`, {
    method: 'PUT',
    headers: getSessionHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error('Failed to update user session data');
  }
}

/**
 * Delete a user session
 */
export async function deleteUserSession(userSessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/user-sessions/${userSessionId}`, {
    method: 'DELETE',
    headers: getSessionHeaders(),
    credentials: 'include',
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to delete user session');
  }
}

/**
 * Duplicate a user session
 */
export async function duplicateUserSession(userSessionId: string): Promise<UserSession> {
  const response = await fetch(`${API_BASE}/api/user-sessions/${userSessionId}/duplicate`, {
    method: 'POST',
    headers: getSessionHeaders(),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to duplicate user session');
  }

  const data = await response.json();
  return data.session;
}

/**
 * Rename a user session
 */
export async function renameUserSession(userSessionId: string, newName: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/user-sessions/${userSessionId}/rename`, {
    method: 'PUT',
    headers: getSessionHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify({ name: newName }),
  });

  if (!response.ok) {
    throw new Error('Failed to rename user session');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Community Sessions
// ═══════════════════════════════════════════════════════════════════════════

export interface CommunitySession {
  id: string;
  name: string;
  author: string;
  goalPreview: string;
  publishedAt: string;
  tags: string[];
  cloneCount: number;
  sourceBrowserSession?: string;
}

/**
 * List all community sessions
 */
export async function listCommunitySessions(limit = 50, offset = 0): Promise<{ sessions: CommunitySession[]; total: number }> {
  const response = await fetch(`${API_BASE}/api/community-sessions?limit=${limit}&offset=${offset}`);
  if (!response.ok) throw new Error('Failed to fetch community sessions');
  return await response.json();
}

/**
 * Clone a community session into user's sessions
 */
export async function cloneCommunitySession(communityId: string): Promise<UserSession> {
  const response = await fetch(`${API_BASE}/api/community-sessions/${communityId}/clone`, {
    method: 'POST',
    headers: getSessionHeaders(),
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to clone community session');
  const data = await response.json();
  return data.session;
}

/**
 * Publish a user session to community
 */
export async function publishSession(userSessionId: string, author?: string, tags?: string[]): Promise<{ published: boolean; communityId: string }> {
  const response = await fetch(`${API_BASE}/api/user-sessions/${userSessionId}/publish`, {
    method: 'POST',
    headers: getSessionHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify({ author: author || 'Anonymous', tags: tags || [] }),
  });
  if (!response.ok) throw new Error('Failed to publish session');
  return await response.json();
}

/**
 * Unpublish (delete) a community session — only owner can do this
 */
export async function unpublishSession(communityId: string): Promise<{ deleted: boolean }> {
  const response = await fetch(`${API_BASE}/api/community-sessions/${communityId}`, {
    method: 'DELETE',
    headers: getSessionHeaders(),
    credentials: 'include',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to unpublish session');
  }
  return await response.json();
}

/**
 * Get community session count (lightweight, no data)
 */
export async function getCommunityCount(): Promise<number> {
  const response = await fetch(`${API_BASE}/api/community-sessions/count`);
  if (!response.ok) return 0;
  const data = await response.json();
  return data.total || 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// Session Bookmarks
// ═══════════════════════════════════════════════════════════════════════════

export interface BookmarkedSession {
  id: string;
  name: string;
  author: string;
  goalPreview: string;
  createdAt: string;
  updatedAt: string;
  browserSessionId: string;
}

/**
 * Toggle bookmark and set author for a user session
 */
export async function bookmarkSession(userSessionId: string, isBookmarked: boolean, author: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/user-sessions/${userSessionId}/bookmark`, {
    method: 'PUT',
    headers: getSessionHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify({ isBookmarked, author }),
  });
  if (!response.ok) throw new Error('Failed to bookmark session');
}

/**
 * Get all bookmarked sessions across all browser sessions
 */
export async function getBookmarkedSessions(): Promise<BookmarkedSession[]> {
  const response = await fetch(`${API_BASE}/api/bookmarked-sessions`);
  if (!response.ok) throw new Error('Failed to fetch bookmarked sessions');
  const data = await response.json();
  return data.sessions || [];
}

/**
 * Load full data for a bookmarked session from any browser session
 */
export async function loadBookmarkedSession(userSessionId: string, browserSessionId: string): Promise<any> {
  const response = await fetch(`${API_BASE}/api/bookmarked-sessions/${userSessionId}/load?browserSessionId=${browserSessionId}`);
  if (!response.ok) throw new Error('Failed to load bookmarked session');
  const data = await response.json();
  return data.data;
}

// ═══════════════════════════════════════════════════════════════════════════
// Export/Import Functions
// ═══════════════════════════════════════════════════════════════════════════

interface ExportData {
  metadata: {
    exported_at: string;
    version: string;
    total_sessions?: number;
  };
  sessions?: Array<{
    metadata: UserSession;
    data: SessionData | null;
  }>;
  session?: {
    metadata: UserSession;
    data: SessionData | null;
  };
}

/**
 * Export all user sessions as JSON
 */
export async function exportAllSessions(): Promise<ExportData> {
  const response = await fetch(`${API_BASE}/api/export/all`, {
    headers: getSessionHeaders(),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to export sessions');
  }

  return await response.json();
}

/**
 * Export a single session as JSON
 */
export async function exportSession(userSessionId: string): Promise<ExportData> {
  const response = await fetch(`${API_BASE}/api/export/session/${userSessionId}`, {
    headers: getSessionHeaders(),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to export session');
  }

  return await response.json();
}

/**
 * Import multiple sessions from JSON
 */
export async function importSessions(exportData: ExportData): Promise<{ imported: number; sessions: UserSession[] }> {
  const response = await fetch(`${API_BASE}/api/import/sessions`, {
    method: 'POST',
    headers: getSessionHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(exportData),
  });

  if (!response.ok) {
    throw new Error('Failed to import sessions');
  }

  const data = await response.json();
  return data;
}

/**
 * Import a single session from JSON
 */
export async function importSession(exportData: ExportData): Promise<{ imported: boolean; session: UserSession }> {
  const response = await fetch(`${API_BASE}/api/import/session`, {
    method: 'POST',
    headers: getSessionHeaders({ 'Content-Type': 'application/json' }),
    credentials: 'include',
    body: JSON.stringify(exportData),
  });

  if (!response.ok) {
    throw new Error('Failed to import session');
  }

  const data = await response.json();
  return data;
}

/**
 * Download export data as a JSON file
 */
export function downloadExportAsFile(exportData: ExportData, filename?: string): void {
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `omega-point-export-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Read and parse import file
 */
export async function readImportFile(file: File): Promise<ExportData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        resolve(json);
      } catch (error) {
        reject(new Error('Invalid JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * API client for user session management (UI sessions)
 * Communicates with PostgreSQL backend instead of localStorage
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

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
    credentials: 'include', // Include session cookie
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
export async function createUserSession(name?: string): Promise<UserSession> {
  const response = await fetch(`${API_BASE}/api/user-sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ name }),
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
    headers: {
      'Content-Type': 'application/json',
    },
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
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ name: newName }),
  });

  if (!response.ok) {
    throw new Error('Failed to rename user session');
  }
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
    headers: {
      'Content-Type': 'application/json',
    },
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
    headers: {
      'Content-Type': 'application/json',
    },
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

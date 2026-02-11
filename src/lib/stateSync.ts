/**
 * State Synchronization Layer for Omega Point
 * Syncs app state between client (localStorage) and server (PostgreSQL)
 */

import api from './api';
import { sessionManager } from './sessionManager';

class StateSync {
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private isSyncing: boolean = false;
  private lastSyncTime: number = 0;

  /**
   * Save current app state to server
   * @param state - The state object to save
   */
  async saveToServer(state: any): Promise<void> {
    if (this.isSyncing) {
      console.log('[StateSync] Sync already in progress, skipping...');
      return;
    }

    const sessionId = sessionManager.getSessionId();
    if (!sessionId) {
      console.warn('[StateSync] No session ID available, skipping server sync');
      return;
    }

    this.isSyncing = true;
    try {
      await api.put('/api/session/state', {
        app_state: state,
      });
      this.lastSyncTime = Date.now();
      console.log('[StateSync] ✓ State saved to server');
    } catch (error) {
      console.error('[StateSync] Failed to save state to server:', error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Load app state from server
   * @returns The loaded state or null if not found
   */
  async loadFromServer(): Promise<any | null> {
    const sessionId = sessionManager.getSessionId();
    if (!sessionId) {
      console.warn('[StateSync] No session ID available, skipping server load');
      return null;
    }

    try {
      const response = await api.get('/api/session/state', {
        params: { key: 'app_state' },
      });

      if (response.data.state) {
        console.log('[StateSync] ✓ State loaded from server');
        return response.data.state;
      }

      return null;
    } catch (error: any) {
      if (error.response?.status === 404) {
        console.log('[StateSync] No saved state found on server (fresh session)');
        return null;
      }
      console.error('[StateSync] Failed to load state from server:', error);
      throw error;
    }
  }

  /**
   * Start automatic syncing every 30 seconds
   * @param getState - Function that returns current state to sync
   */
  startAutoSync(getState: () => any): void {
    if (this.syncInterval) {
      console.warn('[StateSync] Auto-sync already started');
      return;
    }

    console.log('[StateSync] Starting auto-sync (every 30 seconds)');
    this.syncInterval = setInterval(async () => {
      try {
        const state = getState();
        await this.saveToServer(state);
      } catch (error) {
        console.error('[StateSync] Auto-sync failed:', error);
      }
    }, 30000); // 30 seconds
  }

  /**
   * Stop automatic syncing
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[StateSync] Auto-sync stopped');
    }
  }

  /**
   * Manually trigger a sync (useful for critical actions like step completion)
   * @param state - The state object to save
   */
  async syncNow(state: any): Promise<void> {
    console.log('[StateSync] Manual sync triggered');
    await this.saveToServer(state);
  }

  /**
   * Get time elapsed since last successful sync
   * @returns Time in seconds
   */
  getTimeSinceLastSync(): number {
    if (this.lastSyncTime === 0) return Infinity;
    return (Date.now() - this.lastSyncTime) / 1000;
  }

  /**
   * Check if auto-sync is active
   */
  isAutoSyncActive(): boolean {
    return this.syncInterval !== null;
  }

  /**
   * Load state from a plain object (used during session switching)
   * @param state - The state object to apply
   */
  async loadFromObject(state: any): Promise<void> {
    if (!state) {
      console.warn('[StateSync] No state to load');
      return;
    }

    try {
      // Import useAppStore dynamically to avoid circular dependency
      const { useAppStore } = await import('../store/useAppStore');

      // Apply state to Zustand store
      useAppStore.setState({
        currentGoal: state.currentGoal || '',
        agents: state.agents || [],
        steps: state.steps || [],
        versions: state.versions || [],
      });

      console.log('[StateSync] ✓ State loaded from object');
    } catch (error) {
      console.error('[StateSync] Failed to load state from object:', error);
      throw error;
    }
  }

  /**
   * Reset app state to default empty values
   * Used when creating a new session or switching to a session with no data
   */
  async resetToDefault(): Promise<void> {
    try {
      // Import useAppStore dynamically to avoid circular dependency
      const { useAppStore } = await import('../store/useAppStore');

      // Call the store's resetToDefaults action to properly initialize everything
      const resetToDefaults = useAppStore.getState().resetToDefaults;
      if (resetToDefaults) {
        resetToDefaults();
        console.log('[StateSync] ✓ State reset to defaults using store action');
      } else {
        // Fallback: manually reset key fields
        useAppStore.setState({
          currentGoal: '',
          versions: [],
          currentVersionId: null,
          selectedGoalId: null,
          selectedL3Id: null,
          selectedL4Id: null,
        });
        console.log('[StateSync] ✓ State reset to defaults (fallback)');
      }
    } catch (error) {
      console.error('[StateSync] Failed to reset state:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const stateSync = new StateSync();

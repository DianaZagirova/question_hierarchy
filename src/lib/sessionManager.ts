/**
 * Session Manager for Omega Point multi-session support
 * Handles client-side session initialization and validation
 */

import axios from 'axios';

// Production (Docker): VITE_API_URL="" -> use empty string for same-origin relative URLs
// Development: VITE_API_URL from .env or default to http://localhost:3002
const envApiUrl = import.meta.env.VITE_API_URL;
const API_URL = envApiUrl === '' ? '' : (envApiUrl || 'http://localhost:3002');

class SessionManager {
  private sessionId: string | null = null;
  private initialized: boolean = false;

  /**
   * Initialize session - validates existing or creates new
   * Returns the session ID
   */
  async initialize(): Promise<string> {
    if (this.initialized && this.sessionId) {
      return this.sessionId;
    }

    try {
      // Check localStorage for existing session ID
      const storedSessionId = localStorage.getItem('session_id');

      if (storedSessionId) {
        // Validate with server
        const response = await axios.get(`${API_URL}/api/session/validate`, {
          headers: {
            'Content-Type': 'application/json',
            'X-Session-ID': storedSessionId,
          },
        });

        if (response.data.valid && response.data.session_id) {
          // Valid session
          const sessionId = response.data.session_id as string;
          this.sessionId = sessionId;
          this.initialized = true;
          console.log('✓ Session validated:', sessionId.substring(0, 8) + '...');
          return sessionId;
        } else if (response.data.session_id) {
          // Session expired or invalid, use new one from server
          const sessionId = response.data.session_id as string;
          this.sessionId = sessionId;
          localStorage.setItem('session_id', sessionId);
          this.initialized = true;
          console.log('✓ New session created (old expired):', sessionId.substring(0, 8) + '...');
          return sessionId;
        }
      }

      // No stored session or validation failed, create new one
      const response = await axios.post(`${API_URL}/api/session/new`, {}, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (response.data.session_id) {
        const sessionId = response.data.session_id as string;
        this.sessionId = sessionId;
        localStorage.setItem('session_id', sessionId);
        this.initialized = true;
        console.log('✓ New session created:', sessionId.substring(0, 8) + '...');
        return sessionId;
      }

      // Should never reach here, but handle edge case
      throw new Error('Server did not return session ID');
    } catch (error) {
      console.error('Failed to initialize session:', error);
      // Generate a temporary client-side session ID as fallback
      this.sessionId = this.generateFallbackSessionId();
      localStorage.setItem('session_id', this.sessionId);
      this.initialized = true;
      console.warn('⚠ Using fallback session ID (server unavailable)');
      return this.sessionId;
    }
  }

  /**
   * Get current session ID
   * Returns null if not initialized
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Force create a new session (useful for "new session" feature)
   */
  async createNewSession(): Promise<string> {
    try {
      const response = await axios.post(`${API_URL}/api/session/new`, {}, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (response.data.session_id) {
        const sessionId = response.data.session_id as string;
        this.sessionId = sessionId;
        localStorage.setItem('session_id', sessionId);
        this.initialized = true;
        console.log('✓ New session created:', sessionId.substring(0, 8) + '...');
        return sessionId;
      }
      throw new Error('Server did not return session ID');
    } catch (error) {
      console.error('Failed to create new session:', error);
      throw error;
    }
  }

  /**
   * Clear current session (logout)
   */
  clearSession(): void {
    this.sessionId = null;
    this.initialized = false;
    localStorage.removeItem('session_id');
    console.log('✓ Session cleared');
  }

  /**
   * Check if session manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Generate a fallback UUID v4 session ID when server is unavailable
   * This allows the app to function in offline mode with localStorage
   */
  private generateFallbackSessionId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

// Export singleton instance
export const sessionManager = new SessionManager();

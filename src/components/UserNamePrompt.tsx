import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User } from 'lucide-react';

const USER_NAME_KEY = 'omega-point-user-name';
const TG_USER_KEY = 'omega-point-telegram-user';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export function getUserName(): string | null {
  return localStorage.getItem(USER_NAME_KEY);
}

export function setUserName(name: string): void {
  localStorage.setItem(USER_NAME_KEY, name);
}

export function getTelegramUser(): TelegramUser | null {
  try {
    const raw = localStorage.getItem(TG_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setTelegramUser(user: TelegramUser): void {
  localStorage.setItem(TG_USER_KEY, JSON.stringify(user));
}

export function clearTelegramUser(): void {
  localStorage.removeItem(TG_USER_KEY);
}

interface UserNamePromptProps {
  onNameSet: (name: string) => void;
}

export const UserNamePrompt: React.FC<UserNamePromptProps> = ({ onNameSet }) => {
  const [name, setName] = useState('');
  const [botUsername, setBotUsername] = useState('');
  const [tgLoading, setTgLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tgContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // Fetch bot config
  useEffect(() => {
    fetch('/api/config/telegram')
      .then(r => r.json())
      .then(data => {
        if (data.enabled && data.botUsername) {
          setBotUsername(data.botUsername);
        }
      })
      .catch(() => {});
  }, []);

  // Telegram auth callback
  const handleTelegramAuth = useCallback(async (tgUser: any) => {
    setTgLoading(true);
    try {
      // Verify with our backend
      const res = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tgUser),
      });
      const data = await res.json();
      if (data.ok && data.user) {
        const fullName = [data.user.first_name, data.user.last_name].filter(Boolean).join(' ');
        setTelegramUser(data.user);
        setUserName(fullName);
        onNameSet(fullName);
      } else {
        console.error('Telegram auth failed:', data.error);
        setTgLoading(false);
      }
    } catch (err) {
      console.error('Telegram auth error:', err);
      setTgLoading(false);
    }
  }, [onNameSet]);

  // Mount the Telegram widget
  useEffect(() => {
    if (!botUsername || !tgContainerRef.current) return;

    // Expose callback globally
    (window as any).onTelegramAuth = handleTelegramAuth;

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '8');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    script.async = true;

    // Clear previous
    if (tgContainerRef.current) {
      tgContainerRef.current.innerHTML = '';
      tgContainerRef.current.appendChild(script);
    }

    return () => {
      delete (window as any).onTelegramAuth;
    };
  }, [botUsername, handleTelegramAuth]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setUserName(trimmed);
    onNameSet(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 bg-card border border-border/60 rounded-xl shadow-2xl shadow-primary/10 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-3 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/15 flex items-center justify-center mb-3">
            <User className="w-6 h-6 text-primary" />
          </div>
          <h2 className="text-lg font-bold text-foreground">Welcome to Omega Point</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Sign in to track your work across sessions
          </p>
        </div>

        {/* Telegram Login */}
        {botUsername && (
          <div className="px-6 pb-3">
            {tgLoading ? (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                Signing in with Telegram...
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div ref={tgContainerRef} className="flex justify-center min-h-[40px]" />
              </div>
            )}
          </div>
        )}

        {/* Divider */}
        {botUsername && (
          <div className="px-6 flex items-center gap-3 pb-3">
            <div className="flex-1 h-px bg-border/40" />
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">or enter name</span>
            <div className="flex-1 h-px bg-border/40" />
          </div>
        )}

        {/* Manual name input */}
        <div className="px-6 pb-2">
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            placeholder="Your name"
            className="w-full px-4 py-2.5 text-sm bg-background border border-border/60 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/40 placeholder:text-muted-foreground/50"
            autoComplete="name"
          />
        </div>

        {/* Button */}
        <div className="px-6 pb-6 pt-2">
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="w-full py-2.5 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

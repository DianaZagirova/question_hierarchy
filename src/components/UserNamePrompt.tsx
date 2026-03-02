import React, { useState, useEffect, useRef } from 'react';
import { User } from 'lucide-react';

const USER_NAME_KEY = 'omega-point-user-name';

interface UserNamePromptProps {
  onNameSet: (name: string) => void;
}

export function getUserName(): string | null {
  return localStorage.getItem(USER_NAME_KEY);
}

export function setUserName(name: string): void {
  localStorage.setItem(USER_NAME_KEY, name);
}

export const UserNamePrompt: React.FC<UserNamePromptProps> = ({ onNameSet }) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus the input
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

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
            Enter your name so your work can be identified across sessions
          </p>
        </div>

        {/* Input */}
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

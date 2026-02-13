import React, { useState, useRef, useEffect } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import { Plus, ChevronDown, Trash2, Copy, Pencil, Check, X, FolderOpen, Download, Upload, Globe, Share2, Users } from 'lucide-react';
import * as sessionApi from '@/lib/sessionApi';
import type { CommunitySession } from '@/lib/sessionApi';

type TabType = 'my' | 'community';

export const SessionSwitcher: React.FC = () => {
  const { sessions, activeSessionId, createSession, switchSession, renameSession, deleteSession, duplicateSession } = useSessionStore();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('my');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [communitySessionsList, setCommunitySessionsList] = useState<CommunitySession[]>([]);
  const [communityTotal, setCommunityTotal] = useState(0);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setEditingId(null);
        setShowNewInput(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load community sessions when tab switches
  useEffect(() => {
    if (activeTab === 'community' && isOpen) {
      loadCommunitySessions();
    }
  }, [activeTab, isOpen]);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (showNewInput && newInputRef.current) {
      newInputRef.current.focus();
    }
  }, [showNewInput]);

  const loadCommunitySessions = async () => {
    try {
      setCommunityLoading(true);
      const result = await sessionApi.listCommunitySessions();
      setCommunitySessionsList(result.sessions);
      setCommunityTotal(result.total);
    } catch (error) {
      console.error('Failed to load community sessions:', error);
    } finally {
      setCommunityLoading(false);
    }
  };

  const handleClone = async (communityId: string) => {
    try {
      setCloningId(communityId);
      await sessionApi.cloneCommunitySession(communityId);
      window.location.reload();
    } catch (error) {
      console.error('Failed to clone session:', error);
      alert('Failed to clone session. Please try again.');
    } finally {
      setCloningId(null);
    }
  };

  const handlePublish = async (userSessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const author = prompt('Your name (for attribution):', 'Anonymous');
    if (author === null) return;
    try {
      setPublishingId(userSessionId);
      await sessionApi.publishSession(userSessionId, author || 'Anonymous');
      alert('Session published to community! 🎉');
      if (activeTab === 'community') loadCommunitySessions();
    } catch (error) {
      console.error('Failed to publish session:', error);
      alert('Failed to publish session.');
    } finally {
      setPublishingId(null);
    }
  };

  const handleStartRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const handleConfirmRename = () => {
    if (editingId && editName.trim()) {
      renameSession(editingId, editName.trim());
    }
    setEditingId(null);
  };

  const handleCreateSession = async () => {
    const name = newName.trim() || undefined;
    try {
      setIsCreating(true);
      await createSession(name);
    } catch (error) {
      console.error('Failed to create session:', error);
      alert('Failed to create session. Please try again.');
    } finally {
      setIsCreating(false);
      setShowNewInput(false);
      setNewName('');
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length <= 1) return;
    if (window.confirm('Delete this session? All its pipeline data will be lost.')) {
      deleteSession(id);
    }
  };

  const handleDuplicate = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    duplicateSession(id);
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const exportData = await sessionApi.exportAllSessions();
      sessionApi.downloadExportAsFile(exportData, `omega-point-sessions-${Date.now()}.json`);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export sessions');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);
      const importData = await sessionApi.readImportFile(file);
      const result = await sessionApi.importSessions(importData);
      alert(`Successfully imported ${result.imported} session(s)`);
      window.location.reload();
    } catch (error) {
      console.error('Import failed:', error);
      alert('Failed to import sessions');
    } finally {
      setIsImporting(false);
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/40 border border-border/50 hover:border-primary/40 hover:bg-secondary/60 transition-all text-sm max-w-[260px]"
      >
        <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
        <span className="truncate text-foreground font-medium">
          {activeSession?.name || 'Session'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-card border border-border/60 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border/40 bg-secondary/20">
            <button
              onClick={() => setActiveTab('my')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                activeTab === 'my'
                  ? 'text-primary border-b-2 border-primary bg-primary/5'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/30'
              }`}
            >
              <FolderOpen className="w-3 h-3" />
              My ({sessions.length})
            </button>
            <button
              onClick={() => setActiveTab('community')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                activeTab === 'community'
                  ? 'text-accent border-b-2 border-accent bg-accent/5'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/30'
              }`}
            >
              <Globe className="w-3 h-3" />
              Community ({communityTotal})
            </button>
          </div>

          {/* My Sessions Tab */}
          {activeTab === 'my' && (
            <>
              {/* Session list */}
              <div className="max-h-64 overflow-y-auto">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => {
                      if (editingId === session.id) return;
                      switchSession(session.id);
                    }}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors group ${
                      session.id === activeSessionId
                        ? 'bg-primary/10 border-l-2 border-l-primary'
                        : 'hover:bg-secondary/40 border-l-2 border-l-transparent'
                    }`}
                  >
                    {editingId === session.id ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <input
                          ref={editInputRef}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleConfirmRename();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="flex-1 min-w-0 px-1.5 py-0.5 text-xs bg-background border border-primary/40 rounded focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <button onClick={handleConfirmRename} className="p-0.5 text-green-500 hover:text-green-400">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-0.5 text-muted-foreground hover:text-foreground">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-foreground truncate">{session.name}</div>
                          {session.goalPreview && (
                            <div className="text-[10px] text-muted-foreground truncate mt-0.5">{session.goalPreview}</div>
                          )}
                          <div className="text-[9px] text-muted-foreground/60 mt-0.5">
                            {new Date(session.updatedAt).toLocaleDateString()} {new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={(e) => handlePublish(session.id, e)}
                            disabled={publishingId === session.id}
                            className="p-1 rounded hover:bg-accent/10 text-muted-foreground hover:text-accent"
                            title="Publish to Community"
                          >
                            <Share2 className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStartRename(session.id, session.name); }}
                            className="p-1 rounded hover:bg-secondary/60 text-muted-foreground hover:text-foreground"
                            title="Rename"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => handleDuplicate(session.id, e)}
                            className="p-1 rounded hover:bg-secondary/60 text-muted-foreground hover:text-foreground"
                            title="Duplicate"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          {sessions.length > 1 && (
                            <button
                              onClick={(e) => handleDelete(session.id, e)}
                              className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Export/Import */}
              <div className="border-t border-border/40 p-2 bg-secondary/10">
                <div className="flex gap-2">
                  <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded transition-colors disabled:opacity-50"
                    title="Export all sessions"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isExporting ? 'Exporting...' : 'Export'}
                  </button>

                  <label className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 rounded transition-colors cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    {isImporting ? 'Importing...' : 'Import'}
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".json"
                      onChange={handleImport}
                      disabled={isImporting}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* New session */}
              <div className="border-t border-border/40 p-2">
                {showNewInput ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      ref={newInputRef}
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !isCreating) handleCreateSession();
                        if (e.key === 'Escape') { setShowNewInput(false); setNewName(''); }
                      }}
                      placeholder="Session name (optional)"
                      disabled={isCreating}
                      className="flex-1 min-w-0 px-2 py-1 text-xs bg-background border border-border/60 rounded focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <button
                      onClick={handleCreateSession}
                      disabled={isCreating}
                      className="px-2 py-1 text-xs font-semibold rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isCreating ? 'Creating...' : 'Create'}
                    </button>
                    <button
                      onClick={() => { setShowNewInput(false); setNewName(''); }}
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewInput(true)}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Session
                  </button>
                )}
              </div>
            </>
          )}

          {/* Community Tab */}
          {activeTab === 'community' && (
            <>
              <div className="max-h-72 overflow-y-auto">
                {communityLoading ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
                    Loading community sessions...
                  </div>
                ) : communitySessionsList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <Users className="w-8 h-8 text-muted-foreground/30" />
                    <div className="text-xs text-muted-foreground">No community sessions yet</div>
                    <div className="text-[10px] text-muted-foreground/60">Publish your session to share it!</div>
                  </div>
                ) : (
                  communitySessionsList.map((cs) => (
                    <div
                      key={cs.id}
                      className="flex items-center gap-2 px-3 py-2.5 hover:bg-secondary/40 border-l-2 border-l-transparent transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">{cs.name}</div>
                        {cs.goalPreview && (
                          <div className="text-[10px] text-muted-foreground truncate mt-0.5">{cs.goalPreview}</div>
                        )}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] text-muted-foreground/60">by {cs.author}</span>
                          <span className="text-[9px] text-muted-foreground/40">•</span>
                          <span className="text-[9px] text-muted-foreground/60">
                            {new Date(cs.publishedAt).toLocaleDateString()}
                          </span>
                          {cs.cloneCount > 0 && (
                            <>
                              <span className="text-[9px] text-muted-foreground/40">•</span>
                              <span className="text-[9px] text-muted-foreground/60">{cs.cloneCount} clones</span>
                            </>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => handleClone(cs.id)}
                        disabled={cloningId === cs.id}
                        className="shrink-0 px-2.5 py-1 text-[10px] font-semibold rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors disabled:opacity-50"
                        title="Clone to My Sessions"
                      >
                        {cloningId === cs.id ? '...' : 'Clone'}
                      </button>
                    </div>
                  ))
                )}
              </div>

              {communityTotal > communitySessionsList.length && (
                <div className="border-t border-border/40 p-2 text-center">
                  <button
                    onClick={() => {/* TODO: pagination */}}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    Show more ({communityTotal - communitySessionsList.length} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

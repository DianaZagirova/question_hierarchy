import React, { useState, useRef, useEffect } from 'react';
import { useSessionStore } from '@/store/useSessionStore';
import { Plus, ChevronDown, Trash2, Copy, Pencil, Check, X, FolderOpen, Download, Upload, Globe, Share2, Users } from 'lucide-react';
import * as sessionApi from '@/lib/sessionApi';
import { sessionManager } from '@/lib/sessionManager';
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
  const [newAuthor, setNewAuthor] = useState(localStorage.getItem('omega-point-user-name') || '');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [communitySessionsList, setCommunitySessionsList] = useState<CommunitySession[]>([]);
  const [communityTotal, setCommunityTotal] = useState(0);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [unpublishingId, setUnpublishingId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const browserSessionId = sessionManager.getSessionId();

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

  // Preload community count on mount so tab badge is always up-to-date
  useEffect(() => {
    sessionApi.getCommunityCount().then(count => setCommunityTotal(count)).catch(() => {});
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

  // (bookmark input removed — Saved tab removed)

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
      const newSession = await sessionApi.cloneCommunitySession(communityId);
      if (newSession?.id) {
        switchSession(newSession.id);
      }
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
    const author = prompt('Your name (for attribution):', localStorage.getItem('omega-point-user-name') || 'Anonymous');
    if (author === null) return;
    try {
      setPublishingId(userSessionId);
      await sessionApi.publishSession(userSessionId, author || 'Anonymous');
      alert('Session published to community!');
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
    const author = newAuthor.trim() || localStorage.getItem('omega-point-user-name') || '';
    if (author) {
      localStorage.setItem('omega-point-user-name', author);
    }
    try {
      setIsCreating(true);
      await createSession(name, author || undefined);
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

  const handleUnpublish = async (communityId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Remove this session from Community? Other users will no longer see it.')) return;
    try {
      setUnpublishingId(communityId);
      await sessionApi.unpublishSession(communityId);
      setCommunitySessionsList(prev => prev.filter(cs => cs.id !== communityId));
      setCommunityTotal(prev => Math.max(0, prev - 1));
    } catch (error: any) {
      console.error('Failed to unpublish:', error);
      alert(error.message || 'Failed to remove session');
    } finally {
      setUnpublishingId(null);
    }
  };


  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2.5 px-4 py-2 rounded-lg bg-secondary/40 border border-border/50 hover:border-primary/40 hover:bg-secondary/60 transition-all text-sm max-w-[320px]"
      >
        <FolderOpen className="w-4 h-4 text-primary shrink-0" />
        <span className="truncate text-foreground font-medium text-sm">
          {activeSession?.name || 'Session'}
        </span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-1.5 w-[480px] max-w-[calc(100vw-1rem)] bg-card border border-border/60 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border/40 bg-secondary/20">
            <button
              onClick={() => setActiveTab('my')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                activeTab === 'my'
                  ? 'text-primary border-b-2 border-primary bg-primary/5'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/30'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              My ({sessions.length})
            </button>
            <button
              onClick={() => setActiveTab('community')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                activeTab === 'community'
                  ? 'text-accent border-b-2 border-accent bg-accent/5'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/30'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Community ({communityTotal})
            </button>
            {/* Saved tab removed — use Community to share/access sessions */}
          </div>

          {/* My Sessions Tab */}
          {activeTab === 'my' && (
            <>
              {/* Session list */}
              <div className="max-h-80 overflow-y-auto">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => {
                      if (editingId === session.id) return;
                      switchSession(session.id);
                    }}
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors group ${
                      session.id === activeSessionId
                        ? 'bg-primary/10 border-l-3 border-l-primary'
                        : 'hover:bg-secondary/40 border-l-3 border-l-transparent'
                    }`}
                  >
                    {editingId === session.id ? (
                      <div className="flex items-center gap-2 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <input
                          ref={editInputRef}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleConfirmRename();
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="flex-1 min-w-0 px-2.5 py-1.5 text-sm bg-background border border-primary/40 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <button onClick={handleConfirmRename} className="p-1 text-green-500 hover:text-green-400">
                          <Check className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-1 text-muted-foreground hover:text-foreground">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">{session.name}</span>
                          </div>
                          {session.goalPreview && (
                            <div className="text-xs text-muted-foreground truncate mt-0.5">{session.goalPreview}</div>
                          )}
                          <div className="text-xs text-muted-foreground/60 mt-0.5">
                            {session.author && <span className="mr-2">by {session.author}</span>}
                            {new Date(session.updatedAt).toLocaleDateString()} {new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={(e) => handlePublish(session.id, e)}
                            disabled={publishingId === session.id}
                            className="p-1.5 rounded-md hover:bg-accent/10 text-muted-foreground hover:text-accent"
                            title="Publish to Community"
                          >
                            <Share2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleStartRename(session.id, session.name); }}
                            className="p-1.5 rounded-md hover:bg-secondary/60 text-muted-foreground hover:text-foreground"
                            title="Rename"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleDuplicate(session.id, e)}
                            className="p-1.5 rounded-md hover:bg-secondary/60 text-muted-foreground hover:text-foreground"
                            title="Duplicate"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          {sessions.length > 1 && (
                            <button
                              onClick={(e) => handleDelete(session.id, e)}
                              className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Export/Import/Reset */}
              <div className="border-t border-border/40 px-4 py-2.5 bg-secondary/10">
                <div className="flex gap-3">
                  <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 rounded-md transition-colors disabled:opacity-50"
                    title="Export all sessions"
                  >
                    <Download className="w-4 h-4" />
                    {isExporting ? 'Exporting...' : 'Export'}
                  </button>

                  <label className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/10 rounded-md transition-colors cursor-pointer">
                    <Upload className="w-4 h-4" />
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
              <div className="border-t border-border/40 px-4 py-3">
                {showNewInput ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
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
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-background border border-border/60 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <button
                        onClick={handleCreateSession}
                        disabled={isCreating}
                        className="px-3 py-1.5 text-sm font-semibold rounded-md bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isCreating ? 'Creating...' : 'Create'}
                      </button>
                      <button
                        onClick={() => { setShowNewInput(false); setNewName(''); }}
                        className="p-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">Author:</span>
                      <input
                        value={newAuthor}
                        onChange={(e) => setNewAuthor(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isCreating) handleCreateSession();
                          if (e.key === 'Escape') { setShowNewInput(false); setNewName(''); }
                        }}
                        placeholder="Your name"
                        disabled={isCreating}
                        className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-background border border-accent/40 rounded-md focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/40 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewInput(true)}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 rounded-md transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    New Session
                  </button>
                )}
              </div>
            </>
          )}

          {/* Community Tab */}
          {activeTab === 'community' && (
            <>
              <div className="max-h-96 overflow-y-auto">
                {communityLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
                    Loading community sessions...
                  </div>
                ) : communitySessionsList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <Users className="w-10 h-10 text-muted-foreground/30" />
                    <div className="text-sm text-muted-foreground">No community sessions yet</div>
                    <div className="text-xs text-muted-foreground/60">Publish your session to share it!</div>
                  </div>
                ) : (
                  communitySessionsList.map((cs) => {
                    const isOwner = browserSessionId && cs.sourceBrowserSession === browserSessionId;
                    return (
                      <div
                        key={cs.id}
                        onClick={() => handleClone(cs.id)}
                        className={`flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors group cursor-pointer ${
                          isOwner ? 'border-l-3 border-l-accent/40' : 'border-l-3 border-l-transparent'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate">{cs.name}</span>
                            {isOwner && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-bold uppercase">yours</span>
                            )}
                          </div>
                          {cs.goalPreview && (
                            <div className="text-xs text-muted-foreground truncate mt-0.5">{cs.goalPreview}</div>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-muted-foreground/60">by {cs.author}</span>
                            <span className="text-xs text-muted-foreground/40">-</span>
                            <span className="text-xs text-muted-foreground/60">
                              {new Date(cs.publishedAt).toLocaleDateString()}
                            </span>
                            {cs.cloneCount > 0 && (
                              <>
                                <span className="text-xs text-muted-foreground/40">-</span>
                                <span className="text-xs text-muted-foreground/60">{cs.cloneCount} clones</span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isOwner && (
                            <button
                              onClick={(e) => handleUnpublish(cs.id, e)}
                              disabled={unpublishingId === cs.id}
                              className="p-1.5 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                              title="Remove from Community"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          <span className={`px-3.5 py-1.5 text-xs font-semibold rounded-md bg-accent/15 text-accent transition-colors ${cloningId === cs.id ? 'opacity-50' : 'group-hover:bg-accent/25'}`}>
                            {cloningId === cs.id ? 'Opening...' : 'Open'}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {communityTotal > communitySessionsList.length && (
                <div className="border-t border-border/40 p-3 text-center">
                  <button
                    onClick={() => {/* TODO: pagination */}}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Show more ({communityTotal - communitySessionsList.length} remaining)
                  </button>
                </div>
              )}
            </>
          )}

          {/* Saved tab removed — simplified to My + Community */}
        </div>
      )}
    </div>
  );
};

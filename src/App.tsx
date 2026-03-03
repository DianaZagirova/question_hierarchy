import React, { useState, useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { useSessionStore } from './store/useSessionStore';
import { usePipelineExecution } from './hooks/usePipelineExecution';
import { loadPipelineJSON, saveToFile, saveInputsOutputs } from './lib/fileIO';
import { SessionSwitcher } from './components/SessionSwitcher';
import { AgentCard } from './components/AgentCard';
import { PipelineView } from './components/PipelineView';
import { GraphVisualizationWrapper } from './components/GraphVisualizationWrapper';
import { ParticleBackground } from './components/ParticleBackground';
import { SystemOverview } from './components/SystemOverview';
import { L6PerspectiveAnalyzer } from './components/L6PerspectiveAnalyzer';
import { Button } from './components/ui/Button';
import { Select } from './components/ui/Select';
import { Card, CardHeader, CardTitle, CardContent } from './components/ui/Card';
import { Users, User, GitBranch, Save, History, Network, LayoutGrid, Download, Shield, Zap, Target, X, Play, RefreshCw, Upload, FileJson, Trash2, Eye, EyeOff, Info, Maximize2, Minimize2, Rocket, Square, Send } from 'lucide-react';
import { runFullPipeline, FullPipelineProgress, shareToTelegram, getSessionFeedback } from './lib/api';
import { UserNamePrompt, getUserName, getTelegramUser, clearTelegramUser, setUserName as storeUserName } from './components/UserNamePrompt';
import type { TelegramUser } from './components/UserNamePrompt';

function App() {
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'split' | 'pipeline' | 'graph' | 'versions' | 'scientific'>('split');
  const [scientificPillars, setScientificPillars] = useState<any>(null);
  const [splitRatio, setSplitRatio] = useState(27); // Percentage for pipeline width
  const [isDragging, setIsDragging] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null); // For single-goal pipeline
  const [selectedL3Id, setSelectedL3Id] = useState<string | null>(null); // For single-L3 pipeline
  const [selectedL4Id, setSelectedL4Id] = useState<string | null>(null); // For single-L4 pipeline
  const [globalLens, setGlobalLens] = useState<string>(''); // Global lens for all agents
  const [lensKey, setLensKey] = useState<string>(''); // Which preset is selected (or 'custom')
  const [customLensText, setCustomLensText] = useState<string>(''); // Freeform custom lens
  const [editedLensDescriptions, setEditedLensDescriptions] = useState<Record<string, string>>({}); // Overrides for preset descriptions
  const [zenMode, setZenMode] = useState(false); // Zen mode - show only graph and minimap
  const [graphFullscreen, setGraphFullscreen] = useState(false); // Graph fullscreen overlay
  const [primaryObjectiveCollapsed, setPrimaryObjectiveCollapsed] = useState(false); // Primary Objective collapsed state
  const [fullPipelineRunning, setFullPipelineRunning] = useState(false);
  const [fullPipelineProgress, setFullPipelineProgress] = useState<FullPipelineProgress | null>(null);
  const [fullPipelineError, setFullPipelineError] = useState(false);
  const [userName, setUserName] = useState<string | null>(getUserName());
  const [telegramUser, setTelegramUserState] = useState<TelegramUser | null>(getTelegramUser());
  const [telegramSharing, setTelegramSharing] = useState(false);
  const fullPipelineAbortRef = React.useRef<AbortController | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const {
    currentGoal,
    setGoal,
    agents,
    updateAgent,
    steps,
    updateStepStatus,
    clearStep,
    resetToDefaults,
    saveVersion,
    versions,
    loadVersion,
    deleteVersion,
    resetPipeline,
    setL6AnalysisResult,
    highlightedL6Ids,
    l6AnalysisResult,
  } = useAppStore();

  // Pipeline execution hook (handles all step running, aborting, single-goal execution)
  const { handleRunStep, handleAbortStep, handleRetryStep, handleRunStep4Phase, handleRunStepForSingleGoal } =
    usePipelineExecution({ selectedGoalId, selectedL3Id, selectedL4Id, globalLens });

  // NOTE: sessionManager.initialize() is called inside useSessionStore.initialize()
  // No separate sessionManager init effect needed — it's all sequenced in initSessions()

  // File I/O handlers
  const handleLoadPipelineJSON = (file: File) => {
    loadPipelineJSON(file, {
      setGoal,
      updateStepStatus,
      clearSelections: () => {
        setSelectedGoalId(null);
        setSelectedL3Id(null);
        setSelectedL4Id(null);
      },
    });
  };

  const handleSaveToFile = () => {
    saveToFile(currentGoal, steps, agents);
    alert('Results saved to file successfully!');
  };

  const handleSaveInputsOutputs = () => {
    saveInputsOutputs(currentGoal, steps, selectedGoalId);
    alert('Input/Output check file saved successfully!');
  };

  const handleShareToTelegram = async () => {
    if (!telegramUser?.id) return;
    setTelegramSharing(true);
    try {
      const activeSession = sessions?.find((s: any) => s.id === activeSessionId);
      const sessionName = activeSession?.name || '';
      const q0 = steps[0]?.output?.master_question || steps[0]?.output?.Q0 || '';

      // ── Count pipeline stats ──
      const goalsArr = steps[1]?.output?.goals || [];
      const goalCount = Array.isArray(goalsArr) ? goalsArr.length : 0;

      const raOutput = steps[2]?.output;
      let raCount = 0;
      if (raOutput && typeof raOutput === 'object') {
        Object.values(raOutput).forEach((v: any) => { if (Array.isArray(v)) raCount += v.length; });
      }

      const l3Output = steps[5]?.output;
      const l3s = l3Output?.l3_questions || (Array.isArray(l3Output) ? l3Output : []);
      const l3Count = l3s.length;

      const ihOutput = steps[6]?.output;
      let ihCount = 0;
      if (Array.isArray(ihOutput)) ihOutput.forEach((g: any) => {
        const qs = g?.l3_questions || g?.questions || [];
        qs.forEach((q: any) => { ihCount += (q?.instantiation_hypotheses || []).length; });
      });

      const l4Output = steps[7]?.output;
      const l4s = l4Output?.l4_questions || (Array.isArray(l4Output) ? l4Output : []);
      const l4Count = l4s.length;

      let l6Count = 0;
      const l6Output = steps[8]?.output;
      if (l6Output) {
        const walkL6 = (arr: any[]) => arr?.forEach((item: any) => {
          if (item?.l6_leaf_specifications) l6Count += item.l6_leaf_specifications.length;
          else if (item?.l5_mechanistic_sub_questions) {
            item.l5_mechanistic_sub_questions.forEach((l5: any) => {
              if (l5?.l6_leaf_specifications) l6Count += l5.l6_leaf_specifications.length;
            });
          }
        });
        if (Array.isArray(l6Output)) walkL6(l6Output);
        else if (l6Output.results) walkL6(l6Output.results);
      }

      // ── Feedback ──
      let feedbackEntries: any[] = [];
      if (activeSessionId) {
        try { feedbackEntries = await getSessionFeedback(activeSessionId); } catch { /* */ }
      }

      // ── Build concise text summary ──
      const esc = (s: string) => s.replace(/[*_`\[]/g, '\\$&');
      const lines: string[] = [];

      lines.push('🔬 *Omega Point — Session Report*');
      if (sessionName) lines.push(`📋 ${esc(sessionName)}`);
      lines.push('');

      if (q0) {
        lines.push('*Q₀:*');
        lines.push(`_${esc(q0.length > 200 ? q0.slice(0, 200) + '…' : q0)}_`);
        lines.push('');
      }
      if (currentGoal && currentGoal !== q0) {
        lines.push(`*Goal:* ${esc(currentGoal.slice(0, 120))}`);
        lines.push('');
      }

      // Pipeline stats block
      const statParts: string[] = [];
      if (goalCount) statParts.push(`${goalCount} goals`);
      if (raCount) statParts.push(`${raCount} req. atoms`);
      if (l3Count) statParts.push(`${l3Count} L3 questions`);
      if (ihCount) statParts.push(`${ihCount} hypotheses`);
      if (l4Count) statParts.push(`${l4Count} L4 tactical`);
      if (l6Count) statParts.push(`${l6Count} L6 experiments`);
      if (statParts.length) {
        lines.push(`*Pipeline:* ${statParts.join(' → ')}`);
        lines.push('');
      }

      // Best L6 — top 3 one-liners
      if (l6AnalysisResult?.selected_experiments?.length) {
        lines.push('*Top experiments:*');
        l6AnalysisResult.selected_experiments.slice(0, 3).forEach((exp) => {
          lines.push(`  #${exp.rank} ⭐${exp.score}/10 — ${esc(exp.key_insight?.slice(0, 90) || exp.l6_id)}`);
        });
        const total = l6AnalysisResult.selected_experiments.length;
        if (total > 3) lines.push(`  _…and ${total - 3} more in the file_`);
        lines.push('');
      } else if (highlightedL6Ids.length > 0) {
        lines.push(`*Best L6:* ${highlightedL6Ids.length} selected`);
        lines.push('');
      }

      // Feedback count
      if (feedbackEntries.length > 0) {
        lines.push(`*Feedback:* ${feedbackEntries.length} note${feedbackEntries.length > 1 ? 's' : ''} on ${new Set(feedbackEntries.map(f => f.nodeId)).size} node${new Set(feedbackEntries.map(f => f.nodeId)).size > 1 ? 's' : ''}`);
        lines.push('');
      }

      lines.push('📎 _Full session JSON attached below_');
      lines.push('_Shared from_ [Omega Point](https://q0.openlongevity.work)');

      const summary = lines.join('\n');

      // ── Build full session JSON ──
      const sessionJson: Record<string, any> = {
        goal: currentGoal,
        timestamp: new Date().toISOString(),
        session_name: sessionName,
        steps: steps.map(s => ({
          id: s.id,
          name: s.name,
          status: s.status,
          output: s.output,
          timestamp: s.timestamp,
        })),
        highlighted_l6_ids: highlightedL6Ids,
        l6_analysis: l6AnalysisResult,
        feedback: feedbackEntries.map(fb => ({
          node_id: fb.nodeId,
          node_type: fb.nodeType,
          node_label: fb.nodeLabel,
          rating: fb.rating,
          category: fb.category,
          comment: fb.comment,
          created_at: fb.createdAt,
        })),
      };

      // Filename
      const slug = (currentGoal || 'session').slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
      const filename = `omega_point_${slug}_${Date.now()}.json`;

      await shareToTelegram({
        chat_id: telegramUser.id,
        summary,
        session_json: sessionJson,
        filename,
      });

      alert('Report sent to your Telegram! Check your chat with @omega_point_q0_bot');
    } catch (err: any) {
      console.error('Share to Telegram failed:', err);
      alert(err?.response?.data?.error || err.message);
    } finally {
      setTelegramSharing(false);
    }
  };

  const handleEditOutput = (stepId: number, newOutput: any) => {
    updateStepStatus(stepId, 'completed', newOutput);
  };

  // Full pipeline execution
  const handleRunFullPipeline = async () => {
    if (fullPipelineRunning || !currentGoal) return;

    setFullPipelineRunning(true);
    setFullPipelineProgress(null);

    // Mark all pipeline steps as running
    const pipelineStepIds = [1, 2, 3, 4, 6, 7, 8, 9];
    for (const stepId of pipelineStepIds) {
      updateStepStatus(stepId, 'pending');
    }
    updateStepStatus(1, 'running');

    const abortController = new AbortController();
    fullPipelineAbortRef.current = abortController;

    // Track which steps have been applied to avoid duplicate updates
    const appliedSteps = new Set<number>();

    // Build agent overrides from current agent configs
    const agentOverrides: Record<string, any> = {};
    for (const agent of agents) {
      agentOverrides[agent.id] = agent;
    }

    try {
      const result = await runFullPipeline(
        currentGoal,
        globalLens,
        agentOverrides,
        (progress) => {
          setFullPipelineProgress(progress);

          // Apply completed step outputs incrementally for live graph rendering
          const stepMap: Record<string, number> = {
            step1: 1, step2: 2, step3: 3, step4: 4,
            step6: 6, step7: 7, step8: 8, step9: 9,
          };
          if (progress.step_outputs) {
            for (const [key, stepId] of Object.entries(stepMap)) {
              if (progress.step_outputs[key] && !appliedSteps.has(stepId)) {
                updateStepStatus(stepId, 'completed', progress.step_outputs[key]);
                appliedSteps.add(stepId);
              }
            }
          }

          // Mark current step as running (if not already completed with output)
          const currentStep = progress.step;
          if (!appliedSteps.has(currentStep)) {
            updateStepStatus(currentStep, 'running');
          }
          // Mark steps before current as completed (status only, no output yet)
          for (const stepId of pipelineStepIds) {
            if (stepId < currentStep && !appliedSteps.has(stepId)) {
              updateStepStatus(stepId, 'completed');
            }
          }
        },
        abortController.signal,
      );

      if (result.success) {
        // Map backend step_outputs to store
        const stepMap: Record<string, number> = {
          step1: 1, step2: 2, step3: 3, step4: 4,
          step6: 6, step7: 7, step8: 8, step9: 9,
        };
        for (const [key, stepId] of Object.entries(stepMap)) {
          const output = result.step_outputs[key];
          if (output) {
            updateStepStatus(stepId, 'completed', output);
          }
        }
        // Apply L6 Perspective Analysis result if present
        if (result.l6_analysis && result.l6_analysis.selected_experiments) {
          setL6AnalysisResult(result.l6_analysis);
        }
        const elapsed = result.total_elapsed_seconds;
        const mins = Math.floor(elapsed / 60);
        const secs = Math.round(elapsed % 60);
        const bestCount = result.summary?.total_l6_best || 0;
        alert(`Full pipeline completed in ${mins}m ${secs}s\n\nGenerated: ${result.summary.goals || 0} goals, ${result.summary.total_l3_questions || 0} L3 questions, ${result.summary.total_l6_tasks || 0} L6 experiments${bestCount ? `, ${bestCount} best selected` : ''}`);
      } else {
        // Partial failure — load whatever outputs exist, reset stuck steps
        const stepMap: Record<string, number> = {
          step1: 1, step2: 2, step3: 3, step4: 4,
          step6: 6, step7: 7, step8: 8, step9: 9,
        };
        const completedSteps = new Set<number>();
        for (const [key, stepId] of Object.entries(stepMap)) {
          const output = result.step_outputs?.[key];
          if (output) {
            updateStepStatus(stepId, 'completed', output);
            completedSteps.add(stepId);
          }
        }
        // Reset any steps still in 'running' or 'pending' that weren't completed
        for (const stepId of pipelineStepIds) {
          if (!completedSteps.has(stepId) && !appliedSteps.has(stepId)) {
            updateStepStatus(stepId, 'error', undefined, result.error || 'Pipeline failed before reaching this step');
          }
        }
        setFullPipelineError(true);
        setTimeout(() => setFullPipelineError(false), 5000);
        alert(`Pipeline failed: ${result.error || 'Unknown error'}.\nPartial results have been loaded.`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[FullPipeline] Aborted by user');
        // Reset all running steps to pending on abort
        for (const stepId of pipelineStepIds) {
          if (!appliedSteps.has(stepId)) {
            updateStepStatus(stepId, 'pending');
          }
        }
      } else {
        console.error('[FullPipeline] Error:', err);
        // Reset all running/pending steps to error so they don't stay stuck
        for (const stepId of pipelineStepIds) {
          if (!appliedSteps.has(stepId)) {
            updateStepStatus(stepId, 'error', undefined, err.message || 'Pipeline error');
          }
        }
        setFullPipelineError(true);
        setTimeout(() => setFullPipelineError(false), 5000);
        alert(`Pipeline error: ${err.message || 'Unknown error'}`);
      }
    } finally {
      setFullPipelineRunning(false);
      setFullPipelineProgress(null);
      fullPipelineAbortRef.current = null;
    }
  };

  const handleAbortFullPipeline = () => {
    if (fullPipelineAbortRef.current) {
      fullPipelineAbortRef.current.abort();
    }
  };

  // Session management
  const { initialize: initSessions, updateActiveSessionMeta, saveCurrentToSession, isLoading: sessionsLoading, activeSessionId, sessions } = useSessionStore();

  useEffect(() => {
    if (!userName) return;
    // Initialize sessions (async)
    initSessions().catch((error) => {
      console.error('[App] Session initialization failed:', error);
    });
  }, [initSessions, userName]);

  // Auto-save session meta when goal changes (only after sessions initialized)
  useEffect(() => {
    if (currentGoal && !sessionsLoading) {
      updateActiveSessionMeta(currentGoal);
    }
  }, [currentGoal, sessionsLoading]);

  // Auto-save session data periodically and on unload (only after sessions initialized)
  useEffect(() => {
    if (sessionsLoading) return; // Don't start auto-save until sessions are ready

    const interval = setInterval(() => {
      saveCurrentToSession();
    }, 30000); // every 30 seconds

    const handleBeforeUnload = () => {
      saveCurrentToSession();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveCurrentToSession, sessionsLoading]);

  // enabledAgents used in tab label

  // Show name prompt if user hasn't identified themselves yet
  if (!userName) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <ParticleBackground />
        <UserNamePrompt onNameSet={(name) => setUserName(name)} />
      </div>
    );
  }

  return (
    <div className="app-main-container min-h-screen bg-background text-foreground overflow-x-hidden">
      <ParticleBackground />
      
      {/* Header */}
      <header className="relative z-20 border-b border-border/40 bg-card/80 backdrop-blur-md">
        <div className="flex items-center justify-between px-4 py-2 w-full overflow-visible">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-background" />
            </div>
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <span className="neon-text">OMEGA</span>
              <span className="gradient-text">POINT</span>
            </h1>
            <span className="hidden sm:inline text-[10px] text-muted-foreground/70 uppercase tracking-wide">
              Ontological Mapping &amp; Epistemic Generation Agents
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <SessionSwitcher />
            {telegramUser && (
              <button
                onClick={handleShareToTelegram}
                disabled={telegramSharing}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-sky-500/10 border border-sky-400/40 hover:bg-sky-500/20 transition-colors cursor-pointer text-sm disabled:opacity-50 disabled:cursor-wait"
                title="Share session report to your Telegram"
              >
                {telegramSharing ? (
                  <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5 text-sky-400" />
                )}
                <span className="text-sky-300 font-medium">Share</span>
              </button>
            )}
            {userName && (
              <button
                onClick={() => {
                  if (telegramUser) {
                    if (window.confirm('Log out from Telegram?')) {
                      clearTelegramUser();
                      setTelegramUserState(null);
                      localStorage.removeItem('omega-point-user-name');
                      setUserName(null);
                    }
                  } else {
                    const newName = prompt('Change your name:', userName);
                    if (newName && newName.trim()) {
                      storeUserName(newName.trim());
                      setUserName(newName.trim());
                    }
                  }
                }}
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-secondary/30 border border-border/30 hover:bg-secondary/50 transition-colors cursor-pointer text-sm"
                title={telegramUser ? 'Click to log out' : 'Click to change your name'}
              >
                {telegramUser?.photo_url ? (
                  <img src={telegramUser.photo_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                ) : (
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                )}
                <span className="font-medium text-foreground/80">{userName}</span>
                {telegramUser && (
                  <svg viewBox="0 0 24 24" className="w-3 h-3 text-sky-400" fill="currentColor">
                    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                  </svg>
                )}
              </button>
            )}
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" title="System online" />
          </div>
        </div>
      </header>

      <div className="relative z-10 max-w-[98vw] mx-auto px-3 py-3">

        {/* Goal Input */}
        <Card className="mb-3 bg-card/50 backdrop-blur-sm border border-border/30">
          <CardHeader
            className="border-b border-border/20 pb-2 cursor-pointer hover:bg-secondary/20 transition-colors"
            onClick={() => setPrimaryObjectiveCollapsed(!primaryObjectiveCollapsed)}
          >
            <CardTitle className="text-xs font-semibold uppercase tracking-wider flex items-center justify-between text-muted-foreground">
              <div className="flex items-center gap-2">
                <Target size={14} className="text-primary" />
                <span>Primary Objective</span>
              </div>
              <button className="p-0.5 hover:bg-secondary/50 rounded transition-colors">
                {primaryObjectiveCollapsed ? (
                  <Maximize2 size={12} className="text-muted-foreground" />
                ) : (
                  <Minimize2 size={12} className="text-muted-foreground" />
                )}
              </button>
            </CardTitle>
          </CardHeader>
          {!primaryObjectiveCollapsed && (
            <CardContent className="pt-3">
            <div className="space-y-2">
              {/* Row 1: Goal textarea + primary action buttons */}
              <div className="flex gap-2">
                <textarea
                  placeholder="Define your research objective or master question (Q₀)..."
                  value={currentGoal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={2}
                  className="flex-1 bg-secondary/20 border border-border/40 focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all rounded-md px-3 py-1.5 text-sm resize-y min-h-[50px] max-h-[200px] overflow-y-auto"
                />
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  {!fullPipelineRunning ? (
                    <Button
                      onClick={handleRunFullPipeline}
                      disabled={!currentGoal || fullPipelineRunning}
                      size="sm"
                      className={fullPipelineError
                        ? "bg-red-600 hover:bg-red-700 transition-colors h-8 animate-pulse"
                        : "bg-amber-600 hover:bg-amber-700 transition-colors h-8"
                      }
                      title={fullPipelineError ? "Pipeline failed — click to retry" : "Run the entire pipeline: Steps 1→2→3→4→6→7→8→9"}
                    >
                      <Rocket size={14} className="mr-1" />
                      {fullPipelineError ? 'Retry' : 'Run All'}
                    </Button>
                  ) : (
                    <Button
                      onClick={handleAbortFullPipeline}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 transition-colors h-8 animate-pulse"
                      title={fullPipelineProgress ? `Step ${fullPipelineProgress.step}: ${fullPipelineProgress.step_name} (${Math.round(fullPipelineProgress.elapsed)}s)` : 'Pipeline running...'}
                    >
                      <Square size={12} className="mr-1" />
                      {fullPipelineProgress ? `S${fullPipelineProgress.step} ${Math.round(fullPipelineProgress.elapsed)}s` : 'Stop'}
                    </Button>
                  )}
                  <Button
                    onClick={() => handleRunStep(1)}
                    disabled={!currentGoal || steps[0].status === 'running' || steps[0].status === 'completed' || fullPipelineRunning}
                    size="sm"
                    className="bg-primary hover:bg-primary/90 transition-colors h-8"
                  >
                    <Play size={14} className="mr-1" />
                    Step 1
                  </Button>
                </div>
              </div>

              {/* Row 2: Secondary actions — compact inline */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { saveVersion(); alert('Version saved!'); }}
                    disabled={!currentGoal || steps.every(s => s.status === 'pending')}
                    className="h-7 text-xs px-2.5 border-border/40 hover:bg-secondary/50 disabled:opacity-30"
                  >
                    <Save size={12} className="mr-1" />Save
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { handleSaveToFile(); }}
                    disabled={!currentGoal || steps.every(s => s.status === 'pending')}
                    className="h-7 text-xs px-2.5 border-border/40 hover:bg-secondary/50 disabled:opacity-30"
                    title="Download all results as JSON"
                  >
                    <Download className="w-3 h-3 mr-1" />Export
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { handleSaveInputsOutputs(); }}
                    disabled={!currentGoal || steps.every(s => s.status === 'pending')}
                    className="h-7 text-xs px-2.5 border-border/40 hover:bg-secondary/50 disabled:opacity-30"
                    title="Save inputs and outputs for verification"
                  >
                    <Download className="w-3 h-3 mr-1" />I/O Check
                  </Button>
                </div>
                <div className="w-px h-4 bg-border/30" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resetPipeline()}
                  className="h-7 text-xs px-2.5 border-border/40 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30"
                >
                  Reset
                </Button>
              </div>
              
              {/* Global Lens Selector */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
                  Epistemic Lens (Optional)
                </label>
                <Select
                  value={lensKey}
                  onChange={(e) => {
                    const key = e.target.value;
                    setLensKey(key);
                    if (key === '') {
                      setGlobalLens('');
                    } else if (key === 'custom') {
                      setGlobalLens(customLensText);
                    } else {
                      const presets: Record<string, string> = {
                        dca: "Distributed Consensus Architecture. View Homo sapiens as a multi-agent system where health is a 'collective agreement' between subsystems. Aging is not 'breaking,' it is 'de-synchronization' or 'loss of consensus' where individual parts stop following the global protocol.",
                        itec: "Information Theory & Error Correction. View aging as progressive accumulation of errors in biological information processing, storage, and transmission. Health is high-fidelity information flow; aging is rising noise and corrupted signals.",
                        cas: "Complex Adaptive Systems. View the organism as a network of interacting agents with emergent properties. Aging is loss of network robustness, reduced adaptability, and failure of distributed coordination.",
                        re: "Reliability Engineering. View the body as a mission-critical system with redundancy, fault tolerance, and graceful degradation. Aging is the progressive loss of safety margins and backup systems.",
                        ccs: "Cybernetic Control Systems. View health as stable homeostatic regulation via feedback loops. Aging is drift in setpoints, degraded sensor accuracy, and weakened actuator response.",
                      };
                      setGlobalLens(editedLensDescriptions[key] || presets[key] || '');
                    }
                  }}
                  className="bg-secondary/30 border-border/50 focus:border-primary focus:ring-primary/30 transition-all"
                >
                  <option value="">No specific focus</option>
                  <option value="dca">Distributed Consensus Architecture</option>
                  <option value="itec">Information Theory & Error Correction</option>
                  <option value="cas">Complex Adaptive Systems</option>
                  <option value="re">Reliability Engineering</option>
                  <option value="ccs">Cybernetic Control Systems</option>
                  <option value="custom">Custom Lens...</option>
                </Select>

                {/* Editable description for preset lenses */}
                {lensKey && lensKey !== 'custom' && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Lens Description (editable)</span>
                      {editedLensDescriptions[lensKey] && (
                        <button
                          onClick={() => {
                            const presets: Record<string, string> = {
                              dca: "Distributed Consensus Architecture. View Homo sapiens as a multi-agent system where health is a 'collective agreement' between subsystems. Aging is not 'breaking,' it is 'de-synchronization' or 'loss of consensus' where individual parts stop following the global protocol.",
                              itec: "Information Theory & Error Correction. View aging as progressive accumulation of errors in biological information processing, storage, and transmission. Health is high-fidelity information flow; aging is rising noise and corrupted signals.",
                              cas: "Complex Adaptive Systems. View the organism as a network of interacting agents with emergent properties. Aging is loss of network robustness, reduced adaptability, and failure of distributed coordination.",
                              re: "Reliability Engineering. View the body as a mission-critical system with redundancy, fault tolerance, and graceful degradation. Aging is the progressive loss of safety margins and backup systems.",
                              ccs: "Cybernetic Control Systems. View health as stable homeostatic regulation via feedback loops. Aging is drift in setpoints, degraded sensor accuracy, and weakened actuator response.",
                            };
                            const updated = { ...editedLensDescriptions };
                            delete updated[lensKey];
                            setEditedLensDescriptions(updated);
                            setGlobalLens(presets[lensKey] || '');
                          }}
                          className="text-[10px] text-amber-400 hover:text-amber-300"
                        >
                          Reset to default
                        </button>
                      )}
                    </div>
                    <textarea
                      value={globalLens}
                      onChange={(e) => {
                        setGlobalLens(e.target.value);
                        setEditedLensDescriptions(prev => ({ ...prev, [lensKey]: e.target.value }));
                      }}
                      rows={3}
                      className="w-full bg-secondary/30 border border-border/50 rounded-md px-3 py-2 text-xs text-foreground font-mono leading-relaxed focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all resize-y"
                    />
                  </div>
                )}

                {/* Custom lens freeform input */}
                {lensKey === 'custom' && (
                  <div className="mt-2">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                      Write your own epistemic lens
                    </span>
                    <textarea
                      value={customLensText}
                      onChange={(e) => {
                        setCustomLensText(e.target.value);
                        setGlobalLens(e.target.value);
                      }}
                      placeholder="Describe a conceptual framework through which all agents should interpret the problem..."
                      rows={4}
                      className="w-full bg-secondary/30 border border-border/50 rounded-md px-3 py-2 text-xs text-foreground font-mono leading-relaxed focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all resize-y"
                    />
                  </div>
                )}
              </div>
            </div>
            {!currentGoal && (
              <p className="text-xs text-primary/80 mt-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary glow-pulse" />
                Please enter a goal to begin the pipeline
              </p>
            )}
          </CardContent>
          )}
        </Card>

        {/* Tabs */}
        <div className="flex gap-1 mb-3 bg-card/40 backdrop-blur-sm rounded-lg p-1 border border-border/20">
          {([
            { key: 'overview', label: 'Overview', icon: Info },
            { key: 'agents', label: `Agents (${agents.filter(a => a.enabled).length})`, icon: Users },
            { key: 'split', label: 'Split View', icon: LayoutGrid },
            { key: 'pipeline', label: 'Pipeline', icon: GitBranch },
            { key: 'graph', label: 'Graph', icon: Network },
            { key: 'versions', label: `Versions (${versions.length})`, icon: History },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as typeof activeTab)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-1.5 ${
                activeTab === key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'overview' && (
          <div className="pb-12">
            <SystemOverview />
          </div>
        )}

        {activeTab === 'split' && (
          <div ref={containerRef} className="flex gap-0 split-view-container relative">
            <div
              style={{ width: `${splitRatio}%` }}
              className="overflow-auto bg-card/50 backdrop-blur-sm rounded-l-lg shadow-lg border border-border/30 p-4 select-text"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-foreground/80">Pipeline Steps</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const stepsWithData = steps.filter(s => s.status === 'completed' || s.status === 'error');
                    if (stepsWithData.length === 0) { alert('No data to clear'); return; }
                    if (confirm(`Clear all data from ${stepsWithData.length} step(s)?`)) {
                      stepsWithData.forEach(step => clearStep(step.id));
                    }
                  }}
                  disabled={!steps.some(s => s.status === 'completed' || s.status === 'error')}
                  className="h-7 text-xs px-2.5 border-border/40 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 disabled:opacity-30"
                  title="Clear all step data"
                >
                  <Trash2 size={12} className="mr-1" />Clear All
                </Button>
              </div>
              
              {/* Single Goal Selector */}
              {steps[1]?.output?.goals && steps[1].output.goals.length > 0 && (
                <Card className="mb-4 bg-primary/5 border-primary/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Run for Single Goal
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Select
                      value={selectedGoalId || ''}
                      onChange={(e) => setSelectedGoalId(e.target.value || null)}
                    >
                      <option value="">🌐 All Goals (Batch Mode)</option>
                      {steps[1].output.goals.map((goal: any) => (
                        <option key={goal.id} value={goal.id}>
                          🎯 {goal.id}: {goal.title}
                        </option>
                      ))}
                    </Select>
                    {selectedGoalId ? (
                      <>
                        <div className="text-xs text-primary font-semibold flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-primary glow-pulse" />
                          Single Goal Mode: {selectedGoalId}
                        </div>
                        {(() => {
                          const selectedGoal = steps[1].output.goals.find((g: any) => g.id === selectedGoalId);
                          return selectedGoal ? (
                            <div className="mt-2 p-3 bg-background/50 border border-primary/20 rounded text-xs space-y-1 max-h-48 overflow-y-auto">
                              <div className="font-semibold text-primary mb-2">📋 Goal Properties:</div>
                              <div><span className="text-muted-foreground">ID:</span> <span className="text-foreground font-mono">{selectedGoal.id}</span></div>
                              <div><span className="text-muted-foreground">Title:</span> <span className="text-foreground">{selectedGoal.title}</span></div>
                              {selectedGoal.state_definition && (
                                <div><span className="text-muted-foreground">State:</span> <span className="text-foreground">{selectedGoal.state_definition.substring(0, 150)}...</span></div>
                              )}
                              {selectedGoal.catastrophe_primary && (
                                <div><span className="text-muted-foreground">Catastrophe:</span> <span className="text-foreground">{selectedGoal.catastrophe_primary}</span></div>
                              )}
                              {selectedGoal.bridge_tags?.failure_channels && (
                                <div><span className="text-muted-foreground">FCCs:</span> <span className="text-foreground">{selectedGoal.bridge_tags.failure_channels.join(', ')}</span></div>
                              )}
                              {selectedGoal.bridge_tags?.system_properties_required && (
                                <div><span className="text-muted-foreground">SPVs:</span> <span className="text-foreground">{selectedGoal.bridge_tags.system_properties_required.map((sp: any) => sp.spv_id).join(', ')}</span></div>
                              )}
                            </div>
                          ) : null;
                        })()}
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                        Batch Mode: All {steps[1].output.goals.length} goals will be processed
                      </div>
                    )}
                    {selectedGoalId && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRunStepForSingleGoal(3, selectedGoalId)}
                          disabled={steps[2]?.status === 'running'}
                          className="flex-1"
                        >
                          Step 3 (RAs)
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRunStepForSingleGoal(5, selectedGoalId)}
                          disabled={steps[4]?.status === 'running'}
                          className="flex-1"
                        >
                          Step 5 (Match)
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRunStepForSingleGoal(6, selectedGoalId)}
                          disabled={steps[5]?.status === 'running'}
                          className="flex-1"
                        >
                          Step 6 (L3)
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* L3 Question Selection */}
              {steps[5]?.output?.l3_questions && steps[5].output.l3_questions.length > 0 && (
                <Card className="mb-4 bg-accent/5 border-accent/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Zap className="w-4 h-4" />
                      Run for Single L3 Question
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Select
                      value={selectedL3Id || ''}
                      onChange={(e) => setSelectedL3Id(e.target.value || null)}
                    >
                      <option value="">🌐 All L3 Questions (Batch Mode)</option>
                      {steps[5].output.l3_questions.map((l3: any) => (
                        <option key={l3.id} value={l3.id}>
                          ❓ {l3.id}: {l3.text?.substring(0, 60)}...
                        </option>
                      ))}
                    </Select>
                    {selectedL3Id ? (
                      <>
                        <div className="text-xs text-accent font-semibold flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-accent glow-pulse" />
                          Single L3 Mode: {selectedL3Id}
                        </div>
                        {(() => {
                          const selectedL3 = steps[5].output.l3_questions.find((l3: any) => l3.id === selectedL3Id);
                          return selectedL3 ? (
                            <div className="mt-2 p-3 bg-background/50 border border-accent/20 rounded text-xs space-y-1 max-h-48 overflow-y-auto">
                              <div className="font-semibold text-accent mb-2">❓ L3 Question Properties:</div>
                              <div><span className="text-muted-foreground">ID:</span> <span className="text-foreground font-mono">{selectedL3.id}</span></div>
                              <div><span className="text-muted-foreground">Text:</span> <span className="text-foreground">{selectedL3.text}</span></div>
                              {selectedL3.parent_goal_id && (
                                <div><span className="text-muted-foreground">Parent Goal:</span> <span className="text-foreground font-mono">{selectedL3.parent_goal_id}</span></div>
                              )}
                              {selectedL3.strategy_used && (
                                <div><span className="text-muted-foreground">Strategy:</span> <span className="text-foreground">{selectedL3.strategy_used}</span></div>
                              )}
                              {selectedL3.rationale && (
                                <div><span className="text-muted-foreground">Rationale:</span> <span className="text-foreground">{selectedL3.rationale.substring(0, 150)}...</span></div>
                              )}
                              {selectedL3.discriminator_target && (
                                <div><span className="text-muted-foreground">Target:</span> <span className="text-foreground">{selectedL3.discriminator_target}</span></div>
                              )}
                            </div>
                          ) : null;
                        })()}
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                        Batch Mode: All {steps[5].output.l3_questions.length} L3 questions
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* L4 Question Selection */}
              {steps[7]?.output?.l4_questions && steps[7].output.l4_questions.length > 0 && (
                <Card className="mb-4 bg-secondary/5 border-secondary/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Network className="w-4 h-4" />
                      Run for Single L4 Question
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <Select
                      value={selectedL4Id || ''}
                      onChange={(e) => setSelectedL4Id(e.target.value || null)}
                    >
                      <option value="">🌐 All L4 Questions (Batch Mode)</option>
                      {steps[7].output.l4_questions.map((l4: any) => (
                        <option key={l4.id} value={l4.id}>
                          🔍 {l4.id}: {l4.text?.substring(0, 60)}...
                        </option>
                      ))}
                    </Select>
                    {selectedL4Id ? (
                      <>
                        <div className="text-xs text-secondary font-semibold flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-secondary glow-pulse" />
                          Single L4 Mode: {selectedL4Id}
                        </div>
                        {(() => {
                          const selectedL4 = steps[7].output.l4_questions.find((l4: any) => l4.id === selectedL4Id);
                          return selectedL4 ? (
                            <div className="mt-2 p-3 bg-background/50 border border-secondary/20 rounded text-xs space-y-1 max-h-48 overflow-y-auto">
                              <div className="font-semibold text-secondary mb-2">🔍 L4 Question Properties:</div>
                              <div><span className="text-muted-foreground">ID:</span> <span className="text-foreground font-mono">{selectedL4.id}</span></div>
                              <div><span className="text-muted-foreground">Text:</span> <span className="text-foreground">{selectedL4.text}</span></div>
                              {selectedL4.parent_l3_id && (
                                <div><span className="text-muted-foreground">Parent L3:</span> <span className="text-foreground font-mono">{selectedL4.parent_l3_id}</span></div>
                              )}
                              {selectedL4.type && (
                                <div><span className="text-muted-foreground">Type:</span> <span className="text-foreground">{selectedL4.type}</span></div>
                              )}
                              {selectedL4.lens && (
                                <div><span className="text-muted-foreground">Lens:</span> <span className="text-foreground">{selectedL4.lens}</span></div>
                              )}
                              {selectedL4.distinguishes_ih_ids && selectedL4.distinguishes_ih_ids.length > 0 && (
                                <div><span className="text-muted-foreground">Distinguishes IHs:</span> <span className="text-foreground font-mono">{selectedL4.distinguishes_ih_ids.join(', ')}</span></div>
                              )}
                              {selectedL4.rationale && (
                                <div><span className="text-muted-foreground">Rationale:</span> <span className="text-foreground">{selectedL4.rationale.substring(0, 150)}...</span></div>
                              )}
                            </div>
                          ) : null;
                        })()}
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                        Batch Mode: All {steps[7].output.l4_questions.length} L4 questions
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              
              <PipelineView
                steps={steps}
                agents={agents}
                onRunStep={handleRunStep}
                onClearStep={clearStep}
                onAbortStep={handleAbortStep}
                onRetryStep={handleRetryStep}
                onRunStep4Phase={handleRunStep4Phase}
                onEditOutput={handleEditOutput}
              />

              {/* L6 Perspective Analysis */}
              <div className="mt-4">
                <L6PerspectiveAnalyzer />
              </div>
            </div>

            {/* Resizable Divider */}
            <div
              className={`w-2 bg-border/50 hover:bg-primary/50 cursor-col-resize relative group flex-shrink-0 ${
                isDragging ? 'bg-primary' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsDragging(true);
                
                const container = containerRef.current;
                if (!container) return;
                
                const containerRect = container.getBoundingClientRect();
                
                const handleMouseMove = (moveEvent: MouseEvent) => {
                  moveEvent.preventDefault();
                  
                  const containerWidth = containerRect.width;
                  const mouseX = moveEvent.clientX - containerRect.left;
                  const newRatio = (mouseX / containerWidth) * 100;
                  
                  // Constrain between 20% and 70%
                  const constrainedRatio = Math.min(Math.max(newRatio, 20), 70);
                  setSplitRatio(constrainedRatio);
                };
                
                const handleMouseUp = () => {
                  setIsDragging(false);
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                  document.body.style.cursor = '';
                  document.body.style.userSelect = '';
                };
                
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            >
              <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary/20 transition-colors" />
            </div>
            
            <div 
              style={{ width: `${100 - splitRatio}%` }}
              className="bg-card/50 backdrop-blur-sm rounded-r-lg shadow-lg border border-border/30 select-text"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
                <h2 className="text-sm font-semibold text-foreground/80">Knowledge Graph</h2>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setZenMode(!zenMode)}
                    className="px-2 py-1 text-[11px] border border-border/30 hover:bg-secondary/50 rounded transition-colors flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    title={zenMode ? "Show all controls" : "Hide controls"}
                  >
                    {zenMode ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    <span>{zenMode ? 'Full' : 'Zen'}</span>
                  </button>
                  <button
                    onClick={() => setGraphFullscreen(true)}
                    className="px-2 py-1 text-[11px] border border-border/30 hover:bg-secondary/50 rounded transition-colors flex items-center gap-1 text-muted-foreground hover:text-foreground"
                    title="Fullscreen"
                  >
                    <Maximize2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="h-[calc(100%-42px)]">
                <GraphVisualizationWrapper steps={steps} zenMode={zenMode} />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'pipeline' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground/80">Pipeline Steps</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const stepsWithData = steps.filter(s => s.status === 'completed' || s.status === 'error');
                  if (stepsWithData.length === 0) { alert('No data to clear'); return; }
                  if (confirm(`Clear all data from ${stepsWithData.length} step(s)?`)) {
                    stepsWithData.forEach(step => clearStep(step.id));
                  }
                }}
                disabled={!steps.some(s => s.status === 'completed' || s.status === 'error')}
                className="h-7 text-xs px-2.5 border-border/40 text-muted-foreground hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 disabled:opacity-30"
                title="Clear all step data"
              >
                <Trash2 size={12} className="mr-1" />Clear All
              </Button>
            </div>
            <PipelineView
              steps={steps}
              agents={agents}
              onRunStep={handleRunStep}
              onRunStep4Phase={handleRunStep4Phase}
              onClearStep={clearStep}
              onAbortStep={handleAbortStep}
              onRetryStep={handleRetryStep}
              onEditOutput={handleEditOutput}
            />
          </div>
        )}

        {activeTab === 'graph' && (
          <div className="graph-view-container bg-card/50 backdrop-blur-sm rounded-lg border border-border/30 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/20">
              <h2 className="text-sm font-semibold text-foreground/80">Knowledge Graph</h2>
              <button
                onClick={() => setZenMode(!zenMode)}
                className="px-2 py-1 text-[11px] border border-border/30 hover:bg-secondary/50 rounded transition-colors flex items-center gap-1 text-muted-foreground hover:text-foreground"
                title={zenMode ? "Show all controls" : "Hide controls"}
              >
                {zenMode ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                <span>{zenMode ? 'Full' : 'Zen'}</span>
              </button>
            </div>
            <div className="h-[calc(100%-38px)]">
              <GraphVisualizationWrapper steps={steps} zenMode={zenMode} />
            </div>
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold gradient-text">Agent Configuration</h2>
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm('Reset all agents to default configuration? This will clear all customizations and cached data.')) {
                    resetToDefaults();
                    window.location.reload();
                  }
                }}
                className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
              >
                <RefreshCw size={16} className="mr-2" />
                Reset to Defaults
              </Button>
            </div>
            <div className="flex flex-col gap-4">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onUpdate={(updates) => updateAgent(agent.id, updates)}
                />
              ))}
            </div>
          </div>
        )}

        {activeTab === 'scientific' && (
          <div className="space-y-4">
            <Card className="bg-card/50 border-border/30">
              <CardHeader>
                <CardTitle className="gradient-text">Scientific Pillars Management</CardTitle>
                <p className="text-sm text-muted-foreground mt-2">
                  Upload a JSON file with predefined scientific pillars to automatically populate Step 4 results.
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Upload Scientific Pillars JSON</label>
                    <input
                      type="file"
                      accept=".json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            try {
                              const json = JSON.parse(event.target?.result as string);
                              
                              // Validate format
                              if (!json.scientific_pillars || !Array.isArray(json.scientific_pillars)) {
                                alert('Invalid format: Missing "scientific_pillars" array');
                                return;
                              }
                              
                              // Check required fields
                              const requiredFields = ['id', 'title', 'capabilities'];
                              const isValid = json.scientific_pillars.every((pillar: any) => 
                                requiredFields.every(field => pillar.hasOwnProperty(field))
                              );
                              
                              if (!isValid) {
                                alert('Invalid format: Each pillar must have id, title, and capabilities');
                                return;
                              }
                              
                              setScientificPillars(json);
                              
                              // Automatically load as Step 4 output
                              updateStepStatus(4, 'completed', json);
                              
                              alert(`Successfully loaded ${json.scientific_pillars.length} scientific pillars!`);
                            } catch (error) {
                              alert('Error parsing JSON: ' + (error as Error).message);
                            }
                          };
                          reader.readAsText(file);
                        }
                      }}
                      className="block w-full text-sm text-muted-foreground
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-lg file:border-0
                        file:text-sm file:font-semibold
                        file:bg-primary/20 file:text-primary
                        hover:file:bg-primary/30 file:cursor-pointer
                        cursor-pointer border border-border/50 rounded-lg"
                    />
                  </div>
                  
                  {scientificPillars && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                      <p className="text-sm text-emerald-400 font-medium mb-2">
                        ✓ Loaded {scientificPillars.scientific_pillars?.length || 0} Scientific Pillars
                      </p>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {scientificPillars.scientific_pillars?.slice(0, 5).map((pillar: any) => (
                          <div key={pillar.id} className="flex items-center gap-2">
                            <span className="text-primary">•</span>
                            <span className="font-mono">{pillar.id}</span>
                            <span>-</span>
                            <span>{pillar.title}</span>
                          </div>
                        ))}
                        {scientificPillars.scientific_pillars?.length > 5 && (
                          <p className="text-muted-foreground/70 italic">
                            ... and {scientificPillars.scientific_pillars.length - 5} more
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setScientificPillars(null);
                          updateStepStatus(4, 'pending', null);
                        }}
                        className="mt-3 border-rose-500/50 text-rose-400 hover:bg-rose-500/10"
                      >
                        Clear Pillars
                      </Button>
                    </div>
                  )}
                  
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                    <p className="text-sm text-blue-400 font-medium mb-2">Expected JSON Format:</p>
                    <pre className="text-xs text-muted-foreground overflow-x-auto bg-background/50 p-3 rounded">
{`{
  "scientific_pillars": [
    {
      "id": "S_001",
      "title": "Intervention Name",
      "capabilities": [
        {
          "spv_id": "SPV_1",
          "effect_direction": "INCREASE",
          "rationale": "Explanation..."
        }
      ],
      "mechanism": "Description...",
      "verified_effect": "Evidence...",
      ...
    }
  ]
}`}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'versions' && (
          <div className="space-y-4">
            {/* Load Pipeline JSON */}
            <Card className="bg-card/50 border-border/30">
              <CardHeader>
                <CardTitle className="gradient-text flex items-center gap-2">
                  <Upload size={20} />
                  Load Complete Pipeline
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-2">
                  Upload a complete pipeline JSON file to restore all steps, outputs, and visualize the knowledge graph.
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Upload Pipeline JSON</label>
                    <input
                      type="file"
                      accept=".json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleLoadPipelineJSON(file);
                          e.target.value = ''; // Reset input
                        }
                      }}
                      className="block w-full text-sm text-muted-foreground
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-lg file:border-0
                        file:text-sm file:font-semibold
                        file:bg-primary/20 file:text-primary
                        hover:file:bg-primary/30 file:cursor-pointer
                        cursor-pointer border border-border/50 rounded-lg"
                    />
                  </div>
                  
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                    <p className="text-sm text-blue-400 font-medium mb-2 flex items-center gap-2">
                      <FileJson size={16} />
                      Expected JSON Structure:
                    </p>
                    <pre className="text-xs text-muted-foreground overflow-x-auto bg-background/50 p-3 rounded">
{`{
  "goal": "radical life extension",
  "timestamp": "2026-01-25T20:38:17.321Z",
  "steps": [
    {
      "id": 1,
      "name": "Goal Formalization",
      "status": "completed",
      "output": { ... }
    },
    ...
  ]
}`}
                    </pre>
                  </div>
                  
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                    <p className="text-xs text-amber-400">
                      <strong>Note:</strong> Loading a pipeline will replace your current work. Save your current pipeline first if needed.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {versions.length === 0 ? (
              <Card className="bg-card/50 border-border/30">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-3">
                    <History size={48} className="text-muted-foreground/50" />
                    <p className="text-lg font-medium">No saved versions yet</p>
                    <p className="text-sm">Complete some pipeline steps and click "Save" to create one.</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-muted-foreground">
                    {versions.length} saved {versions.length === 1 ? 'version' : 'versions'}
                  </p>
                </div>
                {versions.map((version) => (
                  <Card key={version.id} className="group bg-card/50 border-border/30 hover:border-primary/50 hover:shadow-[0_0_30px_rgba(59,130,246,0.2)] transition-all">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <CardTitle className="text-lg gradient-text truncate">{version.goal}</CardTitle>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <History size={12} />
                              {new Date(version.timestamp).toLocaleString()}
                            </span>
                            <span className="flex items-center gap-1">
                              <GitBranch size={12} />
                              {version.steps.filter(s => s.status === 'completed').length}/{version.steps.length} steps
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => loadVersion(version.id)}
                            className="bg-primary/20 hover:bg-primary/30 text-primary border-primary/30 hover:shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                          >
                            <Download size={14} className="mr-1" />
                            Load
                          </Button>
                          <button
                            onClick={() => deleteVersion(version.id)}
                            className="p-2 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Delete version"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex gap-2 flex-wrap">
                        {version.steps.map((step) => (
                          <span
                            key={step.id}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                              step.status === 'completed'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.1)]'
                                : step.status === 'error'
                                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-[0_0_10px_rgba(239,68,68,0.1)]'
                                : step.status === 'running'
                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse'
                                : 'bg-secondary/50 text-muted-foreground border border-border/30'
                            }`}
                          >
                            {step.status === 'completed' ? '✓' : step.status === 'error' ? '✗' : '○'} Step {step.id}
                          </span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fullscreen Graph Overlay */}
      {graphFullscreen && (
        <div
          className="fixed inset-0 z-50 bg-background flex flex-col"
          onKeyDown={(e) => { if (e.key === 'Escape') setGraphFullscreen(false); }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-card/80 backdrop-blur-sm flex-shrink-0">
            <h2 className="text-lg font-bold gradient-text">Knowledge Graph — Fullscreen</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setZenMode(!zenMode)}
                className="px-3 py-1.5 text-xs bg-gradient-to-r from-purple-500/20 to-blue-500/20 hover:from-purple-500/30 hover:to-blue-500/30 border border-purple-500/40 hover:border-purple-400/60 rounded-md transition-all duration-300 flex items-center gap-2 font-semibold hover:shadow-[0_0_15px_rgba(168,85,247,0.3)]"
                title={zenMode ? "Show all controls" : "Hide controls (zen mode)"}
              >
                {zenMode ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Full View</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>Zen Mode</span>
                  </>
                )}
              </button>
              <button
                onClick={() => setGraphFullscreen(false)}
                className="px-3 py-1.5 text-xs bg-gradient-to-r from-rose-500/20 to-orange-500/20 hover:from-rose-500/30 hover:to-orange-500/30 border border-rose-500/40 hover:border-rose-400/60 rounded-md transition-all duration-300 flex items-center gap-2 font-semibold hover:shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                title="Exit fullscreen (Esc)"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Exit Fullscreen</span>
              </button>
            </div>
          </div>
          <div className="flex-1">
            <GraphVisualizationWrapper steps={steps} zenMode={zenMode} />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

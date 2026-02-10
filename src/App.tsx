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
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';
import { Select } from './components/ui/Select';
import { Card, CardHeader, CardTitle, CardContent } from './components/ui/Card';
import { Users, GitBranch, Save, History, Network, LayoutGrid, Download, Shield, Zap, Target, X, Play, RefreshCw, Upload, FileJson, Trash2, Eye, EyeOff } from 'lucide-react';
import { sessionManager } from './lib/sessionManager';
import { stateSync } from './lib/stateSync';

function App() {
  const [activeTab, setActiveTab] = useState<'agents' | 'split' | 'pipeline' | 'graph' | 'versions' | 'scientific'>('split');
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
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { 
    currentGoal, 
    setGoal, 
    agents, 
    updateAgent, 
    steps, 
    updateStepStatus,
    skipStep,
    clearStep,
    resetToDefaults,
    saveVersion,
    versions,
    loadVersion,
    deleteVersion,
    resetPipeline
  } = useAppStore();

  // Pipeline execution hook (handles all step running, aborting, single-goal execution)
  const { handleRunStep, handleAbortStep, handleRunStep4Phase, handleRunStepForSingleGoal } =
    usePipelineExecution({ selectedGoalId, selectedL3Id, selectedL4Id, globalLens });

  // Initialize session and state sync on mount
  useEffect(() => {
    const initializeSession = async () => {
      try {
        // Initialize session manager
        await sessionManager.initialize();

        // Load state from server
        const serverState = await stateSync.loadFromServer();
        if (serverState) {
          // Merge server state with local state (server takes precedence)
          useAppStore.setState(serverState);
          console.log('[App] State loaded from server');
        }

        // Start auto-sync (save state to server every 30 seconds)
        stateSync.startAutoSync(() => useAppStore.getState());
        console.log('[App] Auto-sync started');
      } catch (error) {
        console.error('[App] Failed to initialize session:', error);
        // Continue with local-only mode
      }
    };

    initializeSession();

    // Cleanup on unmount
    return () => {
      stateSync.stopAutoSync();
    };
  }, []);

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

  const handleEditOutput = (stepId: number, newOutput: any) => {
    updateStepStatus(stepId, 'completed', newOutput);
  };

  // Session management
  const { initialize: initSessions, updateActiveSessionMeta, saveCurrentToSession } = useSessionStore();

  useEffect(() => {
    initSessions();
  }, []);

  // Auto-save session meta when goal changes
  useEffect(() => {
    if (currentGoal) {
      updateActiveSessionMeta(currentGoal);
    }
  }, [currentGoal]);

  // Auto-save session data periodically and on unload
  useEffect(() => {
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
  }, [saveCurrentToSession]);

  const enabledAgents = agents.filter(agent => agent.enabled);
  const teamPower = enabledAgents.reduce((sum) => sum + 100, 0);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      <ParticleBackground />
      
      {/* Header */}
      <header className="relative z-20 border-b border-primary/30 bg-card/80 backdrop-blur-md shadow-[0_0_30px_rgba(34,197,94,0.1)]">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg neon-border">
                <Shield className="w-6 h-6 text-background" />
              </div>
              <div className="absolute inset-0 rounded-xl blur-xl glow-pulse -z-10" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <span className="neon-text">OMEGA</span>
                <span className="gradient-text">POINT</span>
                <span className="text-[10px] px-2 py-0.5 rounded neon-border text-primary font-mono">v3.0</span>
              </h1>
              <p className="text-[11px] text-muted-foreground uppercase tracking-widest">
                Ontological Mapping & Epistemic Generation Agents
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <SessionSwitcher />
            <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary/30 neon-border">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-sm font-mono neon-text">{teamPower}</span>
              <span className="text-[10px] text-muted-foreground">Team Power</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-primary glow-pulse" />
              <span className="hidden sm:inline neon-text text-xs">System Online</span>
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 max-w-[90vw] mx-auto px-4 py-6">

        {/* Goal Input */}
        <Card className="mb-6 neon-border bg-card/50 backdrop-blur-sm shadow-[0_0_30px_rgba(34,197,94,0.1)]">
          <CardHeader className="border-b border-primary/20 bg-gradient-to-r from-primary/10 via-transparent to-accent/10 pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2 text-primary">
              <Target size={16} className="text-primary" />
              Primary Objective
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              <div className="flex gap-3">
                <Input
                  placeholder="Define your longevity research objective or master question (Q₀)..."
                  value={currentGoal}
                  onChange={(e) => setGoal(e.target.value)}
                  className="flex-1 bg-secondary/30 border-primary/30 focus:border-primary focus:ring-primary/30 transition-all focus:shadow-[0_0_15px_rgba(34,197,94,0.2)]"
                />
              <Button
                onClick={() => handleRunStep(1)}
                disabled={!currentGoal || steps[0].status === 'running' || steps[0].status === 'completed'}
                className="bg-gradient-to-r from-primary to-accent hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] transition-all neon-border"
              >
                <Play size={16} className="mr-1" />
                Start
              </Button>
              <Button
                onClick={() => {
                  saveVersion();
                  alert('Version saved successfully!');
                }}
                disabled={!currentGoal || steps.every(s => s.status === 'pending')}
                className="bg-gradient-to-r from-primary to-primary/80 hover:shadow-[0_0_30px_rgba(34,197,94,0.4)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                title={!currentGoal ? 'Enter a goal first' : steps.every(s => s.status === 'pending') ? 'Run at least one step first' : 'Save current state as a version'}
              >
                <Save size={16} className="mr-2" />
                Save
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  handleSaveToFile();
                  alert('Results saved to file successfully!');
                }}
                disabled={!currentGoal || steps.every(s => s.status === 'pending')}
                className="neon-border text-primary hover:bg-primary/10 hover:shadow-[0_0_20px_rgba(34,197,94,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:border-muted"
                title={!currentGoal ? 'Enter a goal first' : steps.every(s => s.status === 'pending') ? 'Run at least one step first' : 'Download all results as JSON'}
              >
                <Download className="w-4 h-4 mr-2" />
                Save Results
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  handleSaveInputsOutputs();
                  alert('Input/Output check file saved successfully!');
                }}
                disabled={!currentGoal || steps.every(s => s.status === 'pending')}
                className="neon-border text-accent hover:bg-accent/10 hover:shadow-[0_0_20px_rgba(6,182,212,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:border-muted"
                title={!currentGoal ? 'Enter a goal first' : steps.every(s => s.status === 'pending') ? 'Run at least one step first' : 'Save inputs and outputs for verification'}
              >
                <Download className="w-4 h-4 mr-2" />
                Check I/O
              </Button>
              <Button
                variant="outline"
                onClick={() => resetPipeline()}
                className="border-border/50 hover:bg-secondary/50 hover:border-primary/30"
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
        </Card>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-card/50 backdrop-blur-sm rounded-xl p-2 shadow-lg neon-border">
          <button
            onClick={() => setActiveTab('agents')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'agents'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <Users size={18} />
            Agent Team ({agents.filter(a => a.enabled).length}/{agents.length})
          </button>
          <button
            onClick={() => setActiveTab('split')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'split'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <LayoutGrid size={18} />
            Split View
          </button>
          <button
            onClick={() => setActiveTab('pipeline')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'pipeline'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <GitBranch size={18} />
            Pipeline
          </button>
          <button
            onClick={() => setActiveTab('graph')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'graph'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <Network size={18} />
            Graph View
          </button>
          <button
            onClick={() => setActiveTab('scientific')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'scientific'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <Network size={18} />
            Scientific Pillars
          </button>
          <button
            onClick={() => setActiveTab('versions')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'versions'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <History size={18} />
            Versions ({versions.length})
          </button>
        </div>

        {/* Content */}
        {activeTab === 'split' && (
          <div ref={containerRef} className="flex gap-0 h-[800px] relative">
            <div
              style={{ width: `${splitRatio}%` }}
              className="overflow-auto bg-card/50 backdrop-blur-sm rounded-l-lg shadow-lg border border-border/30 p-4 select-text"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold gradient-text">Pipeline Steps</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const stepsWithData = steps.filter(s => s.status === 'completed' || s.status === 'error');
                    if (stepsWithData.length === 0) {
                      alert('No data to clear');
                      return;
                    }
                    if (confirm(`Clear all data from ${stepsWithData.length} step(s)? This will reset all completed steps to pending.`)) {
                      stepsWithData.forEach(step => clearStep(step.id));
                    }
                  }}
                  disabled={!steps.some(s => s.status === 'completed' || s.status === 'error')}
                  className="relative group border-rose-500/50 bg-gradient-to-r from-rose-500/10 to-red-500/10 text-rose-400 hover:from-rose-500/20 hover:to-red-500/20 hover:border-rose-400 hover:shadow-[0_0_20px_rgba(244,63,94,0.3)] transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
                  title="Clear all data from all steps"
                >
                  <div className="absolute inset-0 rounded-md bg-gradient-to-r from-rose-500/0 via-rose-500/5 to-rose-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <Trash2 size={14} className="mr-1.5 relative z-10 group-hover:scale-110 transition-transform duration-200" />
                  <span className="relative z-10 font-semibold">Clear All Data</span>
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
                onSkipStep={skipStep}
                onClearStep={clearStep}
                onAbortStep={handleAbortStep}
                onRunStep4Phase={handleRunStep4Phase}
                onEditOutput={handleEditOutput}
              />
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
              <div className="flex items-center justify-between p-4 border-b border-border/30">
                <h2 className="text-lg font-bold gradient-text">Knowledge Graph</h2>
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
              </div>
              <div className="h-[calc(100%-70px)]">
                <GraphVisualizationWrapper steps={steps} zenMode={zenMode} />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'pipeline' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold gradient-text">Pipeline Steps</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const stepsWithData = steps.filter(s => s.status === 'completed' || s.status === 'error');
                  if (stepsWithData.length === 0) {
                    alert('No data to clear');
                    return;
                  }
                  if (confirm(`Clear all data from ${stepsWithData.length} step(s)? This will reset all completed steps to pending.`)) {
                    stepsWithData.forEach(step => clearStep(step.id));
                  }
                }}
                disabled={!steps.some(s => s.status === 'completed' || s.status === 'error')}
                className="relative group border-rose-500/50 bg-gradient-to-r from-rose-500/10 to-red-500/10 text-rose-400 hover:from-rose-500/20 hover:to-red-500/20 hover:border-rose-400 hover:shadow-[0_0_20px_rgba(244,63,94,0.3)] transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
                title="Clear all data from all steps"
              >
                <div className="absolute inset-0 rounded-md bg-gradient-to-r from-rose-500/0 via-rose-500/5 to-rose-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <Trash2 size={14} className="mr-1.5 relative z-10 group-hover:scale-110 transition-transform duration-200" />
                <span className="relative z-10 font-semibold">Clear All Data</span>
              </Button>
            </div>
            <PipelineView
              steps={steps}
              agents={agents}
              onRunStep={handleRunStep}
              onRunStep4Phase={handleRunStep4Phase}
              onSkipStep={skipStep}
              onClearStep={clearStep}
              onAbortStep={handleAbortStep}
              onEditOutput={handleEditOutput}
            />
          </div>
        )}

        {activeTab === 'graph' && (
          <div className="h-[800px] bg-card/50 backdrop-blur-sm rounded-lg shadow-lg border border-border/30 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border/30">
              <h2 className="text-lg font-bold gradient-text">Knowledge Graph</h2>
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
            </div>
            <div className="h-[calc(100%-60px)]">
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
    </div>
  );
}

export default App;

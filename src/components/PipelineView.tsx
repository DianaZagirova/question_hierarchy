import React, { useState, useEffect, useRef } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { StepOutputViewer } from './StepOutputViewer';
import { PipelineStep, AgentConfig } from '@/types';
import { Play, SkipForward, CheckCircle, XCircle, Circle, Loader, RefreshCw, Trash2, StopCircle, Info, X, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { subscribeBatchProgress, BatchProgress } from '@/lib/api';

interface PipelineViewProps {
  steps: PipelineStep[];
  agents: AgentConfig[];
  onRunStep: (stepId: number) => void;
  onSkipStep: (stepId: number) => void;
  onClearStep: (stepId: number) => void;
  onAbortStep: (stepId: number) => void;
  onRetryStep?: (stepId: number) => void;
  onRunStep4Phase?: (phase: '4a' | '4b') => void;
  onEditOutput?: (stepId: number, newOutput: any) => void;
}

// Step-specific input/output descriptions
const STEP_IO: Record<number, { inputs: string[]; outputs: string[] }> = {
  1: {
    inputs: ['User-provided goal/objective (free text)'],
    outputs: ['Q₀ — a single, engineering-grade master question with success criteria, baseline, and constraints'],
  },
  2: {
    inputs: ['Q₀ from Step 1'],
    outputs: ['Goal Pillars (sub-goals with state definitions, done criteria, failure modes)', 'Bridge Lexicon (SPVs — System Property Variables with meter classes)'],
  },
  3: {
    inputs: ['Goal Pillars from Step 2', 'Bridge Lexicon from Step 2'],
    outputs: ['Requirement Atoms (RAs) — atomic, testable requirements per goal with state variables, failure shapes, and perturbation classes'],
  },
  4: {
    inputs: ['Goal Pillars from Step 2', 'Requirement Atoms from Step 3', 'Bridge Lexicon from Step 2'],
    outputs: ['Scientific Knowledge Base — domain-mapped interventions with evidence levels, organized by research domain'],
  },
  5: {
    inputs: ['Requirement Atoms from Step 3', 'Scientific Knowledge from Step 4'],
    outputs: ['Matching Edges — connections between RAs and scientific interventions (SKIPPED — integrated into Step 4b)'],
  },
  6: {
    inputs: ['Goal Pillars from Step 2', 'Requirement Atoms from Step 3', 'Scientific Knowledge from Step 4'],
    outputs: ['L3 Seed Questions — frontier research questions per goal, each with strategy, rationale, and discriminator target'],
  },
  7: {
    inputs: ['L3 Questions from Step 6', 'Goal Pillars from Step 2'],
    outputs: ['Instantiation Hypotheses (IH) — competing process hypotheses per L3, with discriminating predictions and domain categories'],
  },
  8: {
    inputs: ['L3 Questions from Step 6', 'IH from Step 7', 'Scientific Knowledge from Step 4'],
    outputs: ['L4 Tactical Questions — discriminators, model/tool requirements, and unknown explorations per L3 branch'],
  },
  9: {
    inputs: ['L4 Questions from Step 8', 'Requirement Atoms from Step 3'],
    outputs: ['L5 Mechanistic Drills (sub-questions per L4)', 'L6 Leaf Specs (actionable experiment tasks with S-I-M-T parameters)'],
  },
  10: {
    inputs: ['Q₀ from Step 1', 'L4 Questions from Step 8', 'All L6 Tasks from Step 9 (grouped per L4 branch)'],
    outputs: ['Per-L4 verdict: either a unified Common Experiment design or a justified impossibility statement with rejection reasons'],
  },
};

export const PipelineView: React.FC<PipelineViewProps> = ({ steps, agents, onRunStep, onSkipStep, onClearStep, onAbortStep, onRetryStep, onRunStep4Phase, onEditOutput }) => {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [agentInfoStep, setAgentInfoStep] = useState<number | null>(null);
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [editJson, setEditJson] = useState<string>('');
  const [editError, setEditError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<Record<number, BatchProgress>>({});
  const sseCleanupRefs = useRef<Record<number, () => void>>({});

  // Track whether any step is currently running (global lock for Run/Regenerate buttons)
  const isAnyStepRunning = steps.some((s) => s.status === 'running');

  // Subscribe to SSE progress for running batch steps (steps 3-10 use batching)
  useEffect(() => {
    const batchStepIds = [3, 4, 6, 7, 8, 9, 10];
    steps.forEach((step) => {
      if (step.status === 'running' && batchStepIds.includes(step.id) && !sseCleanupRefs.current[step.id]) {
        // Clear stale progress from previous run before subscribing
        setBatchProgress((prev) => {
          if (prev[step.id]) {
            const next = { ...prev };
            delete next[step.id];
            return next;
          }
          return prev;
        });
        const cleanup = subscribeBatchProgress(
          step.id,
          (progress) => {
            setBatchProgress((prev) => {
              const existing = prev[step.id];
              // Enforce monotonic progress: never let percent go backward
              if (existing && progress.percent < existing.percent) {
                return { ...prev, [step.id]: { ...progress, percent: existing.percent, completed: Math.max(progress.completed, existing.completed) } };
              }
              return { ...prev, [step.id]: progress };
            });
          },
          () => {
            // On done/disconnect, remove from active subscriptions
            delete sseCleanupRefs.current[step.id];
          }
        );
        sseCleanupRefs.current[step.id] = cleanup;
      }
      // Clean up SSE if step is no longer running
      if (step.status !== 'running' && sseCleanupRefs.current[step.id]) {
        sseCleanupRefs.current[step.id]();
        delete sseCleanupRefs.current[step.id];
        // Clear stale progress after a short delay
        setTimeout(() => {
          setBatchProgress((prev) => {
            const next = { ...prev };
            delete next[step.id];
            return next;
          });
        }, 2000);
      }
    });
    // Cleanup all on unmount
    return () => {
      Object.values(sseCleanupRefs.current).forEach((fn) => fn());
      sseCleanupRefs.current = {};
    };
  }, [steps.map(s => `${s.id}:${s.status}`).join(',')]);

  const handleStartEdit = (stepId: number, output: any) => {
    setEditingStep(stepId);
    setEditJson(JSON.stringify(output, null, 2));
    setEditError(null);
    // Ensure step is expanded
    setExpandedSteps((prev) => new Set(prev).add(stepId));
  };

  const handleSaveEdit = (stepId: number) => {
    try {
      const parsed = JSON.parse(editJson);
      onEditOutput?.(stepId, parsed);
      setEditingStep(null);
      setEditJson('');
      setEditError(null);
    } catch (e: any) {
      setEditError(e.message);
    }
  };

  const handleCancelEdit = () => {
    setEditingStep(null);
    setEditJson('');
    setEditError(null);
  };

  const toggleStep = (stepId: number) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stepId)) {
        newSet.delete(stepId);
      } else {
        newSet.add(stepId);
      }
      return newSet;
    });
  };

  const getStep4PhaseLabel = (phase: string): string => {
    switch (phase) {
      case '4a_domain_mapping':
        return 'Phase 4a: Domain Mapping';
      case '4b_domain_scans':
        return 'Phase 4b: Domain Scans (Parallel)';
      default:
        return phase;
    }
  };

  const getStatusIcon = (status: PipelineStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="text-green-500" size={20} />;
      case 'running':
        return <Loader className="text-blue-500 animate-spin" size={20} />;
      case 'error':
        return <XCircle className="text-red-500" size={20} />;
      case 'skipped':
        return <Circle className="text-gray-400" size={20} />;
      default:
        return <Circle className="text-gray-300" size={20} />;
    }
  };

  const canRunStep = (step: PipelineStep, index: number) => {
    // Check if agent is disabled
    const agent = agents.find(a => a.id === step.agentId);
    if (agent && agent.enabled === false) return false;

    if (step.status === 'completed' || step.status === 'running' || step.status === 'skipped') return false;
    if (index === 0) return true; // First step can always run if not completed
    const previousStep = steps[index - 1];
    return previousStep.status === 'completed' || previousStep.status === 'skipped';
  };

  return (
    <div className="space-y-4">
      {steps.map((step, index) => {
        const agent = agents.find(a => a.id === step.agentId);
        const isDisabled = agent && agent.enabled === false;

        return (
        <Card
          key={step.id}
          className={cn(
            'transition-all bg-card/50 border-border/30',
            step.status === 'running' && 'ring-2 ring-primary shadow-[0_0_30px_rgba(59,130,246,0.3)]',
            step.status === 'error' && 'ring-2 ring-rose-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]',
            isDisabled && 'opacity-60 bg-muted/30 border-muted'
          )}
        >
          <CardHeader className="border-b border-border/30 bg-gradient-to-r from-primary/5 via-transparent to-accent/5">
            <div className="flex items-center justify-between">
              <div 
                onClick={() => (step.output || step.error) && toggleStep(step.id)} 
                className="flex-1 cursor-pointer hover:opacity-80 transition-opacity"
              >
                <div className="flex items-center gap-3 flex-1">
                  {getStatusIcon(step.status)}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {(() => {
                        const agent = agents.find(a => a.id === step.agentId);
                        return agent?.icon && (
                          <span className="text-xl" title={agent.name}>{agent.icon}</span>
                        );
                      })()}
                      <CardTitle className="text-base">
                        Step {step.id}: {step.name}
                      </CardTitle>
                      {isDisabled && (
                        <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-muted text-muted-foreground border border-muted-foreground/30">
                          {step.id === 5 ? 'PERMANENTLY SKIPPED' : 'DISABLED'}
                        </span>
                      )}
                    </div>
                    {(() => {
                      const stepAgent = agents.find(a => a.id === step.agentId);
                      return stepAgent && (
                        <p className="text-xs text-muted-foreground">
                          {stepAgent.name}
                          {isDisabled && (
                            <span className="ml-2 text-muted-foreground/70">
                              • Agent disabled - function integrated into Step 4
                            </span>
                          )}
                          {!isDisabled && step.status === 'running' && (() => {
                            const prog = batchProgress[step.id];
                            if (prog && prog.total > 0) {
                              const etaMin = Math.ceil(prog.eta / 60);
                              return (
                                <span className="ml-2 text-primary">
                                  • {prog.completed}/{prog.total} items ({prog.percent}%)
                                  {prog.eta > 0 && ` — ETA ${etaMin < 1 ? '<1' : etaMin} min`}
                                </span>
                              );
                            }
                            return (
                              <span className="ml-2 text-primary animate-pulse">
                                • Processing (this may take 30-60 seconds)
                              </span>
                            );
                          })()}
                          {/* Show Step 4 phase information */}
                          {step.id === 4 && step.output && typeof step.output === 'object' && (step.output as any).phase && (
                            <span className="ml-2 text-blue-400">
                              • {getStep4PhaseLabel((step.output as any).phase)}
                              {(step.output as any).progress !== undefined && ` (${(step.output as any).progress}%)`}
                            </span>
                          )}
                        </p>
                      );
                    })()}
                    {step.timestamp && (
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        {new Date(step.timestamp).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAgentInfoStep(agentInfoStep === step.id ? null : step.id)}
                  className={cn(
                    "px-2 text-muted-foreground hover:text-foreground",
                    agentInfoStep === step.id && "text-blue-400 bg-blue-500/10"
                  )}
                  title="Agent info"
                >
                  <Info size={16} />
                </Button>
                {canRunStep(step, index) && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => onRunStep(step.id)}
                      disabled={isAnyStepRunning}
                    >
                      <Play size={16} className="mr-1" />
                      Run
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onSkipStep(step.id)}
                      disabled={isAnyStepRunning}
                    >
                      <SkipForward size={16} className="mr-1" />
                      Skip
                    </Button>
                  </>
                )}
                {step.status === 'running' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAbortStep(step.id)}
                      className="border-orange-300 text-orange-600 hover:bg-orange-50 px-2"
                      title="Stop Generation"
                    >
                      <StopCircle size={16} className="mr-1" />
                      Stop
                    </Button>
                    {onRetryStep && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onRetryStep(step.id)}
                        className="border-blue-300 text-blue-600 hover:bg-blue-50 px-2"
                        title="Abort current run and restart this step"
                      >
                        <RefreshCw size={16} className="mr-1" />
                        Retry
                      </Button>
                    )}
                  </>
                )}
                {step.status === 'completed' && (
                  <>
                    {onEditOutput && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleStartEdit(step.id, step.output)}
                        disabled={isAnyStepRunning}
                        className={cn(
                          "px-2",
                          editingStep === step.id
                            ? "border-amber-400 text-amber-400 bg-amber-500/10"
                            : "border-amber-300 text-amber-600 hover:bg-amber-50"
                        )}
                        title="Edit output JSON"
                      >
                        <Pencil size={16} />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRunStep(step.id)}
                      disabled={isAnyStepRunning}
                      className="border-blue-300 text-blue-600 hover:bg-blue-50 px-2"
                      title="Regenerate"
                    >
                      <RefreshCw size={16} />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onClearStep(step.id)}
                      disabled={isAnyStepRunning}
                      className="border-rose-300 text-rose-600 hover:bg-rose-50 px-2"
                      title="Clear"
                    >
                      <Trash2 size={16} />
                    </Button>
                  </>
                )}
                {step.status === 'error' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRunStep(step.id)}
                      disabled={isAnyStepRunning}
                      className="border-orange-300 text-orange-600 hover:bg-orange-50"
                      title="Retry this step"
                    >
                      <RefreshCw size={16} className="mr-1" />
                      Retry
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onClearStep(step.id)}
                      disabled={isAnyStepRunning}
                      className="border-rose-300 text-rose-600 hover:bg-rose-50 px-2"
                      title="Clear error"
                    >
                      <Trash2 size={16} />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>

          {/* Agent Info Panel */}
          {agentInfoStep === step.id && agent && (
            <CardContent className="border-t border-border/30">
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4 relative">
                <button
                  onClick={() => setAgentInfoStep(null)}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X size={14} />
                </button>

                {/* Header */}
                <div className="flex items-center gap-3 mb-3">
                  {agent.icon && <span className="text-2xl">{agent.icon}</span>}
                  <div>
                    <div className="font-bold text-sm text-foreground">{agent.name}</div>
                    <div className="text-xs text-blue-400 font-semibold">{agent.role}</div>
                  </div>
                </div>

                {/* Description */}
                {agent.description && (
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{agent.description}</p>
                )}

                {/* Model & Settings */}
                <div className="flex flex-wrap gap-2 mb-3">
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-700/50 text-slate-300 border border-slate-600/50">
                    Model: {agent.model}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-700/50 text-slate-300 border border-slate-600/50">
                    Temp: {agent.temperature}
                  </span>
                  {agent.settings?.nodeCount && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-700/50 text-slate-300 border border-slate-600/50">
                      Nodes: {agent.settings.nodeCount.min}–{agent.settings.nodeCount.max} (default {agent.settings.nodeCount.default})
                    </span>
                  )}
                  {agent.enabled === false && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-red-900/30 text-red-400 border border-red-800/50">
                      DISABLED
                    </span>
                  )}
                </div>

                {/* Inputs */}
                {STEP_IO[step.id] && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-emerald-500/5 border border-emerald-500/20 rounded p-2.5">
                      <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide mb-1.5">Inputs</div>
                      <ul className="space-y-1">
                        {STEP_IO[step.id].inputs.map((input, i) => (
                          <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                            <span className="text-emerald-500 shrink-0">→</span>
                            {input}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded p-2.5">
                      <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wide mb-1.5">Outputs</div>
                      <ul className="space-y-1">
                        {STEP_IO[step.id].outputs.map((output, i) => (
                          <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                            <span className="text-amber-500 shrink-0">←</span>
                            {output}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          )}

          {/* Real-time batch progress bar (for all batch steps except Step 4 which has its own UI) */}
          {step.status === 'running' && step.id !== 4 && batchProgress[step.id] && batchProgress[step.id].total > 0 && (
            <CardContent className="border-t border-border/30 py-3">
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-primary uppercase tracking-wide">
                    Batch Progress
                  </span>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    {batchProgress[step.id].successful > 0 && (
                      <span className="text-green-400">{batchProgress[step.id].successful} ok</span>
                    )}
                    {batchProgress[step.id].failed > 0 && (
                      <span className="text-rose-400">{batchProgress[step.id].failed} failed</span>
                    )}
                    {batchProgress[step.id].elapsed > 0 && (
                      <span>{Math.round(batchProgress[step.id].elapsed)}s elapsed</span>
                    )}
                    {batchProgress[step.id].eta > 0 && (
                      <span className="text-primary font-semibold">
                        ETA {Math.ceil(batchProgress[step.id].eta / 60) < 1 ? '<1' : Math.ceil(batchProgress[step.id].eta / 60)} min
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-full bg-slate-700/50 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-primary to-accent h-full transition-all duration-700 ease-out rounded-full"
                    style={{ width: `${batchProgress[step.id].percent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-0.5">
                  <span>{batchProgress[step.id].completed} / {batchProgress[step.id].total} items</span>
                  <span className="text-primary font-semibold">{batchProgress[step.id].percent}%</span>
                </div>
              </div>
            </CardContent>
          )}

          {/* Step 4 Phase Progress Indicator (shown when running) */}
          {step.id === 4 && step.status === 'running' && step.output && typeof step.output === 'object' && (step.output as any).phase && (
            <CardContent className="border-t border-border/30">
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                <div className="text-xs font-bold text-blue-400 mb-3 uppercase tracking-wide">
                  🔬 2-Phase Scientific Knowledge Collection
                </div>
                <div className="space-y-2.5">
                  {/* Phase 4a */}
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      (step.output as any).phase === '4a_domain_mapping' ? 'bg-blue-500 text-white animate-pulse ring-2 ring-blue-400' :
                      (step.output as any).progress >= 50 ? 'bg-green-500 text-white' : 'bg-slate-700 text-slate-400'
                    }`}>
                      {(step.output as any).progress >= 50 ? '✓' : '1'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">Phase 1: Domain Mapping</div>
                      <div className="text-xs text-muted-foreground">Identify 8-12 relevant research domains</div>
                    </div>
                  </div>

                  {/* Phase 4b */}
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      (step.output as any).phase === '4b_domain_scans' ? 'bg-blue-500 text-white animate-pulse ring-2 ring-blue-400' :
                      (step.output as any).progress === 100 ? 'bg-green-500 text-white' : 'bg-slate-700 text-slate-400'
                    }`}>
                      {(step.output as any).progress === 100 ? '✓' : '2'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold">Phase 2: Domain Scans (Parallel)</div>
                      <div className="text-xs text-muted-foreground">Collect 15-50 interventions per domain</div>
                    </div>
                  </div>

                </div>

                {/* Progress Bar - 2 phases = 50% each */}
                <div className="mt-4">
                  <div className="w-full bg-slate-700/50 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-green-500 h-full transition-all duration-500 rounded-full"
                      style={{ width: `${(step.output as any).progress || 0}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 mt-1 px-1">
                    <span>Phase 1</span>
                    <span className="text-blue-400 font-semibold">{(step.output as any).progress || 0}% Complete</span>
                    <span>Phase 2</span>
                  </div>
                </div>
              </div>
            </CardContent>
          )}

          {/* Step 4 Phase Controls (shown when completed or has phase data) */}
          {step.id === 4 && onRunStep4Phase && (step.status === 'completed' || step.step4Phases) && (
            <CardContent className="border-t border-border/30">
              <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
                <div className="text-xs font-bold text-slate-300 mb-3 uppercase tracking-wide">Rerun Specific Phases</div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRunStep4Phase('4a')}
                    disabled={step.status === 'running'}
                    className="border-blue-400/50 text-blue-400 hover:bg-blue-500/10 text-xs"
                    title="Rerun Phase 4a: Domain Mapping"
                  >
                    <RefreshCw size={14} className="mr-1" />
                    Phase 4a
                    {step.step4Phases?.phase4a_domain_mapping && <span className="ml-1">✓</span>}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRunStep4Phase('4b')}
                    disabled={step.status === 'running' || !step.step4Phases?.phase4a_domain_mapping}
                    className="border-purple-400/50 text-purple-400 hover:bg-purple-500/10 text-xs disabled:opacity-50"
                    title={!step.step4Phases?.phase4a_domain_mapping ? "Phase 4a must be completed first" : "Rerun Phase 4b: Domain Scans"}
                  >
                    <RefreshCw size={14} className="mr-1" />
                    Phase 4b
                    {step.step4Phases?.phase4b_domain_scans && <span className="ml-1">✓</span>}
                  </Button>
                </div>
                <div className="text-xs text-slate-400 mt-2">
                  Click a phase button to rerun that specific phase independently
                </div>
              </div>
            </CardContent>
          )}

          {(step.output || step.error || step.step4Phases) && expandedSteps.has(step.id) && (
            <CardContent>
              {step.error && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded p-3 mb-3">
                  <p className="text-sm text-rose-400 font-medium">Error:</p>
                  <p className="text-sm text-rose-300 mt-1">{step.error}</p>
                </div>
              )}
              {/* JSON Editor Mode */}
              {editingStep === step.id && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Pencil size={14} className="text-amber-400" />
                      <span className="text-xs font-bold text-amber-400 uppercase tracking-wide">
                        Editing Step {step.id} Output
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleSaveEdit(step.id)}
                        className="bg-green-600 hover:bg-green-700 text-white text-xs px-3"
                      >
                        Save Changes
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCancelEdit}
                        className="border-slate-500 text-slate-400 hover:bg-slate-700 text-xs px-3"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                  {editError && (
                    <div className="bg-rose-500/10 border border-rose-500/30 rounded p-2 text-xs text-rose-400">
                      JSON Parse Error: {editError}
                    </div>
                  )}
                  <textarea
                    value={editJson}
                    onChange={(e) => {
                      setEditJson(e.target.value);
                      setEditError(null);
                    }}
                    className="w-full h-[500px] bg-slate-900 border border-amber-500/30 rounded-lg p-3 text-xs font-mono text-foreground leading-relaxed focus:border-amber-400 focus:ring-1 focus:ring-amber-400/30 transition-all resize-y"
                    spellCheck={false}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Edit the JSON output directly. Changes will be saved to the pipeline and used by downstream steps.
                    Be careful to maintain valid JSON structure.
                  </p>
                </div>
              )}
              {/* Normal Output Viewer */}
              {editingStep !== step.id && (step.output || step.step4Phases) && (
                <StepOutputViewer output={step.output} stepId={step.id} step={step} />
              )}
            </CardContent>
          )}
        </Card>
        );
      })}
    </div>
  );
};

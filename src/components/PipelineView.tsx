import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { StepOutputViewer } from './StepOutputViewer';
import { PipelineStep, AgentConfig } from '@/types';
import { Play, SkipForward, CheckCircle, XCircle, Circle, Loader, RefreshCw, Trash2, StopCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PipelineViewProps {
  steps: PipelineStep[];
  agents: AgentConfig[];
  onRunStep: (stepId: number) => void;
  onSkipStep: (stepId: number) => void;
  onClearStep: (stepId: number) => void;
  onAbortStep: (stepId: number) => void;
  onRunStep4Phase?: (phase: '4a' | '4b') => void;
}

export const PipelineView: React.FC<PipelineViewProps> = ({ steps, agents, onRunStep, onSkipStep, onClearStep, onAbortStep, onRunStep4Phase }) => {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

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
                          {!isDisabled && step.status === 'running' && (
                            <span className="ml-2 text-primary animate-pulse">
                              • Processing (this may take 30-60 seconds)
                            </span>
                          )}
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
                {canRunStep(step, index) && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => onRunStep(step.id)}
                      disabled={step.status === 'running'}
                    >
                      <Play size={16} className="mr-1" />
                      Run
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onSkipStep(step.id)}
                    >
                      <SkipForward size={16} className="mr-1" />
                      Skip
                    </Button>
                  </>
                )}
                {step.status === 'running' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onAbortStep(step.id)}
                    className="border-orange-300 text-orange-600 hover:bg-orange-50 px-2"
                    title="Stop Generation"
                  >
                    <StopCircle size={16} />
                  </Button>
                )}
                {step.status === 'completed' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRunStep(step.id)}
                      className="border-blue-300 text-blue-600 hover:bg-blue-50 px-2"
                      title="Regenerate"
                    >
                      <RefreshCw size={16} />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onClearStep(step.id)}
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
              {(step.output || step.step4Phases) && (
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

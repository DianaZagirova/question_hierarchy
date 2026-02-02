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
}

export const PipelineView: React.FC<PipelineViewProps> = ({ steps, agents, onRunStep, onSkipStep, onClearStep, onAbortStep }) => {
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
    if (step.status === 'completed' || step.status === 'running') return false;
    if (index === 0) return true; // First step can always run if not completed
    const previousStep = steps[index - 1];
    return previousStep.status === 'completed' || previousStep.status === 'skipped';
  };

  return (
    <div className="space-y-4">
      {steps.map((step, index) => (
        <Card
          key={step.id}
          className={cn(
            'transition-all bg-card/50 border-border/30',
            step.status === 'running' && 'ring-2 ring-primary shadow-[0_0_30px_rgba(59,130,246,0.3)]',
            step.status === 'error' && 'ring-2 ring-rose-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]'
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
                    </div>
                    {(() => {
                      const agent = agents.find(a => a.id === step.agentId);
                      return agent && (
                        <p className="text-xs text-muted-foreground">
                          {agent.name}
                          {step.status === 'running' && (
                            <span className="ml-2 text-primary animate-pulse">
                              • Processing (this may take 30-60 seconds)
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
              </div>
            </div>
          </CardHeader>

          {(step.output || step.error) && expandedSteps.has(step.id) && (
            <CardContent>
              {step.error && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded p-3 mb-3">
                  <p className="text-sm text-rose-400 font-medium">Error:</p>
                  <p className="text-sm text-rose-300 mt-1">{step.error}</p>
                </div>
              )}
              {step.output && (
                <StepOutputViewer output={step.output} stepId={step.id} />
              )}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
};

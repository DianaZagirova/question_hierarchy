import React from 'react';
import { PipelineView } from './PipelineView';
import { GraphVisualization } from './GraphVisualization';
import { PipelineStep, AgentConfig } from '@/types';

interface SplitViewProps {
  steps: PipelineStep[];
  agents: AgentConfig[];
  onRunStep: (stepId: number) => void;
  onSkipStep: (stepId: number) => void;
  onClearStep: (stepId: number) => void;
  onAbortStep: (stepId: number) => void;
}

export const SplitView: React.FC<SplitViewProps> = ({ steps, agents, onRunStep, onSkipStep, onClearStep, onAbortStep }) => {
  return (
    <div className="grid grid-cols-2 gap-4 h-[calc(100vh-300px)]">
      {/* Left: Pipeline Actions */}
      <div className="overflow-y-auto pr-2">
        <h2 className="text-xl font-bold mb-4 sticky top-0 bg-gradient-to-r from-primary/10 to-accent/10 backdrop-blur-sm py-3 px-4 rounded-lg border border-border/30 z-10">
          Pipeline Steps
        </h2>
        <PipelineView
          steps={steps}
          agents={agents}
          onRunStep={onRunStep}
          onSkipStep={onSkipStep}
          onClearStep={onClearStep}
          onAbortStep={onAbortStep}
        />
      </div>

      {/* Right: Graph Visualization */}
      <div className="bg-card/50 backdrop-blur-sm rounded-lg shadow-lg border border-border/30 sticky top-0">
        <div className="h-full">
          <GraphVisualization steps={steps} />
        </div>
      </div>
    </div>
  );
};

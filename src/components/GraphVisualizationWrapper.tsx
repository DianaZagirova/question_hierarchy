import React from 'react';
import { ReactFlowProvider } from 'reactflow';
import { GraphVisualizationImproved } from './GraphVisualizationImproved';
import { PipelineStep } from '@/types';

interface GraphVisualizationWrapperProps {
  steps: PipelineStep[];
  highlightedNodeId?: string | null;
  onNodeHighlight?: (nodeId: string | null, nodeType: string | null) => void;
  zenMode?: boolean;
}

export const GraphVisualizationWrapper: React.FC<GraphVisualizationWrapperProps> = (props) => {
  return (
    <ReactFlowProvider>
      <GraphVisualizationImproved {...props} />
    </ReactFlowProvider>
  );
};

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import ReactFlow, {
  Node,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MiniMap,
  useReactFlow,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { PipelineStep } from '@/types';
import { GraphControls } from './graph/GraphControls';
import { StandardNode, ClusterNode, CompactNode, MasterNode, NODE_COLORS } from './graph/CustomNodes';
import { buildGraphFromSteps, ClusterState } from './graph/graphBuilder';
import { getHierarchicalLayout, getRadialLayout, getForceLayout } from './graph/layoutUtils';
import { renderNodeDetails } from './StepOutputViewer';

interface GraphVisualizationImprovedProps {
  steps: PipelineStep[];
  highlightedNodeId?: string | null;
  onNodeHighlight?: (nodeId: string | null, nodeType: string | null) => void;
}

const nodeTypes = {
  standard: StandardNode,
  cluster: ClusterNode,
  compact: CompactNode,
  master: MasterNode,
};

export const GraphVisualizationImproved: React.FC<GraphVisualizationImprovedProps> = ({
  steps,
  onNodeHighlight,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    new Set(['q0', 'goals', 'spvs', 'ras', 'domains', 'l3', 'ih', 'l4', 'l5', 'l6'])
  );
  const [layoutMode, setLayoutMode] = useState<'hierarchical' | 'force' | 'radial'>('hierarchical');
  const [clusterState, setClusterState] = useState<ClusterState>({});
  const { fitView } = useReactFlow();
  
  // Extract bridge lexicon from Step 2 for node detail lookups
  const step2 = steps.find(s => s.id === 2);
  const bridgeLexicon = step2?.output?.bridge_lexicon || step2?.output?.Bridge_Lexicon || step2?.output?.bridgeLexicon || {};

  // Build graph from pipeline steps
  const graphData = useMemo(() => {
    return buildGraphFromSteps(steps, clusterState);
  }, [steps, clusterState]);

  // Apply layout to nodes
  const layoutedGraph = useMemo(() => {
    let layoutedNodes = graphData.nodes;

    // Apply selected layout algorithm
    switch (layoutMode) {
      case 'hierarchical':
        layoutedNodes = getHierarchicalLayout(graphData.nodes, graphData.edges, {
          direction: 'TB',
          rankSep: 250,  // Generous vertical spacing between hierarchy levels
          nodeSep: 80,   // Tighter horizontal spacing to reduce width
        });
        break;
      case 'radial':
        layoutedNodes = getRadialLayout(graphData.nodes, graphData.edges);
        break;
      case 'force':
        layoutedNodes = getForceLayout(graphData.nodes, graphData.edges);
        break;
    }

    return { nodes: layoutedNodes, edges: graphData.edges };
  }, [graphData, layoutMode]);

  // Filter nodes and edges based on visible layers and search
  const filteredGraph = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();

    // Filter nodes
    const filteredNodes = layoutedGraph.nodes.filter((node) => {
      // Layer filter
      const nodeType = node.data.type;
      const layerId = getLayerIdFromNodeType(nodeType);
      if (!visibleLayers.has(layerId)) return false;

      // Search filter
      if (searchTerm) {
        const label = node.data.label?.toLowerCase() || '';
        const title = node.data.title?.toLowerCase() || '';
        const description = node.data.description?.toLowerCase() || '';
        return label.includes(searchLower) || title.includes(searchLower) || description.includes(searchLower);
      }

      return true;
    });

    const visibleNodeIds = new Set(filteredNodes.map(n => n.id));

    // Filter edges (only show edges where both source and target are visible)
    const filteredEdges = layoutedGraph.edges.filter((edge) => {
      return visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
    });

    return { nodes: filteredNodes, edges: filteredEdges };
  }, [layoutedGraph, visibleLayers, searchTerm]);

  // Add cluster toggle callbacks to cluster nodes
  const nodesWithCallbacks = useMemo(() => {
    return filteredGraph.nodes.map(node => {
      if (node.type === 'cluster') {
        return {
          ...node,
          data: {
            ...node.data,
            onToggle: () => {
              setClusterState(prev => ({
                ...prev,
                [node.id]: !prev[node.id],
              }));
            },
          },
        };
      }
      return node;
    });
  }, [filteredGraph.nodes]);

  useEffect(() => {
    setNodes(nodesWithCallbacks);
    setEdges(filteredGraph.edges);
  }, [nodesWithCallbacks, filteredGraph.edges, setNodes, setEdges]);

  // Fit view when layout changes
  useEffect(() => {
    setTimeout(() => fitView({ duration: 500, padding: 0.1 }), 100);
  }, [layoutMode, fitView]);

  // Node click handler
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNode(node.data);
      if (onNodeHighlight) {
        onNodeHighlight(node.id, node.data.type);
      }
    },
    [onNodeHighlight]
  );

  // Pane click handler (deselect)
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    if (onNodeHighlight) {
      onNodeHighlight(null, null);
    }
  }, [onNodeHighlight]);

  // Layer toggle handler
  const handleLayerToggle = useCallback((layerId: string) => {
    setVisibleLayers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(layerId)) {
        newSet.delete(layerId);
      } else {
        newSet.add(layerId);
      }
      return newSet;
    });
  }, []);

  // Expand/collapse all clusters
  // Must iteratively discover all cluster IDs since cascading collapse
  // hides downstream clusters until their parents are expanded
  const handleExpandAll = useCallback(() => {
    let currentState: ClusterState = { ...clusterState };
    // Iteratively expand: each pass may reveal new clusters
    for (let i = 0; i < 10; i++) {
      // Mark all currently known clusters as expanded
      const data = buildGraphFromSteps(steps, currentState);
      const newState: ClusterState = { ...currentState };
      let foundNew = false;
      data.nodes.filter(n => n.type === 'cluster').forEach(n => {
        if (!newState[n.id]) {
          newState[n.id] = true;
          foundNew = true;
        }
      });
      currentState = newState;
      if (!foundNew) break; // All clusters discovered
    }
    setClusterState(currentState);
  }, [steps, clusterState]);

  const handleCollapseAll = useCallback(() => {
    setClusterState({});
  }, []);

  // Reset to default view: collapse all, show all layers, clear search, hierarchical layout, center on Q0
  const handleResetView = useCallback(() => {
    setClusterState({});
    setSearchTerm('');
    setVisibleLayers(new Set(['q0', 'goals', 'spvs', 'ras', 'domains', 'l3', 'ih', 'l4', 'l5', 'l6']));
    setLayoutMode('hierarchical');
    setSelectedNode(null);
    if (onNodeHighlight) onNodeHighlight(null, null);
    setTimeout(() => fitView({ duration: 500, padding: 0.1 }), 150);
  }, [fitView, onNodeHighlight]);

  return (
    <div className="h-full w-full relative bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.05}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.7 }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        selectNodesOnDrag={false}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        preventScrolling={true}
        attributionPosition="bottom-right"
        proOptions={{ hideAttribution: true }}
      >
        <Background color="hsl(var(--muted-foreground) / 0.15)" gap={16} />
        <Controls
          showZoom
          showFitView
          showInteractive
          className="bg-card/95 backdrop-blur-sm border-border shadow-lg"
        />
        <MiniMap
          nodeColor={(node) => {
            const type = node.data?.type;
            return type === 'q0' ? '#3b82f6' :
                   type === 'goal' ? '#8b5cf6' :
                   type === 'ra' ? '#10b981' :
                   type === 'domain' ? '#06b6d4' :
                   type === 'l3' ? '#ef4444' :
                   type === 'l6' ? '#14b8a6' : '#6366f1';
          }}
          maskColor="rgba(0, 0, 0, 0.6)"
          style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
          className="backdrop-blur-sm"
        />

        {/* Graph Controls */}
        <Panel position="top-left">
          <GraphControls
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            visibleLayers={visibleLayers}
            onLayerToggle={handleLayerToggle}
            onExpandAll={handleExpandAll}
            onCollapseAll={handleCollapseAll}
            onResetView={handleResetView}
            layoutMode={layoutMode}
            onLayoutChange={setLayoutMode}
          />
        </Panel>

        {/* Stats Panel */}
        <Panel position="top-right">
          <div className="bg-card/95 backdrop-blur-sm rounded-lg shadow-lg p-3 border border-border/50 text-xs">
            <div className="font-bold mb-2">Graph Stats</div>
            <div className="space-y-1 text-[10px]">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Total Nodes:</span>
                <span className="font-semibold">{nodes.length}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Visible:</span>
                <span className="font-semibold text-green-400">{filteredGraph.nodes.length}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Edges:</span>
                <span className="font-semibold">{edges.length}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Layout:</span>
                <span className="font-semibold capitalize">{layoutMode}</span>
              </div>
            </div>
          </div>
        </Panel>
      </ReactFlow>

      {/* Node Details Panel */}
      {selectedNode && (
        <div className="absolute top-4 right-4 bg-card/95 backdrop-blur-sm rounded-lg shadow-xl p-4 max-w-lg max-h-[70vh] overflow-auto border border-border/50 z-20">
          <div className="flex justify-between items-start mb-3">
            <h3 className="font-bold text-sm leading-tight flex-1 pr-2">
              <span className={NODE_COLORS[selectedNode.type as keyof typeof NODE_COLORS]?.text || 'text-foreground'}>
                {selectedNode.label || selectedNode.title}
              </span>
            </h3>
            <button
              onClick={() => {
                setSelectedNode(null);
                if (onNodeHighlight) {
                  onNodeHighlight(null, null);
                }
              }}
              className="text-muted-foreground hover:text-foreground text-xl leading-none flex-shrink-0"
            >
              ×
            </button>
          </div>

          {/* Show full text if different from label */}
          {selectedNode.fullText && selectedNode.fullText !== selectedNode.label && (
            <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <div className="text-xs font-semibold text-blue-400 mb-1">FULL TEXT:</div>
              <div className="text-sm text-foreground leading-relaxed">
                {selectedNode.fullText}
              </div>
            </div>
          )}

          <div className="text-sm space-y-2">
            {selectedNode.fullData && (
              <div className="max-h-[calc(70vh-200px)] overflow-auto">
                {renderNodeDetails(selectedNode.type, selectedNode.fullData, bridgeLexicon)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-card/95 backdrop-blur-sm rounded-lg shadow-lg p-3 text-[10px] border border-border/50">
        <div className="font-bold mb-2 text-xs">Node Types</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-blue-500"></div>
            <span>Q₀ Master</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-purple-500"></div>
            <span>Goals</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-amber-500"></div>
            <span>SPVs</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-emerald-500"></div>
            <span>RAs</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-cyan-500"></div>
            <span>Domains</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-red-500"></div>
            <span>L3 Questions</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-orange-500"></div>
            <span>Hypotheses</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-teal-500"></div>
            <span>L6 Tasks</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Helper function to map node types to layer IDs
// Cluster nodes use the same type as their children (e.g., 'l3' for L3 clusters)
const getLayerIdFromNodeType = (nodeType: string): string => {
  switch (nodeType) {
    case 'q0':
    case 'master':
      return 'q0';
    case 'goal':
      return 'goals';
    case 'spv':
      return 'spvs';
    case 'ra':
      return 'ras';
    case 'domain':
    case 'scientific':
      return 'domains';
    case 'l3':
    case 'l3_cluster':
    case 'l3_group':
      return 'l3';
    case 'ih':
    case 'ih_cluster':
    case 'ih_group':
      return 'ih';
    case 'l4':
    case 'l4_cluster':
    case 'l4_group':
      return 'l4';
    case 'l5':
    case 'l5_cluster':
    case 'l5_group':
      return 'l5';
    case 'l6':
    case 'l6_cluster':
    case 'l6_group':
      return 'l6';
    case 'common_l6':
    case 'common_l6_fail':
      return 'l6';
    default:
      return 'other';
  }
};

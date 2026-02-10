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
import { NodeChat } from './NodeChat';
import { NodeDataEditor } from './NodeDataEditor';
import { NodeLLMImprover } from './NodeLLMImprover';
import { MessageSquare, Edit3, Sparkles, Minimize2, Maximize2, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

interface GraphVisualizationImprovedProps {
  steps: PipelineStep[];
  highlightedNodeId?: string | null;
  onNodeHighlight?: (nodeId: string | null, nodeType: string | null) => void;
  zenMode?: boolean;
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
  zenMode = false,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatNodes, setChatNodes] = useState<Array<{ id: string; type: string; label: string; fullData?: any }>>([]);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    new Set(['q0', 'goals', 'spvs', 'ras', 'domains', 'l3', 'ih', 'l4', 'l5', 'l6'])
  );
  const [layoutMode, setLayoutMode] = useState<'hierarchical' | 'force' | 'radial'>('hierarchical');
  const [clusterState, setClusterState] = useState<ClusterState>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [llmImproverOpen, setLlmImproverOpen] = useState(false);
  const [editingNodeInfo, setEditingNodeInfo] = useState<{ stepId: number; path: string[]; nodeId: string } | null>(null);
  const [contextSelectionMode, setContextSelectionMode] = useState(false);
  const [selectedContextNodes, setSelectedContextNodes] = useState<Array<{ id: string; type: string; label: string; data: any }>>([]);
  const [nodeDetailsMinimized, setNodeDetailsMinimized] = useState(false);
  const { fitView } = useReactFlow();
  const { updateNodeData } = useAppStore();
  
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
            onSelect: () => {
              setSelectedNode(node.data);
              if (onNodeHighlight) {
                onNodeHighlight(node.id, node.data.type);
              }
            },
          },
        };
      }
      return node;
    });
  }, [filteredGraph.nodes, onNodeHighlight]);

  useEffect(() => {
    setNodes(nodesWithCallbacks);
    setEdges(filteredGraph.edges);
  }, [nodesWithCallbacks, filteredGraph.edges, setNodes, setEdges]);

  // Fit view when layout changes
  useEffect(() => {
    setTimeout(() => fitView({ duration: 500, padding: 0.1 }), 100);
  }, [layoutMode, fitView]);

  // Handle ESC key to close/minimize panels
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Priority: close modals first, then minimize node details, then close node details
        if (llmImproverOpen) {
          setLlmImproverOpen(false);
          setContextSelectionMode(false);
        } else if (editorOpen) {
          setEditorOpen(false);
        } else if (chatOpen) {
          setChatOpen(false);
        } else if (selectedNode && !nodeDetailsMinimized) {
          setNodeDetailsMinimized(true);
        } else if (selectedNode && nodeDetailsMinimized) {
          setSelectedNode(null);
          setNodeDetailsMinimized(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [llmImproverOpen, editorOpen, chatOpen, selectedNode, nodeDetailsMinimized]);

  // Node click handler — Ctrl/Cmd+click to add to chat selection, or context selection mode
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const isMultiSelect = event.ctrlKey || event.metaKey;

      // Handle context selection mode for LLM improver
      if (contextSelectionMode) {
        const nodeInfo = {
          id: node.id,
          type: node.data.type,
          label: node.data.fullText || node.data.label || node.id,
          data: node.data.fullData,
        };

        setSelectedContextNodes(prev => {
          // Toggle: if already selected, remove it; otherwise add it
          const exists = prev.find(n => n.id === node.id);
          if (exists) {
            return prev.filter(n => n.id !== node.id);
          } else {
            return [...prev, nodeInfo];
          }
        });
        return; // Don't do normal selection in context mode
      }

      if (isMultiSelect || chatOpen) {
        // Add/remove from chat nodes
        setChatNodes(prev => {
          const exists = prev.find(n => n.id === node.id);
          if (exists) return prev.filter(n => n.id !== node.id);
          return [...prev, {
            id: node.id,
            type: node.data.type,
            label: node.data.fullText || node.data.label || node.id,
            fullData: node.data.fullData,
          }];
        });
        if (!chatOpen) setChatOpen(true);
      } else {
        setSelectedNode(node.data);
      }

      if (onNodeHighlight) {
        onNodeHighlight(node.id, node.data.type);
      }
    },
    [onNodeHighlight, chatOpen, contextSelectionMode]
  );

  // Pane click handler (deselect) — only deselect detail panel, not chat nodes
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    if (onNodeHighlight) {
      onNodeHighlight(null, null);
    }
  }, [onNodeHighlight]);

  // Extract Q0, goal, and lens from pipeline steps for chat context
  const q0Text = steps.find(s => s.id === 1)?.output?.text || steps.find(s => s.id === 1)?.input || '';
  const goalText = steps.find(s => s.id === 2)?.output?.goals?.[0]?.title || '';
  const lensText = steps.find(s => s.id === 2)?.output?.lens || '';

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

  // Find the path to a node in the step output based on node type and ID
  const findNodePath = (nodeType: string, nodeId: string, stepId: number): string[] | null => {
    const step = steps.find(s => s.id === stepId);
    if (!step || !step.output) return null;

    // Special handling for Q0 - it's usually just the output itself or has a simple structure
    if (nodeType === 'q0' || nodeType === 'master') {
      // Q0 output is typically { Q0: "text" } or just a string
      // For editing purposes, we treat the entire output as the node
      return [];
    }

    // Helper function to search recursively
    const searchInObject = (obj: any, currentPath: string[]): string[] | null => {
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          const item = obj[i];
          if (item && typeof item === 'object' && item.id === nodeId) {
            return [...currentPath, i.toString()];
          }
          const found = searchInObject(item, [...currentPath, i.toString()]);
          if (found) return found;
        }
      } else if (obj && typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          if (obj[key] && typeof obj[key] === 'object') {
            if (obj[key].id === nodeId) {
              return [...currentPath, key];
            }
            const found = searchInObject(obj[key], [...currentPath, key]);
            if (found) return found;
          }
        }
      }
      return null;
    };

    return searchInObject(step.output, []);
  };

  // Get step ID based on node type
  const getStepIdForNodeType = (nodeType: string): number => {
    switch (nodeType) {
      case 'q0':
      case 'master':
        return 1;
      case 'goal':
        return 2;
      case 'spv':
        return 2; // SPVs are in bridge_lexicon
      case 'ra':
        return 3;
      case 'domain':
      case 'scientific':
        return 4;
      case 'l3':
      case 'l3_cluster':
      case 'l3_group':
        return 6;
      case 'ih':
      case 'ih_cluster':
      case 'ih_group':
        return 7;
      case 'l4':
      case 'l4_cluster':
      case 'l4_group':
        return 8;
      case 'l5':
      case 'l5_cluster':
      case 'l5_group':
        return 9;
      case 'l6':
      case 'l6_cluster':
      case 'l6_group':
      case 'common_l6':
      case 'common_l6_fail':
        return 9;
      default:
        return 0;
    }
  };

  // Handle opening the node editor
  const handleEditNode = () => {
    if (!selectedNode || !selectedNode.fullData) {
      console.warn('No node data to edit');
      return;
    }

    const nodeType = selectedNode.type;
    const stepId = getStepIdForNodeType(nodeType);

    if (stepId === 0) {
      console.warn('Cannot determine step for node type:', nodeType);
      return;
    }

    // Special handling for Q0 which doesn't have an ID
    let nodeId = selectedNode.fullData.id || 'q0';
    let path: string[] | null;

    if (nodeType === 'q0' || nodeType === 'master') {
      path = []; // Empty path means the entire output
    } else {
      nodeId = selectedNode.fullData.id;
      if (!nodeId) {
        console.warn('Node has no ID');
        return;
      }
      path = findNodePath(nodeType, nodeId, stepId);
    }

    if (path === null) {
      console.warn('Cannot find path to node:', nodeId);
      return;
    }

    setEditingNodeInfo({ stepId, path, nodeId });
    setEditorOpen(true);
  };

  // Handle saving edited node data
  const handleSaveNodeData = (updatedData: any) => {
    if (!editingNodeInfo) return;

    const { stepId, path } = editingNodeInfo;
    updateNodeData(stepId, path, updatedData);

    console.log('[Graph] Node data saved:', { stepId, path, updatedData });

    // Update the selected node to reflect changes
    if (selectedNode) {
      setSelectedNode({
        ...selectedNode,
        fullData: { ...selectedNode.fullData, ...updatedData },
      });
    }
  };

  // Handle opening the LLM improver
  const handleImproveWithLLM = () => {
    if (!selectedNode || !selectedNode.fullData) {
      console.warn('No node data to improve');
      return;
    }

    const nodeType = selectedNode.type;
    const stepId = getStepIdForNodeType(nodeType);

    if (stepId === 0) {
      console.warn('Cannot determine step for node type:', nodeType);
      return;
    }

    // Special handling for Q0 which doesn't have an ID
    let nodeId = selectedNode.fullData.id || 'q0';
    let path: string[] | null;

    if (nodeType === 'q0' || nodeType === 'master') {
      path = []; // Empty path means the entire output
    } else {
      nodeId = selectedNode.fullData.id;
      if (!nodeId) {
        console.warn('Node has no ID');
        return;
      }
      path = findNodePath(nodeType, nodeId, stepId);
    }

    if (path === null) {
      console.warn('Cannot find path to node:', nodeId);
      return;
    }

    setEditingNodeInfo({ stepId, path, nodeId });
    setLlmImproverOpen(true);
  };

  // Handle accepting LLM-improved data
  const handleAcceptImprovedData = (improvedData: any) => {
    if (!editingNodeInfo) return;

    const { stepId, path } = editingNodeInfo;

    // Validate that critical fields are not changed
    const originalData = selectedNode?.fullData;
    if (originalData) {
      const criticalFields = ['id', 'type', 'parent_node_id', 'parent_goal_id', 'l4_reference_id'];
      for (const field of criticalFields) {
        if (originalData[field] !== undefined && improvedData[field] !== originalData[field]) {
          console.warn(`[LLM Improver] Critical field "${field}" was changed. Restoring original value.`);
          improvedData[field] = originalData[field];
        }
      }
    }

    updateNodeData(stepId, path, improvedData);

    console.log('[Graph] LLM-improved data accepted:', { stepId, path, improvedData });

    // Update the selected node to reflect changes
    if (selectedNode) {
      setSelectedNode({
        ...selectedNode,
        fullData: { ...selectedNode.fullData, ...improvedData },
      });
    }
  };

  // Handle adding context nodes for LLM improver
  const handleAddContextNodes = () => {
    setContextSelectionMode(true);
  };

  // Handle finishing context selection
  const handleFinishContextSelection = () => {
    setContextSelectionMode(false);
  };

  // Handle removing a context node
  const handleRemoveContextNode = (nodeId: string) => {
    setSelectedContextNodes(prev => prev.filter(n => n.id !== nodeId));
  };

  // Handle clearing all context nodes
  const handleClearContextNodes = () => {
    setSelectedContextNodes([]);
  };

  // Handle closing LLM improver
  const handleCloseLLMImprover = () => {
    setLlmImproverOpen(false);
    setContextSelectionMode(false);
    setSelectedContextNodes([]);
  };

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

        {/* Graph Controls - Hidden in Zen Mode */}
        {!zenMode && (
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
        )}

        {/* Stats Panel - Hidden in Zen Mode */}
        {!zenMode && (
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
        )}
      </ReactFlow>

      {/* Node Details Panel - Collapsible */}
      {selectedNode && (
        <div
          className={`absolute top-4 right-4 bg-card/95 backdrop-blur-sm rounded-lg shadow-xl border border-border/50 z-20 transition-all duration-300 ${
            nodeDetailsMinimized
              ? 'w-[300px]'
              : 'max-w-lg max-h-[70vh] overflow-auto'
          }`}
        >
          {/* Header Bar */}
          <div className="flex justify-between items-center p-3 border-b border-border/30 sticky top-0 bg-card/95 backdrop-blur-sm z-10">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${NODE_COLORS[selectedNode.type as keyof typeof NODE_COLORS]?.bg || 'bg-secondary'} ${NODE_COLORS[selectedNode.type as keyof typeof NODE_COLORS]?.text || 'text-foreground'} border ${NODE_COLORS[selectedNode.type as keyof typeof NODE_COLORS]?.border || 'border-border'}`}>
                {selectedNode.type}
              </span>
              <h3 className="font-bold text-sm leading-tight truncate">
                <span className={NODE_COLORS[selectedNode.type as keyof typeof NODE_COLORS]?.text || 'text-foreground'}>
                  {selectedNode.label || selectedNode.title}
                </span>
              </h3>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => setNodeDetailsMinimized(!nodeDetailsMinimized)}
                className="p-1.5 rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
                title={nodeDetailsMinimized ? "Expand panel (or press ESC to toggle)" : "Minimize panel (or press ESC)"}
              >
                {nodeDetailsMinimized ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
              </button>
              <button
                onClick={() => {
                  setSelectedNode(null);
                  setNodeDetailsMinimized(false);
                  if (onNodeHighlight) {
                    onNodeHighlight(null, null);
                  }
                }}
                className="p-1.5 rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
                title="Close panel (ESC)"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Content - Hidden when minimized */}
          {!nodeDetailsMinimized && (
            <div className="p-4">
              {/* Action Buttons */}
              {selectedNode.fullData && (
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={handleImproveWithLLM}
                    className="group relative flex-1 px-2.5 py-1.5 rounded-md bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/40 text-purple-400 hover:from-purple-500/20 hover:to-blue-500/20 hover:border-purple-400 hover:shadow-[0_0_15px_rgba(139,92,246,0.4)] transition-all duration-200 flex items-center justify-center gap-1.5"
                    title="Improve with LLM"
                  >
                    <Sparkles size={12} className="group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-semibold">AI Improve</span>
                  </button>
                  <button
                    onClick={handleEditNode}
                    className="group relative flex-1 px-2.5 py-1.5 rounded-md bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/40 text-amber-400 hover:from-amber-500/20 hover:to-orange-500/20 hover:border-amber-400 hover:shadow-[0_0_15px_rgba(251,191,36,0.3)] transition-all duration-200 flex items-center justify-center gap-1.5"
                    title="Edit node data"
                  >
                    <Edit3 size={12} className="group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-semibold">Edit</span>
                  </button>
                </div>
              )}

              {/* Show full text if different from label */}
              {selectedNode.fullText && selectedNode.fullText !== selectedNode.label && (
                <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <div className="text-xs font-semibold text-blue-400 mb-1">FULL TEXT:</div>
                  <div className="text-sm text-foreground leading-relaxed">
                    {selectedNode.fullText}
                  </div>
                </div>
              )}

              {/* Node Details */}
              <div className="text-sm space-y-2">
                {selectedNode.fullData && (
                  <div className="max-h-[calc(70vh-280px)] overflow-auto">
                    {renderNodeDetails(selectedNode.type, selectedNode.fullData, bridgeLexicon)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chat Toggle Button - Positioned to avoid MiniMap */}
      <button
        onClick={() => setChatOpen(!chatOpen)}
        className={`
          absolute bottom-4 right-[200px] z-20 flex items-center gap-2 px-4 py-2.5 rounded-xl
          font-semibold text-sm shadow-lg transition-all duration-200
          ${chatOpen
            ? 'bg-primary/30 border-primary/60 text-primary hover:bg-primary/40'
            : 'bg-card/95 border-border/50 text-foreground hover:bg-card hover:border-primary/40'
          }
          border backdrop-blur-sm hover:scale-105
        `}
        title="Chat with multiple nodes using AI"
      >
        <MessageSquare className="w-4 h-4" />
        <span>Node Chat</span>
        {chatNodes.length > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary/30 text-primary text-[10px] font-bold">
            {chatNodes.length}
          </span>
        )}
      </button>

      {/* Node Chat Panel */}
      <NodeChat
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        selectedNodes={chatNodes}
        onRemoveNode={(nodeId) => setChatNodes(prev => prev.filter(n => n.id !== nodeId))}
        onClearNodes={() => setChatNodes([])}
        q0={q0Text}
        goal={goalText}
        lens={lensText}
      />

      {/* Node Data Editor */}
      {selectedNode && selectedNode.fullData && (
        <NodeDataEditor
          isOpen={editorOpen}
          onClose={() => setEditorOpen(false)}
          nodeData={selectedNode.fullData}
          nodeLabel={selectedNode.label || selectedNode.title || 'Node'}
          onSave={handleSaveNodeData}
        />
      )}

      {/* Node LLM Improver */}
      {selectedNode && selectedNode.fullData && (
        <NodeLLMImprover
          isOpen={llmImproverOpen}
          onClose={handleCloseLLMImprover}
          nodeData={selectedNode.fullData}
          nodeType={selectedNode.type}
          nodeLabel={selectedNode.label || selectedNode.title || 'Node'}
          q0={q0Text}
          goal={goalText}
          lens={lensText}
          onAccept={handleAcceptImprovedData}
          contextNodes={selectedContextNodes}
          onAddContextNodes={handleAddContextNodes}
          onRemoveContextNode={handleRemoveContextNode}
          onClearContextNodes={handleClearContextNodes}
          contextSelectionMode={contextSelectionMode}
        />
      )}

      {/* Context Selection Mode Banner */}
      {contextSelectionMode && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-30 bg-purple-500 text-white px-6 py-3 rounded-lg shadow-2xl border-2 border-purple-300 flex items-center gap-4 animate-pulse">
          <Sparkles className="w-5 h-5" />
          <div>
            <div className="font-bold text-sm">Context Selection Mode</div>
            <div className="text-xs">Click nodes in the graph to add them as context</div>
          </div>
          <button
            onClick={handleFinishContextSelection}
            className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded text-xs font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      )}
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

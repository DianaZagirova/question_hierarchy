import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import ReactFlow, {
  Node,
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
import { StandardNode, ClusterNode, CompactNode, MasterNode, LayerLabelNode, NODE_COLORS } from './graph/CustomNodes';
import { buildGraphFromSteps, ClusterState } from './graph/graphBuilder';
import { getHierarchicalLayout, getRadialLayout, getForceLayout } from './graph/layoutUtils';
import { renderNodeDetails } from './StepOutputViewer';
import { NodeChat } from './NodeChat';
import { NodeDataEditor } from './NodeDataEditor';
import { NodeLLMImprover } from './NodeLLMImprover';
import { Edit3, Sparkles, Minimize2, Maximize2, X, MessageSquare, GitBranch, Users } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useSessionStore } from '@/store/useSessionStore';
import { NodeFeedbackForm } from './NodeFeedbackForm';
import { getSessionFeedback } from '@/lib/api';
import { buildGraphSummaryForChat, buildL6AnalysisSummary, getNodeDescendants, getNodesByType, SelectedNodeData } from '@/lib/chatContextBuilder';

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
  layerLabel: LayerLabelNode,
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
  const [focusedGoalId, setFocusedGoalId] = useState<string | null>(null);
  const [compactMode, setCompactMode] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackNodeIds, setFeedbackNodeIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string; nodeType: string; nodeLabel: string; nodeData?: any } | null>(null);
  const { fitView } = useReactFlow();
  const { updateNodeData, highlightedL6Ids, setHighlightedL6Ids, focusedNodeId, setFocusedNodeId, l6AnalysisResult } = useAppStore();
  const prevHighlightCountRef = useRef(highlightedL6Ids.length);
  const { activeSessionId } = useSessionStore();

  // Load feedback node IDs for the active session
  useEffect(() => {
    if (!activeSessionId) return;
    getSessionFeedback(activeSessionId).then(entries => {
      setFeedbackNodeIds(new Set(entries.map(e => e.nodeId)));
    }).catch(() => {});
  }, [activeSessionId]);

  // Extract bridge lexicon from Step 2 for node detail lookups
  const step2 = steps.find(s => s.id === 2);
  const bridgeLexicon = step2?.output?.bridge_lexicon || step2?.output?.Bridge_Lexicon || step2?.output?.bridgeLexicon || {};

  // Build a lookup context so renderNodeDetails can resolve IDs → text
  const pipelineLookup = useMemo(() => {
    const goals: Record<string, string> = {};
    const ras: Record<string, string> = {};
    const l3s: Record<string, string> = {};
    const ihs: Record<string, string> = {};
    const l4s: Record<string, string> = {};
    const l5s: Record<string, string> = {};

    // Goals from step 2
    const s2goals = step2?.output?.goals || [];
    for (const g of s2goals) goals[g.id] = g.title || g.name || g.id;

    // RAs from step 3
    const s3 = steps.find(s => s.id === 3);
    if (s3?.output) {
      for (const arr of Object.values(s3.output)) {
        if (Array.isArray(arr)) {
          for (const ra of arr) if (ra.id) ras[ra.id] = ra.requirement_statement || ra.title || ra.id;
        }
      }
    }

    // L3s from step 6
    const s6 = steps.find(s => s.id === 6);
    const l3arr = s6?.output?.l3_questions || s6?.output?.seed_questions || [];
    if (Array.isArray(l3arr)) {
      for (const q of l3arr) if (q.id) l3s[q.id] = q.text || q.title || q.id;
    }

    // IHs from step 7
    const s7 = steps.find(s => s.id === 7);
    const iharr = s7?.output?.instantiation_hypotheses || [];
    if (Array.isArray(iharr)) {
      for (const ih of iharr) if (ih.id) ihs[ih.id] = ih.process_hypothesis || ih.title || ih.id;
    }

    // L4s from step 8
    const s8 = steps.find(s => s.id === 8);
    const l4arr = s8?.output?.l4_questions || [];
    if (Array.isArray(l4arr)) {
      for (const q of l4arr) if (q.id) l4s[q.id] = q.text || q.title || q.id;
    }

    // L5s from step 9
    const s9 = steps.find(s => s.id === 9);
    const l5arr = s9?.output?.l5_nodes || [];
    if (Array.isArray(l5arr)) {
      for (const n of l5arr) if (n.id) l5s[n.id] = n.text || n.title || n.id;
    }

    return { goals, ras, l3s, ihs, l4s, l5s };
  }, [steps, step2]);
  
  // Extract available goals for focus mode
  const availableGoals = useMemo(() => {
    const goals = step2?.output?.goals || [];
    return goals.map((g: any) => ({ id: g.id, title: g.title || g.name || g.id }));
  }, [step2]);

  // Compute TRUE total node count from step outputs (includes collapsed children)
  const totalNodeCount = useMemo(() => {
    let count = 0;
    const s1 = steps.find(s => s.id === 1);
    if (s1?.output) count += 1; // Q0
    const s2 = steps.find(s => s.id === 2);
    const goals = s2?.output?.goals || [];
    count += goals.length;
    const bl = s2?.output?.bridge_lexicon || {};
    const spvs = bl.system_properties || bl.System_Properties || [];
    count += spvs.length;
    const s3 = steps.find(s => s.id === 3);
    if (s3?.output) {
      const ras = Object.values(s3.output).flat();
      count += ras.length;
    }
    const s4 = steps.find(s => s.id === 4);
    if (s4?.output) {
      for (const goalData of Object.values(s4.output)) {
        const domains = Array.isArray(goalData) ? goalData : (goalData as any)?.domains || [];
        count += domains.length;
        for (const d of domains) {
          const pillars = (d as any)?.scientific_pillars || (d as any)?.pillars || [];
          count += pillars.length;
        }
      }
    }
    const s6 = steps.find(s => s.id === 6);
    const l3s = s6?.output?.l3_questions || s6?.output?.seed_questions || [];
    count += l3s.length;
    const s7 = steps.find(s => s.id === 7);
    const ihs = s7?.output?.instantiation_hypotheses || [];
    count += ihs.length;
    const s8 = steps.find(s => s.id === 8);
    const l4s = s8?.output?.l4_questions || [];
    count += l4s.length;
    const s9 = steps.find(s => s.id === 9);
    const l5s = s9?.output?.l5_nodes || [];
    const l6s = s9?.output?.l6_tasks || [];
    count += l5s.length + l6s.length;
    return count;
  }, [steps]);

  // Layer depth label mapping (type → display label + color + description)
  const LAYER_LABEL_MAP: Record<string, { label: string; color: string; description: string }> = useMemo(() => ({
    q0: { label: 'Master Question', color: '#3b82f6', description: 'Step 1 — The formalized root question (Q₀) that drives the entire pipeline. Solution-neutral, system-explicit, and time-bounded.' },
    goal: { label: 'Goal Pillars', color: '#8b5cf6', description: 'Step 2 — MECE decomposition of Q₀ into required end-states via Inverse Failure Analysis. Each pillar targets a functional requirement or failure mode.' },
    spv: { label: 'System Properties', color: '#f59e0b', description: 'Step 2 — Bridge Lexicon variables (SPVs) — the shared measurement language used across all downstream steps.' },
    ra: { label: 'Requirement Atoms', color: '#10b981', description: 'Step 3 — Solution-agnostic, testable atomic requirements. Each binds a state variable to a perturbation class, timescale, and meter class.' },
    domain: { label: 'Research Domains', color: '#06b6d4', description: 'Step 4a — 8-12 MECE research domains per goal, each scoped to ~25 actionable interventions. Includes non-obvious adjacent fields.' },
    scientific: { label: 'Scientific Pillars', color: '#06b6d4', description: 'Step 4b — 15-25 established, evidence-based mechanisms per domain from PubMed, Semantic Scholar, and OpenAlex. Pushes beyond textbook knowledge.' },
    l3: { label: 'Frontier Questions', color: '#ef4444', description: 'Step 6 — Seed questions targeting the strategic gap between Goals and Scientific Reality. Unanswerable by literature search alone.' },
    ih: { label: 'Hypotheses', color: '#f97316', description: 'Step 7 — Competing Instantiation Hypotheses across diverse domain categories. Includes heretical and cross-domain transfer hypotheses.' },
    l4: { label: 'Tactical Questions', color: '#84cc16', description: 'Step 8 — Discriminator questions that pit hypotheses against each other. ≥50% must be elimination-focused, not descriptive.' },
    l5: { label: 'Sub-problems', color: '#22c55e', description: 'Step 9 — Mechanistic sub-questions decomposing each L4 into testable parts: tool requirements, model requirements, mechanism drills.' },
    l6: { label: 'Experiments', color: '#14b8a6', description: 'Step 9 — Concrete experimental protocols with S-I-M-T parameters: System, Intervention, Meter, Threshold/Time. The leaf nodes of the pipeline.' },
    common_l6: { label: 'Unified Experiments', color: '#eab308', description: 'Step 10 — Synthesized experiments combining multiple L6 tasks from the same L4 branch into a single, more powerful experiment.' },
    common_l6_fail: { label: 'No Merge Possible', color: '#ef4444', description: 'Step 10 — L4 branches where unifying all L6 tasks into a single experiment was not feasible. Includes justification and recommended groupings.' },
  }), []);

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

  // Filter nodes and edges based on visible layers, search, and focus mode
  const filteredGraph = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();

    // Filter nodes
    let filteredNodes = layoutedGraph.nodes.filter((node) => {
      // Layer filter
      const nodeType = node.data.type;
      const layerId = getLayerIdFromNodeType(nodeType);
      if (!visibleLayers.has(layerId)) return false;

      // Focus mode filter - only show nodes related to focused goal
      if (focusedGoalId) {
        const nodeData = node.data.fullData || node.data;
        const parentGoalId = nodeData.parent_goal_id || nodeData.goal_id;
        const isGoalNode = nodeType === 'goal' && nodeData.id === focusedGoalId;
        const isQ0 = nodeType === 'q0' || nodeType === 'master';
        const isRelatedToGoal = parentGoalId === focusedGoalId;
        
        if (!isGoalNode && !isQ0 && !isRelatedToGoal) {
          return false;
        }
      }

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
  }, [layoutedGraph, visibleLayers, searchTerm, focusedGoalId]);

  // Build ancestor set: for highlighted L6 nodes, trace back through edges to find all parent nodes
  const highlightedAncestorIds = useMemo(() => {
    if (highlightedL6Ids.length === 0) return new Set<string>();

    const hlSet = new Set(highlightedL6Ids);
    const hlPrefixed = new Set(highlightedL6Ids.map(id => `l6-${id}`));

    // Find graph node IDs for the highlighted L6s
    const highlightedGraphIds = new Set<string>();
    for (const node of filteredGraph.nodes) {
      const rawId = node.data.fullData?.id || '';
      if ((node.data.type === 'l6' || node.data.type === 'common_l6') &&
        (hlSet.has(rawId) || hlSet.has(node.id) || hlPrefixed.has(node.id))) {
        highlightedGraphIds.add(node.id);
      }
    }

    // Build reverse edge map (target → sources) for ancestor traversal
    const parentMap: Record<string, string[]> = {};
    for (const edge of filteredGraph.edges) {
      if (!parentMap[edge.target]) parentMap[edge.target] = [];
      parentMap[edge.target].push(edge.source);
    }

    // BFS up the tree from each highlighted L6
    const ancestors = new Set<string>();
    const queue = [...highlightedGraphIds];
    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const parents = parentMap[nodeId] || [];
      for (const parentId of parents) {
        if (!ancestors.has(parentId) && !highlightedGraphIds.has(parentId)) {
          ancestors.add(parentId);
          queue.push(parentId);
        }
      }
    }
    return ancestors;
  }, [highlightedL6Ids, filteredGraph.nodes, filteredGraph.edges]);

  // Add cluster toggle callbacks to cluster nodes and apply L6 highlighting
  const nodesWithCallbacks = useMemo(() => {
    const hlSet = new Set(highlightedL6Ids);
    const hlPrefixed = new Set(highlightedL6Ids.map(id => `l6-${id}`));
    const hasActiveHighlights = hlSet.size > 0;

    return filteredGraph.nodes.map(node => {
      // Check if this is a highlighted L6 node (match raw ID, prefixed ID, or fullData.id)
      const nodeRawId = node.data.fullData?.id || '';
      const isHighlightedL6 = hasActiveHighlights &&
        (node.data.type === 'l6' || node.data.type === 'common_l6') &&
        (hlSet.has(nodeRawId) || hlSet.has(node.id) || hlPrefixed.has(node.id));

      // Check if this is an ancestor of a highlighted L6
      const isAncestorHighlight = highlightedAncestorIds.has(node.id);
      const isDimmed = hasActiveHighlights && !isHighlightedL6 && !isAncestorHighlight;

      // Check if this node has feedback
      const feedbackId = node.data.type === 'q0' ? 'q0' : (node.data.fullData?.id || '');
      const hasFeedback = feedbackNodeIds.has(feedbackId);

      // Apply highlighting styles
      const nodeWithHighlight = {
        ...node,
        data: {
          ...node.data,
          isHighlighted: isHighlightedL6 || isAncestorHighlight,
          hasFeedback,
        },
        style: {
          ...node.style,
          ...(isHighlightedL6 ? {
            outline: '3px solid rgb(168, 85, 247)',
            outlineOffset: '2px',
            border: '3px solid rgb(168, 85, 247)',
            zIndex: 1000,
          } : isAncestorHighlight ? {
            outline: '2px solid rgba(168, 85, 247, 0.5)',
            outlineOffset: '1px',
            border: '2px solid rgba(168, 85, 247, 0.5)',
            zIndex: 500,
          } : isDimmed ? {
            opacity: 0.25,
          } : {}),
        },
      };

      if (node.type === 'cluster') {
        return {
          ...nodeWithHighlight,
          data: {
            ...nodeWithHighlight.data,
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
      return nodeWithHighlight;
    });
  }, [filteredGraph.nodes, onNodeHighlight, highlightedL6Ids, highlightedAncestorIds, feedbackNodeIds]);

  // Compute in-graph layer labels: use filteredGraph (stable positions, not affected by highlight changes)
  const layerLabels = useMemo(() => {
    const tierMap: Record<string, { ys: number[]; xs: number[] }> = {};
    for (const node of filteredGraph.nodes) {
      const t = node.data?.type;
      if (!t || node.position?.y == null || node.position?.x == null) continue;
      const key = t === 'domain_group' ? 'domain' : t;
      if (!tierMap[key]) tierMap[key] = { ys: [], xs: [] };
      tierMap[key].ys.push(node.position.y);
      tierMap[key].xs.push(node.position.x);
    }

    let globalMinX = Infinity;
    for (const { xs } of Object.values(tierMap)) {
      for (const x of xs) {
        if (x < globalMinX) globalMinX = x;
      }
    }

    const tiers: Array<{ type: string; label: string; color: string; description: string; y: number }> = [];
    for (const [type, { ys }] of Object.entries(tierMap)) {
      const meta = LAYER_LABEL_MAP[type];
      if (!meta) continue;
      const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
      tiers.push({ type, ...meta, y: avgY });
    }
    tiers.sort((a, b) => a.y - b.y);

    const groups: Array<{ tiers: typeof tiers; y: number }> = [];
    for (const tier of tiers) {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && Math.abs(tier.y - lastGroup.y) < 120) {
        lastGroup.tiers.push(tier);
        lastGroup.y = lastGroup.tiers.reduce((s, t) => s + t.y, 0) / lastGroup.tiers.length;
      } else {
        groups.push({ tiers: [tier], y: tier.y });
      }
    }
    return { groups, x: globalMinX - 180 };
  }, [filteredGraph.nodes, LAYER_LABEL_MAP]);

  // Apply edge dimming when highlights are active
  const edgesWithHighlight = useMemo(() => {
    if (highlightedL6Ids.length === 0) return filteredGraph.edges;

    const hlSet = new Set(highlightedL6Ids);
    const hlPrefixed = new Set(highlightedL6Ids.map(id => `l6-${id}`));

    // Collect all highlighted node graph IDs (L6 nodes + ancestors)
    const highlightedNodeIds = new Set<string>(highlightedAncestorIds);
    for (const node of filteredGraph.nodes) {
      const rawId = node.data.fullData?.id || '';
      if ((node.data.type === 'l6' || node.data.type === 'common_l6') &&
        (hlSet.has(rawId) || hlSet.has(node.id) || hlPrefixed.has(node.id))) {
        highlightedNodeIds.add(node.id);
      }
    }

    return filteredGraph.edges.map(edge => {
      const isHighlightedEdge = highlightedNodeIds.has(edge.source) && highlightedNodeIds.has(edge.target);
      return {
        ...edge,
        style: {
          ...edge.style,
          opacity: isHighlightedEdge ? 1 : 0.1,
          strokeWidth: isHighlightedEdge ? 2.5 : (edge.style as any)?.strokeWidth || 1,
        },
        animated: isHighlightedEdge || undefined,
      };
    });
  }, [filteredGraph.edges, filteredGraph.nodes, highlightedL6Ids, highlightedAncestorIds]);

  // Build annotation nodes for layer labels (positioned in graph space)
  const annotationNodes = useMemo(() => {
    if (zenMode || layerLabels.groups.length === 0) return [];
    return layerLabels.groups.map((group, i): Node => ({
      id: `__layer-label-${i}`,
      type: 'layerLabel',
      position: { x: layerLabels.x, y: group.y },
      data: { tiers: group.tiers },
      selectable: false,
      draggable: false,
      connectable: false,
      style: { pointerEvents: 'auto' as const },
    }));
  }, [layerLabels, zenMode]);

  useEffect(() => {
    setNodes([...nodesWithCallbacks, ...annotationNodes]);
    setEdges(edgesWithHighlight);
  }, [nodesWithCallbacks, annotationNodes, edgesWithHighlight, setNodes, setEdges]);

  // Fit view when layout changes
  useEffect(() => {
    setTimeout(() => fitView({ duration: 500, padding: 0.1 }), 100);
  }, [layoutMode, fitView]);

  // Auto-expand all layers when L6 highlights are active (so ancestor branches are visible)
  useEffect(() => {
    if (highlightedL6Ids.length > 0) {
      setVisibleLayers(new Set(['q0', 'goals', 'spvs', 'ras', 'domains', 'l3', 'ih', 'l4', 'l5', 'l6', 'common_l6']));
    }
  }, [highlightedL6Ids]);

  // Reset view when L6 highlights are cleared (transition from highlighted → none)
  useEffect(() => {
    const prev = prevHighlightCountRef.current;
    prevHighlightCountRef.current = highlightedL6Ids.length;
    if (prev > 0 && highlightedL6Ids.length === 0) {
      setTimeout(() => fitView({ duration: 600, padding: 0.1 }), 150);
    }
  }, [highlightedL6Ids, fitView]);

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
      // Ignore clicks on annotation label nodes
      if (node.id.startsWith('__layer-label-')) return;

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
        setFeedbackOpen(false);
      }

      if (onNodeHighlight) {
        onNodeHighlight(node.id, node.data.type);
      }
    },
    [onNodeHighlight, chatOpen, contextSelectionMode]
  );

  // Double-click on highlighted L6 node: clear all highlights and reset view
  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (highlightedL6Ids.length > 0 && (node.data.type === 'l6' || node.data.type === 'common_l6')) {
        // Use isHighlighted flag already computed by nodesWithCallbacks
        if (node.data.isHighlighted) {
          setHighlightedL6Ids([]);
          return;
        }
      }
    },
    [highlightedL6Ids.length, setHighlightedL6Ids]
  );

  // Pane click handler (deselect) — only deselect detail panel, not chat nodes
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setFeedbackOpen(false);
    setContextMenu(null);
    if (onNodeHighlight) {
      onNodeHighlight(null, null);
    }
  }, [onNodeHighlight]);

  // Extract Q0, goals, and lens from pipeline steps for chat context
  const q0Text = steps.find(s => s.id === 1)?.output?.text || steps.find(s => s.id === 1)?.input || '';
  const allGoals = steps.find(s => s.id === 2)?.output?.goals || [];
  const goalText = allGoals.map((g: any, i: number) => `${i + 1}. [${g.id}] ${g.title || g.name || g.id}`).join('\n') || '';
  const lensText = steps.find(s => s.id === 2)?.output?.lens || '';

  // Build compressed pipeline context for chat
  const graphSummary = useMemo(
    () => buildGraphSummaryForChat(steps, highlightedL6Ids),
    [steps, highlightedL6Ids]
  );
  const l6AnalysisSummary = useMemo(
    () => buildL6AnalysisSummary(l6AnalysisResult),
    [l6AnalysisResult]
  );

  // Bulk-add nodes to chat
  const handleAddChatNodes = useCallback((newNodes: SelectedNodeData[]) => {
    setChatNodes(prev => {
      const existingIds = new Set(prev.map(n => n.id));
      return [...prev, ...newNodes.filter(n => !existingIds.has(n.id))];
    });
    if (!chatOpen) setChatOpen(true);
  }, [chatOpen]);

  // Right-click context menu on graph nodes
  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: node.id,
        nodeType: node.data.type,
        nodeLabel: node.data.fullText || node.data.label || node.id,
        nodeData: node.data.fullData,
      });
    },
    []
  );

  // Close context menu on pane/node click
  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

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

  // Reset to default view: collapse all, show all layers, clear search, hierarchical layout, fit all
  const handleResetView = useCallback(() => {
    // Skip the auto-reset effect by zeroing the ref before clearing highlights
    prevHighlightCountRef.current = 0;
    setClusterState({});
    setSearchTerm('');
    setVisibleLayers(new Set(['q0', 'goals', 'spvs', 'ras', 'domains', 'l3', 'ih', 'l4', 'l5', 'l6']));
    setLayoutMode('hierarchical');
    setSelectedNode(null);
    setFocusedGoalId(null);
    setCompactMode(false);
    setHighlightedL6Ids([]);
    setFeedbackOpen(false);
    if (onNodeHighlight) onNodeHighlight(null, null);
    // Delay fitView to let collapsed layout recompute, then fit the full graph
    setTimeout(() => fitView({ duration: 400, padding: 0.15 }), 300);
  }, [fitView, onNodeHighlight, setHighlightedL6Ids]);
  
  // Jump to Q0 node
  const handleJumpToQ0 = useCallback(() => {
    const q0Node = nodes.find(n => n.data.type === 'q0' || n.data.type === 'master');
    if (q0Node) {
      setSelectedNode(q0Node.data);
      if (onNodeHighlight) onNodeHighlight(q0Node.id, q0Node.data.type);
      // Center on Q0
      setTimeout(() => fitView({ duration: 500, padding: 0.2, nodes: [q0Node] }), 100);
    }
  }, [nodes, fitView, onNodeHighlight]);
  
  // Jump to Goals layer
  const handleJumpToGoals = useCallback(() => {
    const goalNodes = nodes.filter(n => n.data.type === 'goal');
    if (goalNodes.length > 0) {
      // Center on all goal nodes
      setTimeout(() => fitView({ duration: 500, padding: 0.15, nodes: goalNodes }), 100);
    }
  }, [nodes, fitView]);
  
  // Focus mode - isolate a single goal's path
  const handleFocusMode = useCallback((goalId: string | null) => {
    setFocusedGoalId(goalId);
    if (goalId) {
      // When focusing, collapse everything first for cleaner view
      setClusterState({});
      setTimeout(() => fitView({ duration: 500, padding: 0.1 }), 150);
    }
  }, [fitView]);
  
  // Smart expand - intelligently expand relevant branches
  const handleSmartExpand = useCallback(() => {
    // Strategy: Expand L3 and L4 clusters (strategic/tactical layers)
    // Keep L5/L6 collapsed (execution details)
    const newState: ClusterState = { ...clusterState };
    
    // Build current graph to discover clusters
    const data = buildGraphFromSteps(steps, clusterState);
    
    data.nodes.filter(n => n.type === 'cluster').forEach(n => {
      const nodeType = n.data.type;
      // Expand strategic layers (L3, L4, IH)
      if (['l3', 'l4', 'ih'].includes(nodeType)) {
        newState[n.id] = true;
      }
      // Keep execution layers collapsed (L5, L6)
      else if (['l5', 'l6'].includes(nodeType)) {
        newState[n.id] = false;
      }
      // Expand other important layers (goals, domains)
      else if (['goal', 'domain', 'domain_group'].includes(nodeType)) {
        newState[n.id] = true;
      }
    });
    
    setClusterState(newState);
  }, [steps, clusterState]);

  // Helper: Find an L6 task in step 9 output (handles both flat array and object-keyed formats)
  const findL6TaskInOutput = useCallback((l6Id: string) => {
    const step9Data = steps.find((s: any) => s.id === 9);
    if (!step9Data?.output) return null;
    const output = step9Data.output;

    // Check flat l6_tasks array
    if (Array.isArray(output.l6_tasks)) {
      const found = output.l6_tasks.find((t: any) => t.id === l6Id);
      if (found) return found;
    } else if (output.l6_tasks && typeof output.l6_tasks === 'object') {
      // Object keyed by L4 ID
      for (const key of Object.keys(output.l6_tasks)) {
        const tasks = output.l6_tasks[key];
        if (Array.isArray(tasks)) {
          const found = tasks.find((t: any) => t.id === l6Id);
          if (found) return found;
        }
      }
    }

    // Check batch_results format
    if (output.batch_results) {
      for (const result of output.batch_results) {
        if (result.data?.l6_tasks) {
          const found = result.data.l6_tasks.find((t: any) => t.id === l6Id);
          if (found) return found;
        }
      }
    }

    return null;
  }, [steps]);

  // Helper: Find the parent L3 ID for an L4 ID from step 8 output
  const findL4ParentL3 = useCallback((l4Id: string) => {
    const step8 = steps.find((s: any) => s.id === 8);
    if (!step8?.output) return null;
    const output = step8.output;

    // Check flat l4_questions array
    const l4Questions = output.l4_questions || [];
    if (Array.isArray(l4Questions)) {
      const found = l4Questions.find((q: any) => q.id === l4Id);
      if (found?.parent_l3_id) return found.parent_l3_id;
    } else if (typeof l4Questions === 'object') {
      for (const key of Object.keys(l4Questions)) {
        const qs = l4Questions[key];
        if (Array.isArray(qs)) {
          const found = qs.find((q: any) => q.id === l4Id);
          if (found?.parent_l3_id) return found.parent_l3_id;
        }
      }
    }

    // Check batch_results
    if (output.batch_results) {
      for (const result of output.batch_results) {
        const qs = result.data?.l4_questions || [];
        if (Array.isArray(qs)) {
          const found = qs.find((q: any) => q.id === l4Id);
          if (found?.parent_l3_id) return found.parent_l3_id;
        }
      }
    }
    return null;
  }, [steps]);

  // Helper: Find the parent goal ID for an L3 question from step 6 output
  const findL3ParentGoal = useCallback((l3Id: string) => {
    const step6 = steps.find((s: any) => s.id === 6);
    if (!step6?.output) return null;
    const output = step6.output;

    const l3Questions = output.l3_questions || output.questions || [];
    if (Array.isArray(l3Questions)) {
      const found = l3Questions.find((q: any) => q.id === l3Id);
      if (found?.goal_id || found?.target_goal_id || found?.parent_goal_id) {
        return found.goal_id || found.target_goal_id || found.parent_goal_id;
      }
    } else if (typeof l3Questions === 'object') {
      for (const key of Object.keys(l3Questions)) {
        const qs = l3Questions[key];
        if (Array.isArray(qs)) {
          const found = qs.find((q: any) => q.id === l3Id);
          if (found) return found.goal_id || found.target_goal_id || found.parent_goal_id || key;
        }
      }
    }

    // Check batch_results
    if (output.batch_results) {
      for (const result of output.batch_results) {
        const qs = result.data?.l3_questions || result.data?.questions || [];
        if (Array.isArray(qs)) {
          const found = qs.find((q: any) => q.id === l3Id);
          if (found) return found.goal_id || found.target_goal_id || found.parent_goal_id;
        }
      }
    }
    return null;
  }, [steps]);

  // Zoom to focused node (triggered by L6 analyzer or other components)
  useEffect(() => {
    if (focusedNodeId && nodes.length > 0) {
      const fId = focusedNodeId;
      // Try exact match, then prefixed match (graph nodes use "l6-{id}" format), then fullData match
      const targetNode = nodes.find(n => n.id === fId)
        || nodes.find(n => n.id === `l6-${fId}`)
        || nodes.find(n => n.data?.fullData?.id === fId);

      if (targetNode) {
        // Node is visible — select and zoom to it
        setSelectedNode(targetNode.data);
        setFeedbackOpen(false);

        setTimeout(() => {
          fitView({
            duration: 800,
            padding: 0.3,
            nodes: [{ id: targetNode.id }]
          });
        }, 150);

        // Clear the focused node after zooming (one-time action)
        setTimeout(() => setFocusedNodeId(null), 1200);
      } else {
        // Node not found — expand the full cluster chain: L3 → L4 → L5 → L6
        // First, find the L6 task data to know its parents
        const l6Task = findL6TaskInOutput(fId);
        const expansions: Record<string, boolean> = {};

        if (l6Task) {
          const parentL5Id = l6Task.parent_l5_id;
          const parentL4Id = l6Task.parent_l4_id;

          // Expand L6 cluster (keyed by parent L5 ID)
          if (parentL5Id) {
            expansions[`l6-cluster-${parentL5Id}`] = true;
          }

          // Expand L5 cluster (keyed by parent L4 ID)
          if (parentL4Id) {
            expansions[`l5-cluster-${parentL4Id}`] = true;

            // Expand L4 cluster (keyed by parent L3 ID)
            const parentL3Id = findL4ParentL3(parentL4Id);
            if (parentL3Id) {
              expansions[`l4-cluster-${parentL3Id}`] = true;

              // Expand L3 cluster (keyed by parent goal ID)
              const parentGoalId = findL3ParentGoal(parentL3Id);
              if (parentGoalId) {
                expansions[`l3-cluster-${parentGoalId}`] = true;
              }
            }
          }
        } else {
          // Fallback: search graph data for clusters containing this task
          const allGraphNodes = graphData.nodes;
          const parentCluster = allGraphNodes.find(n =>
            n.type === 'cluster' && n.id.startsWith('l6-cluster-') &&
            n.data?.fullData?.tasks?.some((t: any) => t.id === fId)
          );

          if (parentCluster) {
            expansions[parentCluster.id] = true;
            const parentL5Id = parentCluster.data?.fullData?.parentL5Id;
            if (parentL5Id) {
              // Walk up to find parent L4's L5 cluster
              const step9Data = steps.find((s: any) => s.id === 9);
              const l5Nodes = step9Data?.output?.l5_nodes || [];
              const l5Node = Array.isArray(l5Nodes) ? l5Nodes.find((n: any) => n.id === parentL5Id) : null;
              if (l5Node?.parent_l4_id) {
                expansions[`l5-cluster-${l5Node.parent_l4_id}`] = true;
                const parentL3Id = findL4ParentL3(l5Node.parent_l4_id);
                if (parentL3Id) {
                  expansions[`l4-cluster-${parentL3Id}`] = true;
                  const parentGoalId = findL3ParentGoal(parentL3Id);
                  if (parentGoalId) {
                    expansions[`l3-cluster-${parentGoalId}`] = true;
                  }
                }
              }
            }
          }
        }

        if (Object.keys(expansions).length > 0) {
          setClusterState(prev => ({ ...prev, ...expansions }));
          // Don't clear focusedNodeId — next render cycle will find the expanded node and zoom
          return;
        }

        // Nothing found at all — clear to prevent infinite loop
        setFocusedNodeId(null);
      }
    }
  }, [focusedNodeId, nodes, fitView, setFocusedNodeId, graphData.nodes, clusterState, steps, findL6TaskInOutput, findL4ParentL3, findL3ParentGoal]);

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
    <div className="h-full w-full relative bg-background" data-tour-graph>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
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
        {/* Controls component removed - default zoom controls hidden */}
        <MiniMap
          nodeColor={(node) => {
            if (node.id.startsWith('__layer-label-')) return 'transparent';
            const type = node.data?.type;
            return type === 'q0' ? '#3b82f6' :
                   type === 'goal' ? '#8b5cf6' :
                   type === 'ra' ? '#10b981' :
                   type === 'domain' ? '#06b6d4' :
                   type === 'l3' ? '#ef4444' :
                   type === 'l6' ? '#14b8a6' : '#6366f1';
          }}
          maskColor="rgba(0, 0, 0, 0.6)"
          style={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', width: 140, height: 90 }}
          className="backdrop-blur-sm"
        />

        {/* Graph Controls - Hidden in Zen Mode */}
        {!zenMode && (
          <Panel position="top-left">
            <div data-tour-graph-controls>
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
              chatOpen={chatOpen}
              onChatToggle={() => setChatOpen(!chatOpen)}
              chatNodeCount={chatNodes.length}
              onJumpToQ0={handleJumpToQ0}
              onJumpToGoals={handleJumpToGoals}
              onFocusMode={handleFocusMode}
              focusedGoalId={focusedGoalId}
              availableGoals={availableGoals}
              onSmartExpand={handleSmartExpand}
              compactMode={compactMode}
              onCompactModeToggle={() => setCompactMode(!compactMode)}
              totalNodeCount={totalNodeCount}
              visibleNodeCount={filteredGraph.nodes.length}
            />
            </div>
          </Panel>
        )}

        {/* Graph Stats Panel removed — stats shown in controls panel header */}

        {/* Pipeline Flow Legend — bottom center, compact with dots */}
        {!zenMode && (
          <Panel position="bottom-center">
            <div className="bg-card/80 backdrop-blur-sm rounded-full shadow-md px-3 py-1.5 border border-border/30 flex items-center gap-1 text-[9px] font-medium select-none">
              <span className="w-2 h-2 rounded-full bg-blue-400" title="Master Question" />
              <span className="text-muted-foreground/40 text-[8px]">›</span>
              <span className="w-2 h-2 rounded-full bg-purple-400" title="Goals" />
              <span className="text-muted-foreground/40 text-[8px]">›</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400" title="Requirements" />
              <span className="text-muted-foreground/40 text-[8px]">›</span>
              <span className="w-2 h-2 rounded-full bg-cyan-400" title="Domains + Science" />
              <span className="text-muted-foreground/40 text-[8px]">›</span>
              <span className="w-2 h-2 rounded-full bg-red-400" title="Questions" />
              <span className="text-muted-foreground/40 text-[8px]">›</span>
              <span className="w-2 h-2 rounded-full bg-orange-400" title="Hypotheses" />
              <span className="text-muted-foreground/40 text-[8px]">›</span>
              <span className="w-2 h-2 rounded-full bg-lime-400" title="Tactics" />
              <span className="text-muted-foreground/40 text-[8px]">›</span>
              <span className="w-2 h-2 rounded-full bg-teal-400" title="Experiments" />
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* Node Details Panel - Collapsible */}
      {selectedNode && (
        <div
          data-tour-node-panel
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
                    <span className="text-xs font-semibold">AI Improve</span>
                  </button>
                  <button
                    onClick={handleEditNode}
                    className="group relative flex-1 px-2.5 py-1.5 rounded-md bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/40 text-amber-400 hover:from-amber-500/20 hover:to-orange-500/20 hover:border-amber-400 hover:shadow-[0_0_15px_rgba(251,191,36,0.3)] transition-all duration-200 flex items-center justify-center gap-1.5"
                    title="Edit node data"
                  >
                    <Edit3 size={12} className="group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-semibold">Edit</span>
                  </button>
                  <button
                    onClick={() => setFeedbackOpen(!feedbackOpen)}
                    className={`group relative flex-1 px-2.5 py-1.5 rounded-md bg-gradient-to-r from-teal-500/10 to-cyan-500/10 border text-teal-400 transition-all duration-200 flex items-center justify-center gap-1.5 ${
                      feedbackOpen
                        ? 'border-teal-400 from-teal-500/20 to-cyan-500/20 shadow-[0_0_15px_rgba(20,184,166,0.3)]'
                        : 'border-teal-500/40 hover:from-teal-500/20 hover:to-cyan-500/20 hover:border-teal-400 hover:shadow-[0_0_15px_rgba(20,184,166,0.3)]'
                    }`}
                    title="Leave feedback"
                  >
                    <MessageSquare size={12} className="group-hover:scale-110 transition-transform" />
                    <span className="text-xs font-semibold">Feedback</span>
                  </button>
                </div>
              )}

              {/* Feedback Form */}
              {feedbackOpen && selectedNode && (
                <div className="mb-3">
                  <NodeFeedbackForm
                    nodeId={selectedNode.type === 'q0' ? 'q0' : (selectedNode.fullData?.id || selectedNode.label || 'unknown')}
                    nodeType={selectedNode.type}
                    nodeLabel={selectedNode.fullText || selectedNode.label || ''}
                    userSessionId={activeSessionId || ''}
                    onFeedbackChange={(nodeId, hasFeedback) => {
                      setFeedbackNodeIds(prev => {
                        const next = new Set(prev);
                        if (hasFeedback) next.add(nodeId);
                        else next.delete(nodeId);
                        return next;
                      });
                    }}
                  />
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
                    {renderNodeDetails(selectedNode.type, selectedNode.fullData, bridgeLexicon, pipelineLookup)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}


      {/* Node Chat Panel */}
      <NodeChat
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        selectedNodes={chatNodes}
        onRemoveNode={(nodeId) => setChatNodes(prev => prev.filter(n => n.id !== nodeId))}
        onClearNodes={() => setChatNodes([])}
        onAddNodes={handleAddChatNodes}
        q0={q0Text}
        goal={goalText}
        lens={lensText}
        graphSummary={graphSummary}
        l6AnalysisSummary={l6AnalysisSummary}
        steps={steps}
        highlightedL6Ids={highlightedL6Ids}
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

      {/* Right-click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-card border border-border rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.5)] py-1.5 min-w-[200px] animate-in fade-in zoom-in-95 duration-150"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={handleContextMenuClose}
        >
          <button
            className="w-full text-left px-3.5 py-2 text-xs text-foreground/90 hover:bg-muted/60 hover:text-foreground flex items-center gap-2.5 transition-colors"
            onClick={() => {
              handleAddChatNodes([{
                id: contextMenu.nodeId,
                type: contextMenu.nodeType,
                label: contextMenu.nodeLabel,
                fullData: contextMenu.nodeData,
              }]);
              setContextMenu(null);
            }}
          >
            <MessageSquare className="w-3.5 h-3.5 text-primary" />
            Add to Chat
          </button>
          {['goal', 'l3', 'ih', 'l4', 'l5'].includes(contextMenu.nodeType) && (
            <button
              className="w-full text-left px-3.5 py-2 text-xs text-foreground/90 hover:bg-muted/60 hover:text-foreground flex items-center gap-2.5 transition-colors"
              onClick={() => {
                const self: SelectedNodeData = {
                  id: contextMenu.nodeId,
                  type: contextMenu.nodeType,
                  label: contextMenu.nodeLabel,
                  fullData: contextMenu.nodeData,
                };
                const descendants = getNodeDescendants(contextMenu.nodeId, contextMenu.nodeType, steps);
                handleAddChatNodes([self, ...descendants]);
                setContextMenu(null);
              }}
            >
              <GitBranch className="w-3.5 h-3.5 text-purple-300" />
              Add Branch to Chat
            </button>
          )}
          <div className="mx-2 my-1 border-t border-border/30" />
          <button
            className="w-full text-left px-3.5 py-2 text-xs text-foreground/90 hover:bg-muted/60 hover:text-foreground flex items-center gap-2.5 transition-colors"
            onClick={() => {
              const siblings = getNodesByType(contextMenu.nodeType, steps);
              handleAddChatNodes(siblings);
              setContextMenu(null);
            }}
          >
            <Users className="w-3.5 h-3.5 text-cyan-300" />
            Add All {contextMenu.nodeType.toUpperCase()}s
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

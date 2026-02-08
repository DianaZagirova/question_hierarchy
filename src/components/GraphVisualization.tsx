import React, { useCallback, useEffect, useState, useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  MiniMap,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { PipelineStep } from '@/types';
import { renderNodeDetails } from './StepOutputViewer';
import { buildL3Hierarchy } from './graph/hierarchicalBuilder';
import { DEFAULT_LAYOUT_CONFIG } from './graph/hierarchicalLayout';

interface GraphVisualizationProps {
  steps: PipelineStep[];
  highlightedNodeId?: string | null;
  onNodeHighlight?: (nodeId: string | null, nodeType: string | null) => void;
}

// Color scheme for different node types
const NODE_COLORS = {
  q0: '#3b82f6',           // Blue - Goal
  goal: '#8b5cf6',         // Purple - Goal Pillars
  fcc: '#ec4899',          // Pink - Failure Channels
  spv: '#f59e0b',          // Amber - System Properties
  ra: '#10b981',           // Green - Requirement Atoms
  ra_group: '#10b981',     // Green - RA Group
  domain_group: '#06b6d4', // Cyan - Research Domains
  scientific: '#06b6d4',   // Cyan - Scientific Pillars
  s_group: '#06b6d4',      // Cyan - S Group
  edge: '#6366f1',         // Indigo - Matching Edges
  l3: '#ef4444',           // Red - L3 Questions
  l3_group: '#ef4444',     // Red - L3 Group
  ih: '#f97316',           // Orange - Instantiation Hypotheses
  ih_group: '#f97316',     // Orange - IH Group
  l4: '#84cc16',           // Lime - L4 Questions
  l4_group: '#84cc16',     // Lime - L4 Group
  l5: '#a3e635',           // Light Lime - L5 Mechanistic Drills
  l5_group: '#a3e635',     // Light Lime - L5 Group
  l6: '#14b8a6',           // Teal - L6 Tasks
  l6_group: '#14b8a6',     // Teal - L6 Group
};

export const GraphVisualization: React.FC<GraphVisualizationProps> = ({ steps, highlightedNodeId, onNodeHighlight }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [highlightedNodeIdState, setHighlightedNodeIdState] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Extract bridge lexicon from Step 2 for node detail lookups
  const step2 = steps.find(s => s.id === 2);
  const bridgeLexicon = step2?.output?.bridge_lexicon || step2?.output?.Bridge_Lexicon || step2?.output?.bridgeLexicon || {};

  // Helper: Check if a node or any of its ancestors are collapsed
  const isNodeOrAncestorCollapsed = (nodeId: string, allNodes: Node[]): boolean => {
    const node = allNodes.find(n => n.id === nodeId);
    if (!node) return false;

    // Check if this node's parent group is collapsed
    const parentGroup = node.data?.parentGroup;
    if (parentGroup && collapsedGroups.has(parentGroup)) {
      return true;
    }

    // Recursively check parent's ancestors
    if (parentGroup) {
      return isNodeOrAncestorCollapsed(parentGroup, allNodes);
    }

    return false;
  };

  // Helper: Calculate vertical position for child items in a grid (moved to hierarchicalLayout.ts)
  // Keeping this commented for reference
  /* const calculateChildPosition = (...) => { ... } */

  const buildGraph = useMemo(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    let yOffset = 0;

    // NEW LAYOUT: Vertical-first with smart spacing
    const verticalSpacing = {
      betweenLevels: 300,      // Space between major levels (Q0 -> Goals -> L3 -> IH/L4)
      withinLevel: 150,         // Space between items in same level
      groupToChildren: 200,     // Space from group node to its children
      childRows: 120            // Space between rows of children
    };

    // LEGACY: Keep old spacing variables for old code sections (temporary)
    const xSpacing = 500;
    const ySpacing = 400;
    const clusterSpacing = 200;

    // Step 1: Q0 (Master Question) - Centered at top
    const step1 = steps.find(s => s.id === 1);
    if (step1?.output) {
      let q0Text = 'Master Question';
      if (typeof step1.output === 'object') {
        q0Text = step1.output.Q0 || step1.output.q0 || step1.output.question || 'Master Question';
      } else if (typeof step1.output === 'string') {
        q0Text = step1.output;
      }

      newNodes.push({
        id: 'q0',
        type: 'default',
        position: { x: 0, y: yOffset }, // Centered
        data: {
          label: `Q₀: ${q0Text.substring(0, 120)}${q0Text.length > 120 ? '...' : ''}`,
          fullData: { Q0: q0Text, raw: step1.output },
          type: 'q0'
        },
        style: {
          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(34, 197, 94, 0.2))',
          color: 'hsl(var(--foreground))',
          border: '2px solid rgba(59, 130, 246, 0.6)',
          borderRadius: '12px',
          padding: '12px',
          fontSize: '13px',
          fontWeight: '600',
          width: 350,
          boxShadow: '0 0 20px rgba(59, 130, 246, 0.4)',
        },
      });
      yOffset += verticalSpacing.betweenLevels;
    }

    // Step 2: Goal Pillars and Bridge Lexicon
    const step2 = steps.find(s => s.id === 2);
    if (step2?.output) {
      // Handle different key formats
      const goals = step2.output.goals || step2.output.Goal_Pillars || step2.output.goal_pillars || [];
      const bridgeLexicon = step2.output.bridge_lexicon || step2.output.Bridge_Lexicon || step2.output.bridgeLexicon || {};
      
      // Position Goals in a horizontal row with generous spacing
      const goalsY = yOffset;
      goals.slice(0, 6).forEach((goal: any, idx: number) => {
        const nodeId = `goal-${goal.id}`;
        const xPos = 100 + idx * xSpacing;
        
        newNodes.push({
          id: nodeId,
          type: 'default',
          position: { x: xPos, y: goalsY },
          data: { 
            label: `${goal.id}: ${goal.title}`,
            fullData: goal,
            type: 'goal'
          },
          style: {
            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(236, 72, 153, 0.2))',
            color: 'hsl(var(--foreground))',
            border: '2px solid rgba(139, 92, 246, 0.6)',
            borderRadius: '12px',
            padding: '12px',
            fontSize: '12px',
            fontWeight: '600',
            width: 280,
            boxShadow: '0 0 20px rgba(139, 92, 246, 0.4)',
          },
        });

        // Connect to Q0
        if (step1?.output) {
          newEdges.push({
            id: `q0-${nodeId}`,
            source: 'q0',
            target: nodeId,
            type: 'smoothstep',
            animated: true,
            style: { stroke: NODE_COLORS.goal, strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.goal },
          });
        }
      });

      yOffset += ySpacing; // Move to next level

      // Add Bridge Lexicon nodes (SPVs only, no FCCs)
      const spvs = bridgeLexicon.system_properties || bridgeLexicon.System_Properties || [];
      
      // Add ALL SPVs with modern design
      const lexiconY = yOffset;
      spvs.forEach((spv: any, idx: number) => {
        if (!spv || typeof spv !== 'object') return;
        
        const nodeId = `spv-${spv.id || spv.ID}`;
        const xPos = 100 + idx * 180; // Spacing for all SPVs
        
        newNodes.push({
          id: nodeId,
          type: 'default',
          position: { x: xPos, y: lexiconY },
          data: { 
            label: `${spv.id || spv.ID}: ${spv.name || spv.Name || 'SPV'}`,
            fullData: spv,
            type: 'spv'
          },
          style: {
            background: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(251,146,60,0.2))',
            color: 'hsl(var(--foreground))',
            border: '1.5px solid rgba(245,158,11,0.6)',
            borderRadius: '10px',
            padding: '8px',
            fontSize: '10px',
            fontWeight: '600',
            width: 200,
            boxShadow: '0 0 15px rgba(245,158,11,0.4)',
          },
        });
        
        // Connect SPVs to their associated Goals (will connect to RAs later if they exist)
        goals.forEach((goal: any) => {
          const goalSPVs = goal.bridge_tags?.system_properties_required || [];
          const hasSPV = goalSPVs.some((sp: any) => sp.spv_id === (spv.id || spv.ID));
          if (hasSPV) {
            newEdges.push({
              id: `${nodeId}-goal-${goal.id}`,
              source: nodeId,
              target: `goal-${goal.id}`,
              type: 'smoothstep',
              animated: true,
              style: { stroke: NODE_COLORS.spv, strokeWidth: 1, strokeDasharray: '5,5' },
              markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.spv },
            });
          }
        });
      });

      yOffset += ySpacing;
    }

    // Step 3: Requirement Atoms with common collapsible node per goal
    const step3 = steps.find(s => s.id === 3);
    if (step3?.output && typeof step3.output === 'object') {
      const rasByGoal = step3.output;
      const raY = yOffset;

      // Process each goal's RAs
      Object.keys(rasByGoal).forEach((goalId) => {
        const ras = Array.isArray(rasByGoal[goalId]) ? rasByGoal[goalId] : [];
        const parentGoalNode = `goal-${goalId}`;
        const parentNode = newNodes.find(n => n.id === parentGoalNode);

        if (!parentNode || ras.length === 0) return;

        const baseX = parentNode.position.x;
        const raGroupId = `ra-group-${goalId}`;

        // Create common RA collapsible node
        newNodes.push({
          id: raGroupId,
          type: 'default',
          position: { x: baseX, y: raY },
          data: {
            label: `RA (${ras.length})`,
            fullData: { ras, goalId },
            type: 'ra_group'
          },
          style: {
            background: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(34,197,94,0.15))',
            color: 'hsl(var(--foreground))',
            border: '2px solid rgba(16,185,129,0.6)',
            borderRadius: '12px',
            padding: '12px',
            fontSize: '11px',
            fontWeight: '700',
            width: 120,
            minHeight: 60,
            boxShadow: '0 0 18px rgba(16,185,129,0.3)',
            cursor: 'pointer',
            textAlign: 'center'
          }
        });

        // Edge from Goal to RA group
        newEdges.push({
          id: `${parentGoalNode}-${raGroupId}`,
          source: parentGoalNode,
          target: raGroupId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: NODE_COLORS.ra, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.ra },
        });

        // Create individual RA nodes when expanded
        if (!collapsedGroups.has(raGroupId)) {
          ras.slice(0, 6).forEach((ra: any, raIdx: number) => {
            if (!ra || typeof ra !== 'object') return;

            const nodeId = `ra-${ra.ra_id || `${goalId}-${raIdx}`}`;
            const col = raIdx % 3;
            const row = Math.floor(raIdx / 3);
            const xPos = baseX - 320 + col * 320;
            const yPos = raY + 150 + row * 140;

            newNodes.push({
              id: nodeId,
              type: 'default',
              position: { x: xPos, y: yPos },
              data: {
                label: `${ra.ra_id || 'RA'}: ${(ra.atom_title || ra.title || 'Untitled').substring(0, 70)}${(ra.atom_title || ra.title || '').length > 70 ? '...' : ''}`,
                fullData: ra,
                type: 'ra',
                parentGoalId: goalId,
                parentGroup: raGroupId
              },
              style: {
                background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(34,197,94,0.2))',
                color: 'hsl(var(--foreground))',
                border: '2px solid rgba(16,185,129,0.6)',
                borderRadius: '10px',
                padding: '10px',
                fontSize: '10px',
                fontWeight: '600',
                width: 280,
                boxShadow: '0 0 18px rgba(16,185,129,0.4)',
              },
            });

            // Edge from RA group to individual RA
            newEdges.push({
              id: `${raGroupId}-${nodeId}`,
              source: raGroupId,
              target: nodeId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: NODE_COLORS.ra, strokeWidth: 1, strokeDasharray: '2,2' },
              markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.ra },
            });

            // Connect SPVs to individual RAs
            const spvNodes = newNodes.filter(n => n.data.type === 'spv');
            spvNodes.forEach(spvNode => {
              const oldEdgeId = `${spvNode.id}-${parentGoalNode}`;
              const edgeIndex = newEdges.findIndex(e => e.id === oldEdgeId);
              if (edgeIndex !== -1) {
                newEdges.splice(edgeIndex, 1);
                newEdges.push({
                  id: `${spvNode.id}-${nodeId}`,
                  source: spvNode.id,
                  target: nodeId,
                  type: 'smoothstep',
                  animated: true,
                  style: { stroke: NODE_COLORS.spv, strokeWidth: 1, strokeDasharray: '5,5', opacity: 0.5 },
                  markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.spv },
                });
              }
            });
          });
        }
      });

      // Adjust yOffset based on expansion state
      const hasExpandedRAs = Object.keys(rasByGoal).some(goalId => !collapsedGroups.has(`ra-group-${goalId}`));
      if (hasExpandedRAs) {
        const maxRows = Math.max(...Object.values(rasByGoal).map((ras: any) => Math.ceil(Math.min(ras.length, 6) / 3)), 1);
        yOffset += ySpacing + 150 + (maxRows * 140);
      } else {
        yOffset += ySpacing;
      }
    }

    // Step 4: Scientific Pillars with common collapsible node per goal
    const step4 = steps.find(s => s.id === 4);
    if (step4?.output) {
      const sciY = yOffset;

      Object.entries(step4.output).forEach(([goalId, goalData]: [string, any]) => {
        const sNodes = goalData?.scientific_pillars || [];
        const parentGoalNode = `goal-${goalId}`;
        const parentNode = newNodes.find(n => n.id === parentGoalNode);

        if (!parentNode || sNodes.length === 0) return;

        const baseX = parentNode.position.x;
        const sGroupId = `s-group-${goalId}`;

        // Create common S collapsible node
        newNodes.push({
          id: sGroupId,
          type: 'default',
          position: { x: baseX, y: sciY },
          data: {
            label: `S (${sNodes.length})`,
            fullData: { sNodes, goalId },
            type: 's_group'
          },
          style: {
            background: 'linear-gradient(135deg, rgba(6,182,212,0.15), rgba(8,145,178,0.15))',
            color: 'hsl(var(--foreground))',
            border: '2px solid rgba(6,182,212,0.6)',
            borderRadius: '12px',
            padding: '12px',
            fontSize: '11px',
            fontWeight: '700',
            width: 120,
            minHeight: 60,
            boxShadow: '0 0 18px rgba(6,182,212,0.3)',
            cursor: 'pointer',
            textAlign: 'center'
          }
        });

        // Edge from Goal to S group
        newEdges.push({
          id: `${parentGoalNode}-${sGroupId}`,
          source: parentGoalNode,
          target: sGroupId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: NODE_COLORS.scientific, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.scientific },
        });

        // Create individual S nodes when expanded (show top 15 by strategic value)
        if (!collapsedGroups.has(sGroupId)) {
          const topSNodes = sNodes
            .sort((a: any, b: any) => (b.strategic_value_score || 0) - (a.strategic_value_score || 0))
            .slice(0, 15);

          topSNodes.forEach((sNode: any, idx: number) => {
            const nodeId = `s-${sNode.id || idx}`;
            const col = idx % 3;
            const row = Math.floor(idx / 3);
            const xPos = baseX - 320 + col * 320;
            const yPos = sciY + 150 + row * 130;

            newNodes.push({
              id: nodeId,
              type: 'default',
              position: { x: xPos, y: yPos },
              data: {
                label: `${sNode.title?.substring(0, 60)}${sNode.title && sNode.title.length > 60 ? '...' : ''}`,
                fullData: sNode,
                type: 'scientific',
                parentGroup: sGroupId
              },
              style: {
                background: 'linear-gradient(135deg, rgba(6,182,212,0.2), rgba(8,145,178,0.2))',
                color: 'hsl(var(--foreground))',
                border: '1.5px solid rgba(6,182,212,0.6)',
                borderRadius: '10px',
                padding: '8px',
                fontSize: '10px',
                fontWeight: '600',
                width: 280,
                boxShadow: '0 0 15px rgba(6,182,212,0.4)',
              },
            });

            // Edge from S group to individual S
            newEdges.push({
              id: `${sGroupId}-${nodeId}`,
              source: sGroupId,
              target: nodeId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: NODE_COLORS.scientific, strokeWidth: 1, strokeDasharray: '2,2' },
              markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.scientific },
            });

            // Create edge from S to Goal for Step 5 classification
            newEdges.push({
              id: `gs-${goalId}-${sNode.id}`,
              source: nodeId,
              target: parentGoalNode,
              type: 'smoothstep',
              animated: false,
              style: {
                stroke: '#64748b',
                strokeWidth: 1,
                strokeDasharray: '5,5',
                opacity: 0.3
              },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
              data: {
                type: 'gs_edge',
                s_node_id: sNode.id,
                classified: false,
                source_step: 4,
                hidden: true
              }
            });
          });
        }
      });

      // Adjust yOffset based on expansion state
      const hasExpandedS = Object.keys(step4.output).some((goalId: string) => !collapsedGroups.has(`s-group-${goalId}`));
      if (hasExpandedS) {
        const maxSNodes = Math.max(...Object.values(step4.output).map((goalData: any) => (goalData?.scientific_pillars || []).length), 0);
        const maxRows = Math.ceil(Math.min(maxSNodes, 15) / 3);
        yOffset += ySpacing + 150 + (maxRows * 130);
      } else {
        yOffset += ySpacing;
      }
    }

    // Step 5: Update G-S edges with relationship classifications
    // NEW MODE: Step 5 now classifies existing G-S edges created in Step 4
    const step5 = steps.find(s => s.id === 5);
    if (step5?.output) {
      const matchingData = step5.output;
      Object.keys(matchingData).forEach((goalId) => {
        const goalData = matchingData[goalId];
        const edgesData = goalData?.edges || [];
        
        edgesData.forEach((edgeData: any) => {
          if (!edgeData || typeof edgeData !== 'object') return;
          
          const sourceNode = `s-${edgeData.source_s_id}`;
          const targetNode = `goal-${goalId}`;
          const edgeId = `gs-${goalId}-${edgeData.source_s_id}`;
          
          // Find the existing edge created in Step 4
          const existingEdgeIndex = newEdges.findIndex(e => e.id === edgeId);
          
          if (existingEdgeIndex !== -1) {
            // UPDATE existing edge with classification
            let edgeColor, strokeWidth, dashArray, animated;
            
            switch (edgeData.relationship) {
              case 'solves':
                edgeColor = '#10b981'; // Green - fully solves
                strokeWidth = 3;
                dashArray = '0'; // Solid line
                animated = true;
                break;
              case 'partially_solves':
                edgeColor = '#f59e0b'; // Amber - partial solution
                strokeWidth = 2.5;
                dashArray = '8,4'; // Dashed
                animated = true;
                break;
              case 'enables_measurement_for':
                edgeColor = '#3b82f6'; // Blue - enables measurement
                strokeWidth = 2;
                dashArray = '4,4'; // Short dashes
                animated = false;
                break;
              case 'proxies_for':
                edgeColor = '#8b5cf6'; // Purple - proxy relationship
                strokeWidth = 1.5;
                dashArray = '2,3'; // Dotted
                animated = false;
                break;
              case 'violates':
                edgeColor = '#ef4444'; // Red - violates (should be removed)
                strokeWidth = 2;
                dashArray = '10,5'; // Long dashes
                animated = true;
                break;
              default:
                edgeColor = '#6366f1'; // Indigo - other
                strokeWidth = 2;
                dashArray = '5,5';
                animated = true;
            }
            
            // Update the existing edge
            newEdges[existingEdgeIndex] = {
              ...newEdges[existingEdgeIndex],
              animated: animated,
              label: edgeData.relationship?.replace(/_/g, ' '),
              style: { 
                stroke: edgeColor, 
                strokeWidth: strokeWidth, 
                strokeDasharray: dashArray 
              },
              markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
              data: { 
                ...newEdges[existingEdgeIndex].data,
                fullData: edgeData, 
                type: 'gs_edge_classified',
                classified: true,
                relationship: edgeData.relationship,
                confidence: edgeData.confidence_score,
                gap: edgeData.gap_analysis?.primary_delta,
                source_step: 5
              },
            };
            
            // REMOVE edges classified as 'violates' (invalid links)
            if (edgeData.relationship === 'violates') {
              newEdges.splice(existingEdgeIndex, 1);
            }
          } else if (newNodes.find(n => n.id === sourceNode) && newNodes.find(n => n.id === targetNode)) {
            // FALLBACK: Old mode - create new edge if it doesn't exist (backward compatibility)
            let edgeColor, strokeWidth, dashArray, animated;
            
            switch (edgeData.relationship) {
              case 'solves':
                edgeColor = '#10b981';
                strokeWidth = 3;
                dashArray = '0';
                animated = true;
                break;
              case 'partially_solves':
                edgeColor = '#f59e0b';
                strokeWidth = 2.5;
                dashArray = '8,4';
                animated = true;
                break;
              case 'enables_measurement_for':
                edgeColor = '#3b82f6';
                strokeWidth = 2;
                dashArray = '4,4';
                animated = false;
                break;
              case 'proxies_for':
                edgeColor = '#8b5cf6';
                strokeWidth = 1.5;
                dashArray = '2,3';
                animated = false;
                break;
              case 'violates':
                // Skip creating edges for 'violates' in old mode
                return;
              default:
                edgeColor = '#6366f1';
                strokeWidth = 2;
                dashArray = '5,5';
                animated = true;
            }
            
            newEdges.push({
              id: `match-${sourceNode}-${targetNode}`,
              source: sourceNode,
              target: targetNode,
              type: 'smoothstep',
              animated: animated,
              label: edgeData.relationship?.replace(/_/g, ' '),
              style: { 
                stroke: edgeColor, 
                strokeWidth: strokeWidth, 
                strokeDasharray: dashArray 
              },
              markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor },
              data: { 
                fullData: edgeData, 
                type: 'matching_edge',
                confidence: edgeData.confidence_score,
                gap: edgeData.gap_analysis?.primary_delta
              },
            });
          }
        });
      });
    }

    // Step 6: L3 Questions - Create collapsible group nodes under Goals
    const step6 = steps.find(s => s.id === 6);

    console.log('[GraphViz] === STEP 6 DEBUG ===');
    console.log('[GraphViz] All steps:', steps.map(s => ({ id: s.id, name: s.name, status: s.status, hasOutput: !!s.output })));
    console.log('[GraphViz] Step 6 found:', !!step6);
    console.log('[GraphViz] Step 6 status:', step6?.status);
    console.log('[GraphViz] Step 6 has output:', !!step6?.output);

    if (step6?.output) {
      let l3Questions: any[] = [];

      console.log('[GraphViz] Step 6 output structure:', step6.output);
      console.log('[GraphViz] Step 6 output keys:', Object.keys(step6.output || {}));

      if (Array.isArray(step6.output)) {
        l3Questions = step6.output;
        console.log('[GraphViz] Step 6 output is array, length:', l3Questions.length);
      } else if (step6.output && typeof step6.output === 'object') {
        if (step6.output.l3_questions) {
          l3Questions = Array.isArray(step6.output.l3_questions) ? step6.output.l3_questions : [];
          console.log('[GraphViz] Found l3_questions, length:', l3Questions.length);
        } else if (step6.output.seed_questions) {
          l3Questions = Array.isArray(step6.output.seed_questions) ? step6.output.seed_questions : [];
          console.log('[GraphViz] Found seed_questions, length:', l3Questions.length);
        } else {
          l3Questions = Object.values(step6.output).filter(val => Array.isArray(val)).flat();
          console.log('[GraphViz] Extracted arrays from object, length:', l3Questions.length);
        }
      }

      console.log('[GraphViz] Total L3 questions extracted:', l3Questions.length);
      if (l3Questions.length > 0) {
        console.log('[GraphViz] Sample L3 question:', l3Questions[0]);
        console.log('[GraphViz] L3 IDs:', l3Questions.map(q => q?.id).slice(0, 5));
        console.log('[GraphViz] L3 texts:', l3Questions.map(q => q?.text?.substring(0, 30)).slice(0, 5));
      } else {
        console.error('[GraphViz] ❌ NO L3 QUESTIONS FOUND!');
        console.error('[GraphViz] Step 6 output is empty or has unexpected structure');
        console.error('[GraphViz] Skipping L3 processing');
        // Don't process L3s, but continue with the rest of the graph
        yOffset += ySpacing;
      }

      if (l3Questions.length > 0) {
        // Group L3s by their parent Goal
        const l3sByGoal: Record<string, any[]> = {};

        l3Questions.forEach((q: any) => {
          if (!q || typeof q !== 'object') {
            console.warn('[GraphViz] Skipping invalid L3 question:', q);
            return;
          }
          const l3Id = q.id || '';
          let parentGoalId = null;

          // Method 1: Try new format first: Q_L3_M_G1_1, Q_L3_M_G2_1
          const newFormatMatch = l3Id.match(/Q_L3_(M_G\d+)_/);
          if (newFormatMatch) {
            parentGoalId = newFormatMatch[1];
            console.log(`[GraphViz] L3 ${l3Id} matched new format -> parent goal: ${parentGoalId}`);
          }
          // Method 2: Check if question has explicit target_goal_id field
          else if (q.target_goal_id) {
            parentGoalId = q.target_goal_id;
            console.log(`[GraphViz] L3 ${l3Id} using target_goal_id field -> parent goal: ${parentGoalId}`);
          }
          // Legacy format fallbacks
          else if (l3Id.includes('_FRAG_')) parentGoalId = 'M_G1';
          else if (l3Id.match(/_MG(\d+)_/)) {
            const match = l3Id.match(/_MG(\d+)_/);
            if (match) parentGoalId = `M_G${match[1]}`;
          } else if (l3Id.match(/Q_L3_003_/)) parentGoalId = 'M_G3';
          else if (l3Id.match(/Q_L3_001_/)) parentGoalId = 'M_G4';
          else if (l3Id.match(/Q_L3_007_/)) parentGoalId = 'M_G5';
          else if (l3Id.match(/Q_L3_006_/)) parentGoalId = 'M_G6';

          if (parentGoalId) {
            if (!l3sByGoal[parentGoalId]) l3sByGoal[parentGoalId] = [];
            l3sByGoal[parentGoalId].push(q);
          } else {
            console.warn(`[GraphViz] Could not determine parent goal for L3 question: ${l3Id}`, q);
          }
        });

        console.log('[GraphViz] L3s grouped by goal:', Object.keys(l3sByGoal).map(k => `${k}: ${l3sByGoal[k].length}`));

        const l3Y = yOffset;

        // For each Goal, create a collapsible L3 group node
        Object.keys(l3sByGoal).forEach((goalId) => {
        const goalL3s = l3sByGoal[goalId];
        const parentGoalNode = newNodes.find(n => n.id === `goal-${goalId}`);

        console.log(`[GraphViz] Processing L3s for goal ${goalId}: ${goalL3s.length} questions`);
        console.log(`[GraphViz] L3 questions data:`, goalL3s.map(q => ({ id: q?.id, text: q?.text?.substring(0, 50) })));
        console.log(`[GraphViz] Looking for parent node: goal-${goalId}`);
        console.log(`[GraphViz] Parent node found:`, !!parentGoalNode);

        if (!parentGoalNode) {
          console.warn(`[GraphViz] ⚠️ SKIPPING L3 questions for ${goalId} - parent goal node not found!`);
          console.warn(`[GraphViz] Available goal nodes:`, newNodes.filter(n => n.id.startsWith('goal-')).map(n => n.id));
          return;
        }

        if (goalL3s.length === 0) {
          console.warn(`[GraphViz] ⚠️ SKIPPING goal ${goalId} - no L3 questions in this group`);
          return;
        }

        const baseX = parentGoalNode.position.x;
        const l3GroupId = `l3-group-${goalId}`;

        // Create collapsible L3 group node
        console.log(`[GraphViz] Creating L3 group node: ${l3GroupId}`);
        console.log(`[GraphViz]   - Position: (${baseX}, ${l3Y})`);
        console.log(`[GraphViz]   - L3 questions in this group:`, goalL3s.length);
        console.log(`[GraphViz]   - Is collapsed:`, collapsedGroups.has(l3GroupId));

        newNodes.push({
          id: l3GroupId,
          type: 'default',
          position: { x: baseX, y: l3Y },
          data: {
            label: `L3 (${goalL3s.length})`,
            fullData: {
              questions: goalL3s,
              goalId: goalId
            },
            type: 'l3_group'
          },
          style: {
            background: 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(220,38,38,0.15))',
            color: 'hsl(var(--foreground))',
            border: '2px solid rgba(239,68,68,0.6)',
            borderRadius: '12px',
            padding: '16px',
            fontSize: '11px',
            fontWeight: '600',
            width: 280,
            minHeight: 100,
            boxShadow: '0 0 20px rgba(239,68,68,0.3)',
            cursor: 'pointer'
          }
        });

        // Create edge from Goal to L3 Group
        newEdges.push({
          id: `goal-${goalId}-${l3GroupId}`,
          source: `goal-${goalId}`,
          target: l3GroupId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: NODE_COLORS.l3, strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l3 },
        });

        console.log(`[GraphViz] ✅ Created L3 group node: ${l3GroupId} with ${goalL3s.length} questions`);

        // Create individual L3 nodes (shown when expanded)
        console.log(`[GraphViz] Checking if L3 group should be expanded...`);
        console.log(`[GraphViz]   - Group ID: ${l3GroupId}`);
        console.log(`[GraphViz]   - Is in collapsedGroups:`, collapsedGroups.has(l3GroupId));
        console.log(`[GraphViz]   - Should create individual nodes:`, !collapsedGroups.has(l3GroupId));

        if (!collapsedGroups.has(l3GroupId)) {
          console.log(`[GraphViz] ✅ Creating ${goalL3s.length} individual L3 nodes for ${l3GroupId}`);
          const l3sPerRow = 2;
          goalL3s.forEach((q: any, idx: number) => {
            console.log(`[GraphViz]   Creating L3 node ${idx + 1}/${goalL3s.length}: ${q?.id}`);
            const nodeId = `l3-${q.id || idx}`;
            const row = Math.floor(idx / l3sPerRow);
            const col = idx % l3sPerRow;
            const xPos = baseX - 150 + col * 320;
            const yPos = l3Y + 180 + row * 140;
            console.log(`[GraphViz]     - Node ID: ${nodeId}, Position: (${xPos}, ${yPos})`);

            const l3Node = {
              id: nodeId,
              type: 'default',
              position: { x: xPos, y: yPos },
              data: {
                label: `${q.text?.substring(0, 100)}${q.text && q.text.length > 100 ? '...' : ''}`,
                fullData: q,
                type: 'l3',
                parentGroup: l3GroupId
              },
              style: {
                background: 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(220,38,38,0.2))',
                color: 'hsl(var(--foreground))',
                border: '2px solid rgba(239,68,68,0.6)',
                borderRadius: '10px',
                padding: '10px',
                fontSize: '10px',
                fontWeight: '600',
                width: 280,
                boxShadow: '0 0 18px rgba(239,68,68,0.4)',
              },
            };
            newNodes.push(l3Node);
            console.log(`[GraphViz]     ✅ Added L3 node to graph`);

            // Create edge from L3 Group to individual L3
            const l3Edge = {
              id: `${l3GroupId}-${nodeId}`,
              source: l3GroupId,
              target: nodeId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: NODE_COLORS.l3, strokeWidth: 1, strokeDasharray: '2,2' },
              markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l3 },
            };
            newEdges.push(l3Edge);
            console.log(`[GraphViz]     ✅ Added edge from group to L3 node`);
          });
          console.log(`[GraphViz] ✅ Finished creating ${goalL3s.length} individual L3 nodes`);
        } else {
          console.log(`[GraphViz] ⚠️ L3 group ${l3GroupId} is COLLAPSED - not creating individual nodes`);
        }
      });

      // Adjust yOffset based on whether groups are expanded
      const hasExpandedGroups = Object.keys(l3sByGoal).some(goalId => !collapsedGroups.has(`l3-group-${goalId}`));
      if (hasExpandedGroups) {
        const maxL3Rows = Math.max(...Object.values(l3sByGoal).map(l3s => Math.ceil(l3s.length / 2)), 1);
        yOffset += ySpacing + 180 + (maxL3Rows * 140) + clusterSpacing;
      } else {
        yOffset += ySpacing;
      }

      // Final check: how many L3 nodes were created?
      const l3GroupNodes = newNodes.filter(n => n.data?.type === 'l3_group');
      const l3IndividualNodes = newNodes.filter(n => n.data?.type === 'l3');
      const l3NodesCreated = l3GroupNodes.length + l3IndividualNodes.length;

      console.log(`[GraphViz] ✅ Step 6 complete: Created ${l3NodesCreated} L3-related nodes`);
      console.log(`[GraphViz]   - L3 group nodes: ${l3GroupNodes.length}`);
      console.log(`[GraphViz]   - L3 individual nodes: ${l3IndividualNodes.length}`);
      console.log(`[GraphViz]   - L3 groups:`, l3GroupNodes.map(n => n.id));
      console.log(`[GraphViz]   - L3 nodes:`, l3IndividualNodes.map(n => n.id));

        if (l3GroupNodes.length > 0 && l3IndividualNodes.length === 0) {
          console.warn(`[GraphViz] ⚠️ WARNING: L3 groups created but NO individual L3 nodes!`);
          console.warn(`[GraphViz]   This means groups are either empty or collapsed`);
          console.warn(`[GraphViz]   collapsedGroups state:`, Array.from(collapsedGroups));
        }
      } // End of if (l3Questions.length > 0)
    }

    // Step 7: Instantiation Hypotheses - Create collapsible group nodes under L3s
    const step7 = steps.find(s => s.id === 7);
    if (step7?.output) {
      let ihs: any[] = [];

      if (Array.isArray(step7.output)) {
        ihs = step7.output;
      } else if (step7.output && typeof step7.output === 'object') {
        if (step7.output.instantiation_hypotheses) {
          ihs = Array.isArray(step7.output.instantiation_hypotheses) ? step7.output.instantiation_hypotheses : [];
        } else {
          ihs = Object.values(step7.output).filter(val => Array.isArray(val)).flat();
        }
      }

      console.log(`[Graph] Found ${ihs.length} IH nodes in Step 7 output`);

      // Group IHs by their parent L3 question
      const ihsByL3: Record<string, any[]> = {};

      ihs.forEach((ih: any) => {
        if (!ih || typeof ih !== 'object') return;
        const ihId = ih.ih_id || '';

        // Extract L3 ID from IH ID format: IH_Q_L3_M_G1_1_01 -> Q_L3_M_G1_1
        const l3Match = ihId.match(/IH_(Q_L3_[^_]+_[^_]+_\d+)/);
        if (l3Match) {
          const parentL3Id = l3Match[1];
          if (!ihsByL3[parentL3Id]) ihsByL3[parentL3Id] = [];
          ihsByL3[parentL3Id].push(ih);
        }
      });

      const ihY = yOffset;

      // For each L3, create a collapsible IH group node
      Object.keys(ihsByL3).forEach((l3Id) => {
        const l3IHs = ihsByL3[l3Id];
        const parentL3Node = newNodes.find(n => n.id === `l3-${l3Id}`);

        if (!parentL3Node) {
          console.warn(`Parent L3 node not found for IHs: ${l3Id}. Skipping ${l3IHs.length} IH nodes.`);
          return;
        }

        const baseX = parentL3Node.position.x;
        const ihGroupId = `ih-group-${l3Id}`;

        // Create collapsible IH group node
        newNodes.push({
          id: ihGroupId,
          type: 'default',
          position: { x: baseX, y: ihY },
          data: {
            label: `IH (${l3IHs.length})`,
            fullData: {
              hypotheses: l3IHs,
              l3Id: l3Id
            },
            type: 'ih_group'
          },
          style: {
            background: 'linear-gradient(135deg, rgba(249,115,22,0.15), rgba(245,158,11,0.15))',
            color: 'hsl(var(--foreground))',
            border: '2px solid rgba(249,115,22,0.6)',
            borderRadius: '12px',
            padding: '16px',
            fontSize: '11px',
            fontWeight: '600',
            width: 260,
            minHeight: 90,
            boxShadow: '0 0 18px rgba(249,115,22,0.3)',
            cursor: 'pointer'
          }
        });

        // Create edge from L3 to IH Group
        newEdges.push({
          id: `l3-${l3Id}-${ihGroupId}`,
          source: `l3-${l3Id}`,
          target: ihGroupId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: NODE_COLORS.ih, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.ih },
        });

        // Create individual IH nodes (shown when expanded)
        if (!collapsedGroups.has(ihGroupId)) {
          const ihsPerRow = 2;
          l3IHs.forEach((ih: any, idx: number) => {
            const nodeId = `ih-${ih.ih_id || idx}`;
            const row = Math.floor(idx / ihsPerRow);
            const col = idx % ihsPerRow;
            const xPos = baseX - 130 + col * 280;
            const yPos = ihY + 150 + row * 130;

            newNodes.push({
              id: nodeId,
              type: 'default',
              position: { x: xPos, y: yPos },
              data: {
                label: `${ih.process_hypothesis?.substring(0, 70)}${ih.process_hypothesis && ih.process_hypothesis.length > 70 ? '...' : ''}`,
                fullData: ih,
                type: 'ih',
                parentGroup: ihGroupId
              },
              style: {
                background: 'linear-gradient(135deg, rgba(249,115,22,0.2), rgba(245,158,11,0.2))',
                color: 'hsl(var(--foreground))',
                border: '1.5px solid rgba(249,115,22,0.6)',
                borderRadius: '10px',
                padding: '8px',
                fontSize: '10px',
                fontWeight: '600',
                width: 240,
                boxShadow: '0 0 15px rgba(249,115,22,0.4)',
              },
            });

            // Create edge from IH Group to individual IH
            newEdges.push({
              id: `${ihGroupId}-${nodeId}`,
              source: ihGroupId,
              target: nodeId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: NODE_COLORS.ih, strokeWidth: 1, strokeDasharray: '2,2' },
              markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.ih },
            });
          });
        }
      });

      // Adjust yOffset based on whether groups are expanded
      const hasExpandedGroups = Object.keys(ihsByL3).some(l3Id => !collapsedGroups.has(`ih-group-${l3Id}`));
      if (hasExpandedGroups) {
        const maxIHRows = Math.max(...Object.values(ihsByL3).map(ihs => Math.ceil(ihs.length / 2)), 1);
        yOffset += ySpacing + 150 + (maxIHRows * 130) + clusterSpacing;
      } else {
        yOffset += ySpacing;
      }
    }

    // Step 8: L4 Questions - Create collapsible group nodes under IH or L3 nodes
    const step8 = steps.find(s => s.id === 8);
    if (step8?.output) {
      let l4Questions: any[] = [];

      if (Array.isArray(step8.output)) {
        l4Questions = step8.output;
      } else if (step8.output && typeof step8.output === 'object') {
        if (step8.output.l4_questions) {
          l4Questions = Array.isArray(step8.output.l4_questions) ? step8.output.l4_questions : [];
        } else {
          l4Questions = Object.values(step8.output).filter(val => Array.isArray(val)).flat();
        }
      }

      // Group L4s by their parent (IH if exists, otherwise L3)
      const l4sByIH: Record<string, any[]> = {};
      const l4sByL3: Record<string, any[]> = {};

      l4Questions.forEach((q: any) => {
        if (!q || typeof q !== 'object') return;

        // Try to link to IH first
        const parentIHIds = q.distinguishes_ih_ids || [];
        if (parentIHIds.length > 0) {
          const parentIHId = parentIHIds[0];
          const parentExists = newNodes.some(n => n.id === `ih-${parentIHId}`);
          if (parentExists) {
            if (!l4sByIH[parentIHId]) l4sByIH[parentIHId] = [];
            l4sByIH[parentIHId].push(q);
            return;
          }
        }

        // Try to extract parent L3 from L4 ID
        const l4Id = q.id || '';
        const l3Match = l4Id.match(/Q_L4_(M_G\d+_\d+)_/);
        if (l3Match) {
          const parentL3Id = `Q_L3_${l3Match[1]}`;
          const parentL3Exists = newNodes.some(n => n.id === `l3-${parentL3Id}`);
          if (parentL3Exists) {
            if (!l4sByL3[parentL3Id]) l4sByL3[parentL3Id] = [];
            l4sByL3[parentL3Id].push(q);
            return;
          }
        }

        console.warn(`L4 question ${q.id} has no valid parent (IH or L3)`);
      });

      const l4Y = yOffset;

      // Create collapsible L4 group nodes for IH parents
      Object.keys(l4sByIH).forEach((ihId) => {
        const ihL4s = l4sByIH[ihId];
        const parentIHNode = newNodes.find(n => n.id === `ih-${ihId}`);

        if (!parentIHNode) return;

        const baseX = parentIHNode.position.x;
        const l4GroupId = `l4-group-ih-${ihId}`;

        // Create collapsible L4 group node
        newNodes.push({
          id: l4GroupId,
          type: 'default',
          position: { x: baseX, y: l4Y },
          data: {
            label: `L4 (${ihL4s.length})`,
            fullData: {
              questions: ihL4s,
              ihId: ihId
            },
            type: 'l4_group'
          },
          style: {
            background: 'linear-gradient(135deg, rgba(132,204,22,0.15), rgba(34,197,94,0.15))',
            color: 'hsl(var(--foreground))',
            border: '2px solid rgba(132,204,22,0.6)',
            borderRadius: '12px',
            padding: '14px',
            fontSize: '10px',
            fontWeight: '600',
            width: 220,
            minHeight: 80,
            boxShadow: '0 0 15px rgba(132,204,22,0.3)',
            cursor: 'pointer'
          }
        });

        // Create edge from IH to L4 Group
        newEdges.push({
          id: `ih-${ihId}-${l4GroupId}`,
          source: `ih-${ihId}`,
          target: l4GroupId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: NODE_COLORS.l4, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l4 },
        });

        // Create individual L4 nodes (shown when expanded)
        if (!collapsedGroups.has(l4GroupId)) {
          const l4sPerRow = 2;
          ihL4s.forEach((q: any, idx: number) => {
            const nodeId = `l4-${q.id || idx}`;
            const row = Math.floor(idx / l4sPerRow);
            const col = idx % l4sPerRow;
            const xPos = baseX - 110 + col * 240;
            const yPos = l4Y + 130 + row * 110;

            newNodes.push({
              id: nodeId,
              type: 'default',
              position: { x: xPos, y: yPos },
              data: {
                label: `${q.text?.substring(0, 55)}${q.text && q.text.length > 55 ? '...' : ''}`,
                fullData: q,
                type: 'l4',
                parentGroup: l4GroupId
              },
              style: {
                background: 'linear-gradient(135deg, rgba(132,204,22,0.2), rgba(34,197,94,0.2))',
                color: 'hsl(var(--foreground))',
                border: '1.5px solid rgba(132,204,22,0.6)',
                borderRadius: '10px',
                padding: '7px',
                fontSize: '9px',
                fontWeight: '600',
                width: 200,
                boxShadow: '0 0 15px rgba(132,204,22,0.4)',
              },
            });

            // Create edge from L4 Group to individual L4
            newEdges.push({
              id: `${l4GroupId}-${nodeId}`,
              source: l4GroupId,
              target: nodeId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: NODE_COLORS.l4, strokeWidth: 0.5, strokeDasharray: '1,1' },
              markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l4 },
            });
          });
        }
      });

      // Create collapsible L4 group nodes for L3 parents
      Object.keys(l4sByL3).forEach((l3Id) => {
        const l3L4s = l4sByL3[l3Id];
        const parentL3Node = newNodes.find(n => n.id === `l3-${l3Id}`);

        if (!parentL3Node) return;

        const baseX = parentL3Node.position.x;
        const l4GroupId = `l4-group-l3-${l3Id}`;

        // Create collapsible L4 group node
        newNodes.push({
          id: l4GroupId,
          type: 'default',
          position: { x: baseX, y: l4Y },
          data: {
            label: `L4 (${l3L4s.length})`,
            fullData: {
              questions: l3L4s,
              l3Id: l3Id
            },
            type: 'l4_group'
          },
          style: {
            background: 'linear-gradient(135deg, rgba(132,204,22,0.15), rgba(34,197,94,0.15))',
            color: 'hsl(var(--foreground))',
            border: '2px solid rgba(132,204,22,0.6)',
            borderRadius: '12px',
            padding: '14px',
            fontSize: '10px',
            fontWeight: '600',
            width: 220,
            minHeight: 80,
            boxShadow: '0 0 15px rgba(132,204,22,0.3)',
            cursor: 'pointer'
          }
        });

        // Create edge from L3 to L4 Group
        newEdges.push({
          id: `l3-${l3Id}-${l4GroupId}`,
          source: `l3-${l3Id}`,
          target: l4GroupId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: NODE_COLORS.l4, strokeWidth: 1.5, strokeDasharray: '3,3' },
          markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l4 },
        });

        // Create individual L4 nodes (shown when expanded)
        if (!collapsedGroups.has(l4GroupId)) {
          const l4sPerRow = 2;
          l3L4s.forEach((q: any, idx: number) => {
            const nodeId = `l4-${q.id || idx}`;
            const row = Math.floor(idx / l4sPerRow);
            const col = idx % l4sPerRow;
            const xPos = baseX - 110 + col * 240;
            const yPos = l4Y + 130 + row * 110;

            newNodes.push({
              id: nodeId,
              type: 'default',
              position: { x: xPos, y: yPos },
              data: {
                label: `${q.text?.substring(0, 55)}${q.text && q.text.length > 55 ? '...' : ''}`,
                fullData: q,
                type: 'l4',
                parentGroup: l4GroupId
              },
              style: {
                background: 'linear-gradient(135deg, rgba(132,204,22,0.2), rgba(34,197,94,0.2))',
                color: 'hsl(var(--foreground))',
                border: '1.5px solid rgba(132,204,22,0.6)',
                borderRadius: '10px',
                padding: '7px',
                fontSize: '9px',
                fontWeight: '600',
                width: 200,
                boxShadow: '0 0 15px rgba(132,204,22,0.4)',
              },
            });

            // Create edge from L4 Group to individual L4
            newEdges.push({
              id: `${l4GroupId}-${nodeId}`,
              source: l4GroupId,
              target: nodeId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: NODE_COLORS.l4, strokeWidth: 0.5, strokeDasharray: '1,1' },
              markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l4 },
            });
          });
        }
      });

      // Adjust yOffset based on whether groups are expanded
      const hasExpandedGroups =
        Object.keys(l4sByIH).some(ihId => !collapsedGroups.has(`l4-group-ih-${ihId}`)) ||
        Object.keys(l4sByL3).some(l3Id => !collapsedGroups.has(`l4-group-l3-${l3Id}`));

      if (hasExpandedGroups) {
        const allL4Rows = Math.max(
          ...Object.values(l4sByIH).map(l4s => Math.ceil(l4s.length / 2)),
          ...Object.values(l4sByL3).map(l4s => Math.ceil(l4s.length / 2)),
          1
        );
        yOffset += ySpacing + 130 + (allL4Rows * 110) + clusterSpacing;
      } else {
        yOffset += ySpacing;
      }
    }

    // Step 9 Part 1: L5 Mechanistic Drills - Create collapsible group nodes under L4 nodes
    const step9 = steps.find(s => s.id === 9);
    if (step9?.output) {
      let l5Nodes: any[] = [];

      if (step9.output && typeof step9.output === 'object' && step9.output.l5_nodes) {
        l5Nodes = Array.isArray(step9.output.l5_nodes) ? step9.output.l5_nodes : [];
      }

      if (l5Nodes.length > 0) {
        console.log(`[Graph] Found ${l5Nodes.length} L5 nodes in Step 9 output`);

        // Group L5s by their parent L4
        const l5sByL4: Record<string, any[]> = {};

        l5Nodes.forEach((l5: any) => {
          if (!l5 || typeof l5 !== 'object') return;
          const parentL4Id = l5.parent_l4_id;
          if (parentL4Id) {
            if (!l5sByL4[parentL4Id]) l5sByL4[parentL4Id] = [];
            l5sByL4[parentL4Id].push(l5);
          }
        });

        const l5Y = yOffset;

        // For each L4, create a collapsible L5 group node
        Object.keys(l5sByL4).forEach((l4Id) => {
          const l4L5s = l5sByL4[l4Id];
          const parentL4Node = newNodes.find(n => n.id === `l4-${l4Id}`);

          if (!parentL4Node) {
            console.warn(`Parent L4 node not found for L5 nodes: ${l4Id}`);
            return;
          }

          const baseX = parentL4Node.position.x;
          const l5GroupId = `l5-group-${l4Id}`;

          // Create collapsible L5 group node
          newNodes.push({
            id: l5GroupId,
            type: 'default',
            position: { x: baseX, y: l5Y },
            data: {
              label: `L5 (${l4L5s.length})`,
              fullData: {
                drills: l4L5s,
                l4Id: l4Id
              },
              type: 'l5_group'
            },
            style: {
              background: 'linear-gradient(135deg, rgba(163,230,53,0.15), rgba(132,204,22,0.15))',
              color: 'hsl(var(--foreground))',
              border: '2px solid rgba(163,230,53,0.6)',
              borderRadius: '12px',
              padding: '12px',
              fontSize: '10px',
              fontWeight: '600',
              width: 200,
              minHeight: 70,
              boxShadow: '0 0 15px rgba(163,230,53,0.3)',
              cursor: 'pointer'
            }
          });

          // Create edge from L4 to L5 Group
          newEdges.push({
            id: `l4-${l4Id}-${l5GroupId}`,
            source: `l4-${l4Id}`,
            target: l5GroupId,
            type: 'smoothstep',
            animated: true,
            style: { stroke: NODE_COLORS.l5, strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l5 },
          });

          // Create individual L5 nodes (shown when expanded)
          if (!collapsedGroups.has(l5GroupId)) {
            const l5sPerRow = 2;
            l4L5s.forEach((l5: any, idx: number) => {
              const nodeId = `l5-${l5.id || idx}`;
              const row = Math.floor(idx / l5sPerRow);
              const col = idx % l5sPerRow;
              const xPos = baseX - 105 + col * 220;
              const yPos = l5Y + 120 + row * 100;

              newNodes.push({
                id: nodeId,
                type: 'default',
                position: { x: xPos, y: yPos },
                data: {
                  label: `${l5.text?.substring(0, 50)}${l5.text && l5.text.length > 50 ? '...' : ''}`,
                  fullData: l5,
                  type: 'l5',
                  parentGroup: l5GroupId
                },
                style: {
                  background: 'linear-gradient(135deg, rgba(163,230,53,0.2), rgba(132,204,22,0.2))',
                  color: 'hsl(var(--foreground))',
                  border: '1.5px solid rgba(163,230,53,0.6)',
                  borderRadius: '10px',
                  padding: '7px',
                  fontSize: '9px',
                  fontWeight: '600',
                  width: 190,
                  boxShadow: '0 0 15px rgba(163,230,53,0.4)',
                },
              });

              // Create edge from L5 Group to individual L5
              newEdges.push({
                id: `${l5GroupId}-${nodeId}`,
                source: l5GroupId,
                target: nodeId,
                type: 'smoothstep',
                animated: true,
                style: { stroke: NODE_COLORS.l5, strokeWidth: 0.5, strokeDasharray: '1,1' },
                markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l5 },
              });
            });
          }
        });

        // Adjust yOffset based on whether groups are expanded
        const hasExpandedGroups = Object.keys(l5sByL4).some(l4Id => !collapsedGroups.has(`l5-group-${l4Id}`));
        if (hasExpandedGroups) {
          const maxL5Rows = Math.max(...Object.values(l5sByL4).map(l5s => Math.ceil(l5s.length / 2)), 1);
          yOffset += ySpacing + 120 + (maxL5Rows * 100) + clusterSpacing;
        } else {
          yOffset += ySpacing;
        }
      }
    }

    // Step 9 Part 2: L6 Tasks - Create collapsible group nodes under L5 or L4 nodes
    if (step9?.output) {
      let l6Tasks: any[] = [];

      if (Array.isArray(step9.output)) {
        l6Tasks = step9.output;
      } else if (step9.output && typeof step9.output === 'object') {
        if (step9.output.l6_tasks) {
          l6Tasks = Array.isArray(step9.output.l6_tasks) ? step9.output.l6_tasks : [];
        } else {
          l6Tasks = Object.values(step9.output).filter(val => Array.isArray(val)).flat();
        }
      }

      // Group L6s by their parent (L5 if exists, otherwise L4)
      const l6sByL5: Record<string, any[]> = {};
      const l6sByL4: Record<string, any[]> = {};

      l6Tasks.forEach((task: any) => {
        if (!task || typeof task !== 'object') return;

        // Try to link to L5 first
        if (task.parent_l5_id) {
          const parentL5Id = task.parent_l5_id;
          if (!l6sByL5[parentL5Id]) l6sByL5[parentL5Id] = [];
          l6sByL5[parentL5Id].push(task);
          return;
        }

        // Otherwise link to L4
        let parentL4Id = task.parent_l4_id || task.l4_id;

        // If no explicit parent, extract from L6 ID format
        if (!parentL4Id && task.id) {
          const l6Id = task.id;
          const match = l6Id.match(/T_L6_(M_G\d+_\d+_\d+)_/);
          if (match) {
            parentL4Id = `Q_L4_${match[1]}`;
          }
        }

        if (parentL4Id) {
          if (!l6sByL4[parentL4Id]) l6sByL4[parentL4Id] = [];
          l6sByL4[parentL4Id].push(task);
        } else {
          console.warn(`L6 task ${task.id} has no valid parent (L5 or L4)`);
        }
      });

      console.log(`[Graph] Found ${l6Tasks.length} L6 tasks in Step 9 output`);

      const l6Y = yOffset;

      // Create collapsible L6 group nodes for L5 parents
      Object.keys(l6sByL5).forEach((l5Id) => {
        const l5L6s = l6sByL5[l5Id];
        const parentL5Node = newNodes.find(n => n.id === `l5-${l5Id}`);

        if (!parentL5Node) {
          console.warn(`Parent L5 node not found for L6 tasks: ${l5Id}`);
          return;
        }

        const baseX = parentL5Node.position.x;
        const l6GroupId = `l6-group-l5-${l5Id}`;

        // Create collapsible L6 group node
        newNodes.push({
          id: l6GroupId,
          type: 'default',
          position: { x: baseX, y: l6Y },
          data: {
            label: `L6 (${l5L6s.length})`,
            fullData: {
              tasks: l5L6s,
              l5Id: l5Id
            },
            type: 'l6_group'
          },
          style: {
            background: 'linear-gradient(135deg, rgba(20,184,166,0.15), rgba(6,182,212,0.15))',
            color: 'hsl(var(--foreground))',
            border: '2px solid rgba(20,184,166,0.6)',
            borderRadius: '12px',
            padding: '10px',
            fontSize: '9px',
            fontWeight: '600',
            width: 180,
            minHeight: 60,
            boxShadow: '0 0 15px rgba(20,184,166,0.3)',
            cursor: 'pointer'
          }
        });

        // Create edge from L5 to L6 Group
        newEdges.push({
          id: `l5-${l5Id}-${l6GroupId}`,
          source: `l5-${l5Id}`,
          target: l6GroupId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: NODE_COLORS.l6, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l6 },
        });

        // Create individual L6 nodes (shown when expanded)
        if (!collapsedGroups.has(l6GroupId)) {
          const l6sPerRow = 2;
          l5L6s.forEach((task: any, idx: number) => {
            const nodeId = `l6-${task.id || idx}`;
            const row = Math.floor(idx / l6sPerRow);
            const col = idx % l6sPerRow;
            const xPos = baseX - 95 + col * 200;
            const yPos = l6Y + 110 + row * 90;

            newNodes.push({
              id: nodeId,
              type: 'default',
              position: { x: xPos, y: yPos },
              data: {
                label: `${task.title?.substring(0, 45)}${task.title && task.title.length > 45 ? '...' : ''}`,
                fullData: task,
                type: 'l6',
                parentGroup: l6GroupId
              },
              style: {
                background: 'linear-gradient(135deg, rgba(20,184,166,0.2), rgba(6,182,212,0.2))',
                color: 'hsl(var(--foreground))',
                border: '1.5px solid rgba(20,184,166,0.6)',
                borderRadius: '10px',
                padding: '6px',
                fontSize: '8px',
                fontWeight: '600',
                width: 170,
                boxShadow: '0 0 15px rgba(20,184,166,0.4)',
              },
            });

            // Create edge from L6 Group to individual L6
            newEdges.push({
              id: `${l6GroupId}-${nodeId}`,
              source: l6GroupId,
              target: nodeId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: NODE_COLORS.l6, strokeWidth: 0.5, strokeDasharray: '1,1' },
              markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l6 },
            });
          });
        }
      });

      // Create collapsible L6 group nodes for L4 parents
      Object.keys(l6sByL4).forEach((l4Id) => {
        const l4L6s = l6sByL4[l4Id];
        const parentL4Node = newNodes.find(n => n.id === `l4-${l4Id}`);

        if (!parentL4Node) {
          console.warn(`Parent L4 node not found for L6 tasks: ${l4Id}. Skipping ${l4L6s.length} L6 tasks.`);
          return;
        }

        const baseX = parentL4Node.position.x;
        const l6GroupId = `l6-group-l4-${l4Id}`;

        // Create collapsible L6 group node
        newNodes.push({
          id: l6GroupId,
          type: 'default',
          position: { x: baseX, y: l6Y },
          data: {
            label: `L6 (${l4L6s.length})`,
            fullData: {
              tasks: l4L6s,
              l4Id: l4Id
            },
            type: 'l6_group'
          },
          style: {
            background: 'linear-gradient(135deg, rgba(20,184,166,0.15), rgba(6,182,212,0.15))',
            color: 'hsl(var(--foreground))',
            border: '2px solid rgba(20,184,166,0.6)',
            borderRadius: '12px',
            padding: '10px',
            fontSize: '9px',
            fontWeight: '600',
            width: 180,
            minHeight: 60,
            boxShadow: '0 0 15px rgba(20,184,166,0.3)',
            cursor: 'pointer'
          }
        });

        // Create edge from L4 to L6 Group
        newEdges.push({
          id: `l4-${l4Id}-${l6GroupId}`,
          source: `l4-${l4Id}`,
          target: l6GroupId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: NODE_COLORS.l6, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l6 },
        });

        // Create individual L6 nodes (shown when expanded)
        if (!collapsedGroups.has(l6GroupId)) {
          const l6sPerRow = 2;
          l4L6s.forEach((task: any, idx: number) => {
            const nodeId = `l6-${task.id || idx}`;
            const row = Math.floor(idx / l6sPerRow);
            const col = idx % l6sPerRow;
            const xPos = baseX - 95 + col * 200;
            const yPos = l6Y + 110 + row * 90;

            newNodes.push({
              id: nodeId,
              type: 'default',
              position: { x: xPos, y: yPos },
              data: {
                label: `${task.title?.substring(0, 45)}${task.title && task.title.length > 45 ? '...' : ''}`,
                fullData: task,
                type: 'l6',
                parentGroup: l6GroupId
              },
              style: {
                background: 'linear-gradient(135deg, rgba(20,184,166,0.2), rgba(6,182,212,0.2))',
                color: 'hsl(var(--foreground))',
                border: '1.5px solid rgba(20,184,166,0.6)',
                borderRadius: '10px',
                padding: '6px',
                fontSize: '8px',
                fontWeight: '600',
                width: 170,
                boxShadow: '0 0 15px rgba(20,184,166,0.4)',
              },
            });

            // Create edge from L6 Group to individual L6
            newEdges.push({
              id: `${l6GroupId}-${nodeId}`,
              source: l6GroupId,
              target: nodeId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: NODE_COLORS.l6, strokeWidth: 0.5, strokeDasharray: '1,1' },
              markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l6 },
            });
          });
        }
      });

      // Adjust yOffset based on whether groups are expanded
      const hasExpandedGroups =
        Object.keys(l6sByL5).some(l5Id => !collapsedGroups.has(`l6-group-l5-${l5Id}`)) ||
        Object.keys(l6sByL4).some(l4Id => !collapsedGroups.has(`l6-group-l4-${l4Id}`));

      if (hasExpandedGroups) {
        const maxL6Rows = Math.max(
          ...Object.values(l6sByL5).map(l6s => Math.ceil(l6s.length / 2)),
          ...Object.values(l6sByL4).map(l6s => Math.ceil(l6s.length / 2)),
          1
        );
        yOffset += ySpacing + 110 + (maxL6Rows * 90) + clusterSpacing;
      } else {
        yOffset += ySpacing;
      }
    }

    // ====================================================================
    // NEW HIERARCHICAL SYSTEM: L3 -> IH/L4 -> L5 -> L6
    // ====================================================================

    // Collect all downstream data (using "New" suffix to avoid conflicts with old code)
    const step6New = steps.find(s => s.id === 6);
    const step7New = steps.find(s => s.id === 7);
    const step8New = steps.find(s => s.id === 8);
    const step9New = steps.find(s => s.id === 9);

    // Extract all L3 questions and per-goal analysis data
    let allL3Questions: any[] = [];
    let goalAnalyses: Record<string, any> = {};
    if (step6New?.output) {
      if (Array.isArray(step6New.output)) {
        allL3Questions = step6New.output;
      } else if (step6New.output.l3_questions) {
        allL3Questions = Array.isArray(step6New.output.l3_questions) ? step6New.output.l3_questions : [];
      } else if (step6New.output.seed_questions) {
        allL3Questions = Array.isArray(step6New.output.seed_questions) ? step6New.output.seed_questions : [];
      }
      if (step6New.output.goal_analyses) {
        goalAnalyses = step6New.output.goal_analyses;
      }
    }

    // Extract all IH
    let allIHs: any[] = [];
    if (step7New?.output) {
      if (Array.isArray(step7New.output)) {
        allIHs = step7New.output;
      } else if (step7New.output.instantiation_hypotheses) {
        allIHs = Array.isArray(step7New.output.instantiation_hypotheses) ? step7New.output.instantiation_hypotheses : [];
      }
    }

    // Extract all L4
    let allL4s: any[] = [];
    if (step8New?.output) {
      if (Array.isArray(step8New.output)) {
        allL4s = step8New.output;
      } else if (step8New.output.l4_questions) {
        allL4s = Array.isArray(step8New.output.l4_questions) ? step8New.output.l4_questions : [];
      } else if (step8New.output.child_nodes_L4) {
        allL4s = Array.isArray(step8New.output.child_nodes_L4) ? step8New.output.child_nodes_L4 : [];
      }
    }

    // Extract all L5
    let allL5s: any[] = [];
    if (step9New?.output?.l5_nodes) {
      allL5s = Array.isArray(step9New.output.l5_nodes) ? step9New.output.l5_nodes : [];
    }

    // Extract all L6
    let allL6s: any[] = [];
    if (step9New?.output) {
      if (Array.isArray(step9New.output)) {
        allL6s = step9New.output;
      } else if (step9New.output.l6_tasks) {
        allL6s = Array.isArray(step9New.output.l6_tasks) ? step9New.output.l6_tasks : [];
      }
    }

    console.log('[GraphViz] NEW HIERARCHY - Data collected:', {
      l3: allL3Questions.length,
      ih: allIHs.length,
      l4: allL4s.length,
      l5: allL5s.length,
      l6: allL6s.length,
    });

    // Group L3 by goals
    const l3sByGoal: Record<string, any[]> = {};
    allL3Questions.forEach(l3 => {
      if (!l3 || typeof l3 !== 'object') return;

      let parentGoalId = l3.target_goal_id;

      // Fallback to ID parsing if no explicit target_goal_id
      if (!parentGoalId) {
        const l3Id = l3.id || '';
        const match = l3Id.match(/Q_L3_(M_G\d+)_/);
        if (match) parentGoalId = match[1];
      }

      if (parentGoalId) {
        if (!l3sByGoal[parentGoalId]) l3sByGoal[parentGoalId] = [];
        l3sByGoal[parentGoalId].push(l3);
      }
    });

    // Build L3 hierarchy for each goal
    Object.keys(l3sByGoal).forEach(goalId => {
      const goalNode = newNodes.find(n => n.id === `goal-${goalId}`);
      if (!goalNode) {
        console.warn(`[GraphViz] Goal node not found for ${goalId}, skipping L3 hierarchy`);
        return;
      }

      const goalL3s = l3sByGoal[goalId];
      const goalX = goalNode.position.x;

      console.log(`[GraphViz] Building L3 hierarchy for goal ${goalId} at (${goalX}, ${yOffset})`);

      const finalY = buildL3Hierarchy(
        goalId,
        goalX,
        yOffset,
        goalL3s,
        allIHs,
        allL4s,
        allL5s,
        allL6s,
        {
          nodes: newNodes,
          edges: newEdges,
          collapsedGroups,
          config: DEFAULT_LAYOUT_CONFIG,
        },
        goalAnalyses[goalId]
      );

      // Update yOffset to be below this goal's hierarchy
      yOffset = Math.max(yOffset, finalY);
    });

    console.log(`[GraphViz] Final graph: ${newNodes.length} nodes, ${newEdges.length} edges`);

    return { nodes: newNodes, edges: newEdges };
  }, [steps, collapsedGroups]);

  useEffect(() => {
    setNodes(buildGraph.nodes);
    setEdges(buildGraph.edges);
  }, [buildGraph, setNodes, setEdges]);

  // Update node highlighting without rebuilding entire graph
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        className: highlightedNodeId === node.id ? 'highlighted-node' : '',
      }))
    );
  }, [highlightedNodeId, setNodes]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    // Handle group node collapse/expand
    if (node.data.type.endsWith('_group')) {
      setCollapsedGroups(prev => {
        const newSet = new Set(prev);
        if (newSet.has(node.id)) {
          newSet.delete(node.id);
        } else {
          newSet.add(node.id);
        }
        return newSet;
      });
      return;
    }

    setSelectedNode(node.data);
    if (onNodeHighlight) {
      onNodeHighlight(node.id, node.data.type);
    }

    // Toggle: if clicking the same node, clear highlighting
    if (highlightedNodeIdState === node.id) {
      setHighlightedNodeIdState(null);

      // Reset to original graph state
      setNodes(buildGraph.nodes);
      setEdges(buildGraph.edges);

      return;
    }
    
    // Set new highlighted node
    setHighlightedNodeIdState(node.id);
    
    // Find connected nodes and edges (including ancestors up the hierarchy)
    const connectedEdgeIds = new Set<string>();
    const connectedNodeIds = new Set<string>();
    connectedNodeIds.add(node.id);
    
    // Helper function to recursively find all ancestors
    const findAncestors = (nodeId: string) => {
      edges.forEach(edge => {
        // If this node is the target, add the source (parent) and recurse
        if (edge.target === nodeId && !connectedNodeIds.has(edge.source)) {
          connectedEdgeIds.add(edge.id);
          connectedNodeIds.add(edge.source);
          findAncestors(edge.source); // Recurse to find grandparents
        }
        // Also include direct connections (children)
        if (edge.source === nodeId) {
          connectedEdgeIds.add(edge.id);
          connectedNodeIds.add(edge.target);
        }
      });
    };
    
    // Start the recursive search
    findAncestors(node.id);
    
    // Highlight connected edges (green, thicker, animated)
    setEdges(edges.map(edge => ({
      ...edge,
      animated: connectedEdgeIds.has(edge.id),
      style: {
        ...edge.style,
        stroke: connectedEdgeIds.has(edge.id) ? '#22c55e' : edge.style?.stroke,
        strokeWidth: connectedEdgeIds.has(edge.id) ? 3 : 2,
      }
    })));
    
    // Highlight connected nodes (add glow effect)
    setNodes(nodes.map(n => ({
      ...n,
      style: {
        ...n.style,
        boxShadow: connectedNodeIds.has(n.id) 
          ? `0 0 30px rgba(34, 197, 94, 0.8), ${n.style?.boxShadow}` 
          : n.style?.boxShadow,
        border: connectedNodeIds.has(n.id)
          ? '3px solid #22c55e'
          : n.style?.border,
      }
    })));
  }, [onNodeHighlight, edges, nodes, setEdges, setNodes, highlightedNodeIdState, buildGraph]);

  const onNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node) => {
    if (onNodeHighlight) {
      onNodeHighlight(node.id, node.data.type);
    }
  }, [onNodeHighlight]);

  const onNodeMouseLeave = useCallback(() => {
    if (onNodeHighlight) {
      onNodeHighlight(null, null);
    }
  }, [onNodeHighlight]);

  const onPaneClick = useCallback(() => {
    // Clear highlighting when clicking on background
    setHighlightedNodeIdState(null);
    
    // Reset to original graph state
    setNodes(buildGraph.nodes);
    setEdges(buildGraph.edges);
    
    setSelectedNode(null);
  }, [buildGraph, setNodes, setEdges]);

  return (
    <div className="h-full w-full relative bg-background" style={{ transform: 'translateZ(0)' }}>
      <style>{`
        .react-flow__node {
          isolation: isolate;
          will-change: auto;
        }
        .react-flow__node.dragging {
          cursor: grabbing !important;
          z-index: 1000 !important;
          will-change: transform;
        }
        .react-flow__node.dragging * {
          pointer-events: none !important;
        }
        .react-flow__pane {
          cursor: default !important;
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onPaneClick={onPaneClick}
        fitView
        minZoom={0.1}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        selectNodesOnDrag={false}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        preventScrolling={true}
        attributionPosition="bottom-left"
        className="bg-background"
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        snapToGrid={false}
        snapGrid={[15, 15]}
      >
        <Background color="hsl(var(--muted-foreground) / 0.2)" />
        <Controls showZoom showFitView showInteractive className="bg-card border-border" />
        <MiniMap 
          nodeColor={(node) => {
            const type = node.data?.type;
            return NODE_COLORS[type as keyof typeof NODE_COLORS] || '#6366f1';
          }}
          maskColor="rgba(0, 0, 0, 0.6)"
          style={{ background: '#1f2937' }}
        />
      </ReactFlow>

      {/* Node Details Panel */}
      {selectedNode && (
        <div className="absolute top-4 right-4 bg-card/95 backdrop-blur-sm rounded-lg shadow-xl p-4 max-w-lg max-h-[600px] overflow-auto border border-border/50">
          <div className="flex justify-between items-start mb-3">
            <h3 className="font-bold text-lg" style={{ color: NODE_COLORS[selectedNode.type as keyof typeof NODE_COLORS] }}>
              {selectedNode.label}
            </h3>
            <button
              onClick={() => {
                setSelectedNode(null);
                // Clear highlighting when closing the panel
                setHighlightedNodeIdState(null);
                setNodes(buildGraph.nodes);
                setEdges(buildGraph.edges);
              }}
              className="text-gray-500 hover:text-gray-700 text-xl leading-none"
            >
              ×
            </button>
          </div>
          <div className="text-sm space-y-2">
            {selectedNode.type === 'q0' && selectedNode.fullData && (
              <div className="space-y-2">
                <div className="bg-blue-500/10 border border-blue-500/30 p-2 rounded">
                  <p className="text-xs font-semibold text-blue-400">Master Question</p>
                  <p className="text-xs mt-1 text-foreground">{selectedNode.fullData.Q0}</p>
                </div>
              </div>
            )}
            {selectedNode.type !== 'q0' && selectedNode.fullData && (
              <div className="max-h-[500px] overflow-auto">
                {renderNodeDetails(selectedNode.type, selectedNode.fullData, bridgeLexicon)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-card/95 backdrop-blur-sm rounded-lg shadow-lg p-3 text-xs border border-border/50">
        <div className="font-bold mb-2">Legend</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ background: NODE_COLORS.q0 }}></div>
            <span>Q₀ Master Question</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ background: NODE_COLORS.goal }}></div>
            <span>Goal Pillars</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ background: NODE_COLORS.ra }}></div>
            <span>Requirement Atoms</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ background: NODE_COLORS.scientific }}></div>
            <span>Scientific Pillars</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ background: NODE_COLORS.l3 }}></div>
            <span>L3 Questions</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded" style={{ background: NODE_COLORS.l6 }}></div>
            <span>L6 Tasks</span>
          </div>
        </div>
      </div>
    </div>
  );
};

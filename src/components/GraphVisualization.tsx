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
  scientific: '#06b6d4',   // Cyan - Scientific Pillars
  edge: '#6366f1',         // Indigo - Matching Edges
  l3: '#ef4444',           // Red - L3 Questions
  ih: '#f97316',           // Orange - Instantiation Hypotheses
  l4: '#84cc16',           // Lime - L4 Questions
  l5: '#a3e635',           // Light Lime - L5 Mechanistic Drills
  l6: '#14b8a6',           // Teal - L6 Tasks
};

export const GraphVisualization: React.FC<GraphVisualizationProps> = ({ steps, highlightedNodeId, onNodeHighlight }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [highlightedNodeIdState, setHighlightedNodeIdState] = useState<string | null>(null);

  const buildGraph = useMemo(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    let yOffset = 0;
    const xSpacing = 500; // Increased horizontal spacing to prevent overlap
    const ySpacing = 400; // Increased vertical spacing between major levels
    const clusterSpacing = 200; // Extra space between clusters

    // Step 1: Q0 (Master Question)
    const step1 = steps.find(s => s.id === 1);
    if (step1?.output) {
      // Parse Q0 text from output
      let q0Text = 'Master Question';
      if (typeof step1.output === 'object') {
        q0Text = step1.output.Q0 || step1.output.q0 || step1.output.question || 'Master Question';
      } else if (typeof step1.output === 'string') {
        q0Text = step1.output;
      }
      
      newNodes.push({
        id: 'q0',
        type: 'default',
        position: { x: 400, y: yOffset },
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
      yOffset += ySpacing;
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

    // Step 3: Requirement Atoms (organized by parent goal) - all at same Y level
    const step3 = steps.find(s => s.id === 3);
    if (step3?.output && typeof step3.output === 'object') {
      const rasByGoal = step3.output;
      const raY = yOffset; // All RAs at same level
      let totalRaCount = 0;
      
      // Process each goal's RAs
      Object.keys(rasByGoal).forEach((goalId) => {
        const ras = Array.isArray(rasByGoal[goalId]) ? rasByGoal[goalId] : [];
        const parentGoalNode = `goal-${goalId}`;
        
        // Find parent goal position to align RAs below it
        const parentNode = newNodes.find(n => n.id === parentGoalNode);
        const baseX = parentNode ? parentNode.position.x : 100 + (totalRaCount * 200);
        
        // Limit to 3 RAs per goal for clarity
        ras.slice(0, 3).forEach((ra: any, raIdx: number) => {
          if (!ra || typeof ra !== 'object') return;
          
          const nodeId = `ra-${ra.ra_id || `${goalId}-${raIdx}`}`;
          const xPos = baseX + (raIdx - 1) * 320; // Increased spacing to prevent overlap
          
          newNodes.push({
            id: nodeId,
            type: 'default',
            position: { x: xPos, y: raY },
            data: { 
              label: `${ra.ra_id || 'RA'}: ${(ra.atom_title || ra.title || 'Untitled').substring(0, 80)}${(ra.atom_title || ra.title || '').length > 80 ? '...' : ''}`,
              fullData: ra,
              type: 'ra',
              parentGoalId: goalId
            },
            style: {
              background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(34,197,94,0.2))',
              color: 'hsl(var(--foreground))',
              border: '2px solid rgba(16,185,129,0.6)',
              borderRadius: '10px',
              padding: '10px',
              fontSize: '11px',
              fontWeight: '600',
              width: 280,
              boxShadow: '0 0 18px rgba(16,185,129,0.4)',
            },
            });

          // Connect to parent goal
          if (parentNode) {
            newEdges.push({
              id: `${parentGoalNode}-${nodeId}`,
              source: parentGoalNode,
              target: nodeId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: NODE_COLORS.ra, strokeWidth: 1.5, strokeDasharray: '5,5' },
              markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.ra },
            });
          }
          
          // Connect SPVs to RAs instead of Goals if RAs exist
          const spvNodes = newNodes.filter(n => n.data.type === 'spv');
          spvNodes.forEach(spvNode => {
            // Remove SPV->Goal edge if it exists
            const oldEdgeId = `${spvNode.id}-${parentGoalNode}`;
            const edgeIndex = newEdges.findIndex(e => e.id === oldEdgeId);
            if (edgeIndex !== -1) {
              newEdges.splice(edgeIndex, 1);
              
              // Add SPV->RA edge instead
              newEdges.push({
                id: `${spvNode.id}-${nodeId}`,
                source: spvNode.id,
                target: nodeId,
                type: 'smoothstep',
                animated: true,
                style: { stroke: NODE_COLORS.spv, strokeWidth: 1, strokeDasharray: '5,5' },
                markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.spv },
              });
            }
          });
        });
        
        totalRaCount += Math.min(ras.length, 3);
      });
      
      yOffset += ySpacing;
    }

    // Step 4: Domain-Based Scientific Knowledge (3-Phase Output)
    const step4 = steps.find(s => s.id === 4);
    if (step4?.output) {
      const sciY = yOffset;
      
      Object.entries(step4.output).forEach(([goalId, goalData]: [string, any]) => {
        const domains = goalData?.domain_mapping?.research_domains || [];
        const sNodes = goalData?.deduplicated_s_nodes || [];
        
        // Group S-nodes by domain
        const sNodesByDomain: Record<string, any[]> = {};
        sNodes.forEach((sNode: any) => {
          const domainId = sNode.domain_id || 'unknown';
          if (!sNodesByDomain[domainId]) {
            sNodesByDomain[domainId] = [];
          }
          sNodesByDomain[domainId].push(sNode);
        });
        
        // Create domain group nodes (collapsible)
        domains.forEach((domain: any, domainIdx: number) => {
          const domainSNodes = sNodesByDomain[domain.domain_id] || [];
          const topNodes = domainSNodes
            .sort((a, b) => (b.strategic_value_score || 0) - (a.strategic_value_score || 0))
            .slice(0, 5);
          
          const xPos = 100 + domainIdx * 450;
          
          // Create collapsible domain group node
          newNodes.push({
            id: `domain-${domain.domain_id}`,
            type: 'default',
            position: { x: xPos, y: sciY },
            data: {
              label: `${domain.domain_name}\n(${domainSNodes.length} interventions)`,
              fullData: {
                ...domain,
                s_node_count: domainSNodes.length,
                top_nodes: topNodes,
                all_nodes: domainSNodes,
                relevance: domain.relevance_to_goal
              },
              type: 'domain_group'
            },
            style: {
              background: domain.relevance_to_goal === 'HIGH' 
                ? 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(22,163,74,0.15))'
                : domain.relevance_to_goal === 'MED'
                ? 'linear-gradient(135deg, rgba(251,191,36,0.15), rgba(245,158,11,0.15))'
                : 'linear-gradient(135deg, rgba(148,163,184,0.15), rgba(100,116,139,0.15))',
              color: 'hsl(var(--foreground))',
              border: domain.relevance_to_goal === 'HIGH'
                ? '2px solid rgba(34,197,94,0.6)'
                : domain.relevance_to_goal === 'MED'
                ? '2px solid rgba(251,191,36,0.6)'
                : '2px solid rgba(148,163,184,0.6)',
              borderRadius: '12px',
              padding: '16px',
              fontSize: '11px',
              fontWeight: '600',
              width: 350,
              minHeight: 120,
              boxShadow: '0 0 20px rgba(6,182,212,0.3)',
              cursor: 'pointer'
            }
          });
          
          // Create edge from Goal to Domain Group
          newEdges.push({
            id: `g-domain-${goalId}-${domain.domain_id}`,
            source: `goal-${goalId}`,
            target: `domain-${domain.domain_id}`,
            type: 'smoothstep',
            animated: false,
            label: `${domain.relevance_to_goal}`,
            style: {
              stroke: domain.relevance_to_goal === 'HIGH' ? '#22c55e' : domain.relevance_to_goal === 'MED' ? '#fbbf24' : '#94a3b8',
              strokeWidth: domain.relevance_to_goal === 'HIGH' ? 3 : 2,
              strokeDasharray: domain.relevance_to_goal === 'LOW' ? '5,5' : '0'
            },
            markerEnd: { 
              type: MarkerType.ArrowClosed, 
              color: domain.relevance_to_goal === 'HIGH' ? '#22c55e' : domain.relevance_to_goal === 'MED' ? '#fbbf24' : '#94a3b8'
            },
            data: {
              type: 'goal_domain_edge',
              relevance: domain.relevance_to_goal
            }
          });
          
          // Create individual S-node connections (hidden by default, shown on expand)
          domainSNodes.forEach((sNode: any, sIdx: number) => {
            const sNodeId = `s-${sNode.id}`;
            
            // Store S-node data but don't render as separate node (part of domain group)
            // Create edge from domain to Goal (will be classified by Step 5)
            newEdges.push({
              id: `gs-${goalId}-${sNode.id}`,
              source: `domain-${domain.domain_id}`,
              target: `goal-${goalId}`,
              type: 'smoothstep',
              animated: false,
              label: '',
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
                hidden: true // Hidden until Step 5 classifies
              }
            });
          });
        });
      });
      
      yOffset += ySpacing;
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

    // Step 6: L3 Questions - Hierarchical clustering under Goals
    const step6 = steps.find(s => s.id === 6);
    if (step6?.output) {
      let l3Questions: any[] = [];
      
      if (Array.isArray(step6.output)) {
        l3Questions = step6.output;
      } else if (step6.output && typeof step6.output === 'object') {
        if (step6.output.l3_questions) {
          l3Questions = Array.isArray(step6.output.l3_questions) ? step6.output.l3_questions : [];
        } else if (step6.output.seed_questions) {
          l3Questions = Array.isArray(step6.output.seed_questions) ? step6.output.seed_questions : [];
        } else {
          l3Questions = Object.values(step6.output).filter(val => Array.isArray(val)).flat();
        }
      }
      
      // Group L3s by their parent Goal
      const l3sByGoal: Record<string, any[]> = {};
      
      l3Questions.forEach((q: any) => {
        if (!q || typeof q !== 'object') return;
        const l3Id = q.id || '';
        let parentGoalId = null;
        
        // Try new format first: Q_L3_M_G1_1, Q_L3_M_G2_1
        const newFormatMatch = l3Id.match(/Q_L3_(M_G\d+)_/);
        if (newFormatMatch) {
          parentGoalId = newFormatMatch[1];
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
        }
      });
      
      const l3Y = yOffset;
      
      // For each Goal, place its L3s in a cluster below it
      Object.keys(l3sByGoal).forEach((goalId) => {
        const goalL3s = l3sByGoal[goalId];
        const parentGoalNode = newNodes.find(n => n.id === `goal-${goalId}`);
        
        if (!parentGoalNode) return;
        
        // Position L3s in a compact cluster under the parent Goal
        const baseX = parentGoalNode.position.x;
        const l3sPerRow = 3; // 3 L3s per row for compact clustering
        
        goalL3s.slice(0, 5).forEach((q: any, idx: number) => {
          const nodeId = `l3-${q.id || idx}`;
          
          // Arrange in compact grid under parent
          const row = Math.floor(idx / l3sPerRow);
          const col = idx % l3sPerRow;
          const xPos = baseX - 200 + col * 360; // More breathing room
          const yPos = l3Y + row * 150; // More vertical space
        
        newNodes.push({
          id: nodeId,
          type: 'default',
          position: { x: xPos, y: yPos },
          data: { 
            label: `L3: ${q.text?.substring(0, 100)}${q.text && q.text.length > 100 ? '...' : ''}`,
            fullData: q,
            type: 'l3'
          },
          style: {
            background: 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(220,38,38,0.2))',
            color: 'hsl(var(--foreground))',
            border: '2px solid rgba(239,68,68,0.6)',
            borderRadius: '12px',
            padding: '12px',
            fontSize: '11px',
            fontWeight: '600',
            width: 320,
            boxShadow: '0 0 20px rgba(239,68,68,0.4)',
          },
        });
        
        // Create edge to parent Goal
        newEdges.push({
          id: `goal-${goalId}-${nodeId}`,
          source: `goal-${goalId}`,
          target: nodeId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: NODE_COLORS.l3, strokeWidth: 1.5, strokeDasharray: '3,3' },
          markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l3 },
        });
        });
      });
      
      // Adjust yOffset with extra cluster spacing
      const maxL3Rows = Math.max(...Object.values(l3sByGoal).map(l3s => Math.ceil(l3s.length / 3)), 1);
      yOffset += ySpacing + (maxL3Rows - 1) * 120 + clusterSpacing;
    }

    // Step 7: Instantiation Hypotheses - Hierarchical clustering under L3s
    const step7 = steps.find(s => s.id === 7);
    if (step7?.output) {
      let ihs: any[] = [];
      
      if (Array.isArray(step7.output)) {
        ihs = step7.output; // Legacy format (plain array)
      } else if (step7.output && typeof step7.output === 'object') {
        // New format with instantiation_hypotheses key
        if (step7.output.instantiation_hypotheses) {
          ihs = Array.isArray(step7.output.instantiation_hypotheses) ? step7.output.instantiation_hypotheses : [];
        } else {
          // Fallback: try to find arrays in the object
          ihs = Object.values(step7.output).filter(val => Array.isArray(val)).flat();
        }
      }
      
      console.log(`[Graph] Found ${ihs.length} IH nodes in Step 7 output`);
      if (ihs.length > 0) {
        console.log(`[Graph] IH IDs:`, ihs.map(ih => ih.ih_id));
      }
      
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
      
      // For each L3, place its IHs in a cluster below it
      Object.keys(ihsByL3).forEach((l3Id) => {
        const l3IHs = ihsByL3[l3Id];
        const parentL3Node = newNodes.find(n => n.id === `l3-${l3Id}`);
        
        if (!parentL3Node) {
          console.warn(`Parent L3 node not found for IHs: ${l3Id}. Skipping ${l3IHs.length} IH nodes.`);
          console.warn(`Available L3 nodes:`, newNodes.filter(n => n.id.startsWith('l3-')).map(n => n.id));
          return;
        }
        
        // Position IHs in a cluster under the parent L3
        const baseX = parentL3Node.position.x;
        const ihsPerRow = 2; // 2 IHs per row
        
        l3IHs.forEach((ih: any, idx: number) => {
          const nodeId = `ih-${ih.ih_id || idx}`;
          
          // Arrange in grid under parent with more spacing
          const row = Math.floor(idx / ihsPerRow);
          const col = idx % ihsPerRow;
          const xPos = baseX - 140 + col * 320; // Increased horizontal spacing
          const yPos = ihY + row * 160; // Increased vertical spacing
          
          newNodes.push({
            id: nodeId,
            type: 'default',
            position: { x: xPos, y: yPos },
            data: { 
              label: `IH: ${ih.process_hypothesis?.substring(0, 80)}${ih.process_hypothesis && ih.process_hypothesis.length > 80 ? '...' : ''}`,
              fullData: ih,
              type: 'ih'
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
          
          // Create edge to parent L3
          newEdges.push({
            id: `l3-${l3Id}-${nodeId}`,
            source: `l3-${l3Id}`,
            target: nodeId,
            type: 'smoothstep',
            animated: true,
            style: { stroke: NODE_COLORS.ih, strokeWidth: 1, strokeDasharray: '2,2' },
            markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.ih },
          });
        });
      });
      
      // Adjust yOffset with extra cluster spacing
      const maxIHRows = Math.max(...Object.values(ihsByL3).map(ihs => Math.ceil(ihs.length / 2)), 1);
      yOffset += ySpacing + (maxIHRows - 1) * 160 + clusterSpacing; // Updated to match new IH spacing
    }

    // Step 8: L4 Questions - Hierarchical clustering under IH nodes
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
      const l4sByL3: Record<string, any[]> = {}; // L4s linked directly to L3
      
      l4Questions.forEach((q: any) => {
        if (!q || typeof q !== 'object') return;
        
        // Try to link to IH first (if distinguishes_ih_ids exists)
        const parentIHIds = q.distinguishes_ih_ids || [];
        if (parentIHIds.length > 0) {
          const parentIHId = parentIHIds[0];
          // Check if parent IH exists in the graph
          const parentExists = newNodes.some(n => n.id === `ih-${parentIHId}`);
          if (parentExists) {
            if (!l4sByIH[parentIHId]) l4sByIH[parentIHId] = [];
            l4sByIH[parentIHId].push(q);
            return; // Successfully linked to IH
          }
        }
        
        // If no IH link, try to extract parent L3 from L4 ID
        // Format: Q_L4_M_G2_1_01 -> parent L3 is Q_L3_M_G2_1
        const l4Id = q.id || '';
        const l3Match = l4Id.match(/Q_L4_(M_G\d+_\d+)_/);
        if (l3Match) {
          const parentL3Id = `Q_L3_${l3Match[1]}`;
          // Check if parent L3 exists
          const parentL3Exists = newNodes.some(n => n.id === `l3-${parentL3Id}`);
          if (parentL3Exists) {
            if (!l4sByL3[parentL3Id]) l4sByL3[parentL3Id] = [];
            l4sByL3[parentL3Id].push(q);
            return; // Successfully linked to L3
          }
        }
        
        // If we get here, couldn't link to anything - will be handled as orphan
        console.warn(`L4 question ${q.id} has no valid parent (IH or L3)`);
      });
      
      const l4Y = yOffset;
      
      // For each IH, place its L4s in a cluster below it
      Object.keys(l4sByIH).forEach((ihId) => {
        const ihL4s = l4sByIH[ihId];
        const parentIHNode = newNodes.find(n => n.id === `ih-${ihId}`);
        
        if (!parentIHNode) return;
        
        // Position L4s in a cluster under the parent IH
        const baseX = parentIHNode.position.x;
        const l4sPerRow = 2;
        
        ihL4s.forEach((q: any, idx: number) => {
          const nodeId = `l4-${q.id || idx}`;
          
          const row = Math.floor(idx / l4sPerRow);
          const col = idx % l4sPerRow;
          const xPos = baseX - 300 + col * 650; // Dramatically wider horizontal spacing
          const yPos = l4Y + row * 130; // Reduced vertical spacing within layer
          
          newNodes.push({
            id: nodeId,
            type: 'default',
            position: { x: xPos, y: yPos },
            data: { 
              label: `L4: ${q.text?.substring(0, 60)}${q.text && q.text.length > 60 ? '...' : ''}`,
              fullData: q,
              type: 'l4'
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
          
          // Create edge to parent IH
          newEdges.push({
            id: `ih-${ihId}-${nodeId}`,
            source: `ih-${ihId}`,
            target: nodeId,
            type: 'smoothstep',
            animated: true,
            style: { stroke: NODE_COLORS.l4, strokeWidth: 0.5, strokeDasharray: '1,1' },
            markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l4 },
          });
        });
      });
      
      // For each L3, place L4s that link directly to it (no IH parent)
      Object.keys(l4sByL3).forEach((l3Id) => {
        const l3L4s = l4sByL3[l3Id];
        const parentL3Node = newNodes.find(n => n.id === `l3-${l3Id}`);
        
        if (!parentL3Node) return;
        
        // Position L4s in a cluster under the parent L3
        const baseX = parentL3Node.position.x;
        const l4sPerRow = 2;
        
        l3L4s.forEach((q: any, idx: number) => {
          const nodeId = `l4-${q.id || idx}`;
          
          const row = Math.floor(idx / l4sPerRow);
          const col = idx % l4sPerRow;
          const xPos = baseX - 300 + col * 650; // Dramatically wider horizontal spacing
          const yPos = l4Y + row * 130; // Reduced vertical spacing within layer
          
          newNodes.push({
            id: nodeId,
            type: 'default',
            position: { x: xPos, y: yPos },
            data: { 
              label: `L4: ${q.text?.substring(0, 60)}${q.text && q.text.length > 60 ? '...' : ''}`,
              fullData: q,
              type: 'l4'
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
          
          // Create edge to parent L3 (dashed to indicate direct link, skipping IH)
          newEdges.push({
            id: `l3-${l3Id}-${nodeId}`,
            source: `l3-${l3Id}`,
            target: nodeId,
            type: 'smoothstep',
            animated: true,
            style: { stroke: NODE_COLORS.l4, strokeWidth: 0.5, strokeDasharray: '3,3' },
            markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l4 },
          });
        });
      });
      
      // Adjust yOffset with extra cluster spacing
      const allL4Rows = Math.max(
        ...Object.values(l4sByIH).map(l4s => Math.ceil(l4s.length / 2)),
        ...Object.values(l4sByL3).map(l4s => Math.ceil(l4s.length / 2)),
        1
      );
      yOffset += ySpacing + (allL4Rows - 1) * 130 + clusterSpacing; // Reduced vertical spacing within layer
    }

    // Step 9 Part 1: L5 Mechanistic Drills - Hierarchical clustering under L4 nodes
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
        
        // For each L4, place its L5s in a cluster below it
        Object.keys(l5sByL4).forEach((l4Id) => {
          const l4L5s = l5sByL4[l4Id];
          const parentL4Node = newNodes.find(n => n.id === `l4-${l4Id}`);
          
          if (!parentL4Node) {
            console.warn(`Parent L4 node not found for L5 nodes: ${l4Id}`);
            return;
          }
          
          // Position L5s in a cluster under the parent L4
          const baseX = parentL4Node.position.x;
          const l5sPerRow = 2;
          
          l4L5s.forEach((l5: any, idx: number) => {
            const nodeId = `l5-${l5.id || idx}`;
            
            const row = Math.floor(idx / l5sPerRow);
            const col = idx % l5sPerRow;
            const xPos = baseX - 290 + col * 620; // Dramatically wider horizontal spacing
            const yPos = l5Y + row * 125; // Reduced vertical spacing within layer
            
            newNodes.push({
              id: nodeId,
              type: 'default',
              position: { x: xPos, y: yPos },
              data: { 
                label: `L5: ${l5.text?.substring(0, 55)}${l5.text && l5.text.length > 55 ? '...' : ''}`,
                fullData: l5,
                type: 'l5'
              },
              style: {
                background: 'linear-gradient(135deg, rgba(163,230,53,0.2), rgba(132,204,22,0.2))',
                color: 'hsl(var(--foreground))',
                border: '1.5px solid rgba(163,230,53,0.6)',
                borderRadius: '10px',
                padding: '7px',
                fontSize: '9px',
                fontWeight: '600',
                width: 210,
                boxShadow: '0 0 15px rgba(163,230,53,0.4)',
              },
            });
            
            // Create edge to parent L4
            newEdges.push({
              id: `l4-${l4Id}-${nodeId}`,
              source: `l4-${l4Id}`,
              target: nodeId,
              type: 'smoothstep',
              animated: true,
              style: { stroke: NODE_COLORS.l5, strokeWidth: 0.5, strokeDasharray: '1,1' },
              markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l5 },
            });
          });
        });
        
        // Adjust yOffset
        const maxL5Rows = Math.max(...Object.values(l5sByL4).map(l5s => Math.ceil(l5s.length / 2)), 1);
        yOffset += ySpacing + (maxL5Rows - 1) * 125 + clusterSpacing; // Reduced vertical spacing within layer
      }
    }

    // Step 9 Part 2: L6 Tasks - Hierarchical clustering under L5 or L4 nodes
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
        // Format: T_L6_M_G2_1_01_01 -> parent L4 is Q_L4_M_G2_1_01
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
      console.log(`[Graph] L6 tasks grouped by L5:`, Object.keys(l6sByL5).map(l5Id => `${l5Id} (${l6sByL5[l5Id].length} tasks)`));
      console.log(`[Graph] L6 tasks grouped by L4:`, Object.keys(l6sByL4).map(l4Id => `${l4Id} (${l6sByL4[l4Id].length} tasks)`));
      
      const l6Y = yOffset;
      
      // For each L5, place its L6s in a cluster below it
      Object.keys(l6sByL5).forEach((l5Id) => {
        const l5L6s = l6sByL5[l5Id];
        const parentL5Node = newNodes.find(n => n.id === `l5-${l5Id}`);
        
        if (!parentL5Node) {
          console.warn(`Parent L5 node not found for L6 tasks: ${l5Id}`);
          return;
        }
        
        // Position L6s in a cluster under the parent L5
        const baseX = parentL5Node.position.x;
        const l6sPerRow = 2;
        
        l5L6s.forEach((task: any, idx: number) => {
          const nodeId = `l6-${task.id || idx}`;
          
          const row = Math.floor(idx / l6sPerRow);
          const col = idx % l6sPerRow;
          const xPos = baseX - 280 + col * 600; // Dramatically wider horizontal spacing
          const yPos = l6Y + row * 120; // Reduced vertical spacing within layer
        
          newNodes.push({
            id: nodeId,
            type: 'default',
            position: { x: xPos, y: yPos },
            data: { 
              label: `L6: ${task.title?.substring(0, 50)}${task.title && task.title.length > 50 ? '...' : ''}`,
              fullData: task,
              type: 'l6'
            },
            style: {
              background: 'linear-gradient(135deg, rgba(20,184,166,0.2), rgba(6,182,212,0.2))',
              color: 'hsl(var(--foreground))',
              border: '1.5px solid rgba(20,184,166,0.6)',
              borderRadius: '10px',
              padding: '6px',
              fontSize: '8px',
              fontWeight: '600',
              width: 190,
              boxShadow: '0 0 15px rgba(20,184,166,0.4)',
            },
          });
          
          // Create edge to parent L5
          newEdges.push({
            id: `l5-${l5Id}-${nodeId}`,
            source: `l5-${l5Id}`,
            target: nodeId,
            type: 'smoothstep',
            animated: true,
            style: { stroke: NODE_COLORS.l6, strokeWidth: 0.5, strokeDasharray: '1,1' },
            markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l6 },
          });
        });
      });
      
      // For each L4, place its L6s in a cluster below it (when no L5 parent)
      Object.keys(l6sByL4).forEach((l4Id) => {
        const l4L6s = l6sByL4[l4Id];
        const parentL4Node = newNodes.find(n => n.id === `l4-${l4Id}`);
        
        if (!parentL4Node) {
          console.warn(`Parent L4 node not found for L6 tasks: ${l4Id}. Skipping ${l4L6s.length} L6 tasks.`);
          console.warn(`Available L4 nodes:`, newNodes.filter(n => n.id.startsWith('l4-')).map(n => n.id));
          return;
        }
        
        // Position L6s in a cluster under the parent L4
        const baseX = parentL4Node.position.x;
        const l6sPerRow = 2;
        
        l4L6s.forEach((task: any, idx: number) => {
          const nodeId = `l6-${task.id || idx}`;
          
          const row = Math.floor(idx / l6sPerRow);
          const col = idx % l6sPerRow;
          const xPos = baseX - 280 + col * 600; // Dramatically wider horizontal spacing
          const yPos = l6Y + row * 120; // Reduced vertical spacing within layer
        
          newNodes.push({
            id: nodeId,
            type: 'default',
            position: { x: xPos, y: yPos },
            data: { 
              label: `L6: ${task.title?.substring(0, 50)}${task.title && task.title.length > 50 ? '...' : ''}`,
              fullData: task,
              type: 'l6'
            },
            style: {
              background: 'linear-gradient(135deg, rgba(20,184,166,0.2), rgba(6,182,212,0.2))',
              color: 'hsl(var(--foreground))',
              border: '1.5px solid rgba(20,184,166,0.6)',
              borderRadius: '10px',
              padding: '6px',
              fontSize: '9px',
              fontWeight: '600',
              width: 190,
              boxShadow: '0 0 15px rgba(20,184,166,0.4)',
            },
            });
          
          // Create edge to parent L4
          newEdges.push({
            id: `l4-${l4Id}-${nodeId}`,
            source: `l4-${l4Id}`,
            target: nodeId,
            type: 'smoothstep',
            animated: true,
            style: { stroke: NODE_COLORS.l6, strokeWidth: 0.5, strokeDasharray: '1,1' },
            markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l6 },
          });
        });
      });
      
      // Adjust yOffset with extra cluster spacing
      const maxL6Rows = Math.max(
        ...Object.values(l6sByL5).map(l6s => Math.ceil(l6s.length / 2)),
        ...Object.values(l6sByL4).map(l6s => Math.ceil(l6s.length / 2)),
        1
      );
      yOffset += ySpacing + (maxL6Rows - 1) * 120 + clusterSpacing; // Reduced vertical spacing within layer
    }

    return { nodes: newNodes, edges: newEdges };
  }, [steps]);

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
                {renderNodeDetails(selectedNode.type, selectedNode.fullData)}
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

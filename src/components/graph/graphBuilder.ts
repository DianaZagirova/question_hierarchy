import { Node, Edge, MarkerType } from 'reactflow';
import { PipelineStep } from '@/types';
import { getNodeDimensions } from './layoutUtils';

export interface GraphData {
  nodes: Node[];
  edges: Edge[];
}

export interface ClusterState {
  [clusterId: string]: boolean; // true = expanded, false = collapsed
}

/**
 * Build graph data from pipeline steps with clustering support
 */
export const buildGraphFromSteps = (
  steps: PipelineStep[],
  clusterState: ClusterState
): GraphData => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Step 1: Q₀ (Master Question)
  const step1 = steps.find(s => s.id === 1);
  if (step1?.output) {
    const q0Text = extractQ0Text(step1.output);
    const dims = getNodeDimensions('master');

    // Trim Q₀ text to prevent overlap
    const displayText = q0Text.length > 100 ? q0Text.substring(0, 100) + '...' : q0Text;

    nodes.push({
      id: 'q0',
      type: 'master',
      position: { x: 0, y: 0 },
      data: {
        label: displayText,
        fullText: q0Text, // Store full text for details panel
        type: 'q0',
        fullData: step1.output,
      },
      width: dims.width,
      height: dims.height,
    });
  }

  // Step 2: Goal Pillars and Bridge Lexicon
  const step2 = steps.find(s => s.id === 2);
  if (step2?.output) {
    const goals = step2.output.goals || step2.output.Goal_Pillars || step2.output.goal_pillars || [];
    const bridgeLexicon = step2.output.bridge_lexicon || step2.output.Bridge_Lexicon || {};

    // Add Goal nodes
    goals.forEach((goal: any) => {
      const dims = getNodeDimensions('goal');
      const goalTitle = goal.title || 'Untitled Goal';
      const displayTitle = goalTitle.length > 50 ? goalTitle.substring(0, 50) + '...' : goalTitle;

      nodes.push({
        id: `goal-${goal.id}`,
        type: 'standard',
        position: { x: 0, y: 0 },
        data: {
          label: `${goal.id}: ${displayTitle}`,
          fullText: `${goal.id}: ${goalTitle}`, // Full text for details
          subtitle: goal.catastrophe_primary?.substring(0, 50),
          type: 'goal',
          fullData: goal,
          metrics: [
            { label: 'FCCs', value: goal.bridge_tags?.failure_channels?.length || 0 },
            { label: 'SPVs', value: goal.bridge_tags?.system_properties_required?.length || 0 },
          ],
        },
        width: dims.width,
        height: dims.height,
      });

      // Edge from Q₀ to Goal
      if (step1?.output) {
        edges.push({
          id: `q0-goal-${goal.id}`,
          source: 'q0',
          target: `goal-${goal.id}`,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#8b5cf6', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' },
        });
      }
    });

    // Create SPV clusters under each Goal (allow duplicates - same SPV can appear under multiple Goals)
    const allSPVs = bridgeLexicon.system_properties || bridgeLexicon.System_Properties || [];

    goals.forEach((goal: any) => {
      const goalSPVs = goal.bridge_tags?.system_properties_required || [];

      if (goalSPVs.length > 0) {
        // Get full SPV data for this goal
        const goalSPVData = goalSPVs.map((sp: any) => {
          const spvDef = allSPVs.find((spv: any) => (spv.id || spv.ID) === sp.spv_id);
          return {
            ...sp,
            ...spvDef,
            importance: sp.importance || 'MEDIUM'
          };
        }).filter((spv: any) => spv.id || spv.ID); // Only include SPVs with valid data

        const clusterId = `spv-cluster-${goal.id}`;
        const isExpanded = clusterState[clusterId] ?? false;
        const dims = getNodeDimensions('cluster');

        if (isExpanded) {
          // Show individual SPV nodes under this Goal
          goalSPVData.forEach((spv: any) => {
            const spvId = spv.id || spv.ID;
            const spvName = spv.name || spv.Name || 'SPV';
            const displayName = spvName.length > 30 ? spvName.substring(0, 30) + '...' : spvName;
            const spvDims = getNodeDimensions('spv');

            nodes.push({
              id: `spv-${goal.id}-${spvId}`, // Unique ID per goal to allow duplicates
              type: 'standard',
              position: { x: 0, y: 0 },
              data: {
                label: `${spvId}: ${displayName}`,
                fullText: `${spvId}: ${spvName}`,
                subtitle: `${spv.importance} importance`,
                type: 'spv',
                fullData: spv,
                parentGoalId: goal.id,
              },
              width: spvDims.width,
              height: spvDims.height,
            });

            // Edge from SPV cluster to individual SPV
            edges.push({
              id: `${clusterId}-spv-${spvId}`,
              source: clusterId,
              target: `spv-${goal.id}-${spvId}`,
              type: 'smoothstep',
              animated: false,
              style: { stroke: '#f59e0b', strokeWidth: 1.5 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
            });
          });
        }

        // Always show SPV cluster node
        nodes.push({
          id: clusterId,
          type: 'cluster',
          position: { x: 0, y: 0 },
          data: {
            title: `SPVs for ${goal.id}`,
            description: `${goalSPVData.length} System Properties`,
            type: 'spv',
            expanded: isExpanded,
            stats: [
              { label: 'Total SPVs', value: goalSPVData.length },
              { label: 'High Priority', value: goalSPVData.filter((s: any) => s.importance === 'HIGH').length },
            ],
            preview: goalSPVData.slice(0, 3).map((s: any) => {
              const name = s.name || s.Name || 'SPV';
              return `${s.id || s.ID}: ${name}`;
            }),
          },
          width: dims.width,
          height: dims.height,
        });

        // Edge from Goal to SPV cluster
        edges.push({
          id: `goal-${goal.id}-${clusterId}`,
          source: `goal-${goal.id}`,
          target: clusterId,
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '5,5' },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
          label: 'requires',
        });
      }
    });
  }

  // Step 3: Requirement Atoms
  const step3 = steps.find(s => s.id === 3);
  if (step3?.output) {
    Object.entries(step3.output).forEach(([goalId, ras]: [string, any]) => {
      const raArray = Array.isArray(ras) ? ras : [];

      // Create cluster node for RAs (consistent with SPV pattern)
      const clusterId = `ra-cluster-${goalId}`;
      const isExpanded = clusterState[clusterId] ?? false;
      const dims = getNodeDimensions('cluster');

      if (isExpanded) {
        // Show individual RA nodes when expanded
        raArray.slice(0, 10).forEach((ra: any) => {
          const raDims = getNodeDimensions('ra');
          const raTitle = ra.atom_title || 'Requirement Atom';
          const displayTitle = raTitle.length > 50 ? raTitle.substring(0, 50) + '...' : raTitle;

          nodes.push({
            id: `ra-${ra.ra_id}`,
            type: 'standard',
            position: { x: 0, y: 0 },
            data: {
              label: `${ra.ra_id}: ${displayTitle}`,
              fullText: `${ra.ra_id}: ${raTitle}`,
              subtitle: ra.requirement_statement?.substring(0, 40),
              type: 'ra',
              fullData: ra,
              parentGoalId: goalId,
            },
            width: raDims.width,
            height: raDims.height,
          });

          // Edge from RA cluster to individual RA
          edges.push({
            id: `${clusterId}-ra-${ra.ra_id}`,
            source: clusterId,
            target: `ra-${ra.ra_id}`,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#10b981', strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
          });
        });
      }

      // Always show RA cluster node (whether expanded or collapsed)
      nodes.push({
        id: clusterId,
        type: 'cluster',
        position: { x: 0, y: 0 },
        data: {
          title: `RAs for ${goalId}`,
          description: `${raArray.length} Requirement Atoms`,
          type: 'ra',
          expanded: isExpanded,
          stats: [
            { label: 'Total RAs', value: raArray.length },
            { label: 'Showing', value: isExpanded ? Math.min(raArray.length, 10) : 0 },
          ],
          preview: raArray.slice(0, 3).map((ra: any) => {
            const title = ra.atom_title || 'Untitled';
            return `${ra.ra_id}: ${title.length > 40 ? title.substring(0, 40) + '...' : title}`;
          }),
        },
        width: dims.width,
        height: dims.height,
      });

      // Edge from Goal to RA cluster
      edges.push({
        id: `goal-${goalId}-${clusterId}`,
        source: `goal-${goalId}`,
        target: clusterId,
        type: 'smoothstep',
        animated: false,
        style: { stroke: '#10b981', strokeWidth: 2, strokeDasharray: '5,5' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
        label: 'defines',
      });
    });
  }

  // Step 4: 3-Level Scientific Knowledge Hierarchy
  // Level 1: Goal → Scientific Knowledge cluster
  // Level 2: Scientific Knowledge cluster → Domain clusters
  // Level 3: Domain cluster → S-nodes
  const step4 = steps.find(s => s.id === 4);
  if (step4?.output && typeof step4.output === 'object') {
    // Handle both in-progress (phase data) and completed (final data) states
    const isRunning = step4.status === 'running';
    const currentPhase = (step4.output as any).phase;

    Object.entries(step4.output).forEach(([goalId, goalData]: [string, any]) => {
      // Skip non-goal entries (like 'phase', 'progress')
      if (!goalId.startsWith('M_G') && goalId !== 'phase' && goalId !== 'progress') return;
      if (goalId === 'phase' || goalId === 'progress') return;

      // Extract data (no deduplication - direct from Phase 4b)
      const domainMapping = goalData?.domain_mapping;
      const domains = domainMapping?.research_domains || [];
      const rawDomainScans = goalData?.raw_domain_scans?.domains || {};
      const allSciPillars = goalData?.scientific_pillars || []; // Direct array from Phase 4b

      // Only create science cluster if we have domains
      if (domains.length === 0) return;

      // LEVEL 1: Scientific Knowledge cluster for this Goal
      const scienceClusterId = `science-cluster-${goalId}`;
      const scienceExpanded = clusterState[scienceClusterId] ?? false;
      const scienceDims = getNodeDimensions('cluster');

      // Count total interventions across all domains
      const totalInterventions = allSciPillars.length || Object.values(rawDomainScans).reduce((sum: number, scan: any) => {
        return sum + (scan?.scientific_pillars?.length || 0);
      }, 0);

      if (scienceExpanded) {
        // LEVEL 2: Show Domain clusters when science cluster is expanded
        domains.forEach((domain: any) => {
          const domainId = domain.domain_id;
          const domainClusterId = `domain-${domainId}`;
          const domainExpanded = clusterState[domainClusterId] ?? false;

          // Get S-nodes for this domain (directly from raw scans)
          const domainSNodes: any[] = rawDomainScans[domainId]?.scientific_pillars || [];

          if (domainExpanded && domainSNodes.length > 0) {
            // LEVEL 3: Show S-nodes when domain is expanded
            domainSNodes
              .sort((a: any, b: any) => (b.strategic_value_score || b.relevance_score || 0) - (a.strategic_value_score || a.relevance_score || 0))
              .slice(0, 20)  // Show up to 20 S-nodes
              .forEach((sNode: any) => {
                const sNodeDims = getNodeDimensions('scientific');
                const sNodeTitle = sNode.title || sNode.intervention_title || 'Scientific Intervention';
                const displayTitle = sNodeTitle.length > 50 ? sNodeTitle.substring(0, 50) + '...' : sNodeTitle;
                const mechanism = sNode.mechanism || sNode.mechanism_summary || '';
                const score = Math.round(sNode.strategic_value_score || sNode.relevance_score || 0);
                const trl = sNode.readiness_level || sNode.trl || 'N/A';

                nodes.push({
                  id: `s-${goalId}-${domainId}-${sNode.id || sNode.node_id}`,
                  type: 'standard',
                  position: { x: 0, y: 0 },
                  data: {
                    label: displayTitle,
                    fullText: sNodeTitle,
                    subtitle: mechanism.substring(0, 40),
                    type: 'scientific',
                    fullData: sNode,
                    metrics: [
                      { label: 'Score', value: score },
                      { label: 'TRL', value: trl },
                    ],
                  },
                  width: sNodeDims.width,
                  height: sNodeDims.height,
                });

                // Edge from domain cluster to S-node
                edges.push({
                  id: `${domainClusterId}-s-${sNode.id || sNode.node_id}`,
                  source: domainClusterId,
                  target: `s-${goalId}-${domainId}-${sNode.id || sNode.node_id}`,
                  type: 'smoothstep',
                  animated: false,
                  style: { stroke: '#06b6d4', strokeWidth: 1.5 },
                  markerEnd: { type: MarkerType.ArrowClosed, color: '#06b6d4' },
                });
              });
          }

          // Always show domain cluster
          const domainDims = getNodeDimensions('cluster');
          const relevance = domain.relevance_to_goal || domain.relevance || 'MED';
          nodes.push({
            id: domainClusterId,
            type: 'cluster',
            position: { x: 0, y: 0 },
            data: {
              title: domain.domain_name || domain.name,
              description: `${relevance} relevance domain`,
              type: 'domain',
              expanded: domainExpanded,
              fullData: domain, // Include all domain properties for details panel
              stats: [
                { label: 'S-nodes', value: domainSNodes.length },
                { label: 'Showing', value: domainExpanded ? Math.min(domainSNodes.length, 20) : 0 },
                { label: 'Relevance', value: relevance },
              ],
              preview: domainSNodes
                .sort((a: any, b: any) => (b.strategic_value_score || b.relevance_score || 0) - (a.strategic_value_score || a.relevance_score || 0))
                .slice(0, 3)
                .map((s: any) => {
                  const title = s.title || s.intervention_title || 'Intervention';
                  const score = Math.round(s.strategic_value_score || s.relevance_score || 0);
                  return `${title.length > 35 ? title.substring(0, 35) + '...' : title} (${score})`;
                }),
            },
            width: domainDims.width,
            height: domainDims.height,
          });

          // Edge from Science cluster to Domain
          const edgeColor = relevance === 'HIGH' ? '#22c55e' : relevance === 'MED' ? '#fbbf24' : '#94a3b8';
          edges.push({
            id: `${scienceClusterId}-${domainClusterId}`,
            source: scienceClusterId,
            target: domainClusterId,
            type: 'smoothstep',
            animated: false,
            style: {
              stroke: edgeColor,
              strokeWidth: 1.5,
              strokeDasharray: '4,4',
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: edgeColor,
            },
          });
        });
      }

      // LEVEL 1: Always show Scientific Knowledge cluster
      nodes.push({
        id: scienceClusterId,
        type: 'cluster',
        position: { x: 0, y: 0 },
        data: {
          title: `Scientific Knowledge: ${goalId}`,
          description: isRunning ? `${currentPhase || 'Collecting'}...` : `${domains.length} research domains`,
          type: 'scientific',
          expanded: scienceExpanded,
          stats: [
            { label: 'Domains', value: domains.length },
            { label: 'Interventions', value: totalInterventions },
            { label: 'Showing', value: scienceExpanded ? domains.length : 0 },
          ],
          preview: domains.slice(0, 3).map((d: any) => {
            const name = d.domain_name || d.name || 'Domain';
            return `${name.length > 35 ? name.substring(0, 35) + '...' : name}`;
          }),
        },
        width: scienceDims.width,
        height: scienceDims.height,
      });

      // Edge from Goal to Scientific Knowledge cluster
      edges.push({
        id: `goal-${goalId}-${scienceClusterId}`,
        source: `goal-${goalId}`,
        target: scienceClusterId,
        type: 'smoothstep',
        animated: false,
        style: {
          stroke: '#06b6d4',
          strokeWidth: 2,
          strokeDasharray: '5,5',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#06b6d4',
        },
        label: 'explores',
      });
    });
  }

  // Step 6: L3 Questions - Create collapsible clusters grouped by Goal
  const step6 = steps.find(s => s.id === 6);
  console.log('[GraphBuilder] Step 6 found:', !!step6, 'has output:', !!step6?.output);
  if (step6?.output) {
    console.log('[GraphBuilder] Step 6 output structure:', Object.keys(step6.output));
    console.log('[GraphBuilder] Step 6 full output:', step6.output);
    
    const l3Questions = extractL3Questions(step6.output);
    console.log('[GraphBuilder] Step 6 - L3 Questions extracted:', l3Questions.length);
    if (l3Questions.length > 0) {
      console.log('[GraphBuilder] First L3 question sample:', l3Questions[0]);
    }

    // Group L3s by parent Goal
    const l3sByGoal: Record<string, any[]> = {};
    l3Questions.forEach((q: any) => {
      // Try multiple ways to find parent goal:
      // 1. Parse from L3 ID (e.g., Q_L3_M_G1_1 -> M_G1)
      // 2. Use target_goal_id field (set by App.tsx)
      // 3. Use parent_goal_id field
      let parentGoalId = extractParentGoalFromL3(q.id || '');
      
      if (!parentGoalId && q.target_goal_id) {
        parentGoalId = q.target_goal_id;
        console.log(`[GraphBuilder] L3 ${q.id} -> using target_goal_id: ${parentGoalId}`);
      }
      
      if (!parentGoalId && q.parent_goal_id) {
        parentGoalId = q.parent_goal_id;
        console.log(`[GraphBuilder] L3 ${q.id} -> using parent_goal_id: ${parentGoalId}`);
      }
      
      console.log(`[GraphBuilder] L3 ${q.id} -> final parent Goal: ${parentGoalId}`);
      
      if (parentGoalId) {
        if (!l3sByGoal[parentGoalId]) l3sByGoal[parentGoalId] = [];
        l3sByGoal[parentGoalId].push(q);
      } else {
        console.warn('[GraphBuilder] L3 question has no parent Goal (tried id parsing, target_goal_id, parent_goal_id):', q.id, q);
      }
    });
    console.log('[GraphBuilder] L3s grouped by Goal:', Object.keys(l3sByGoal).length, 'goals', l3sByGoal);

    // Create L3 cluster for each Goal
    Object.entries(l3sByGoal).forEach(([goalId, goalL3s]) => {
      const clusterId = `l3-cluster-${goalId}`;
      const isExpanded = clusterState[clusterId] ?? false;
      const dims = getNodeDimensions('cluster');
      console.log(`[GraphBuilder] Creating L3 cluster for ${goalId}: ${goalL3s.length} questions, expanded=${isExpanded}`);

      if (isExpanded) {
        // Expanded: Show individual L3 nodes
        goalL3s.forEach((q: any) => {
          const questionText = q.text || 'L3 Question';
          const displayText = questionText.length > 60 ? questionText.substring(0, 60) + '...' : questionText;
          const l3Dims = getNodeDimensions('l3');

          nodes.push({
            id: `l3-${q.id}`,
            type: 'standard',
            position: { x: 0, y: 0 },
            data: {
              label: `L3: ${displayText}`,
              fullText: `L3: ${questionText}`,
              subtitle: q.strategy_used?.substring(0, 40),
              type: 'l3',
              fullData: q,
            },
            width: l3Dims.width,
            height: l3Dims.height,
          });

          // Edge from Goal to L3
          const parentGoalExists = nodes.find(n => n.id === `goal-${goalId}`);
          if (parentGoalExists) {
            edges.push({
              id: `goal-${goalId}-l3-${q.id}`,
              source: `goal-${goalId}`,
              target: `l3-${q.id}`,
              type: 'smoothstep',
              animated: true,
              style: { stroke: '#ef4444', strokeWidth: 1.5 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' },
            });
          } else {
            console.error(`[GraphBuilder] Parent Goal node not found for L3: goal-${goalId}, L3 ID: ${q.id}`);
          }
        });
      } else {
        // Collapsed: Show cluster node
        // Generate preview of first 3 L3 questions
        const previewItems = goalL3s.slice(0, 3).map((q: any) => {
          const text = q.text || q.question || 'Untitled';
          return text.length > 60 ? text.substring(0, 60) + '...' : text;
        });

        nodes.push({
          id: clusterId,
          type: 'cluster',
          position: { x: 0, y: 0 },
          data: {
            title: `L3 Questions for ${goalId}`,
            description: `${goalL3s.length} seed questions targeting strategic gaps`,
            type: 'l3', // Use 'l3' for proper red coloring
            expanded: isExpanded, // Use actual cluster state
            stats: [
              { label: 'Questions', value: goalL3s.length },
            ],
            preview: previewItems,
            fullData: { questions: goalL3s, goalId },
          },
          width: dims.width,
          height: dims.height,
        });

        // Edge from Goal to L3 cluster
        const parentGoalExists = nodes.find(n => n.id === `goal-${goalId}`);
        if (parentGoalExists) {
          edges.push({
            id: `goal-${goalId}-${clusterId}`,
            source: `goal-${goalId}`,
            target: clusterId,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#ef4444', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#ef4444' },
          });
        } else {
          console.error(`[GraphBuilder] Parent Goal node not found for L3 cluster: goal-${goalId}`);
        }
      }
    });
  }

  // Step 7: Instantiation Hypotheses - Create collapsible clusters grouped by parent L3
  const step7 = steps.find(s => s.id === 7);
  if (step7?.output) {
    const ihs = extractInstantiationHypotheses(step7.output);

    // Group IHs by parent L3
    const ihsByL3: Record<string, any[]> = {};
    ihs.forEach((ih: any) => {
      const parentL3Id = extractParentL3FromIH(ih.ih_id || '');
      if (parentL3Id) {
        if (!ihsByL3[parentL3Id]) ihsByL3[parentL3Id] = [];
        ihsByL3[parentL3Id].push(ih);
      }
    });

    // Create IH cluster for each L3
    Object.entries(ihsByL3).forEach(([l3Id, l3IHs]) => {
      const ihClusterId = `ih-cluster-${l3Id}`;
      const isExpanded = clusterState[ihClusterId] ?? false;
      const dims = getNodeDimensions('cluster');

      // Determine parent node (individual L3 or L3 cluster)
      const individualL3Node = nodes.find(n => n.id === `l3-${l3Id}`);
      let parentNodeId: string | null = null;
      
      if (individualL3Node) {
        // L3 is expanded - connect to individual L3 node
        parentNodeId = `l3-${l3Id}`;
      } else {
        // L3 is collapsed - connect to L3 cluster
        const goalIdMatch = l3Id.match(/Q_L3_(M_G\d+)_/);
        if (goalIdMatch) {
          const goalId = goalIdMatch[1];
          const l3ClusterId = `l3-cluster-${goalId}`;
          if (nodes.find(n => n.id === l3ClusterId)) {
            parentNodeId = l3ClusterId;
          }
        }
      }

      if (isExpanded) {
        // Expanded: Show individual IH nodes
        l3IHs.forEach((ih: any) => {
          const hypothesis = ih.process_hypothesis || 'Hypothesis';
          const displayHypothesis = hypothesis.length > 50 ? hypothesis.substring(0, 50) + '...' : hypothesis;
          const ihDims = getNodeDimensions('ih');

          nodes.push({
            id: `ih-${ih.ih_id}`,
            type: 'standard',
            position: { x: 0, y: 0 },
            data: {
              label: `IH: ${displayHypothesis}`,
              fullText: `IH: ${hypothesis}`,
              subtitle: ih.domain_category?.substring(0, 30),
              type: 'ih',
              fullData: ih,
            },
            width: ihDims.width,
            height: ihDims.height,
          });

          // Edge from IH cluster to individual IH
          edges.push({
            id: `${ihClusterId}-ih-${ih.ih_id}`,
            source: ihClusterId,
            target: `ih-${ih.ih_id}`,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#f97316', strokeWidth: 1 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#f97316' },
          });
        });
      }

      // Always create IH cluster node (collapsed or as parent of expanded IHs)
      const previewItems = l3IHs.slice(0, 3).map((ih: any) => {
        const text = ih.process_hypothesis || 'Hypothesis';
        return text.length > 60 ? text.substring(0, 60) + '...' : text;
      });

      nodes.push({
        id: ihClusterId,
        type: 'cluster',
        position: { x: 0, y: 0 },
        data: {
          title: `Instantiation Hypotheses`,
          description: `${l3IHs.length} hypotheses for ${l3Id}`,
          type: 'ih',
          expanded: isExpanded,
          stats: [
            { label: 'Hypotheses', value: l3IHs.length },
          ],
          preview: previewItems,
          fullData: { hypotheses: l3IHs, parentL3Id: l3Id },
        },
        width: dims.width,
        height: dims.height,
      });

      // Edge from L3 (individual or cluster) to IH cluster
      if (parentNodeId) {
        edges.push({
          id: `${parentNodeId}-${ihClusterId}`,
          source: parentNodeId,
          target: ihClusterId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#f97316', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#f97316' },
        });
      }
    });
  }

  // Step 8: L4 Questions - Create collapsible clusters grouped by parent IH
  const step8 = steps.find(s => s.id === 8);
  if (step8?.output) {
    const l4Questions = extractL4Questions(step8.output);

    // Group L4s by parent IH (use first IH from distinguishes_ih_ids)
    const l4sByIH: Record<string, any[]> = {};
    l4Questions.forEach((q: any) => {
      const parentIHIds = q.distinguishes_ih_ids || [];
      if (parentIHIds.length > 0) {
        const parentIHId = parentIHIds[0];
        if (!l4sByIH[parentIHId]) l4sByIH[parentIHId] = [];
        l4sByIH[parentIHId].push(q);
      }
    });

    // Create L4 cluster for each IH
    Object.entries(l4sByIH).forEach(([ihId, ihL4s]) => {
      const l4ClusterId = `l4-cluster-${ihId}`;
      const isExpanded = clusterState[l4ClusterId] ?? false;
      const dims = getNodeDimensions('cluster');

      // Find parent IH cluster
      const parentL3Id = extractParentL3FromIH(ihId);
      let parentNodeId: string | null = null;
      
      if (parentL3Id) {
        const ihClusterId = `ih-cluster-${parentL3Id}`;
        if (nodes.find(n => n.id === ihClusterId)) {
          parentNodeId = ihClusterId;
        }
      }

      if (isExpanded) {
        // Expanded: Show individual L4 nodes
        ihL4s.forEach((q: any) => {
          const questionText = q.text || 'L4 Question';
          const displayText = questionText.length > 40 ? questionText.substring(0, 40) + '...' : questionText;
          const l4Dims = getNodeDimensions('l4');

          nodes.push({
            id: `l4-${q.id}`,
            type: 'compact',
            position: { x: 0, y: 0 },
            data: {
              label: `L4: ${displayText}`,
              fullText: `L4: ${questionText}`,
              type: 'l4',
              fullData: q,
            },
            width: l4Dims.width,
            height: l4Dims.height,
          });

          // Edge from L4 cluster to individual L4
          edges.push({
            id: `${l4ClusterId}-l4-${q.id}`,
            source: l4ClusterId,
            target: `l4-${q.id}`,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#84cc16', strokeWidth: 1 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#84cc16' },
          });
        });
      }

      // Always create L4 cluster node
      const previewItems = ihL4s.slice(0, 3).map((q: any) => {
        const text = q.text || 'L4 Question';
        return text.length > 60 ? text.substring(0, 60) + '...' : text;
      });

      nodes.push({
        id: l4ClusterId,
        type: 'cluster',
        position: { x: 0, y: 0 },
        data: {
          title: `L4 Tactical Questions`,
          description: `${ihL4s.length} questions for IH ${ihId}`,
          type: 'l4',
          expanded: isExpanded,
          stats: [
            { label: 'Questions', value: ihL4s.length },
          ],
          preview: previewItems,
          fullData: { questions: ihL4s, parentIHId: ihId },
        },
        width: dims.width,
        height: dims.height,
      });

      // Edge from IH cluster to L4 cluster
      if (parentNodeId) {
        edges.push({
          id: `${parentNodeId}-${l4ClusterId}`,
          source: parentNodeId,
          target: l4ClusterId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#84cc16', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#84cc16' },
        });
      }
    });
  }

  // Step 9: L5 nodes and L6 Tasks - Create hierarchical clusters
  const step9 = steps.find(s => s.id === 9);
  if (step9?.output) {
    const l5Nodes = step9.output.l5_nodes || [];
    const l6Tasks = step9.output.l6_tasks || [];

    // Group L5 nodes by parent L4
    const l5sByL4: Record<string, any[]> = {};
    l5Nodes.forEach((l5: any) => {
      const parentL4Id = l5.parent_l4_id;
      if (parentL4Id) {
        if (!l5sByL4[parentL4Id]) l5sByL4[parentL4Id] = [];
        l5sByL4[parentL4Id].push(l5);
      }
    });

    // Create L5 cluster for each L4
    Object.entries(l5sByL4).forEach(([l4Id, l4L5s]) => {
      const l5ClusterId = `l5-cluster-${l4Id}`;
      const isExpanded = clusterState[l5ClusterId] ?? false;
      const dims = getNodeDimensions('cluster');

      // Find parent: individual L4 node or L4 cluster
      const individualL4Node = nodes.find(n => n.id === `l4-${l4Id}`);
      let parentNodeId: string | null = null;
      
      if (individualL4Node) {
        parentNodeId = `l4-${l4Id}`;
      } else {
        // Find L4 cluster by checking which cluster contains this L4
        const l4ClusterNode = nodes.find(n => 
          n.id.startsWith('l4-cluster-') && 
          n.data.fullData?.questions?.some((q: any) => q.id === l4Id)
        );
        if (l4ClusterNode) {
          parentNodeId = l4ClusterNode.id;
        }
      }

      if (isExpanded) {
        // Expanded: Show individual L5 nodes
        l4L5s.forEach((l5: any) => {
          const l5Text = l5.text || 'L5 Node';
          const displayText = l5Text.length > 40 ? l5Text.substring(0, 40) + '...' : l5Text;
          const l5Dims = getNodeDimensions('l5');

          nodes.push({
            id: `l5-${l5.id}`,
            type: 'compact',
            position: { x: 0, y: 0 },
            data: {
              label: `L5: ${displayText}`,
              fullText: `L5: ${l5Text}`,
              type: 'l5',
              fullData: l5,
            },
            width: l5Dims.width,
            height: l5Dims.height,
          });

          // Edge from L5 cluster to individual L5
          edges.push({
            id: `${l5ClusterId}-l5-${l5.id}`,
            source: l5ClusterId,
            target: `l5-${l5.id}`,
            type: 'smoothstep',
            animated: true,
            style: { stroke: '#22c55e', strokeWidth: 1 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' },
          });
        });
      }

      // Always create L5 cluster node
      const previewItems = l4L5s.slice(0, 3).map((l5: any) => {
        const text = l5.text || 'L5 Node';
        return text.length > 60 ? text.substring(0, 60) + '...' : text;
      });

      nodes.push({
        id: l5ClusterId,
        type: 'cluster',
        position: { x: 0, y: 0 },
        data: {
          title: `L5 Mechanistic Nodes`,
          description: `${l4L5s.length} drill branches for L4 ${l4Id}`,
          type: 'l5',
          expanded: isExpanded,
          stats: [
            { label: 'Branches', value: l4L5s.length },
          ],
          preview: previewItems,
          fullData: { nodes: l4L5s, parentL4Id: l4Id },
        },
        width: dims.width,
        height: dims.height,
      });

      // Edge from L4 (individual or cluster) to L5 cluster
      if (parentNodeId) {
        edges.push({
          id: `${parentNodeId}-${l5ClusterId}`,
          source: parentNodeId,
          target: l5ClusterId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#22c55e', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e' },
        });
      }
    });

    // Group L6 tasks by parent L5
    const l6sByL5: Record<string, any[]> = {};
    l6Tasks.forEach((task: any) => {
      const parentL5Id = task.parent_l5_id;
      if (parentL5Id) {
        if (!l6sByL5[parentL5Id]) l6sByL5[parentL5Id] = [];
        l6sByL5[parentL5Id].push(task);
      }
    });

    // Create L6 cluster for each L5
    Object.entries(l6sByL5).forEach(([l5Id, l5L6s]) => {
      const l6ClusterId = `l6-cluster-${l5Id}`;
      const isExpanded = clusterState[l6ClusterId] ?? false;
      const dims = getNodeDimensions('cluster');

      // Find parent: individual L5 node or L5 cluster
      const individualL5Node = nodes.find(n => n.id === `l5-${l5Id}`);
      let parentNodeId: string | null = null;
      
      if (individualL5Node) {
        parentNodeId = `l5-${l5Id}`;
      } else {
        // Find L5 cluster by checking which cluster contains this L5
        const l5ClusterNode = nodes.find(n => 
          n.id.startsWith('l5-cluster-') && 
          n.data.fullData?.nodes?.some((n: any) => n.id === l5Id)
        );
        if (l5ClusterNode) {
          parentNodeId = l5ClusterNode.id;
        }
      }

      if (isExpanded) {
        // Expanded: Show individual L6 nodes (limit to 20 for performance)
        l5L6s.slice(0, 20).forEach((task: any) => {
          const taskTitle = task.title || 'L6 Task';
          const displayTitle = taskTitle.length > 35 ? taskTitle.substring(0, 35) + '...' : taskTitle;
          const l6Dims = getNodeDimensions('l6');

          nodes.push({
            id: `l6-${task.id}`,
            type: 'compact',
            position: { x: 0, y: 0 },
            data: {
              label: `L6: ${displayTitle}`,
              fullText: `L6: ${taskTitle}`,
              type: 'l6',
              fullData: task,
            },
            width: l6Dims.width,
            height: l6Dims.height,
          });

          // Edge from L6 cluster to individual L6
          edges.push({
            id: `${l6ClusterId}-l6-${task.id}`,
            source: l6ClusterId,
            target: `l6-${task.id}`,
            type: 'smoothstep',
            animated: false,
            style: { stroke: '#14b8a6', strokeWidth: 0.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#14b8a6' },
          });
        });
      }

      // Always create L6 cluster node
      const previewItems = l5L6s.slice(0, 3).map((task: any) => {
        const text = task.title || 'L6 Task';
        return text.length > 60 ? text.substring(0, 60) + '...' : text;
      });

      nodes.push({
        id: l6ClusterId,
        type: 'cluster',
        position: { x: 0, y: 0 },
        data: {
          title: `L6 Experiment Tasks`,
          description: `${l5L6s.length} tasks for L5 ${l5Id}`,
          type: 'l6',
          expanded: isExpanded,
          stats: [
            { label: 'Tasks', value: l5L6s.length },
          ],
          preview: previewItems,
          fullData: { tasks: l5L6s, parentL5Id: l5Id },
        },
        width: dims.width,
        height: dims.height,
      });

      // Edge from L5 (individual or cluster) to L6 cluster
      if (parentNodeId) {
        edges.push({
          id: `${parentNodeId}-${l6ClusterId}`,
          source: parentNodeId,
          target: l6ClusterId,
          type: 'smoothstep',
          animated: false,
          style: { stroke: '#14b8a6', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#14b8a6' },
        });
      }
    });
  }

  return { nodes, edges };
};

// Helper extraction functions
const extractQ0Text = (output: any): string => {
  if (typeof output === 'string') return output;
  return output.Q0 || output.q0 || output.question || 'Master Question';
};

const extractL3Questions = (output: any): any[] => {
  if (Array.isArray(output)) return output;
  if (output.l3_questions && Array.isArray(output.l3_questions)) return output.l3_questions;
  if (output.seed_questions && Array.isArray(output.seed_questions)) return output.seed_questions;
  return Object.values(output).filter(val => Array.isArray(val)).flat();
};

const extractInstantiationHypotheses = (output: any): any[] => {
  if (Array.isArray(output)) return output;
  if (output.instantiation_hypotheses) return output.instantiation_hypotheses;
  return Object.values(output).filter(val => Array.isArray(val)).flat();
};

const extractL4Questions = (output: any): any[] => {
  if (Array.isArray(output)) return output;
  if (output.l4_questions) return output.l4_questions;
  return Object.values(output).filter(val => Array.isArray(val)).flat();
};

const extractL6Tasks = (output: any): any[] => {
  if (Array.isArray(output)) return output;
  if (output.l6_tasks) return output.l6_tasks;
  return Object.values(output).filter(val => Array.isArray(val)).flat();
};

const extractParentGoalFromL3 = (l3Id: string): string | null => {
  const match = l3Id.match(/Q_L3_(M_G\d+)_/);
  return match ? match[1] : null;
};

const extractParentL3FromIH = (ihId: string): string | null => {
  const match = ihId.match(/IH_(Q_L3_[^_]+_[^_]+_\d+)/);
  return match ? match[1] : null;
};

const extractParentL4FromL6 = (l6Id: string): string | null => {
  const match = l6Id.match(/T_L6_(M_G\d+_\d+_\d+)_/);
  return match ? `Q_L4_${match[1]}` : null;
};

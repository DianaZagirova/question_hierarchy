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

// ============================================================
// HELPER: Create a cluster node (always visible, toggleable)
// ============================================================
function makeClusterNode(
  id: string,
  title: string,
  description: string,
  type: string,
  isExpanded: boolean,
  childCount: number,
  previewItems: string[],
  fullData: any,
  stats?: { label: string; value: any }[]
): Node {
  const dims = getNodeDimensions('cluster');
  return {
    id,
    type: 'cluster',
    position: { x: 0, y: 0 },
    data: {
      title,
      description,
      type,
      expanded: isExpanded,
      stats: stats || [{ label: 'Items', value: childCount }],
      preview: previewItems,
      fullData,
    },
    width: dims.width,
    height: dims.height,
  };
}

// ============================================================
// HELPER: Create an edge
// ============================================================
function makeEdge(
  id: string,
  source: string,
  target: string,
  color: string,
  opts?: { width?: number; dash?: string; animated?: boolean; label?: string }
): Edge {
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    animated: opts?.animated ?? true,
    style: {
      stroke: color,
      strokeWidth: opts?.width ?? 1.5,
      ...(opts?.dash ? { strokeDasharray: opts.dash } : {}),
    },
    markerEnd: { type: MarkerType.ArrowClosed, color },
    ...(opts?.label ? { label: opts.label } : {}),
  };
}

// ============================================================
// HELPER: Truncate text
// ============================================================
function trunc(text: string | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? text.substring(0, max) + '...' : text;
}

/**
 * Build graph data from pipeline steps with hierarchical clustering.
 *
 * Design principles:
 * 1. Every group of nodes has a CLUSTER node that is ALWAYS present.
 *    Clicking it toggles expanded/collapsed.
 * 2. When expanded, individual child nodes appear below the cluster.
 * 3. Downstream clusters always connect to the nearest visible ancestor
 *    (individual node if parent expanded, cluster if parent collapsed).
 * 4. No hardcoded limits on node counts.
 */
export const buildGraphFromSteps = (
  steps: PipelineStep[],
  clusterState: ClusterState
): GraphData => {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // ============================================================
  // Step 1: Q0 (Master Question)
  // ============================================================
  const step1 = steps.find(s => s.id === 1);
  if (step1?.output) {
    const q0Text = extractQ0Text(step1.output);
    const dims = getNodeDimensions('master');
    nodes.push({
      id: 'q0',
      type: 'master',
      position: { x: 0, y: 0 },
      data: {
        label: trunc(q0Text, 100),
        fullText: q0Text,
        type: 'q0',
        fullData: step1.output,
      },
      width: dims.width,
      height: dims.height,
    });
  }

  // ============================================================
  // Step 2: Goal Pillars + SPV clusters
  // ============================================================
  const step2 = steps.find(s => s.id === 2);
  const goals: any[] = step2?.output?.goals || step2?.output?.Goal_Pillars || step2?.output?.goal_pillars || [];
  const bridgeLexicon = step2?.output?.bridge_lexicon || step2?.output?.Bridge_Lexicon || {};

  if (step2?.output) {
    const allSPVs = bridgeLexicon.system_properties || bridgeLexicon.System_Properties || [];

    goals.forEach((goal: any) => {
      const dims = getNodeDimensions('goal');
      const goalTitle = goal.title || 'Untitled Goal';

      nodes.push({
        id: `goal-${goal.id}`,
        type: 'standard',
        position: { x: 0, y: 0 },
        data: {
          label: `${goal.id}: ${trunc(goalTitle, 50)}`,
          fullText: `${goal.id}: ${goalTitle}`,
          subtitle: trunc(goal.catastrophe_primary, 50),
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

      if (step1?.output) {
        edges.push(makeEdge(`q0-goal-${goal.id}`, 'q0', `goal-${goal.id}`, '#8b5cf6', { width: 2 }));
      }

      // SPV cluster per goal
      const goalSPVs = goal.bridge_tags?.system_properties_required || [];
      if (goalSPVs.length > 0) {
        const goalSPVData = goalSPVs.map((sp: any) => {
          const spvDef = allSPVs.find((spv: any) => (spv.id || spv.ID) === sp.spv_id);
          return { ...sp, ...spvDef, importance: sp.importance || 'MEDIUM' };
        }).filter((spv: any) => spv.id || spv.ID);

        const clusterId = `spv-cluster-${goal.id}`;
        const isExpanded = clusterState[clusterId] ?? false;

        if (isExpanded) {
          goalSPVData.forEach((spv: any) => {
            const spvId = spv.id || spv.ID;
            const spvDims = getNodeDimensions('spv');
            nodes.push({
              id: `spv-${goal.id}-${spvId}`,
              type: 'standard',
              position: { x: 0, y: 0 },
              data: {
                label: `${spvId}: ${trunc(spv.name || spv.Name || 'SPV', 30)}`,
                fullText: `${spvId}: ${spv.name || spv.Name || 'SPV'}`,
                subtitle: `${spv.importance} importance`,
                type: 'spv',
                fullData: spv,
              },
              width: spvDims.width,
              height: spvDims.height,
            });
            edges.push(makeEdge(`${clusterId}-spv-${spvId}`, clusterId, `spv-${goal.id}-${spvId}`, '#f59e0b', { animated: false }));
          });
        }

        nodes.push(makeClusterNode(
          clusterId,
          `SPVs for ${goal.id}`,
          `${goalSPVData.length} System Properties`,
          'spv', isExpanded, goalSPVData.length,
          goalSPVData.slice(0, 3).map((s: any) => `${s.id || s.ID}: ${s.name || s.Name || 'SPV'}`),
          goalSPVData,
          [
            { label: 'Total', value: goalSPVData.length },
            { label: 'High', value: goalSPVData.filter((s: any) => s.importance === 'HIGH').length },
          ]
        ));
        edges.push(makeEdge(`goal-${goal.id}-${clusterId}`, `goal-${goal.id}`, clusterId, '#f59e0b', { dash: '5,5', animated: false, label: 'requires' }));
      }
    });
  }

  // ============================================================
  // Step 3: Requirement Atoms
  // ============================================================
  const step3 = steps.find(s => s.id === 3);
  if (step3?.output) {
    Object.entries(step3.output).forEach(([goalId, ras]: [string, any]) => {
      const raArray = Array.isArray(ras) ? ras : [];
      if (raArray.length === 0) return;

      const clusterId = `ra-cluster-${goalId}`;
      const isExpanded = clusterState[clusterId] ?? false;

      if (isExpanded) {
        raArray.forEach((ra: any) => {
          const raDims = getNodeDimensions('ra');
          nodes.push({
            id: `ra-${ra.ra_id}`,
            type: 'standard',
            position: { x: 0, y: 0 },
            data: {
              label: `${ra.ra_id}: ${trunc(ra.atom_title || 'RA', 50)}`,
              fullText: `${ra.ra_id}: ${ra.atom_title || 'RA'}`,
              subtitle: trunc(ra.requirement_statement, 40),
              type: 'ra',
              fullData: ra,
            },
            width: raDims.width,
            height: raDims.height,
          });
          edges.push(makeEdge(`${clusterId}-ra-${ra.ra_id}`, clusterId, `ra-${ra.ra_id}`, '#10b981'));
        });
      }

      nodes.push(makeClusterNode(
        clusterId,
        `RAs for ${goalId}`,
        `${raArray.length} Requirement Atoms`,
        'ra', isExpanded, raArray.length,
        raArray.slice(0, 3).map((ra: any) => `${ra.ra_id}: ${trunc(ra.atom_title || 'Untitled', 40)}`),
        { ras: raArray, goalId },
        [{ label: 'Total RAs', value: raArray.length }]
      ));
      edges.push(makeEdge(`goal-${goalId}-${clusterId}`, `goal-${goalId}`, clusterId, '#10b981', { dash: '5,5', animated: false, label: 'defines' }));
    });
  }

  // ============================================================
  // Step 4: Scientific Knowledge (3-level hierarchy)
  // ============================================================
  const step4 = steps.find(s => s.id === 4);
  if (step4?.output && typeof step4.output === 'object') {
    const isRunning = step4.status === 'running';
    const currentPhase = (step4.output as any).phase;

    Object.entries(step4.output).forEach(([goalId, goalData]: [string, any]) => {
      if (!goalId.startsWith('M_G')) return;

      const domainMapping = goalData?.domain_mapping;
      const domains = domainMapping?.research_domains || [];
      const rawDomainScans = goalData?.raw_domain_scans?.domains || {};
      const allSciPillars = goalData?.scientific_pillars || [];
      if (domains.length === 0) return;

      const scienceClusterId = `science-cluster-${goalId}`;
      const scienceExpanded = clusterState[scienceClusterId] ?? false;

      const totalInterventions = allSciPillars.length || Object.values(rawDomainScans).reduce((sum: number, scan: any) => {
        return sum + (scan?.scientific_pillars?.length || 0);
      }, 0);

      if (scienceExpanded) {
        domains.forEach((domain: any) => {
          const domainId = domain.domain_id;
          const domainClusterId = `domain-${domainId}`;
          const domainExpanded = clusterState[domainClusterId] ?? false;
          const domainSNodes: any[] = rawDomainScans[domainId]?.scientific_pillars || [];

          if (domainExpanded && domainSNodes.length > 0) {
            domainSNodes
              .sort((a: any, b: any) => (b.strategic_value_score || b.relevance_score || 0) - (a.strategic_value_score || a.relevance_score || 0))
              .forEach((sNode: any) => {
                const sNodeDims = getNodeDimensions('scientific');
                const sNodeTitle = sNode.title || sNode.intervention_title || 'Scientific Intervention';
                const score = Math.round(sNode.strategic_value_score || sNode.relevance_score || 0);
                const trl = sNode.readiness_level || sNode.trl || 'N/A';

                nodes.push({
                  id: `s-${goalId}-${domainId}-${sNode.id || sNode.node_id}`,
                  type: 'standard',
                  position: { x: 0, y: 0 },
                  data: {
                    label: trunc(sNodeTitle, 50),
                    fullText: sNodeTitle,
                    subtitle: trunc(sNode.mechanism || sNode.mechanism_summary || '', 40),
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
                edges.push(makeEdge(`${domainClusterId}-s-${sNode.id || sNode.node_id}`, domainClusterId, `s-${goalId}-${domainId}-${sNode.id || sNode.node_id}`, '#06b6d4', { animated: false }));
              });
          }

          const relevance = domain.relevance_to_goal || domain.relevance || 'MED';
          const domainDims = getNodeDimensions('cluster');
          nodes.push({
            id: domainClusterId,
            type: 'cluster',
            position: { x: 0, y: 0 },
            data: {
              title: domain.domain_name || domain.name,
              description: `${relevance} relevance domain`,
              type: 'domain',
              expanded: domainExpanded,
              fullData: domain,
              stats: [
                { label: 'S-nodes', value: domainSNodes.length },
                { label: 'Relevance', value: relevance },
              ],
              preview: domainSNodes
                .sort((a: any, b: any) => (b.strategic_value_score || b.relevance_score || 0) - (a.strategic_value_score || a.relevance_score || 0))
                .slice(0, 3)
                .map((s: any) => trunc(s.title || s.intervention_title || 'Intervention', 35)),
            },
            width: domainDims.width,
            height: domainDims.height,
          });

          const edgeColor = relevance === 'HIGH' ? '#22c55e' : relevance === 'MED' ? '#fbbf24' : '#94a3b8';
          edges.push(makeEdge(`${scienceClusterId}-${domainClusterId}`, scienceClusterId, domainClusterId, edgeColor, { dash: '4,4', animated: false }));
        });
      }

      nodes.push(makeClusterNode(
        scienceClusterId,
        `Scientific Knowledge: ${goalId}`,
        isRunning ? `${currentPhase || 'Collecting'}...` : `${domains.length} research domains`,
        'scientific', scienceExpanded, domains.length,
        domains.slice(0, 3).map((d: any) => trunc(d.domain_name || d.name || 'Domain', 35)),
        { domains, goalId },
        [
          { label: 'Domains', value: domains.length },
          { label: 'Interventions', value: totalInterventions },
        ]
      ));
      edges.push(makeEdge(`goal-${goalId}-${scienceClusterId}`, `goal-${goalId}`, scienceClusterId, '#06b6d4', { dash: '5,5', animated: false, label: 'explores' }));
    });
  }

  // ============================================================
  // Step 6: L3 Questions - ALWAYS create cluster, expand shows children
  // ============================================================
  const step6 = steps.find(s => s.id === 6);
  if (step6?.output) {
    const l3Questions = extractL3Questions(step6.output);

    // Group L3s by parent Goal
    const l3sByGoal: Record<string, any[]> = {};
    l3Questions.forEach((q: any) => {
      if (!q || typeof q !== 'object') return;
      let parentGoalId = extractParentGoalFromL3(q.id || '');
      if (!parentGoalId) parentGoalId = q.target_goal_id;
      if (!parentGoalId) parentGoalId = q.parent_goal_id;
      if (parentGoalId) {
        if (!l3sByGoal[parentGoalId]) l3sByGoal[parentGoalId] = [];
        l3sByGoal[parentGoalId].push(q);
      }
    });

    // Create L3 cluster for each Goal
    Object.entries(l3sByGoal).forEach(([goalId, goalL3s]) => {
      const clusterId = `l3-cluster-${goalId}`;
      const isExpanded = clusterState[clusterId] ?? false;

      // ALWAYS create cluster node
      nodes.push(makeClusterNode(
        clusterId,
        `L3 Questions (${goalId})`,
        `${goalL3s.length} seed questions`,
        'l3', isExpanded, goalL3s.length,
        goalL3s.slice(0, 3).map((q: any) => trunc(q.text || q.question || 'Untitled', 55)),
        { questions: goalL3s, goalId },
        [{ label: 'Questions', value: goalL3s.length }]
      ));

      // Edge from Goal to L3 cluster
      if (nodes.find(n => n.id === `goal-${goalId}`)) {
        edges.push(makeEdge(`goal-${goalId}-${clusterId}`, `goal-${goalId}`, clusterId, '#ef4444', { width: 2 }));
      }

      // When expanded, show individual L3 nodes as children of the cluster
      if (isExpanded) {
        goalL3s.forEach((q: any) => {
          const l3Dims = getNodeDimensions('l3');
          nodes.push({
            id: `l3-${q.id}`,
            type: 'standard',
            position: { x: 0, y: 0 },
            data: {
              label: `L3: ${trunc(q.text, 60)}`,
              fullText: `L3: ${q.text || 'L3 Question'}`,
              subtitle: trunc(q.strategy_used, 40),
              type: 'l3',
              fullData: q,
            },
            width: l3Dims.width,
            height: l3Dims.height,
          });
          edges.push(makeEdge(`${clusterId}-l3-${q.id}`, clusterId, `l3-${q.id}`, '#ef4444', { width: 1 }));
        });
      }
    });
  }

  // ============================================================
  // Step 7: IH - only show when parent L3 individual node is visible
  // Cascading collapse: L3 collapsed → IH hidden entirely
  // ============================================================
  const step7 = steps.find(s => s.id === 7);
  if (step7?.output) {
    const ihs = extractInstantiationHypotheses(step7.output);

    // Group IHs by parent L3
    const ihsByL3: Record<string, any[]> = {};
    ihs.forEach((ih: any) => {
      if (!ih || typeof ih !== 'object') return;
      const parentL3Id = extractParentL3FromIH(ih.ih_id || '');
      if (parentL3Id) {
        if (!ihsByL3[parentL3Id]) ihsByL3[parentL3Id] = [];
        ihsByL3[parentL3Id].push(ih);
      }
    });

    // Create IH cluster for each L3 — ONLY if parent L3 individual node exists
    Object.entries(ihsByL3).forEach(([l3Id, l3IHs]) => {
      const parentL3Node = nodes.find(n => n.id === `l3-${l3Id}`);
      if (!parentL3Node) return; // L3 is collapsed → skip all IH for this L3

      const ihClusterId = `ih-cluster-${l3Id}`;
      const isExpanded = clusterState[ihClusterId] ?? false;

      nodes.push(makeClusterNode(
        ihClusterId,
        `IH for ${trunc(l3Id, 20)}`,
        `${l3IHs.length} hypotheses`,
        'ih', isExpanded, l3IHs.length,
        l3IHs.slice(0, 3).map((ih: any) => trunc(ih.process_hypothesis || 'Hypothesis', 55)),
        { hypotheses: l3IHs, parentL3Id: l3Id },
        [{ label: 'Hypotheses', value: l3IHs.length }]
      ));
      edges.push(makeEdge(`l3-${l3Id}-${ihClusterId}`, `l3-${l3Id}`, ihClusterId, '#f97316'));

      // When expanded, show individual IH nodes
      if (isExpanded) {
        l3IHs.forEach((ih: any) => {
          const ihDims = getNodeDimensions('ih');
          nodes.push({
            id: `ih-${ih.ih_id}`,
            type: 'standard',
            position: { x: 0, y: 0 },
            data: {
              label: `IH: ${trunc(ih.process_hypothesis, 50)}`,
              fullText: `IH: ${ih.process_hypothesis || 'Hypothesis'}`,
              subtitle: trunc(ih.domain_category, 30),
              type: 'ih',
              fullData: ih,
            },
            width: ihDims.width,
            height: ihDims.height,
          });
          edges.push(makeEdge(`${ihClusterId}-ih-${ih.ih_id}`, ihClusterId, `ih-${ih.ih_id}`, '#f97316', { width: 1 }));
        });
      }
    });
  }

  // ============================================================
  // Step 8: L4 Questions - only show when parent L3 individual node is visible
  // Cascading collapse: L3 collapsed → L4 hidden entirely
  // ============================================================
  const step8 = steps.find(s => s.id === 8);
  if (step8?.output) {
    const l4Questions = extractL4Questions(step8.output);

    // Group L4s by parent L3 (extracted from IH or L4 ID)
    const l4sByL3: Record<string, any[]> = {};
    l4Questions.forEach((q: any) => {
      if (!q || typeof q !== 'object') return;

      let parentL3Id: string | null = null;

      // Method 1: Via IH parent
      const parentIHIds = q.distinguishes_ih_ids || [];
      if (parentIHIds.length > 0) {
        parentL3Id = extractParentL3FromIH(parentIHIds[0]);
      }

      // Method 2: Extract from L4 ID directly
      if (!parentL3Id && q.id) {
        const l4Id = q.id;
        const match = l4Id.match(/Q_L4_(M_G\d+_\d+)/);
        if (match) {
          parentL3Id = `Q_L3_${match[1]}`;
        }
      }

      if (parentL3Id) {
        if (!l4sByL3[parentL3Id]) l4sByL3[parentL3Id] = [];
        l4sByL3[parentL3Id].push(q);
      }
    });

    // Create L4 cluster for each L3 parent — ONLY if parent L3 individual node exists
    Object.entries(l4sByL3).forEach(([l3Id, l3L4s]) => {
      const parentL3Node = nodes.find(n => n.id === `l3-${l3Id}`);
      if (!parentL3Node) return; // L3 is collapsed → skip all L4 for this L3

      const l4ClusterId = `l4-cluster-${l3Id}`;
      const isExpanded = clusterState[l4ClusterId] ?? false;

      nodes.push(makeClusterNode(
        l4ClusterId,
        `L4 Questions`,
        `${l3L4s.length} tactical questions`,
        'l4', isExpanded, l3L4s.length,
        l3L4s.slice(0, 3).map((q: any) => trunc(q.text || 'L4 Question', 55)),
        { questions: l3L4s, parentL3Id: l3Id },
        [{ label: 'Questions', value: l3L4s.length }]
      ));
      edges.push(makeEdge(`l3-${l3Id}-${l4ClusterId}`, `l3-${l3Id}`, l4ClusterId, '#84cc16'));

      // When expanded, show individual L4 nodes
      if (isExpanded) {
        l3L4s.forEach((q: any) => {
          const l4Dims = getNodeDimensions('l4');
          nodes.push({
            id: `l4-${q.id}`,
            type: 'compact',
            position: { x: 0, y: 0 },
            data: {
              label: `L4: ${trunc(q.text, 40)}`,
              fullText: `L4: ${q.text || 'L4 Question'}`,
              type: 'l4',
              fullData: q,
            },
            width: l4Dims.width,
            height: l4Dims.height,
          });
          edges.push(makeEdge(`${l4ClusterId}-l4-${q.id}`, l4ClusterId, `l4-${q.id}`, '#84cc16', { width: 1 }));
        });
      }
    });
  }

  // ============================================================
  // Step 9: L5 + L6 hierarchical clusters
  // ============================================================
  const step9 = steps.find(s => s.id === 9);
  if (step9?.output) {
    const l5Nodes = step9.output.l5_nodes || [];
    const l6Tasks = step9.output.l6_tasks || [];

    // ---- L5: Group by parent L4 ----
    const l5sByL4: Record<string, any[]> = {};
    l5Nodes.forEach((l5: any) => {
      if (!l5 || typeof l5 !== 'object') return;
      const parentL4Id = l5.parent_l4_id;
      if (parentL4Id) {
        if (!l5sByL4[parentL4Id]) l5sByL4[parentL4Id] = [];
        l5sByL4[parentL4Id].push(l5);
      }
    });

    // Create L5 cluster for each L4 — ONLY if parent L4 individual node exists
    Object.entries(l5sByL4).forEach(([l4Id, l4L5s]) => {
      const parentL4Node = nodes.find(n => n.id === `l4-${l4Id}`);
      if (!parentL4Node) return; // L4 is collapsed → skip all L5 for this L4

      const l5ClusterId = `l5-cluster-${l4Id}`;
      const isExpanded = clusterState[l5ClusterId] ?? false;

      nodes.push(makeClusterNode(
        l5ClusterId,
        `L5 Mechanistic`,
        `${l4L5s.length} drill branches`,
        'l5', isExpanded, l4L5s.length,
        l4L5s.slice(0, 3).map((l5: any) => trunc(l5.text || 'L5 Node', 55)),
        { nodes: l4L5s, parentL4Id: l4Id },
        [{ label: 'Branches', value: l4L5s.length }]
      ));
      edges.push(makeEdge(`l4-${l4Id}-${l5ClusterId}`, `l4-${l4Id}`, l5ClusterId, '#22c55e'));

      if (isExpanded) {
        l4L5s.forEach((l5: any) => {
          const l5Dims = getNodeDimensions('l5');
          nodes.push({
            id: `l5-${l5.id}`,
            type: 'compact',
            position: { x: 0, y: 0 },
            data: {
              label: `L5: ${trunc(l5.text, 40)}`,
              fullText: `L5: ${l5.text || 'L5 Node'}`,
              type: 'l5',
              fullData: l5,
            },
            width: l5Dims.width,
            height: l5Dims.height,
          });
          edges.push(makeEdge(`${l5ClusterId}-l5-${l5.id}`, l5ClusterId, `l5-${l5.id}`, '#22c55e', { width: 1 }));
        });
      }
    });

    // ---- L6: Group by parent L5 ----
    const l6sByL5: Record<string, any[]> = {};
    l6Tasks.forEach((task: any) => {
      if (!task || typeof task !== 'object') return;
      const parentL5Id = task.parent_l5_id;
      if (parentL5Id) {
        if (!l6sByL5[parentL5Id]) l6sByL5[parentL5Id] = [];
        l6sByL5[parentL5Id].push(task);
      }
    });

    // Create L6 cluster for each L5 — ONLY if parent L5 individual node exists
    Object.entries(l6sByL5).forEach(([l5Id, l5L6s]) => {
      const parentL5Node = nodes.find(n => n.id === `l5-${l5Id}`);
      if (!parentL5Node) return; // L5 is collapsed → skip all L6 for this L5

      const l6ClusterId = `l6-cluster-${l5Id}`;
      const isExpanded = clusterState[l6ClusterId] ?? false;

      nodes.push(makeClusterNode(
        l6ClusterId,
        `L6 Tasks`,
        `${l5L6s.length} experiment tasks`,
        'l6', isExpanded, l5L6s.length,
        l5L6s.slice(0, 3).map((t: any) => trunc(t.title || 'L6 Task', 55)),
        { tasks: l5L6s, parentL5Id: l5Id },
        [{ label: 'Tasks', value: l5L6s.length }]
      ));
      edges.push(makeEdge(`l5-${l5Id}-${l6ClusterId}`, `l5-${l5Id}`, l6ClusterId, '#14b8a6', { animated: false }));

      if (isExpanded) {
        l5L6s.forEach((task: any) => {
          const l6Dims = getNodeDimensions('l6');
          nodes.push({
            id: `l6-${task.id}`,
            type: 'compact',
            position: { x: 0, y: 0 },
            data: {
              label: `L6: ${trunc(task.title, 35)}`,
              fullText: `L6: ${task.title || 'L6 Task'}`,
              type: 'l6',
              fullData: task,
            },
            width: l6Dims.width,
            height: l6Dims.height,
          });
          edges.push(makeEdge(`${l6ClusterId}-l6-${task.id}`, l6ClusterId, `l6-${task.id}`, '#14b8a6', { width: 0.5, animated: false }));
        });
      }
    });
  }

  return { nodes, edges };
};

// ============================================================
// Helper extraction functions
// ============================================================
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
  if (output.child_nodes_L4) return output.child_nodes_L4;
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


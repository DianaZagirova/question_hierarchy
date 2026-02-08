/**
 * Hierarchical Node Builder
 *
 * Builds L3 -> IH/L4 -> L5 -> L6 hierarchy with full collapse/expand support
 */

import { Node, Edge, MarkerType } from 'reactflow';
import {
  calculateChildGridPosition,
  createGroupNode,
  LayoutConfig,
} from './hierarchicalLayout';

const NODE_COLORS = {
  l3: '#ef4444',
  ih: '#f97316',
  l4: '#84cc16',
  l5: '#a3e635',
  l6: '#14b8a6',
};

interface HierarchyBuilderContext {
  nodes: Node[];
  edges: Edge[];
  collapsedGroups: Set<string>;
  config: LayoutConfig;
}

/**
 * Build L3 question hierarchy for a single goal
 */
export function buildL3Hierarchy(
  goalId: string,
  goalX: number,
  startY: number,
  l3Questions: any[],
  ihData: any[],
  l4Data: any[],
  l5Data: any[],
  l6Data: any[],
  context: HierarchyBuilderContext
): number {
  if (l3Questions.length === 0) return startY;

  const { nodes, edges, collapsedGroups, config } = context;
  const { verticalSpacing, horizontalSpacing } = config;

  let currentY = startY;

  // Create L3 group node
  const l3GroupId = `l3-group-${goalId}`;
  const l3GroupNode = createGroupNode(
    l3GroupId,
    'L3',
    { x: goalX, y: currentY },
    'l3_group',
    NODE_COLORS.l3,
    l3Questions.length,
    { questions: l3Questions, goalId }
  );
  nodes.push(l3GroupNode);

  // Connect to parent goal
  edges.push({
    id: `goal-${goalId}-${l3GroupId}`,
    source: `goal-${goalId}`,
    target: l3GroupId,
    type: 'smoothstep',
    animated: true,
    style: { stroke: NODE_COLORS.l3, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l3 },
  });

  currentY += verticalSpacing.groupToChildren;

  // Expand L3 questions if group is not collapsed
  if (!collapsedGroups.has(l3GroupId)) {
    l3Questions.forEach((l3, idx) => {
      const pos = calculateChildGridPosition(
        idx,
        horizontalSpacing.childrenPerRow,
        goalX,
        currentY,
        horizontalSpacing.childColumns,
        verticalSpacing.childRows
      );

      const l3NodeId = `l3-${l3.id}`;

      // Create individual L3 node
      nodes.push({
        id: l3NodeId,
        type: 'default',
        position: pos,
        data: {
          label: `${l3.text?.substring(0, 80)}${l3.text && l3.text.length > 80 ? '...' : ''}`,
          fullData: l3,
          type: 'l3',
          parentGroup: l3GroupId,
        },
        style: {
          background: `linear-gradient(135deg, ${NODE_COLORS.l3}20, ${NODE_COLORS.l3}30)`,
          color: 'hsl(var(--foreground))',
          border: `2px solid ${NODE_COLORS.l3}`,
          borderRadius: '10px',
          padding: '10px',
          fontSize: '10px',
          fontWeight: '600',
          width: 260,
          boxShadow: `0 0 18px ${NODE_COLORS.l3}40`,
        },
      });

      // Edge from L3 group to individual L3
      edges.push({
        id: `${l3GroupId}-${l3NodeId}`,
        source: l3GroupId,
        target: l3NodeId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: NODE_COLORS.l3, strokeWidth: 1, strokeDasharray: '2,2' },
        markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l3 },
      });

      // Build IH and L4 children for this L3
      const l3ChildY = pos.y + verticalSpacing.groupToChildren;
      const finalY = buildL3Children(
        l3,
        l3NodeId,
        pos.x,
        l3ChildY,
        ihData,
        l4Data,
        l5Data,
        l6Data,
        context
      );

      // Update currentY to be below the tallest L3 subtree
      currentY = Math.max(currentY, finalY);
    });

    // Add spacing after all L3s
    const rows = Math.ceil(l3Questions.length / horizontalSpacing.childrenPerRow);
    currentY = startY + verticalSpacing.groupToChildren + rows * verticalSpacing.childRows;
    currentY += verticalSpacing.betweenLevels;
  } else {
    currentY += verticalSpacing.betweenLevels;
  }

  return currentY;
}

/**
 * Build IH and L4 children for a single L3 question
 */
function buildL3Children(
  l3Question: any,
  l3NodeId: string,
  baseX: number,
  startY: number,
  ihData: any[],
  l4Data: any[],
  l5Data: any[],
  l6Data: any[],
  context: HierarchyBuilderContext
): number {
  let currentY = startY;

  // Filter IH for this L3
  const l3IHs = ihData.filter(ih => {
    const ihId = ih.ih_id || '';
    return ihId.includes(l3Question.id);
  });

  // Filter L4 for this L3
  const l3L4s = l4Data.filter(l4 => {
    const l4Id = l4.id || '';
    return l4Id.includes(l3Question.id);
  });

  let ihFinalY = currentY;
  let l4FinalY = currentY;

  // Build IH group if exists
  if (l3IHs.length > 0) {
    ihFinalY = buildIHGroup(l3Question.id, l3NodeId, baseX - 200, currentY, l3IHs, context);
  }

  // Build L4 hierarchy if exists
  if (l3L4s.length > 0) {
    l4FinalY = buildL4Group(l3Question.id, l3NodeId, baseX + 200, currentY, l3L4s, l5Data, l6Data, context);
  }

  return Math.max(ihFinalY, l4FinalY);
}

/**
 * Build IH group for an L3 question
 */
function buildIHGroup(
  l3Id: string,
  l3NodeId: string,
  baseX: number,
  startY: number,
  ihs: any[],
  context: HierarchyBuilderContext
): number {
  const { nodes, edges, collapsedGroups, config } = context;
  const { verticalSpacing } = config;

  const ihGroupId = `ih-group-${l3Id}`;

  // Create IH group node
  const ihGroupNode = createGroupNode(
    ihGroupId,
    'IH',
    { x: baseX, y: startY },
    'ih_group',
    NODE_COLORS.ih,
    ihs.length,
    { hypotheses: ihs, l3Id },
    l3NodeId
  );
  nodes.push(ihGroupNode);

  // Connect to L3
  edges.push({
    id: `${l3NodeId}-${ihGroupId}`,
    source: l3NodeId,
    target: ihGroupId,
    type: 'smoothstep',
    animated: true,
    style: { stroke: NODE_COLORS.ih, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.ih },
  });

  let currentY = startY + verticalSpacing.groupToChildren;

  // Expand IH if not collapsed
  if (!collapsedGroups.has(ihGroupId)) {
    ihs.forEach((ih, idx) => {
      const pos = calculateChildGridPosition(
        idx,
        2, // 2 IH per row
        baseX,
        currentY,
        280,
        verticalSpacing.childRows
      );

      const ihNodeId = `ih-${ih.ih_id}`;

      nodes.push({
        id: ihNodeId,
        type: 'default',
        position: pos,
        data: {
          label: `${ih.process_hypothesis?.substring(0, 60)}${ih.process_hypothesis && ih.process_hypothesis.length > 60 ? '...' : ''}`,
          fullData: ih,
          type: 'ih',
          parentGroup: ihGroupId,
        },
        style: {
          background: `linear-gradient(135deg, ${NODE_COLORS.ih}20, ${NODE_COLORS.ih}30)`,
          color: 'hsl(var(--foreground))',
          border: `1.5px solid ${NODE_COLORS.ih}`,
          borderRadius: '10px',
          padding: '8px',
          fontSize: '9px',
          fontWeight: '600',
          width: 240,
          boxShadow: `0 0 15px ${NODE_COLORS.ih}40`,
        },
      });

      edges.push({
        id: `${ihGroupId}-${ihNodeId}`,
        source: ihGroupId,
        target: ihNodeId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: NODE_COLORS.ih, strokeWidth: 1, strokeDasharray: '2,2' },
        markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.ih },
      });
    });

    const rows = Math.ceil(ihs.length / 2);
    currentY += rows * verticalSpacing.childRows;
  }

  return currentY + verticalSpacing.betweenLevels;
}

/**
 * Build L4 group and its L5/L6 children
 */
function buildL4Group(
  l3Id: string,
  l3NodeId: string,
  baseX: number,
  startY: number,
  l4s: any[],
  l5Data: any[],
  l6Data: any[],
  context: HierarchyBuilderContext
): number {
  const { nodes, edges, collapsedGroups, config } = context;
  const { verticalSpacing } = config;

  const l4GroupId = `l4-group-${l3Id}`;

  // Create L4 group node
  const l4GroupNode = createGroupNode(
    l4GroupId,
    'L4',
    { x: baseX, y: startY },
    'l4_group',
    NODE_COLORS.l4,
    l4s.length,
    { questions: l4s, l3Id },
    l3NodeId
  );
  nodes.push(l4GroupNode);

  // Connect to L3
  edges.push({
    id: `${l3NodeId}-${l4GroupId}`,
    source: l3NodeId,
    target: l4GroupId,
    type: 'smoothstep',
    animated: true,
    style: { stroke: NODE_COLORS.l4, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l4 },
  });

  let currentY = startY + verticalSpacing.groupToChildren;

  // Expand L4 if not collapsed
  if (!collapsedGroups.has(l4GroupId)) {
    l4s.forEach((l4, idx) => {
      const pos = calculateChildGridPosition(
        idx,
        2, // 2 L4 per row
        baseX,
        currentY,
        280,
        verticalSpacing.childRows
      );

      const l4NodeId = `l4-${l4.id}`;

      nodes.push({
        id: l4NodeId,
        type: 'default',
        position: pos,
        data: {
          label: `${l4.text?.substring(0, 50)}${l4.text && l4.text.length > 50 ? '...' : ''}`,
          fullData: l4,
          type: 'l4',
          parentGroup: l4GroupId,
        },
        style: {
          background: `linear-gradient(135deg, ${NODE_COLORS.l4}20, ${NODE_COLORS.l4}30)`,
          color: 'hsl(var(--foreground))',
          border: `1.5px solid ${NODE_COLORS.l4}`,
          borderRadius: '10px',
          padding: '7px',
          fontSize: '9px',
          fontWeight: '600',
          width: 200,
          boxShadow: `0 0 15px ${NODE_COLORS.l4}40`,
        },
      });

      edges.push({
        id: `${l4GroupId}-${l4NodeId}`,
        source: l4GroupId,
        target: l4NodeId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: NODE_COLORS.l4, strokeWidth: 0.5, strokeDasharray: '1,1' },
        markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l4 },
      });

      // Build L5/L6 children for this L4
      const l4ChildY = pos.y + verticalSpacing.groupToChildren;
      const finalY = buildL5L6Hierarchy(l4.id, l4NodeId, pos.x, l4ChildY, l5Data, l6Data, context);
      currentY = Math.max(currentY, finalY);
    });

    const rows = Math.ceil(l4s.length / 2);
    currentY = startY + verticalSpacing.groupToChildren + rows * verticalSpacing.childRows;
  }

  return currentY + verticalSpacing.betweenLevels;
}

/**
 * Build L5/L6 hierarchy for an L4 question
 */
function buildL5L6Hierarchy(
  l4Id: string,
  l4NodeId: string,
  baseX: number,
  startY: number,
  l5Data: any[],
  l6Data: any[],
  context: HierarchyBuilderContext
): number {
  const { nodes, edges, collapsedGroups, config } = context;
  const { verticalSpacing } = config;

  // Filter L5 for this L4
  const l4L5s = l5Data.filter(l5 => l5.parent_l4_id === l4Id);

  if (l4L5s.length === 0) return startY;

  const l5GroupId = `l5-group-${l4Id}`;

  // Create L5 group node
  const l5GroupNode = createGroupNode(
    l5GroupId,
    'L5',
    { x: baseX, y: startY },
    'l5_group',
    NODE_COLORS.l5,
    l4L5s.length,
    { drills: l4L5s, l4Id },
    l4NodeId
  );
  nodes.push(l5GroupNode);

  // Connect to L4
  edges.push({
    id: `${l4NodeId}-${l5GroupId}`,
    source: l4NodeId,
    target: l5GroupId,
    type: 'smoothstep',
    animated: true,
    style: { stroke: NODE_COLORS.l5, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l5 },
  });

  let currentY = startY + verticalSpacing.groupToChildren;

  // Expand L5 if not collapsed
  if (!collapsedGroups.has(l5GroupId)) {
    l4L5s.forEach((l5, idx) => {
      const pos = calculateChildGridPosition(
        idx,
        2, // 2 L5 per row
        baseX,
        currentY,
        220,
        100
      );

      const l5NodeId = `l5-${l5.id}`;

      nodes.push({
        id: l5NodeId,
        type: 'default',
        position: pos,
        data: {
          label: `${l5.text?.substring(0, 40)}${l5.text && l5.text.length > 40 ? '...' : ''}`,
          fullData: l5,
          type: 'l5',
          parentGroup: l5GroupId,
        },
        style: {
          background: `linear-gradient(135deg, ${NODE_COLORS.l5}20, ${NODE_COLORS.l5}30)`,
          color: 'hsl(var(--foreground))',
          border: `1.5px solid ${NODE_COLORS.l5}`,
          borderRadius: '10px',
          padding: '7px',
          fontSize: '8px',
          fontWeight: '600',
          width: 180,
          boxShadow: `0 0 15px ${NODE_COLORS.l5}40`,
        },
      });

      edges.push({
        id: `${l5GroupId}-${l5NodeId}`,
        source: l5GroupId,
        target: l5NodeId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: NODE_COLORS.l5, strokeWidth: 0.5, strokeDasharray: '1,1' },
        markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l5 },
      });

      // Build L6 children for this L5
      const l6FinalY = buildL6Group(l5.id, l5NodeId, pos.x, pos.y + verticalSpacing.groupToChildren, l6Data, context);
      currentY = Math.max(currentY, l6FinalY);
    });

    const rows = Math.ceil(l4L5s.length / 2);
    currentY = startY + verticalSpacing.groupToChildren + rows * 100;
  }

  return currentY + verticalSpacing.betweenLevels;
}

/**
 * Build L6 group for an L5 drill
 */
function buildL6Group(
  l5Id: string,
  l5NodeId: string,
  baseX: number,
  startY: number,
  l6Data: any[],
  context: HierarchyBuilderContext
): number {
  const { nodes, edges, collapsedGroups, config } = context;
  const { verticalSpacing } = config;

  // Filter L6 for this L5
  const l5L6s = l6Data.filter(l6 => l6.parent_l5_id === l5Id);

  if (l5L6s.length === 0) return startY;

  const l6GroupId = `l6-group-${l5Id}`;

  // Create L6 group node
  const l6GroupNode = createGroupNode(
    l6GroupId,
    'L6',
    { x: baseX, y: startY },
    'l6_group',
    NODE_COLORS.l6,
    l5L6s.length,
    { tasks: l5L6s, l5Id },
    l5NodeId
  );
  nodes.push(l6GroupNode);

  // Connect to L5
  edges.push({
    id: `${l5NodeId}-${l6GroupId}`,
    source: l5NodeId,
    target: l6GroupId,
    type: 'smoothstep',
    animated: true,
    style: { stroke: NODE_COLORS.l6, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l6 },
  });

  let currentY = startY + verticalSpacing.groupToChildren;

  // Expand L6 if not collapsed
  if (!collapsedGroups.has(l6GroupId)) {
    l5L6s.forEach((l6, idx) => {
      const pos = calculateChildGridPosition(
        idx,
        2, // 2 L6 per row
        baseX,
        currentY,
        200,
        90
      );

      const l6NodeId = `l6-${l6.id}`;

      nodes.push({
        id: l6NodeId,
        type: 'default',
        position: pos,
        data: {
          label: `${l6.title?.substring(0, 35)}${l6.title && l6.title.length > 35 ? '...' : ''}`,
          fullData: l6,
          type: 'l6',
          parentGroup: l6GroupId,
        },
        style: {
          background: `linear-gradient(135deg, ${NODE_COLORS.l6}20, ${NODE_COLORS.l6}30)`,
          color: 'hsl(var(--foreground))',
          border: `1.5px solid ${NODE_COLORS.l6}`,
          borderRadius: '10px',
          padding: '6px',
          fontSize: '8px',
          fontWeight: '600',
          width: 160,
          boxShadow: `0 0 15px ${NODE_COLORS.l6}40`,
        },
      });

      edges.push({
        id: `${l6GroupId}-${l6NodeId}`,
        source: l6GroupId,
        target: l6NodeId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: NODE_COLORS.l6, strokeWidth: 0.5, strokeDasharray: '1,1' },
        markerEnd: { type: MarkerType.ArrowClosed, color: NODE_COLORS.l6 },
      });
    });

    const rows = Math.ceil(l5L6s.length / 2);
    currentY += rows * 90;
  }

  return currentY + verticalSpacing.betweenLevels;
}

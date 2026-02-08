/**
 * Hierarchical Graph Layout System
 *
 * Handles collapsible/expandable node hierarchies for the OMEGA-POINT graph visualization
 *
 * Hierarchy Structure:
 * - Q0 (root)
 *   - Goals (G1, G2, ...)
 *     - SPVs, RAs, S-nodes (per goal)
 *     - L3 Questions (per goal)
 *       - Instantiation Hypotheses (IH, per L3)
 *       - L4 Questions (per L3)
 *         - L5 Mechanistic Drills (per L4)
 *           - L6 Tasks (per L5)
 */

import { Node } from 'reactflow';

export interface LayoutConfig {
  verticalSpacing: {
    betweenLevels: number;
    groupToChildren: number;
    childRows: number;
  };
  horizontalSpacing: {
    goalColumns: number;
    childColumns: number;
    childrenPerRow: number;
  };
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  verticalSpacing: {
    betweenLevels: 300,
    groupToChildren: 180,
    childRows: 120,
  },
  horizontalSpacing: {
    goalColumns: 450,
    childColumns: 300,
    childrenPerRow: 3,
  },
};

/**
 * Calculate grid position for child nodes
 */
export function calculateChildGridPosition(
  index: number,
  itemsPerRow: number,
  baseX: number,
  baseY: number,
  colSpacing: number,
  rowSpacing: number
): { x: number; y: number } {
  const row = Math.floor(index / itemsPerRow);
  const col = index % itemsPerRow;

  // Center items horizontally
  const totalWidth = (itemsPerRow - 1) * colSpacing;
  const offsetX = col * colSpacing - totalWidth / 2;

  return {
    x: baseX + offsetX,
    y: baseY + row * rowSpacing,
  };
}

/**
 * Check if a node or any of its ancestors are collapsed
 */
export function isNodeOrAncestorCollapsed(
  nodeId: string,
  collapsedGroups: Set<string>,
  nodes: Node[]
): boolean {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return false;

  // Check if this node's parent group is collapsed
  const parentGroup = node.data?.parentGroup;
  if (parentGroup && collapsedGroups.has(parentGroup)) {
    return true;
  }

  // Recursively check parent's ancestors
  if (parentGroup) {
    return isNodeOrAncestorCollapsed(parentGroup, collapsedGroups, nodes);
  }

  return false;
}

/**
 * Calculate Y offset after rendering a set of expandable children
 */
export function calculateYOffsetAfterChildren(
  baseY: number,
  childCount: number,
  itemsPerRow: number,
  rowSpacing: number,
  isExpanded: boolean
): number {
  if (!isExpanded || childCount === 0) {
    return baseY;
  }

  const rows = Math.ceil(childCount / itemsPerRow);
  return baseY + rows * rowSpacing;
}

/**
 * Create a collapsible group node
 */
export function createGroupNode(
  id: string,
  label: string,
  position: { x: number; y: number },
  type: string,
  color: string,
  childCount: number,
  fullData: any = {},
  parentGroup?: string
): Node {
  return {
    id,
    type: 'default',
    position,
    data: {
      label: `${label} (${childCount})`,
      fullData,
      type,
      parentGroup,
      isGroup: true,
    },
    style: {
      background: `linear-gradient(135deg, ${color}15, ${color}20)`,
      color: 'hsl(var(--foreground))',
      border: `2px solid ${color}`,
      borderRadius: '12px',
      padding: '14px',
      fontSize: '11px',
      fontWeight: '700',
      width: 200,
      minHeight: 80,
      boxShadow: `0 0 18px ${color}40`,
      cursor: 'pointer',
      textAlign: 'center' as const,
    },
  };
}

import dagre from 'dagre';
import { Node, Edge } from 'reactflow';

export interface LayoutOptions {
  direction: 'TB' | 'LR' | 'BT' | 'RL';
  nodeWidth: number;
  nodeHeight: number;
  rankSep: number;
  nodeSep: number;
  edgeSep: number;
}

const defaultOptions: LayoutOptions = {
  direction: 'TB',
  nodeWidth: 250,
  nodeHeight: 100,
  rankSep: 120,
  nodeSep: 80,
  edgeSep: 10,
};

/**
 * Apply dagre hierarchical layout to nodes
 */
export const getHierarchicalLayout = (
  nodes: Node[],
  edges: Edge[],
  options: Partial<LayoutOptions> = {}
): Node[] => {
  const opts = { ...defaultOptions, ...options };

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: opts.direction,
    ranksep: opts.rankSep,
    nodesep: opts.nodeSep,
    edgesep: opts.edgeSep,
  });

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    const width = node.width || opts.nodeWidth;
    const height = node.height || opts.nodeHeight;
    dagreGraph.setNode(node.id, { width, height });
  });

  // Add edges to dagre graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Calculate layout
  dagre.layout(dagreGraph);

  // Apply layout positions to nodes
  return nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const width = node.width || opts.nodeWidth;
    const height = node.height || opts.nodeHeight;

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - width / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });
};

/**
 * Get radial layout positions (circular arrangement by level)
 */
export const getRadialLayout = (nodes: Node[], edges: Edge[]): Node[] => {
  // Build hierarchy levels
  const levels: Map<string, number> = new Map();
  const children: Map<string, Set<string>> = new Map();

  // Find root nodes (no incoming edges)
  const hasIncoming = new Set(edges.map(e => e.target));
  const roots = nodes.filter(n => !hasIncoming.has(n.id)).map(n => n.id);

  // Build parent-child relationships
  edges.forEach(edge => {
    if (!children.has(edge.source)) {
      children.set(edge.source, new Set());
    }
    children.get(edge.source)!.add(edge.target);
  });

  // BFS to assign levels
  const queue: Array<{ id: string; level: number }> = roots.map(id => ({ id, level: 0 }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    levels.set(id, level);

    const nodeChildren = children.get(id) || new Set();
    nodeChildren.forEach(childId => {
      queue.push({ id: childId, level: level + 1 });
    });
  }

  // Group nodes by level
  const nodesByLevel: Map<number, string[]> = new Map();
  nodes.forEach(node => {
    const level = levels.get(node.id) ?? 0;
    if (!nodesByLevel.has(level)) {
      nodesByLevel.set(level, []);
    }
    nodesByLevel.get(level)!.push(node.id);
  });

  // Calculate positions
  const centerX = 0;
  const centerY = 0;
  const levelRadius = 300; // Base radius per level

  return nodes.map(node => {
    const level = levels.get(node.id) ?? 0;
    const nodesInLevel = nodesByLevel.get(level) || [];
    const indexInLevel = nodesInLevel.indexOf(node.id);
    const totalInLevel = nodesInLevel.length;

    if (level === 0) {
      // Center the root
      return {
        ...node,
        position: { x: centerX, y: centerY },
      };
    }

    // Arrange in circle
    const radius = level * levelRadius;
    const angle = (indexInLevel / totalInLevel) * 2 * Math.PI - Math.PI / 2;

    return {
      ...node,
      position: {
        x: centerX + radius * Math.cos(angle) - 125,
        y: centerY + radius * Math.sin(angle) - 50,
      },
    };
  });
};

/**
 * Get force-directed layout using simple physics simulation
 */
export const getForceLayout = (nodes: Node[], edges: Edge[]): Node[] => {
  const simulation = {
    nodes: nodes.map(n => ({
      id: n.id,
      x: n.position?.x || Math.random() * 1000,
      y: n.position?.y || Math.random() * 1000,
      vx: 0,
      vy: 0,
    })),
    edges: edges,
  };

  const nodeMap = new Map(simulation.nodes.map(n => [n.id, n]));

  // Run simulation iterations
  const iterations = 100;
  const repulsionStrength = 10000;
  const attractionStrength = 0.01;
  const damping = 0.9;

  for (let iter = 0; iter < iterations; iter++) {
    // Repulsion between all nodes
    for (let i = 0; i < simulation.nodes.length; i++) {
      for (let j = i + 1; j < simulation.nodes.length; j++) {
        const n1 = simulation.nodes[i];
        const n2 = simulation.nodes[j];
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsionStrength / (distance * distance);

        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;

        n1.vx -= fx;
        n1.vy -= fy;
        n2.vx += fx;
        n2.vy += fy;
      }
    }

    // Attraction along edges
    simulation.edges.forEach(edge => {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) return;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = distance * attractionStrength;

      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;

      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    });

    // Update positions
    simulation.nodes.forEach(n => {
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;
    });
  }

  return nodes.map(node => {
    const simNode = nodeMap.get(node.id);
    return {
      ...node,
      position: simNode ? { x: simNode.x, y: simNode.y } : node.position,
    };
  });
};

/**
 * Calculate node dimensions based on type
 */
export const getNodeDimensions = (type: string): { width: number; height: number } => {
  switch (type) {
    case 'q0':
    case 'master':
      return { width: 400, height: 120 };
    case 'goal':
      return { width: 280, height: 100 };
    case 'cluster':
    case 'domain':
      return { width: 320, height: 140 };
    case 'ra':
    case 'l3':
      return { width: 280, height: 80 };
    case 'spv':
    case 'ih':
    case 'l4':
      return { width: 220, height: 70 };
    case 'l5':
    case 'l6':
    case 'compact':
      return { width: 180, height: 50 };
    default:
      return { width: 250, height: 80 };
  }
};

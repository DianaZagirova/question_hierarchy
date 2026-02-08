import React, { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { ChevronDown, ChevronRight, Layers, FlaskConical, Target, ListChecks, Lightbulb, Workflow, Microscope, Info } from 'lucide-react';

// Color scheme for different node types
export const NODE_COLORS = {
  q0: { bg: 'from-blue-500/20 to-green-500/20', border: 'border-blue-500/60', glow: 'shadow-blue-500/40', text: 'text-blue-400' },
  goal: { bg: 'from-purple-500/20 to-pink-500/20', border: 'border-purple-500/60', glow: 'shadow-purple-500/40', text: 'text-purple-400' },
  spv: { bg: 'from-amber-500/20 to-orange-500/20', border: 'border-amber-500/60', glow: 'shadow-amber-500/40', text: 'text-amber-400' },
  ra: { bg: 'from-emerald-500/20 to-green-500/20', border: 'border-emerald-500/60', glow: 'shadow-emerald-500/40', text: 'text-emerald-400' },
  domain: { bg: 'from-cyan-500/20 to-teal-500/20', border: 'border-cyan-500/60', glow: 'shadow-cyan-500/40', text: 'text-cyan-400' },
  domain_group: { bg: 'from-cyan-500/20 to-teal-500/20', border: 'border-cyan-500/60', glow: 'shadow-cyan-500/40', text: 'text-cyan-400' },
  scientific: { bg: 'from-cyan-500/20 to-blue-500/20', border: 'border-cyan-500/60', glow: 'shadow-cyan-500/40', text: 'text-cyan-400' },
  l3: { bg: 'from-red-500/20 to-rose-500/20', border: 'border-red-500/60', glow: 'shadow-red-500/40', text: 'text-red-400' },
  ih: { bg: 'from-orange-500/20 to-amber-500/20', border: 'border-orange-500/60', glow: 'shadow-orange-500/40', text: 'text-orange-400' },
  l4: { bg: 'from-lime-500/20 to-green-500/20', border: 'border-lime-500/60', glow: 'shadow-lime-500/40', text: 'text-lime-400' },
  l5: { bg: 'from-green-400/20 to-lime-400/20', border: 'border-green-400/60', glow: 'shadow-green-400/40', text: 'text-green-400' },
  l6: { bg: 'from-teal-500/20 to-cyan-500/20', border: 'border-teal-500/60', glow: 'shadow-teal-500/40', text: 'text-teal-400' },
  common_l6: { bg: 'from-yellow-500/20 to-amber-500/20', border: 'border-yellow-500/60', glow: 'shadow-yellow-500/40', text: 'text-yellow-400' },
  common_l6_fail: { bg: 'from-red-900/20 to-slate-800/20', border: 'border-red-800/60', glow: 'shadow-red-900/20', text: 'text-red-400' },
  cluster: { bg: 'from-slate-700/10 to-slate-800/10', border: 'border-slate-600/40', glow: 'shadow-slate-600/20', text: 'text-slate-400' },
};

const getNodeIcon = (type: string) => {
  switch (type) {
    case 'q0': return <Target className="w-4 h-4" />;
    case 'goal': return <Layers className="w-4 h-4" />;
    case 'ra': return <ListChecks className="w-4 h-4" />;
    case 'domain': return <Microscope className="w-4 h-4" />;
    case 'scientific': return <FlaskConical className="w-4 h-4" />;
    case 'l3': return <Lightbulb className="w-4 h-4" />;
    case 'l6': return <Workflow className="w-4 h-4" />;
    case 'common_l6': return <FlaskConical className="w-4 h-4" />;
    case 'common_l6_fail': return <FlaskConical className="w-4 h-4" />;
    default: return null;
  }
};

// Standard Node Component (for most node types)
export const StandardNode = memo(({ data, selected }: NodeProps) => {
  const colors = NODE_COLORS[data.type as keyof typeof NODE_COLORS] || NODE_COLORS.cluster;
  const hasFullText = data.fullText && data.fullText !== data.label;

  return (
    <div
      className={`
        relative px-3 py-2 rounded-lg border-2 bg-gradient-to-br
        ${colors.bg} ${colors.border}
        ${selected ? 'ring-2 ring-green-400 ring-offset-2 ring-offset-slate-900' : ''}
        shadow-lg ${colors.glow}
        hover:scale-105 transition-all duration-200
        min-w-[180px] max-w-[280px]
        group
      `}
      title={hasFullText ? data.fullText : data.label} // Tooltip with full text
    >
      <Handle type="target" position={Position.Top} className="w-2 h-2 bg-slate-400" />

      <div className="flex items-start gap-2">
        <div className={`mt-0.5 ${colors.text}`}>
          {getNodeIcon(data.type)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-foreground leading-tight break-words">
            {data.label}
          </div>
          {hasFullText && (
            <div className="text-[9px] text-blue-400 mt-0.5 italic opacity-0 group-hover:opacity-100 transition-opacity">
              Hover for full text
            </div>
          )}
          {data.subtitle && (
            <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
              {data.subtitle}
            </div>
          )}
          {data.metrics && (
            <div className="flex gap-2 mt-1.5 text-[9px]">
              {data.metrics.map((metric: any, idx: number) => (
                <span key={idx} className="px-1.5 py-0.5 rounded bg-slate-800/50 text-slate-300">
                  {metric.label}: {metric.value}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="w-2 h-2 bg-slate-400" />
    </div>
  );
});

StandardNode.displayName = 'StandardNode';

// Cluster Node Component (for collapsible groups)
export const ClusterNode = memo(({ data, selected }: NodeProps) => {
  // Always use type color (not gray) for consistent, vibrant design
  const colors = NODE_COLORS[data.type as keyof typeof NODE_COLORS] || NODE_COLORS.cluster;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.onToggle) {
      data.onToggle();
    }
    // Also select the node to show details
    if (data.onSelect) {
      data.onSelect();
    }
  };

  const handleInfoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.onSelect) {
      data.onSelect();
    }
  };

  return (
    <div
      className={`
        relative px-4 py-3 rounded-xl border-2 bg-gradient-to-br
        ${colors.bg} ${colors.border}
        ${selected ? 'ring-2 ring-green-400 ring-offset-2 ring-offset-slate-900' : ''}
        shadow-xl ${colors.glow}
        hover:scale-[1.02] hover:shadow-2xl transition-all duration-200
        min-w-[220px] max-w-[360px]
        cursor-pointer group
      `}
      onClick={handleToggle}
      title="Click to expand/collapse"
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-slate-400" />

      <div className="flex items-start gap-3">
        {/* Chevron Icon */}
        <div className={`mt-0.5 ${colors.text} flex-shrink-0 transition-transform duration-200 ${data.expanded ? '' : 'group-hover:translate-x-0.5'}`}>
          {data.expanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title with icon */}
          <div className="flex items-center gap-2 mb-1">
            <div className={colors.text}>
              {getNodeIcon(data.type)}
            </div>
            <div className="text-sm font-bold text-foreground flex-1">
              {data.title}
            </div>
            {data.onSelect && (
              <button
                onClick={handleInfoClick}
                className={`p-1 rounded hover:bg-slate-700/60 ${colors.text} opacity-60 hover:opacity-100 transition-opacity flex-shrink-0`}
                title="Show details"
              >
                <Info className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Description */}
          <div className="text-[11px] text-muted-foreground mb-2">
            {data.description}
          </div>

          {/* Stats badges */}
          <div className="flex flex-wrap gap-2">
            {data.stats?.map((stat: any, idx: number) => (
              <div key={idx} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800/60 text-[10px] border border-slate-700/50">
                <span className="text-slate-400">{stat.label}:</span>
                <span className={`font-semibold ${colors.text}`}>{stat.value}</span>
              </div>
            ))}
          </div>

          {/* Preview (shown when collapsed) */}
          {!data.expanded && data.preview && data.preview.length > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-slate-700/50">
              <div className="text-[9px] text-slate-400 mb-1.5 uppercase tracking-wide font-semibold">
                Preview (top {data.preview.length}):
              </div>
              {data.preview.map((item: string, idx: number) => (
                <div key={idx} className="text-[10px] text-slate-300 truncate leading-relaxed">
                  • {item}
                </div>
              ))}
            </div>
          )}

          {/* Expanded indicator */}
          {data.expanded && (
            <div className="mt-2 text-[10px] text-green-400 font-semibold">
              ✓ Expanded - showing all items
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-slate-400" />
    </div>
  );
});

ClusterNode.displayName = 'ClusterNode';

// Compact Node (for L5/L6 leaf nodes)
export const CompactNode = memo(({ data, selected }: NodeProps) => {
  const colors = NODE_COLORS[data.type as keyof typeof NODE_COLORS] || NODE_COLORS.cluster;
  const hasFullText = data.fullText && data.fullText !== data.label;

  return (
    <div
      className={`
        relative px-2 py-1.5 rounded-md border bg-gradient-to-br
        ${colors.bg} ${colors.border}
        ${selected ? 'ring-2 ring-green-400' : ''}
        shadow-md ${colors.glow}
        hover:scale-110 transition-all duration-200
        min-w-[140px] max-w-[200px]
      `}
      title={hasFullText ? data.fullText : data.label} // Tooltip with full text
    >
      <Handle type="target" position={Position.Top} className="w-1.5 h-1.5 bg-slate-400" />

      <div className="flex items-center gap-1.5">
        <div className={`${colors.text}`}>
          {getNodeIcon(data.type)}
        </div>
        <div className="text-[10px] font-medium text-foreground leading-tight truncate flex-1">
          {data.label}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} className="w-1.5 h-1.5 bg-slate-400" />
    </div>
  );
});

CompactNode.displayName = 'CompactNode';

// Master Q0 Node (special design)
export const MasterNode = memo(({ data, selected }: NodeProps) => {
  const hasFullText = data.fullText && data.fullText !== data.label;

  return (
    <div
      className={`
        relative px-5 py-4 rounded-2xl border-2 bg-gradient-to-br
        from-blue-500/20 via-purple-500/20 to-green-500/20
        border-blue-500/60
        ${selected ? 'ring-3 ring-green-400 ring-offset-2 ring-offset-slate-900' : ''}
        shadow-2xl shadow-blue-500/40
        hover:scale-105 transition-all duration-300
        min-w-[300px] max-w-[400px]
        group
      `}
      title={hasFullText ? data.fullText : data.label} // Tooltip with full text
    >
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-blue-400" />

      <div className="flex items-start gap-3">
        <div className="text-blue-400 mt-0.5">
          <Target className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <div className="text-xs font-bold text-blue-400 mb-1">MASTER QUESTION (Q₀)</div>
          <div className="text-sm font-semibold text-foreground leading-relaxed">
            {data.label}
          </div>
          {hasFullText && (
            <div className="text-[10px] text-blue-300 mt-1 italic opacity-0 group-hover:opacity-100 transition-opacity">
              Click for full text →
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

MasterNode.displayName = 'MasterNode';

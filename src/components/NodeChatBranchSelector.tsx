import React, { useMemo } from 'react';
import { ChevronRight, GitBranch, Target, Beaker, FlaskConical, Microscope } from 'lucide-react';
import { PipelineStep } from '@/types';
import { getNodeDescendants, getNodesByType, SelectedNodeData } from '@/lib/chatContextBuilder';

interface NodeChatBranchSelectorProps {
  steps: PipelineStep[];
  highlightedL6Ids: string[];
  onAddNodes: (nodes: SelectedNodeData[]) => void;
}

const TYPE_BADGE_COLORS: Record<string, string> = {
  goal: 'bg-purple-500/30 text-purple-200 border border-purple-400/30',
  l3: 'bg-red-500/30 text-red-200 border border-red-400/30',
  ih: 'bg-orange-500/30 text-orange-200 border border-orange-400/30',
  l4: 'bg-lime-500/30 text-lime-200 border border-lime-400/30',
  l6: 'bg-teal-500/30 text-teal-200 border border-teal-400/30',
};

export const NodeChatBranchSelector: React.FC<NodeChatBranchSelectorProps> = ({
  steps,
  highlightedL6Ids,
  onAddNodes,
}) => {
  const tree = useMemo(() => {
    const s2 = steps.find(s => s.id === 2);
    const s6 = steps.find(s => s.id === 6);
    const s7 = steps.find(s => s.id === 7);
    const s8 = steps.find(s => s.id === 8);
    const s9 = steps.find(s => s.id === 9);

    const goals = s2?.output?.goals || [];
    const l3arr: any[] = s6?.output?.l3_questions || s6?.output?.seed_questions || [];
    const iharr: any[] = s7?.output?.instantiation_hypotheses || [];
    const l4arr: any[] = s8?.output?.l4_questions || [];
    const l5arr: any[] = s9?.output?.l5_nodes || [];
    const l6arr: any[] = s9?.output?.l6_tasks || [];

    return goals.map((g: any) => {
      const goalL3s = l3arr.filter(q => q.parent_goal_id === g.id || q.goal_id === g.id);
      return {
        id: g.id,
        type: 'goal' as const,
        label: g.title || g.name || g.id,
        fullData: g,
        children: goalL3s.map(l3 => {
          const l3IHs = iharr.filter(ih => ih.parent_l3_id === l3.id || ih.l3_id === l3.id);
          const l3L4Count = l3IHs.reduce((acc, ih) => {
            return acc + l4arr.filter(q => q.parent_ih_id === ih.id || q.ih_id === ih.id).length;
          }, 0);
          const l3L6Count = l3IHs.reduce((acc, ih) => {
            const ihL4s = l4arr.filter(q => q.parent_ih_id === ih.id || q.ih_id === ih.id);
            return acc + ihL4s.reduce((a2, l4) => {
              const l4L5s = l5arr.filter(n => n.parent_l4_id === l4.id || n.l4_id === l4.id);
              return a2 + l4L5s.reduce((a3, l5) => {
                return a3 + l6arr.filter(t => t.parent_l5_id === l5.id || t.l5_id === l5.id).length;
              }, 0);
            }, 0);
          }, 0);

          return {
            id: l3.id,
            type: 'l3' as const,
            label: l3.text || l3.title || l3.id,
            fullData: l3,
            ihCount: l3IHs.length,
            l4Count: l3L4Count,
            l6Count: l3L6Count,
          };
        }),
      };
    });
  }, [steps]);

  const handleAddBranch = (nodeId: string, nodeType: string, nodeData: any, nodeLabel: string) => {
    const self: SelectedNodeData = { id: nodeId, type: nodeType, label: nodeLabel, fullData: nodeData };
    const descendants = getNodeDescendants(nodeId, nodeType, steps);
    onAddNodes([self, ...descendants]);
  };

  const handleQuickAdd = (type: string) => {
    if (type === 'bestL6') {
      const l6Nodes = getNodesByType('l6', steps);
      const bestSet = new Set(highlightedL6Ids);
      const best = l6Nodes.filter(n => bestSet.has(n.id));
      onAddNodes(best.length > 0 ? best : l6Nodes.slice(0, 5));
    } else {
      onAddNodes(getNodesByType(type, steps));
    }
  };

  return (
    <div className="border-t border-border/30 bg-muted/10 rounded-b-lg">
      {/* Quick-add buttons */}
      <div className="flex flex-wrap gap-1.5 px-3 py-2.5 border-b border-border/20">
        <button
          onClick={() => handleQuickAdd('goal')}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-purple-500/15 border border-purple-400/35 text-purple-200 hover:bg-purple-500/25 hover:border-purple-400/50 transition-colors"
        >
          <Target className="w-3 h-3" /> All Goals
        </button>
        <button
          onClick={() => handleQuickAdd('l3')}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-red-500/15 border border-red-400/35 text-red-200 hover:bg-red-500/25 hover:border-red-400/50 transition-colors"
        >
          <Beaker className="w-3 h-3" /> All L3s
        </button>
        <button
          onClick={() => handleQuickAdd('bestL6')}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-teal-500/15 border border-teal-400/35 text-teal-200 hover:bg-teal-500/25 hover:border-teal-400/50 transition-colors"
        >
          <FlaskConical className="w-3 h-3" /> Best L6
        </button>
        <button
          onClick={() => handleQuickAdd('l6')}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-cyan-500/15 border border-cyan-400/35 text-cyan-200 hover:bg-cyan-500/25 hover:border-cyan-400/50 transition-colors"
        >
          <Microscope className="w-3 h-3" /> All L6
        </button>
      </div>

      {/* Tree */}
      <div className="max-h-[300px] overflow-y-auto px-2 py-2 space-y-0.5">
        {tree.map((goal: any) => (
          <div key={goal.id}>
            {/* Goal row */}
            <div className="flex items-center gap-2 group px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors">
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${TYPE_BADGE_COLORS.goal}`}>Goal</span>
              <span className="flex-1 text-xs text-foreground/85 truncate font-medium">{goal.label}</span>
              <button
                onClick={() => handleAddBranch(goal.id, 'goal', goal.fullData, goal.label)}
                className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 border border-purple-400/35 text-purple-200 hover:bg-purple-500/25 transition-all"
                title="Add goal + all descendants"
              >
                <GitBranch className="w-3 h-3" />
                Branch
              </button>
            </div>

            {/* L3 children */}
            {goal.children.map((l3: any) => (
              <div
                key={l3.id}
                className="flex items-center gap-2 group pl-6 pr-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors"
              >
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${TYPE_BADGE_COLORS.l3}`}>L3</span>
                <span className="flex-1 text-[11px] text-foreground/75 truncate">{l3.label}</span>
                {(l3.l4Count > 0 || l3.l6Count > 0) && (
                  <span className="text-[9px] text-foreground/40 shrink-0 tabular-nums">
                    {l3.ihCount > 0 && `${l3.ihCount}IH `}
                    {l3.l4Count > 0 && `${l3.l4Count}L4 `}
                    {l3.l6Count > 0 && `${l3.l6Count}L6`}
                  </span>
                )}
                <button
                  onClick={() => handleAddBranch(l3.id, 'l3', l3.fullData, l3.label)}
                  className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 border border-red-400/35 text-red-200 hover:bg-red-500/25 transition-all shrink-0"
                  title="Add L3 + all descendants"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        ))}
        {tree.length === 0 && (
          <p className="text-xs text-foreground/40 text-center py-6">
            No pipeline data yet. Run the pipeline to populate the tree.
          </p>
        )}
      </div>
    </div>
  );
};

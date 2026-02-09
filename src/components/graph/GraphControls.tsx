import React from 'react';
import { Search, Filter, Layers, Eye, EyeOff, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface GraphControlsProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  visibleLayers: Set<string>;
  onLayerToggle: (layer: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onResetView: () => void;
  layoutMode: 'hierarchical' | 'force' | 'radial';
  onLayoutChange: (mode: 'hierarchical' | 'force' | 'radial') => void;
}

const LAYERS = [
  { id: 'q0', label: 'Q₀', color: 'bg-blue-500', description: 'Root question — the primary research objective' },
  { id: 'goals', label: 'Goals', color: 'bg-purple-500', description: 'Goal Pillars — high-level teleological requirements decomposed from Q₀' },
  { id: 'spvs', label: 'SPVs', color: 'bg-amber-500', description: 'System Property Variables — measurable properties that bridge goals and science' },
  { id: 'ras', label: 'RAs', color: 'bg-emerald-500', description: 'Requirement Atoms — atomic functional specifications for each goal' },
  { id: 'domains', label: 'Domains', color: 'bg-cyan-500', description: 'Research Domains — scientific fields mapped to each goal for knowledge collection' },
  { id: 'l3', label: 'L3', color: 'bg-red-500', description: 'L3 Frontier Questions — strategic science questions that probe knowledge gaps' },
  { id: 'ih', label: 'IH', color: 'bg-orange-500', description: 'Instantiation Hypotheses — divergent hypotheses generated from L3 questions' },
  { id: 'l4', label: 'L4', color: 'bg-lime-500', description: 'L4 Tactical Questions — concrete experimental questions derived from L3s' },
  { id: 'l5', label: 'L5', color: 'bg-green-400', description: 'L5 Drill Branches — execution sub-problems that decompose each L4' },
  { id: 'l6', label: 'L6', color: 'bg-teal-500', description: 'L6 Leaf Specs — actionable experiment tasks with parameters and protocols' },
];

export const GraphControls: React.FC<GraphControlsProps> = ({
  searchTerm,
  onSearchChange,
  visibleLayers,
  onLayerToggle,
  onExpandAll,
  onCollapseAll,
  onResetView,
  layoutMode,
  onLayoutChange,
}) => {
  return (
    <div className="absolute top-4 left-4 z-10 flex flex-row items-start gap-2">
      {/* Column 1: Search + Visible Layers */}
      <div className="flex flex-col gap-2 w-[200px]">
        <div className="bg-card/95 backdrop-blur-sm rounded-lg shadow-lg p-3 border border-border/50">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search nodes..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 h-9 text-sm"
            />
          </div>
        </div>
        <div className="bg-card/95 backdrop-blur-sm rounded-lg shadow-lg p-3 border border-border/50">
          <div className="flex items-center gap-2 mb-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-semibold">Visible Layers</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {LAYERS.map((layer) => (
              <button
                key={layer.id}
                onClick={() => onLayerToggle(layer.id)}
                title={layer.description}
                className={`
                  px-2 py-1 rounded text-[10px] font-medium transition-all flex items-center gap-1.5
                  ${visibleLayers.has(layer.id)
                    ? `${layer.color} text-white shadow-md`
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                  }
                `}
              >
                {visibleLayers.has(layer.id) ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {layer.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Column 2: Layout */}
      <div className="bg-card/95 backdrop-blur-sm rounded-lg shadow-lg p-3 border border-border/50 w-[100px]">
        <div className="flex items-center gap-2 mb-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold">Layout</span>
        </div>
        <div className="flex flex-col gap-1">
          {(['hierarchical', 'force', 'radial'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onLayoutChange(mode)}
              className={`
                px-2 py-1.5 rounded text-[10px] font-medium transition-all capitalize
                ${layoutMode === mode
                  ? 'bg-blue-500 text-white shadow-md'
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                }
              `}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Column 3: Collapse / Expand / Reset */}
      <div className="bg-card/95 backdrop-blur-sm rounded-lg shadow-lg p-3 border border-border/50 w-[120px] flex flex-col gap-1.5">
        <Button size="sm" variant="outline" onClick={onExpandAll} className="w-full h-8 text-xs">
          Expand All
        </Button>
        <Button size="sm" variant="outline" onClick={onCollapseAll} className="w-full h-8 text-xs">
          Collapse All
        </Button>
        <Button size="sm" variant="outline" onClick={onResetView} className="w-full h-8 text-xs border-blue-500/40 text-blue-400 hover:bg-blue-500/10">
          <RotateCcw size={12} className="mr-1.5" />
          Reset
        </Button>
      </div>
    </div>
  );
};

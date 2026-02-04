import React from 'react';
import { Search, Filter, Layers, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface GraphControlsProps {
  searchTerm: string;
  onSearchChange: (term: string) => void;
  visibleLayers: Set<string>;
  onLayerToggle: (layer: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  layoutMode: 'hierarchical' | 'force' | 'radial';
  onLayoutChange: (mode: 'hierarchical' | 'force' | 'radial') => void;
}

const LAYERS = [
  { id: 'q0', label: 'Q₀', color: 'bg-blue-500' },
  { id: 'goals', label: 'Goals', color: 'bg-purple-500' },
  { id: 'spvs', label: 'SPVs', color: 'bg-amber-500' },
  { id: 'ras', label: 'RAs', color: 'bg-emerald-500' },
  { id: 'domains', label: 'Domains', color: 'bg-cyan-500' },
  { id: 'l3', label: 'L3', color: 'bg-red-500' },
  { id: 'ih', label: 'IH', color: 'bg-orange-500' },
  { id: 'l4', label: 'L4', color: 'bg-lime-500' },
  { id: 'l5', label: 'L5', color: 'bg-green-400' },
  { id: 'l6', label: 'L6', color: 'bg-teal-500' },
];

export const GraphControls: React.FC<GraphControlsProps> = ({
  searchTerm,
  onSearchChange,
  visibleLayers,
  onLayerToggle,
  onExpandAll,
  onCollapseAll,
  layoutMode,
  onLayoutChange,
}) => {
  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-3 max-w-sm">
      {/* Search */}
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

      {/* Layer Filters */}
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

      {/* Layout Controls */}
      <div className="bg-card/95 backdrop-blur-sm rounded-lg shadow-lg p-3 border border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold">Layout</span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(['hierarchical', 'force', 'radial'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onLayoutChange(mode)}
              className={`
                px-2 py-1 rounded text-[10px] font-medium transition-all capitalize
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

      {/* View Controls */}
      <div className="bg-card/95 backdrop-blur-sm rounded-lg shadow-lg p-3 border border-border/50 flex gap-2">
        <Button size="sm" variant="outline" onClick={onExpandAll} className="flex-1 h-8 text-xs">
          Expand All
        </Button>
        <Button size="sm" variant="outline" onClick={onCollapseAll} className="flex-1 h-8 text-xs">
          Collapse All
        </Button>
      </div>
    </div>
  );
};

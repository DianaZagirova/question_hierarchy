import React, { useState } from 'react';
import { Search, Filter, RotateCcw, Target, Layers, Lightbulb, FlaskConical, ListChecks, Microscope, Workflow, Focus, Maximize2, ChevronRight, ChevronDown, Home, Eye, EyeOff, PanelLeftClose, PanelLeftOpen, MessageCircle } from 'lucide-react';
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
  chatOpen?: boolean;
  onChatToggle?: () => void;
  chatNodeCount?: number;
  onJumpToQ0?: () => void;
  onJumpToGoals?: () => void;
  onFocusMode?: (goalId: string | null) => void;
  focusedGoalId?: string | null;
  availableGoals?: Array<{ id: string; title: string }>;
  onSmartExpand?: () => void;
  compactMode?: boolean;
  onCompactModeToggle?: () => void;
  totalNodeCount?: number;
  visibleNodeCount?: number;
}

const LAYERS = [
  { id: 'q0', label: 'Master Q', color: 'text-blue-400', dot: 'bg-blue-400', icon: Target },
  { id: 'goals', label: 'Goals', color: 'text-purple-400', dot: 'bg-purple-400', icon: Layers },
  { id: 'spvs', label: 'Properties', color: 'text-amber-400', dot: 'bg-amber-400', icon: FlaskConical },
  { id: 'ras', label: 'Requirements', color: 'text-emerald-400', dot: 'bg-emerald-400', icon: ListChecks },
  { id: 'domains', label: 'Domains', color: 'text-cyan-400', dot: 'bg-cyan-400', icon: Microscope },
  { id: 'l3', label: 'Questions', color: 'text-red-400', dot: 'bg-red-400', icon: Lightbulb },
  { id: 'ih', label: 'Hypotheses', color: 'text-orange-400', dot: 'bg-orange-400', icon: FlaskConical },
  { id: 'l4', label: 'Tactics', color: 'text-lime-400', dot: 'bg-lime-400', icon: Lightbulb },
  { id: 'l5', label: 'Sub-problems', color: 'text-green-400', dot: 'bg-green-400', icon: Workflow },
  { id: 'l6', label: 'Experiments', color: 'text-teal-400', dot: 'bg-teal-400', icon: Workflow },
];

const LAYER_DESCRIPTIONS: Record<string, string> = {
  q0: 'The root research objective — what are we trying to achieve?',
  goals: 'Required end-states — what must be true to solve Q₀?',
  spvs: 'Measurable system properties — the "dials" we can tune',
  ras: 'Atomic testable requirements per goal',
  domains: 'Research fields and their known science',
  l3: 'Frontier questions science can\'t answer yet',
  ih: 'Competing hypotheses for each question',
  l4: 'Discriminator questions — which experiment kills which hypothesis?',
  l5: 'Mechanistic drill-downs per tactic',
  l6: 'Concrete lab protocols with S-I-M-T parameters',
};

export const GraphControls: React.FC<GraphControlsProps> = ({
  searchTerm,
  onSearchChange,
  visibleLayers,
  onLayerToggle,
  onExpandAll,
  onCollapseAll,
  onResetView,
  chatOpen,
  onChatToggle,
  chatNodeCount,
  onJumpToQ0,
  onJumpToGoals,
  onFocusMode,
  focusedGoalId,
  availableGoals = [],
  onSmartExpand,
  compactMode = false,
  onCompactModeToggle,
  totalNodeCount = 0,
  visibleNodeCount = 0,
}) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [layersExpanded, setLayersExpanded] = useState(true);
  const [showFocusMenu, setShowFocusMenu] = useState(false);
  const [hoveredLayer, setHoveredLayer] = useState<string | null>(null);

  // Collapsed state — just a floating toolbar
  if (!panelOpen) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          onClick={() => setPanelOpen(true)}
          className="bg-card/90 backdrop-blur-sm rounded-lg shadow-lg p-2 border border-border/50 hover:bg-card transition-colors group"
          title="Open controls"
        >
          <PanelLeftOpen size={18} className="text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>
        {/* AI Chat floating button when collapsed */}
        {onChatToggle && (
          <button
            onClick={onChatToggle}
            className={`relative backdrop-blur-sm rounded-lg shadow-lg p-2.5 border-2 transition-all group ${
              chatOpen
                ? 'border-violet-400 bg-violet-500/25 shadow-violet-500/20'
                : 'border-violet-400/50 bg-violet-500/10 hover:bg-violet-500/20 hover:border-violet-400/80 hover:shadow-violet-500/15'
            }`}
            title="AI Research Chat"
          >
            <MessageCircle size={20} className={`transition-colors ${
              chatOpen ? 'text-violet-300' : 'text-violet-400 group-hover:text-violet-300'
            }`} />
            {chatNodeCount && chatNodeCount > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-violet-500 text-[8px] font-bold text-white flex items-center justify-center shadow-sm">
                {chatNodeCount}
              </span>
            ) : (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>
        )}
        <button
          onClick={onResetView}
          className="backdrop-blur-sm rounded-lg shadow-lg p-2.5 border-2 border-sky-400/50 bg-sky-500/10 hover:bg-sky-500/20 hover:border-sky-400/80 hover:shadow-sky-500/15 transition-all group"
          title="Reset view"
        >
          <RotateCcw size={20} className="text-sky-400 group-hover:text-sky-300 transition-colors" />
        </button>
      </div>
    );
  }

  // Expanded panel — single compact panel
  return (
    <div className="bg-card/95 backdrop-blur-sm rounded-lg shadow-xl border border-border/50 w-[200px] max-h-[calc(100vh-120px)] overflow-y-auto overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-bold text-foreground">Controls</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{visibleNodeCount}/{totalNodeCount}</span>
          <button
            onClick={() => setPanelOpen(false)}
            className="p-1 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
            title="Collapse panel"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border/20">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>
      </div>

      {/* Layer Toggles */}
      <div className="border-b border-border/20">
        <button
          onClick={() => setLayersExpanded(!layersExpanded)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-secondary/30 transition-colors"
        >
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold">Layers</span>
          </div>
          {layersExpanded ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
        </button>
        {layersExpanded && (
          <div className="px-2 pb-2 space-y-0.5">
            {LAYERS.map((layer) => {
              const isVisible = visibleLayers.has(layer.id);
              return (
                <div key={layer.id} className="relative">
                  <button
                    onClick={() => onLayerToggle(layer.id)}
                    onMouseEnter={() => setHoveredLayer(layer.id)}
                    onMouseLeave={() => setHoveredLayer(null)}
                    className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] transition-all ${
                      isVisible
                        ? `${layer.color} font-semibold bg-white/5`
                        : 'text-slate-500 line-through opacity-60 hover:opacity-80'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isVisible ? layer.dot : 'bg-slate-600'}`} />
                    <span className="flex-1 text-left">{layer.label}</span>
                    {isVisible ? <Eye size={10} className="opacity-40" /> : <EyeOff size={10} className="opacity-40" />}
                  </button>
                  {/* Tooltip */}
                  {hoveredLayer === layer.id && LAYER_DESCRIPTIONS[layer.id] && (
                    <div className="absolute left-full ml-2 top-0 z-50 w-[220px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-2.5 text-[10px] text-slate-300 leading-relaxed">
                      <span className={`font-bold ${layer.color}`}>{layer.label}:</span>{' '}
                      {LAYER_DESCRIPTIONS[layer.id]}
                    </div>
                  )}
                </div>
              );
            })}
            {/* Presets row */}
            <div className="flex gap-1 pt-1.5 border-t border-border/20 mt-1">
              <button
                onClick={() => {
                  ['q0', 'goals', 'ras'].forEach(l => { if (!visibleLayers.has(l)) onLayerToggle(l); });
                  ['spvs', 'domains', 'l3', 'ih', 'l4', 'l5', 'l6'].forEach(l => { if (visibleLayers.has(l)) onLayerToggle(l); });
                }}
                className="flex-1 text-[10px] py-1 rounded bg-slate-800/60 hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 transition-colors"
              >
                Overview
              </button>
              <button
                onClick={() => {
                  ['q0', 'goals', 'domains', 'l3', 'l4'].forEach(l => { if (!visibleLayers.has(l)) onLayerToggle(l); });
                  ['spvs', 'ras', 'ih', 'l5', 'l6'].forEach(l => { if (visibleLayers.has(l)) onLayerToggle(l); });
                }}
                className="flex-1 text-[10px] py-1 rounded bg-slate-800/60 hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 transition-colors"
              >
                Strategy
              </button>
              <button
                onClick={() => {
                  ['l3', 'ih', 'l4', 'l5', 'l6'].forEach(l => { if (!visibleLayers.has(l)) onLayerToggle(l); });
                  ['q0', 'goals', 'spvs', 'ras', 'domains'].forEach(l => { if (visibleLayers.has(l)) onLayerToggle(l); });
                }}
                className="flex-1 text-[10px] py-1 rounded bg-slate-800/60 hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 transition-colors"
              >
                Lab
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Navigation & Tools — compact button grid */}
      <div className="px-3 py-2 space-y-1.5">
        {/* Row: Jump + Focus */}
        <div className="flex gap-1.5">
          {onJumpToQ0 && (
            <Button size="sm" variant="outline" onClick={onJumpToQ0} className="flex-1 h-6 text-[10px] px-1.5">
              <Home size={10} className="mr-1" />Q₀
            </Button>
          )}
          {onJumpToGoals && (
            <Button size="sm" variant="outline" onClick={onJumpToGoals} className="flex-1 h-6 text-[10px] px-1.5">
              <Layers size={10} className="mr-1" />Goals
            </Button>
          )}
        </div>

        {/* Focus Mode */}
        {onFocusMode && availableGoals.length > 0 && (
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowFocusMenu(!showFocusMenu)}
              className={`w-full h-6 text-[10px] justify-between ${
                focusedGoalId ? 'border-primary/60 text-primary bg-primary/10' : ''
              }`}
            >
              <div className="flex items-center gap-1">
                <Focus size={10} />
                <span className="truncate">
                  {focusedGoalId
                    ? availableGoals.find(g => g.id === focusedGoalId)?.title.slice(0, 16) + '...'
                    : 'Focus on Goal'}
                </span>
              </div>
              <ChevronRight size={10} className={`transition-transform ${showFocusMenu ? 'rotate-90' : ''}`} />
            </Button>
            {showFocusMenu && (
              <div className="absolute left-full ml-2 top-0 z-50 w-[200px] bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-1.5 max-h-[250px] overflow-y-auto">
                <button
                  onClick={() => { onFocusMode(null); setShowFocusMenu(false); }}
                  className="w-full text-left px-2 py-1 text-[11px] rounded hover:bg-slate-800 text-slate-400 mb-0.5"
                >
                  Clear Focus
                </button>
                {availableGoals.map(goal => (
                  <button
                    key={goal.id}
                    onClick={() => { onFocusMode(goal.id); setShowFocusMenu(false); }}
                    className={`w-full text-left px-2 py-1 text-[11px] rounded hover:bg-slate-800 ${
                      focusedGoalId === goal.id ? 'bg-primary/20 text-primary' : 'text-slate-300'
                    }`}
                  >
                    {goal.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Expand/Collapse row */}
        <div className="flex gap-1.5">
          {onSmartExpand && (
            <Button size="sm" variant="outline" onClick={onSmartExpand} className="flex-1 h-6 text-[10px] px-1.5 border-green-500/30 text-green-400 hover:bg-green-500/10">
              Smart
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onExpandAll} className="flex-1 h-6 text-[10px] px-1.5">
            <Maximize2 size={10} className="mr-0.5" />All
          </Button>
          <Button size="sm" variant="outline" onClick={onCollapseAll} className="flex-1 h-6 text-[10px] px-1.5">
            Fold
          </Button>
        </div>

        {/* Compact mode + Reset row */}
        <div className="flex gap-1.5">
          {onCompactModeToggle && (
            <Button
              size="sm"
              variant="outline"
              onClick={onCompactModeToggle}
              className={`flex-1 h-6 text-[10px] px-1.5 ${compactMode ? 'border-primary/60 text-primary bg-primary/10' : ''}`}
            >
              {compactMode ? 'Normal' : 'Compact'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onResetView} className="flex-1 h-7 text-[10px] px-1.5 border-sky-400/50 text-sky-400 bg-sky-500/10 hover:bg-sky-500/20 hover:border-sky-400/80">
            <RotateCcw size={11} className="mr-0.5" />Reset
          </Button>
        </div>

        {/* AI Chat button */}
        {onChatToggle && (
          <Button
            size="sm"
            variant="outline"
            onClick={onChatToggle}
            className={`w-full h-7 text-[10px] px-1.5 border-2 ${
              chatOpen
                ? 'border-violet-400 text-violet-300 bg-violet-500/20'
                : 'border-violet-400/50 text-violet-400 bg-violet-500/10 hover:bg-violet-500/20 hover:border-violet-400/80'
            }`}
          >
            <MessageCircle size={11} className="mr-1" />
            AI Chat
            {chatNodeCount && chatNodeCount > 0 ? (
              <span className="ml-1 px-1 rounded-full bg-violet-500/20 text-violet-300 text-[8px] font-bold leading-tight">
                {chatNodeCount}
              </span>
            ) : (
              <span className="ml-1 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
};

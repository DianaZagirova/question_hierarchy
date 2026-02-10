import React, { useState } from 'react';
import { Search, Filter, Layers, Eye, EyeOff, RotateCcw, Info } from 'lucide-react';
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
  {
    id: 'q0',
    label: 'Q₀',
    color: 'bg-blue-500',
    icon: '🎯',
    shortDesc: 'Root question — the primary research objective',
    fullDesc: 'Step 1: Goal Formalization. Transforms vague objectives into a precise, engineering-grade master question (Q₀) that defines success criteria and system requirements. The Q₀ is solution-neutral, system-explicit, baseline-anchored, and includes success criteria driven by time-nonincreasing risk of catastrophic system failure.'
  },
  {
    id: 'goals',
    label: 'Goals',
    color: 'bg-purple-500',
    icon: '🏛️',
    shortDesc: 'Goal Pillars — high-level teleological requirements',
    fullDesc: 'Step 2: Goal Pillars Synthesis. Decomposes Q₀ into MECE (Mutually Exclusive, Collectively Exhaustive) goal pillars and creates a Bridge Lexicon (FCCs & SPVs) to map goals to scientific reality. Each pillar represents a required end-state that, if satisfied together, makes the Q₀ requirement plausible.'
  },
  {
    id: 'spvs',
    label: 'SPVs',
    color: 'bg-amber-500',
    icon: '🔗',
    shortDesc: 'System Property Variables — controllable reliability knobs',
    fullDesc: 'Step 2: Bridge Lexicon (SPVs). System Property Variables are the shared language between teleological goals and scientific interventions. They describe controllable reliability parameters (e.g., "Reset Fidelity," "Consensus Coherence") that can be measured and modified to achieve goal states.'
  },
  {
    id: 'ras',
    label: 'RAs',
    color: 'bg-emerald-500',
    icon: '⚙️',
    shortDesc: 'Requirement Atoms — atomic testable requirements',
    fullDesc: 'Step 3: Requirement Atomization. Breaks down each goal pillar into atomic, testable requirements (RAs) with clear done-criteria and failure modes. Each RA is solution-agnostic, specifies state variables, failure shapes, perturbation classes, and meter requirements. RAs must pass a multiple realizability check—at least 3 distinct architecture classes could satisfy them.'
  },
  {
    id: 'domains',
    label: 'Domains',
    color: 'bg-cyan-500',
    icon: '🗺️',
    shortDesc: 'Research Domains — scientific fields mapped to goals',
    fullDesc: 'Step 4a: Research Domain Identification. Identifies 8-12 distinct research domains relevant to each Goal for systematic scientific knowledge collection. Each domain contains ~25 actionable interventions and is selected based on relevance to catastrophe prevention, number of SPVs addressed, and evidence maturity.'
  },
  {
    id: 'l3',
    label: 'L3',
    color: 'bg-red-500',
    icon: '🔭',
    shortDesc: 'L3 Frontier Questions — strategic science questions',
    fullDesc: 'Step 6: Frontier Question Generation. Generates strategic L3 questions that discriminate between competing hypotheses and reveal critical unknowns. These are innovative "drill bits" designed to reveal why a system property is failing, using strategies like Genesis Probes (for complete voids), Contextual Decoupling (for fragility traps), Causal Pivot (for proxy mirages), and Arbitration Logic (for conflicting interventions).'
  },
  {
    id: 'ih',
    label: 'IH',
    color: 'bg-orange-500',
    icon: '🔮',
    shortDesc: 'Instantiation Hypotheses — divergent mechanistic hypotheses',
    fullDesc: 'Step 7: Divergent Hypothesis Instantiation. Creates diverse, testable hypotheses (IHs) for each L3 question, exploring multiple mechanistic explanations. Translates abstract L3 questions into competing physical and informational realization domains. Diversity is mandatory—includes scout hypotheses addressing underexplored domains like bioelectric memory, matrix-topological coding, and systemic feedback loops.'
  },
  {
    id: 'l4',
    label: 'L4',
    color: 'bg-lime-500',
    icon: '🎲',
    shortDesc: 'L4 Tactical Questions — concrete experimental questions',
    fullDesc: 'Step 8: Tactical Decomposition. Decomposes L3 questions into tactical L4 questions that distinguish between competing hypotheses. Uses discriminator questions designed so different answers support different IHs. At least 50% must be discriminators. Adds monotonic specificity by including specific systems, perturbations, or measurement modalities.'
  },
  {
    id: 'l5',
    label: 'L5',
    color: 'bg-green-400',
    icon: '🔧',
    shortDesc: 'L5 Drill Branches — mechanistic sub-problems',
    fullDesc: 'Step 9: Execution Drilldown (L5). Decomposes L4 tactical nodes into mechanistic sub-questions and pathways. Each L5 node identifies bottlenecks: tool requirements (if we can\'t see it), model requirements (if we can\'t isolate it), or mechanism drills (if logic is circular). L5 bridges the gap between tactical questions and executable experiments.'
  },
  {
    id: 'l6',
    label: 'L6',
    color: 'bg-teal-500',
    icon: '🔬',
    shortDesc: 'L6 Leaf Specs — actionable experiment tasks',
    fullDesc: 'Step 9: Execution Drilldown (L6). Converts L4 questions into concrete, executable L6 tasks with SIMT parameters: System (biological model), Intervention (independent variable), Meter (dependent variable/readout), Threshold/Time (success criteria). Each L6 task is a fully specified, actionable experiment that can be executed in a lab with clear protocols and expected outcomes.'
  },
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
  const [infoHover, setInfoHover] = useState<string | null>(null);

  return (
    <div className="absolute top-4 left-4 z-10 flex flex-row items-start gap-2">
      {/* Column 1: Search + Visible Layers */}
      <div className="flex flex-col gap-2 w-[115px]">
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
          <div className="grid grid-cols-1 gap-1.5">
            {LAYERS.map((layer) => (
              <div key={layer.id} className="relative group">
                <button
                  onClick={() => onLayerToggle(layer.id)}
                  title={layer.shortDesc}
                  className={`
                    w-full px-2 py-1 rounded text-[10px] font-medium transition-all flex items-center gap-1.5
                    ${visibleLayers.has(layer.id)
                      ? `${layer.color} text-white shadow-md`
                      : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                    }
                  `}
                >
                  {visibleLayers.has(layer.id) ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  <span className="flex-1 text-left">{layer.label}</span>
                  <Info
                    className="w-3 h-3 opacity-60 hover:opacity-100 transition-opacity"
                    onMouseEnter={(e) => {
                      e.stopPropagation();
                      setInfoHover(layer.id);
                    }}
                    onMouseLeave={() => setInfoHover(null)}
                  />
                </button>
                {/* Info Tooltip */}
                {infoHover === layer.id && (
                  <div className="absolute left-full ml-2 top-0 z-50 w-[320px] bg-slate-900 border border-blue-500/60 rounded-lg shadow-2xl p-3 animate-in fade-in slide-in-from-left-2 duration-200">
                    <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700">
                      <span className="text-base">{layer.icon}</span>
                      <span className="text-sm font-bold text-white">{layer.label}</span>
                    </div>
                    <p className="text-xs text-slate-200 leading-relaxed">
                      {layer.fullDesc}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="bg-card/95 backdrop-blur-sm rounded-lg shadow-lg p-3 border border-border/50">
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
      </div>

      {/* Column 2: Collapse / Expand / Reset */}
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

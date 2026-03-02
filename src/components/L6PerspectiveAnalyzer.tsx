import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, ChevronDown, ChevronRight, Loader2, Eye, Beaker, Microscope, Activity, Clock, AlertTriangle, Lightbulb, Copy, Check, Zap, FlaskConical, Search, Trophy } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { analyzeL6Perspective } from '@/lib/api';
import { DEFAULT_AGENTS } from '@/config/agents';

interface L6PerspectiveAnalyzerProps {
  onAnalysisComplete?: () => void;
}

export const L6PerspectiveAnalyzer: React.FC<L6PerspectiveAnalyzerProps> = ({ onAnalysisComplete }) => {
  const {
    steps,
    highlightedL6Ids,
    l6AnalysisResult,
    l6AnalysisLoading,
    setHighlightedL6Ids,
    setL6AnalysisResult,
    setL6AnalysisLoading,
    clearL6Analysis,
    setFocusedNodeId
  } = useAppStore();

  const [expandedExperiments, setExpandedExperiments] = useState<Set<string>>(new Set());
  const [topN, setTopN] = useState(15);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Check if step 9 is completed
  const step9 = steps.find(s => s.id === 9);
  const step9Completed = step9?.status === 'completed';

  // Get Q0 and goals
  const step1 = steps.find(s => s.id === 1);
  const step2 = steps.find(s => s.id === 2);
  const q0 = step1?.output?.Q0 || step1?.output?.q0 || step1?.output?.text || '';
  const goals = step2?.output?.goals || [];

  // Extract all L6 experiments from step 9 output — memoized to avoid rebuilding on every render
  const l6Experiments = useMemo(() => {
    if (!step9?.output) return [];
    const allL6: any[] = [];
    const output = step9.output;

    if (output.batch_results) {
      for (const result of output.batch_results) {
        if (result.data?.l6_tasks) allL6.push(...result.data.l6_tasks);
      }
    } else if (output.l6_tasks) {
      if (Array.isArray(output.l6_tasks)) {
        allL6.push(...output.l6_tasks);
      } else {
        for (const l4Id of Object.keys(output.l6_tasks)) {
          const tasks = output.l6_tasks[l4Id];
          if (Array.isArray(tasks)) allL6.push(...tasks);
        }
      }
    }

    const seen = new Set<string>();
    return allL6.filter(exp => {
      if (!exp.id || seen.has(exp.id)) return false;
      seen.add(exp.id);
      return true;
    });
  }, [step9?.output]);

  // Build L6 lookup index for matching analysis results to full experiment data
  const l6Index = useMemo(() => {
    const idx: Record<string, any> = {};
    for (const exp of l6Experiments) {
      if (exp.id) idx[exp.id] = exp;
    }
    return idx;
  }, [l6Experiments]);

  const canAnalyze = step9Completed && l6Experiments.length > 0 && !l6AnalysisLoading;

  // Auto-scroll to results when analysis completes
  useEffect(() => {
    if (l6AnalysisResult && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [l6AnalysisResult]);

  const handleAnalyze = async () => {
    if (!canAnalyze) return;
    try {
      setL6AnalysisLoading(true);
      setIsCollapsed(false);
      const step9Agent = DEFAULT_AGENTS.find(a => a.id === 'agent-tactical-engineer');
      const agentConfig = step9Agent || DEFAULT_AGENTS[0];

      const result = await analyzeL6Perspective({
        q0,
        goals: goals.slice(0, 5),
        l6_experiments: l6Experiments,
        agentConfig,
        top_n: topN
      });

      setL6AnalysisResult(result.analysis);
      const selectedIds = result.analysis.selected_experiments.map((exp: any) => exp.l6_id);
      setHighlightedL6Ids(selectedIds);
      setExpandAll(false);
      setExpandedExperiments(new Set());
      onAnalysisComplete?.();
    } catch (error: any) {
      console.error('[L6 Analysis] Error:', error);
      alert(`Failed to analyze L6 experiments: ${error.message || 'Unknown error'}`);
    } finally {
      setL6AnalysisLoading(false);
    }
  };

  const toggleExpanded = (l6Id: string) => {
    setExpandedExperiments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(l6Id)) newSet.delete(l6Id);
      else newSet.add(l6Id);
      return newSet;
    });
  };

  const toggleExpandAll = () => {
    if (expandAll) {
      setExpandedExperiments(new Set());
      setExpandAll(false);
    } else {
      const allIds = l6AnalysisResult?.selected_experiments.map((e: any) => e.l6_id) || [];
      setExpandedExperiments(new Set(allIds));
      setExpandAll(true);
    }
  };

  const handleClear = () => {
    clearL6Analysis();
    setExpandedExperiments(new Set());
    setExpandAll(false);
  };

  const toggleHighlight = () => {
    if (highlightedL6Ids.length > 0) {
      setHighlightedL6Ids([]);
    } else if (l6AnalysisResult) {
      const selectedIds = l6AnalysisResult.selected_experiments.map((exp: any) => exp.l6_id);
      setHighlightedL6Ids(selectedIds);
    }
  };

  const handleFocusOnGraph = (l6Id: string) => {
    // Toggle: if this experiment is already the only highlight, clear all
    if (highlightedL6Ids.length === 1 && highlightedL6Ids[0] === l6Id) {
      setHighlightedL6Ids([]);
      return;
    }
    setHighlightedL6Ids([l6Id]);
    setFocusedNodeId(l6Id);
  };

  const handleCopyExperiment = (exp: any, fullData: any) => {
    const simt = fullData?.simt_parameters || {};
    const text = [
      `## ${exp.l6_id}: ${fullData?.title || ''}`,
      '',
      `**Score:** ${exp.score}/100 | **Genius:** ${fullData?.genius_score || '?'}/10 | **Feasibility:** ${fullData?.feasibility_score || '?'}/10`,
      '',
      `### Key Insight`,
      exp.key_insight,
      '',
      `### Strategic Value`,
      exp.strategic_value,
      '',
      `### System`,
      simt.system || 'N/A',
      '',
      `### Intervention`,
      simt.intervention || 'N/A',
      '',
      `### Meter`,
      simt.meter || 'N/A',
      '',
      `### Threshold / Time`,
      simt.threshold_time || 'N/A',
      '',
      `### If Null`,
      fullData?.if_null || 'N/A',
      '',
      `### Rationale`,
      fullData?.rationale || 'N/A',
    ].join('\n');
    navigator.clipboard.writeText(text);
    setCopiedId(exp.l6_id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Score color helper
  const scoreColor = (score: number, max: number = 100) => {
    const pct = score / max;
    if (pct >= 0.8) return 'text-emerald-400 bg-emerald-500/20';
    if (pct >= 0.6) return 'text-blue-400 bg-blue-500/20';
    if (pct >= 0.4) return 'text-amber-400 bg-amber-500/20';
    return 'text-red-400 bg-red-500/20';
  };

  const geniusLabel = (score: number) => {
    if (score >= 8) return 'Brilliant';
    if (score >= 6) return 'Strong';
    if (score >= 4) return 'Solid';
    return 'Basic';
  };

  // Don't render anything until step 9 is completed
  if (!step9Completed) return null;

  // ── Compact summary bar when results exist and panel is collapsed ──
  if (l6AnalysisResult && isCollapsed) {
    const count = l6AnalysisResult.selected_experiments.length;
    const topExp = l6AnalysisResult.selected_experiments[0];
    const topScore = topExp?.score;
    return (
      <div className="bg-gradient-to-r from-purple-500/15 via-blue-500/10 to-teal-500/10 border border-purple-500/30 rounded-lg overflow-hidden">
        <button
          onClick={() => setIsCollapsed(false)}
          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-purple-500/10 transition-colors text-left"
        >
          <div className="p-1.5 rounded-lg bg-purple-500/20 border border-purple-500/30">
            <Trophy className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-purple-300">Best Experiments</span>
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30 font-semibold">
                {count} selected
              </span>
              {topScore && (
                <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${scoreColor(topScore)}`}>
                  Top: {topScore}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
              Click to expand &middot; Use <Eye className="w-3 h-3 inline -mt-0.5" /> to highlight on graph
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); toggleHighlight(); }}
              className={`p-1.5 rounded-md transition-colors ${
                highlightedL6Ids.length > 0
                  ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                  : 'hover:bg-secondary/50 text-muted-foreground hover:text-foreground'
              }`}
              title={highlightedL6Ids.length > 0 ? 'Hide graph highlights' : 'Show on graph'}
            >
              <Eye size={14} />
            </button>
            <ChevronRight size={16} className="text-muted-foreground" />
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-teal-500/10 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500/30 to-blue-500/30 border border-purple-500/40 shadow-lg shadow-purple-500/10">
              <Trophy className="w-5 h-5 text-purple-300" />
            </div>
            <div>
              <h3 className="font-bold text-lg flex items-center gap-2">
                Best Experiments
                {l6AnalysisResult && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">
                    {l6AnalysisResult.selected_experiments.length} selected
                  </span>
                )}
              </h3>
              <p className="text-xs text-muted-foreground">
                {l6AnalysisResult
                  ? `AI-ranked top ${l6AnalysisResult.selected_experiments.length} from ${l6Experiments.length} experiments`
                  : `Rank ${l6Experiments.length} experiments by strategic value`
                }
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {l6AnalysisResult && (
              <>
                <button
                  onClick={toggleExpandAll}
                  className="p-2 rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
                  title={expandAll ? "Collapse all" : "Expand all"}
                >
                  {expandAll ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <button
                  onClick={toggleHighlight}
                  className={`p-2 rounded-md transition-colors ${
                    highlightedL6Ids.length > 0
                      ? 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                      : 'hover:bg-secondary/50 text-muted-foreground hover:text-foreground'
                  }`}
                  title={highlightedL6Ids.length > 0 ? 'Hide graph highlights' : 'Highlight on graph'}
                >
                  <Eye size={16} />
                </button>
                <button
                  onClick={() => setIsCollapsed(true)}
                  className="p-2 rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
                  title="Minimize"
                >
                  <ChevronDown size={16} />
                </button>
                <button
                  onClick={handleClear}
                  className="p-2 rounded-md hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
                  title="Clear analysis"
                >
                  <X size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="p-4">
        {/* Analyze Controls */}
        {!l6AnalysisResult && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-muted-foreground whitespace-nowrap">Select top:</label>
              <input
                type="number"
                min="1"
                max="50"
                value={topN}
                onChange={(e) => setTopN(parseInt(e.target.value) || 15)}
                className="w-20 px-2 py-1 rounded border border-border bg-background text-sm"
                disabled={l6AnalysisLoading}
              />
              <span className="text-xs text-muted-foreground">from {l6Experiments.length} experiments</span>
            </div>

            <button
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              className={`w-full px-4 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors ${
                canAnalyze
                  ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white shadow-lg hover:shadow-xl hover:shadow-purple-500/20'
                  : 'bg-secondary text-muted-foreground cursor-not-allowed'
              }`}
            >
              {l6AnalysisLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing {l6Experiments.length} experiments...
                </>
              ) : (
                <>
                  <Trophy className="w-5 h-5" />
                  Find Best Experiments
                </>
              )}
            </button>

            <p className="text-[11px] text-center text-muted-foreground/60">
              AI will rank experiments by strategic value, feasibility, and novelty
            </p>
          </div>
        )}

        {/* Analysis Results */}
        {l6AnalysisResult && (
          <div ref={resultsRef} className="space-y-4">
            {/* Quick actions bar */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/30 border border-border/30">
              <button
                onClick={toggleHighlight}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  highlightedL6Ids.length > 0
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                <Eye size={12} />
                {highlightedL6Ids.length > 0 ? 'Highlighted on graph' : 'Show on graph'}
              </button>
              <span className="text-border">|</span>
              <span className="text-[11px] text-muted-foreground flex items-center gap-1"><Eye size={11} /> Click <Eye size={9} className="inline" /> to zoom to experiment</span>
            </div>

            {/* Strategic Assessment — collapsible */}
            {l6AnalysisResult.overall_assessment && (
              <details className="group rounded-lg bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20">
                <summary className="p-3 cursor-pointer flex items-center gap-2 text-sm font-semibold text-purple-400 list-none">
                  <ChevronRight size={14} className="group-open:rotate-90 transition-transform" />
                  <Lightbulb size={14} />
                  Strategic Assessment
                </summary>
                <div className="px-4 pb-3">
                  <p className="text-sm text-foreground/90 leading-relaxed">
                    {l6AnalysisResult.overall_assessment}
                  </p>
                </div>
              </details>
            )}

            {/* Coverage Gaps — collapsible */}
            {l6AnalysisResult.coverage_gaps && (
              <details className="group rounded-lg bg-amber-500/10 border border-amber-500/20">
                <summary className="p-2.5 cursor-pointer flex items-center gap-1.5 text-xs font-semibold text-amber-400 list-none">
                  <ChevronRight size={12} className="group-open:rotate-90 transition-transform" />
                  <AlertTriangle size={12} />
                  Coverage Gaps
                </summary>
                <div className="px-3 pb-2.5">
                  <p className="text-xs text-foreground/80 leading-relaxed">
                    {l6AnalysisResult.coverage_gaps}
                  </p>
                </div>
              </details>
            )}

            {/* Experiment Cards */}
            <div className="space-y-3">
              {l6AnalysisResult.selected_experiments.map((exp: any) => {
                const isExpanded = expandedExperiments.has(exp.l6_id);
                const isHighlighted = highlightedL6Ids.includes(exp.l6_id);
                const fullData = l6Index[exp.l6_id];
                const simt = fullData?.simt_parameters || {};
                const geniusScore = fullData?.genius_score;
                const feasScore = fullData?.feasibility_score;

                return (
                  <div
                    key={exp.l6_id}
                    className={`rounded-xl border transition-colors duration-150 overflow-hidden ${
                      isHighlighted
                        ? 'border-purple-500/70 bg-purple-500/5 shadow-lg shadow-purple-500/10'
                        : 'border-border hover:border-border/80'
                    }`}
                  >
                    {/* Card Header — always visible */}
                    <div className="flex items-stretch">
                      {/* Left action icons — always visible */}
                      <div className="flex flex-col border-r border-border/50 shrink-0">
                        <button
                          onClick={() => handleFocusOnGraph(exp.l6_id)}
                          className="flex-1 px-2 hover:bg-purple-500/20 transition-colors flex items-center justify-center group/eye"
                          title="Show on graph"
                        >
                          <Eye className="w-4 h-4 text-purple-400/60 group-hover/eye:text-purple-300" />
                        </button>
                        <button
                          onClick={() => handleCopyExperiment(exp, fullData)}
                          className="flex-1 px-2 hover:bg-secondary/50 transition-colors flex items-center justify-center border-t border-border/50 group/copy"
                          title="Copy experiment details"
                        >
                          {copiedId === exp.l6_id ? (
                            <Check className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-muted-foreground/60 group-hover/copy:text-foreground" />
                          )}
                        </button>
                      </div>

                      <button
                        onClick={() => toggleExpanded(exp.l6_id)}
                        className="flex-1 px-4 py-3 flex items-start gap-3 hover:bg-secondary/20 transition-colors text-left min-w-0"
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {isExpanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
                        </div>

                        <div className="flex-1 min-w-0 space-y-1.5">
                          {/* Title row: rank + ID + scores */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold ${
                              exp.rank <= 3 ? 'bg-gradient-to-br from-purple-500 to-blue-500 text-white' : 'bg-purple-500/20 text-purple-400'
                            }`}>
                              {exp.rank}
                            </span>
                            <span className="font-mono text-xs font-medium text-muted-foreground">
                              {exp.l6_id}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${scoreColor(exp.score)}`}>
                              {exp.score}
                            </span>
                            {geniusScore != null && (
                              <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${scoreColor(geniusScore, 10)}`} title={`Genius: ${geniusScore}/10`}>
                                <Zap className="w-2.5 h-2.5 inline -mt-0.5" /> {geniusScore}
                              </span>
                            )}
                            {feasScore != null && (
                              <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${scoreColor(feasScore, 10)}`} title={`Feasibility: ${feasScore}/10`}>
                                <FlaskConical className="w-2.5 h-2.5 inline -mt-0.5" /> {feasScore}
                              </span>
                            )}
                            {fullData?.discovery_component && (
                              <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-teal-500/20 text-teal-400" title="Discovery component">
                                <Search className="w-2.5 h-2.5 inline -mt-0.5" /> Disc
                              </span>
                            )}
                          </div>

                          {/* Experiment title */}
                          <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
                            {fullData?.title || exp.key_insight}
                          </p>

                          {/* Collapsed summary: key insight + parent chain + system hint */}
                          {!isExpanded && (
                            <div className="space-y-0.5">
                              <p className="text-xs text-muted-foreground line-clamp-1">
                                {exp.key_insight}
                              </p>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
                                {fullData?.parent_l4_id && <span className="font-mono">{fullData.parent_l4_id}</span>}
                                {fullData?.parent_l4_id && fullData?.parent_l5_id && <span>&rarr;</span>}
                                {fullData?.parent_l5_id && <span className="font-mono">{fullData.parent_l5_id}</span>}
                                {simt.system && <span className="ml-auto truncate max-w-[120px]">{simt.system.split(',')[0].split('(')[0].trim()}</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      </button>

                    </div>

                    {/* Expanded Content — full experiment details */}
                    {isExpanded && (
                      <div className="border-t border-border/50">
                        {/* Analysis Insights */}
                        <div className="px-4 pt-3 pb-2 space-y-2 bg-purple-500/5">
                          <div>
                            <p className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-0.5">Key Insight</p>
                            <p className="text-sm text-foreground/90 leading-relaxed">{exp.key_insight}</p>
                          </div>
                          {exp.strategic_value && (
                            <div>
                              <p className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-0.5">Strategic Value</p>
                              <p className="text-xs text-foreground/80 leading-relaxed">{exp.strategic_value}</p>
                            </div>
                          )}
                          {exp.discrimination_power && (
                            <div>
                              <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-0.5">Discrimination Power</p>
                              <p className="text-xs text-foreground/80 leading-relaxed">{exp.discrimination_power}</p>
                            </div>
                          )}
                        </div>

                        {/* SIMT Parameters — the core experiment data */}
                        {fullData && (
                          <div className="px-4 py-3 space-y-3">
                            {/* Rationale */}
                            {fullData.rationale && (
                              <div>
                                <p className="text-xs font-bold text-foreground/50 uppercase tracking-wider mb-1 flex items-center gap-1">
                                  <Lightbulb size={10} /> Rationale
                                </p>
                                <p className="text-xs text-foreground/80 leading-relaxed bg-secondary/30 rounded-lg p-2.5">
                                  {fullData.rationale}
                                </p>
                              </div>
                            )}

                            {/* SIMT Grid */}
                            <div className="grid grid-cols-1 gap-2">
                              {simt.system && (
                                <div className="rounded-lg bg-teal-500/5 border border-teal-500/20 p-2.5">
                                  <p className="text-xs font-bold text-teal-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <Beaker size={10} /> System
                                  </p>
                                  <p className="text-xs text-foreground/85 leading-relaxed">{simt.system}</p>
                                </div>
                              )}

                              {simt.intervention && (
                                <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-2.5">
                                  <p className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <Activity size={10} /> Intervention
                                  </p>
                                  <p className="text-xs text-foreground/85 leading-relaxed">{simt.intervention}</p>
                                </div>
                              )}

                              {simt.meter && (
                                <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-2.5">
                                  <p className="text-xs font-bold text-violet-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <Microscope size={10} /> Meter
                                  </p>
                                  <p className="text-xs text-foreground/85 leading-relaxed">{simt.meter}</p>
                                </div>
                              )}

                              {simt.threshold_time && (
                                <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2.5">
                                  <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                    <Clock size={10} /> Threshold / Time
                                  </p>
                                  <p className="text-xs text-foreground/85 leading-relaxed">{simt.threshold_time}</p>
                                </div>
                              )}
                            </div>

                            {fullData.if_null && (
                              <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-2.5">
                                <p className="text-xs font-bold text-red-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                  <AlertTriangle size={10} /> If Null Result
                                </p>
                                <p className="text-xs text-foreground/85 leading-relaxed">{fullData.if_null}</p>
                              </div>
                            )}

                            <div className="flex gap-2">
                              {fullData.expected_impact && (
                                <div className="flex-1 rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2.5">
                                  <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-1">Expected Impact</p>
                                  <p className="text-xs text-foreground/80 leading-relaxed">{fullData.expected_impact}</p>
                                </div>
                              )}
                            </div>

                            {fullData.verification_note && (
                              <div className="rounded-lg bg-secondary/40 p-2.5">
                                <p className="text-xs font-bold text-foreground/40 uppercase tracking-wider mb-1">Verification Note</p>
                                <p className="text-xs text-foreground/70 leading-relaxed">{fullData.verification_note}</p>
                              </div>
                            )}

                            <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground pt-1">
                              {fullData.parent_l4_id && (
                                <span title="Parent L4">L4: {fullData.parent_l4_id}</span>
                              )}
                              {fullData.parent_l5_id && (
                                <span title="Parent L5">L5: {fullData.parent_l5_id}</span>
                              )}
                              {fullData.spv_link && (
                                <span title="SPV Link">SPV: {fullData.spv_link}</span>
                              )}
                              {geniusScore != null && (
                                <span title="Genius score">Genius: {geniusScore}/10 ({geniusLabel(geniusScore)})</span>
                              )}
                              {feasScore != null && (
                                <span title="Feasibility score">Feasibility: {feasScore}/10</span>
                              )}
                            </div>
                          </div>
                        )}

                        {!fullData && (
                          <div className="px-4 py-3">
                            <p className="text-xs text-muted-foreground italic">
                              Full experiment data not found in Step 9 output for {exp.l6_id}. Click the target icon to locate it on the graph.
                            </p>
                            {exp.impact_potential && (
                              <div className="mt-2">
                                <p className="text-xs font-bold text-green-400 uppercase tracking-wider mb-0.5">Impact Potential</p>
                                <p className="text-xs text-foreground/80">{exp.impact_potential}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

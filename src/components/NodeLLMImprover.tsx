import React, { useState, useEffect } from 'react';
import { X, Sparkles, Send, Check, RotateCcw, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import { streamNodeImprovement } from '@/lib/api';

interface NodeLLMImproverProps {
  isOpen: boolean;
  onClose: () => void;
  nodeData: any;
  nodeType: string;
  nodeLabel: string;
  q0: string;
  goal: string;
  lens: string;
  onAccept: (improvedData: any) => void;
  contextNodes: Array<{ id: string; type: string; label: string; data: any }>;
  onAddContextNodes: () => void;
  onRemoveContextNode: (nodeId: string) => void;
  onClearContextNodes: () => void;
  contextSelectionMode: boolean;
}

// Parse models from environment variable
const getAvailableModels = (): Array<{ label: string; value: string }> => {
  const modelsEnv = import.meta.env.VITE_IMPROVEMENT_MODELS || 'GPT-4.1:gpt-4.1,GPT-4o:gpt-4o';
  return modelsEnv.split(',').map((pair: string) => {
    const [label, value] = pair.split(':');
    return { label: label.trim(), value: value.trim() };
  });
};

const DEFAULT_TEMPERATURE = parseFloat(import.meta.env.VITE_DEFAULT_IMPROVEMENT_TEMPERATURE || '0.7');

export const NodeLLMImprover: React.FC<NodeLLMImproverProps> = ({
  isOpen,
  onClose,
  nodeData,
  nodeType,
  nodeLabel,
  q0,
  goal,
  lens,
  onAccept,
  contextNodes,
  onAddContextNodes,
  onRemoveContextNode,
  onClearContextNodes,
  contextSelectionMode,
}) => {
  // ALL HOOKS MUST BE CALLED BEFORE ANY CONDITIONAL RETURNS
  const [selectedModel, setSelectedModel] = useState(getAvailableModels()[0]?.value || 'gpt-4.1');
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedText, setGeneratedText] = useState('');
  const [improvedData, setImprovedData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showContext, setShowContext] = useState(true);
  const [abortFn, setAbortFn] = useState<(() => void) | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [showCurrentData, setShowCurrentData] = useState(false);

  const availableModels = getAvailableModels();

  useEffect(() => {
    if (isOpen) {
      // Reset state when modal opens
      setGeneratedText('');
      setImprovedData(null);
      setError(null);
      setShowOriginal(false);
      setCustomPrompt('');
      setShowPromptEditor(false);
      setShowCurrentData(false);
    }
  }, [isOpen]);

  // Parse generatedText as JSON for preview
  useEffect(() => {
    if (generatedText && !isGenerating) {
      try {
        const parsed = JSON.parse(generatedText);
        setImprovedData(parsed);
        setError(null);
      } catch (e) {
        setError('Generated response is not valid JSON. Click "Remake" to try again.');
      }
    }
  }, [generatedText, isGenerating]);

  // Auto-expand context section when entering context selection mode
  useEffect(() => {
    if (contextSelectionMode) {
      setShowContext(true);
    }
  }, [contextSelectionMode]);

  // CONDITIONAL RETURN MUST BE AFTER ALL HOOKS
  if (!isOpen) return null;

  const handleGenerate = () => {
    setIsGenerating(true);
    setGeneratedText('');
    setImprovedData(null);
    setError(null);

    const abort = streamNodeImprovement(
      {
        nodeData,
        nodeType,
        nodeLabel,
        contextNodes: contextNodes.map(n => ({ type: n.type, label: n.label, data: n.data })),
        q0,
        goal,
        lens,
        model: selectedModel,
        temperature,
        customPrompt: customPrompt.trim() || undefined,
      },
      (token) => {
        setGeneratedText(prev => prev + token);
      },
      () => {
        setIsGenerating(false);
        setAbortFn(null);
      },
      (errorMsg) => {
        setError(errorMsg);
        setIsGenerating(false);
        setAbortFn(null);
      }
    );

    setAbortFn(() => abort);
  };

  const handleRemake = () => {
    handleGenerate();
  };

  const handleAccept = () => {
    if (!improvedData) {
      // Try to parse generatedText as JSON
      try {
        const parsed = JSON.parse(generatedText);
        onAccept(parsed);
        onClose();
      } catch (e) {
        setError('Failed to parse generated JSON. Please try again.');
      }
    } else {
      onAccept(improvedData);
      onClose();
    }
  };

  const handleAbort = () => {
    if (abortFn) {
      abortFn();
      setIsGenerating(false);
      setAbortFn(null);
    }
  };

  const handleAddContextNode = () => {
    onAddContextNodes();
  };

  const renderDiff = () => {
    if (!improvedData) return null;

    const changes: Array<{ field: string; before: string; after: string }> = [];

    const findChanges = (original: any, improved: any, path: string = '') => {
      Object.keys(improved).forEach(key => {
        const currentPath = path ? `${path}.${key}` : key;
        const origValue = original[key];
        const improvedValue = improved[key];

        // Skip non-editable fields
        if (['id', 'type', 'parent_node_id', 'parent_goal_id', 'l4_reference_id'].includes(key)) {
          return;
        }

        if (typeof improvedValue === 'object' && !Array.isArray(improvedValue) && improvedValue !== null) {
          findChanges(origValue || {}, improvedValue, currentPath);
        } else if (typeof improvedValue === 'string' && origValue !== improvedValue) {
          changes.push({
            field: currentPath,
            before: String(origValue || ''),
            after: String(improvedValue || ''),
          });
        }
      });
    };

    findChanges(nodeData, improvedData);

    if (changes.length === 0) {
      return (
        <div className="text-sm text-muted-foreground text-center py-4">
          No changes detected in text fields.
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="text-xs font-bold text-foreground uppercase flex items-center gap-2">
          <Sparkles size={14} className="text-primary" />
          Changes Detected: {changes.length}
        </div>
        {changes.map((change, index) => (
          <div key={index} className="border border-border/50 rounded-lg p-3 bg-secondary/20">
            <div className="text-xs font-semibold text-primary mb-2">{change.field}</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] font-bold text-red-400 mb-1">BEFORE:</div>
                <div className="text-xs text-foreground/80 bg-red-500/10 border border-red-500/30 rounded p-2 max-h-[100px] overflow-y-auto">
                  {change.before || '(empty)'}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-green-400 mb-1">AFTER:</div>
                <div className="text-xs text-foreground bg-green-500/10 border border-green-500/30 rounded p-2 max-h-[100px] overflow-y-auto">
                  {change.after}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Determine modal width and position based on state
  const modalWidth = generatedText || improvedData ? 'max-w-6xl' : 'max-w-3xl';
  const modalOpacity = contextSelectionMode ? 'bg-card/70' : 'bg-card/95';

  // In context selection mode: make modal smaller and position to the left
  const modalPositioning = contextSelectionMode
    ? 'max-w-md ml-4 mr-auto' // Small width, left-aligned
    : modalWidth; // Normal centered width

  return (
    <>
      <style>{`
        .temperature-slider::-webkit-slider-thumb {
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg, #8b5cf6, #3b82f6);
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 0 10px rgba(139, 92, 246, 0.5), 0 2px 4px rgba(0,0,0,0.3);
          transition: all 0.2s ease;
        }
        .temperature-slider::-webkit-slider-thumb:hover {
          transform: scale(1.2);
          box-shadow: 0 0 15px rgba(139, 92, 246, 0.8), 0 2px 6px rgba(0,0,0,0.4);
        }
        .temperature-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: linear-gradient(135deg, #8b5cf6, #3b82f6);
          cursor: pointer;
          border: 2px solid white;
          box-shadow: 0 0 10px rgba(139, 92, 246, 0.5), 0 2px 4px rgba(0,0,0,0.3);
          transition: all 0.2s ease;
        }
        .temperature-slider::-moz-range-thumb:hover {
          transform: scale(1.2);
          box-shadow: 0 0 15px rgba(139, 92, 246, 0.8), 0 2px 6px rgba(0,0,0,0.4);
        }
      `}</style>
      <div className={`fixed inset-0 z-50 flex items-center transition-colors duration-300 ${
        contextSelectionMode
          ? 'bg-black/20 pointer-events-none justify-start'
          : 'bg-black/70 backdrop-blur-sm justify-center'
      }`}>
        <div className={`${modalOpacity} backdrop-blur-md rounded-lg shadow-2xl border w-full ${modalPositioning} max-h-[90vh] overflow-hidden flex flex-col transition-all duration-300 ${
          contextSelectionMode
            ? 'border-purple-500/50 pointer-events-auto'
            : 'border-primary/30'
        }`}>
        {/* Header */}
        <div className={`flex items-center justify-between p-4 border-b border-border/50 transition-all duration-300 ${
          contextSelectionMode
            ? 'bg-gradient-to-r from-purple-500/30 to-blue-500/30'
            : 'bg-gradient-to-r from-purple-500/10 to-blue-500/10'
        }`}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-foreground truncate">
                {contextSelectionMode ? '🎯 Selecting Context...' : 'Improve Node with LLM'}
              </h2>
              <p className="text-xs text-muted-foreground truncate">{nodeLabel}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1 flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Context Selection Instructions - Only shown in selection mode */}
          {contextSelectionMode && (
            <div className="bg-gradient-to-r from-purple-500/20 to-blue-500/20 border-2 border-purple-500/50 rounded-lg p-4 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="text-2xl">👆</div>
                <div>
                  <div className="font-bold text-purple-300 mb-1">Click nodes in the graph to add as context</div>
                  <ul className="text-sm text-foreground/80 space-y-1">
                    <li>• Click a node to add it to context</li>
                    <li>• Click again to remove it</li>
                    <li>• Use the banner above or click "Done" below when finished</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Configuration Panel - Hidden in context selection mode */}
          {!contextSelectionMode && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
            {/* Model Selector */}
            <div>
              <label className="block text-xs font-semibold text-muted-foreground uppercase mb-2">
                Model
              </label>
              <Select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isGenerating}
                className="bg-secondary/30 border-border/50 focus:border-primary focus:ring-primary/30 transition-all disabled:opacity-50"
              >
                {availableModels.map(model => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </Select>
            </div>

            {/* Temperature Slider */}
            <div>
              <label className="block text-xs font-semibold text-foreground uppercase mb-2 flex items-center gap-2">
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Temperature
                </span>
                <span className="text-lg font-bold text-primary">{temperature.toFixed(2)}</span>
              </label>
              <div className="relative">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  disabled={isGenerating}
                  className="temperature-slider w-full h-3 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                  style={{
                    background: `linear-gradient(to right, rgb(59, 130, 246) 0%, rgb(168, 85, 247) ${temperature * 100}%, rgb(99, 102, 241) ${temperature * 100}%, rgb(236, 72, 153) 100%)`
                  }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
                <span className="font-semibold">🎯 Precise (0.0)</span>
                <span className="font-semibold">🎨 Creative (1.0)</span>
              </div>
            </div>

            {/* Generate Button */}
            <div className="flex items-end">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 hover:shadow-[0_0_25px_rgba(139,92,246,0.5)] transition-all disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Send size={14} className="mr-2" />
                    Generate
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Current Node Data Section */}
          <div className="border border-border/50 rounded-lg bg-secondary/10">
            <button
              onClick={() => setShowCurrentData(!showCurrentData)}
              className="w-full flex items-center justify-between p-3 hover:bg-secondary/20 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">Current Node Data</span>
                <span className="text-xs text-muted-foreground">
                  View what will be modified
                </span>
              </div>
              {showCurrentData ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showCurrentData && (
              <div className="p-3 border-t border-border/50">
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 max-h-[300px] overflow-y-auto">
                  <div className="text-xs font-bold text-cyan-400 uppercase mb-2 flex items-center gap-2">
                    <span>📄</span>
                    <span>Current Node Structure</span>
                  </div>
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
                    {JSON.stringify(nodeData, null, 2)}
                  </pre>
                </div>
                <div className="mt-2 bg-amber-500/10 border border-amber-500/30 rounded p-2 text-xs text-amber-300">
                  <strong>Note:</strong> The LLM will improve the text fields while preserving critical fields like <code className="bg-amber-500/20 px-1 rounded">id</code>, <code className="bg-amber-500/20 px-1 rounded">type</code>, and <code className="bg-amber-500/20 px-1 rounded">parent_node_id</code>.
                </div>
              </div>
            )}
          </div>

          {/* Custom Prompt Section */}
          <div className="border border-border/50 rounded-lg bg-secondary/10">
            <button
              onClick={() => setShowPromptEditor(!showPromptEditor)}
              className="w-full flex items-center justify-between p-3 hover:bg-secondary/20 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">Custom Instructions (Optional)</span>
                <span className="text-xs text-muted-foreground">
                  {customPrompt ? '✓ Added' : 'Add specific guidance'}
                </span>
              </div>
              {showPromptEditor ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showPromptEditor && (
              <div className="p-3 border-t border-border/50 space-y-2">
                <div className="bg-blue-500/10 border border-blue-500/30 rounded p-2 text-xs text-blue-300">
                  <strong>Tip:</strong> Add specific instructions like "Focus on mechanism details", "Use more technical language", "Add concrete examples", etc. This will be appended to the standard improvement prompt.
                </div>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Example: Focus on explaining the molecular mechanisms in detail. Include specific pathway names and interactions. Emphasize clinical relevance..."
                  disabled={isGenerating}
                  className="w-full bg-secondary/30 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground leading-relaxed focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all resize-y min-h-[100px] disabled:opacity-50"
                />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">
                    {customPrompt.length} characters
                  </span>
                  {customPrompt && (
                    <button
                      onClick={() => setCustomPrompt('')}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
            </div>
          )}

          {/* Context Section - Always visible, especially during selection mode */}
          <div className="border border-border/50 rounded-lg bg-secondary/10">
            <button
              onClick={() => setShowContext(!showContext)}
              className="w-full flex items-center justify-between p-3 hover:bg-secondary/20 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">Project Context</span>
                <span className="text-xs text-muted-foreground">
                  ({contextNodes.length} additional nodes)
                </span>
              </div>
              {showContext ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showContext && (
              <div className="p-3 border-t border-border/50 space-y-3">
                {/* Q0, Goal, Lens */}
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded p-2">
                    <div className="font-bold text-blue-400 mb-1">Q0 (Master Question)</div>
                    <div className="text-foreground/80 max-h-[60px] overflow-y-auto">{q0 || 'Not specified'}</div>
                  </div>
                  <div className="bg-purple-500/10 border border-purple-500/30 rounded p-2">
                    <div className="font-bold text-purple-400 mb-1">Current Goal</div>
                    <div className="text-foreground/80 max-h-[60px] overflow-y-auto">{goal || 'Not specified'}</div>
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded p-2">
                    <div className="font-bold text-amber-400 mb-1">Epistemic Lens</div>
                    <div className="text-foreground/80 max-h-[60px] overflow-y-auto">{lens || 'None'}</div>
                  </div>
                </div>

                {/* Context Nodes */}
                {contextNodes.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">Context Nodes</span>
                        <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold">
                          {contextNodes.length}
                        </span>
                      </div>
                      <button
                        onClick={onClearContextNodes}
                        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-red-400 transition-all hover:gap-1.5"
                      >
                        <Trash2 className="w-3 h-3" />
                        Clear All
                      </button>
                    </div>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {contextNodes.map((node, idx) => (
                        <div
                          key={node.id}
                          className="group flex items-center gap-3 bg-gradient-to-r from-secondary/30 to-secondary/10 hover:from-secondary/50 hover:to-secondary/30 rounded-lg p-2.5 border border-primary/20 hover:border-primary/40 transition-all duration-200 animate-in fade-in slide-in-from-left-2"
                          style={{ animationDelay: `${idx * 50}ms` }}
                        >
                          <div className="flex-shrink-0 w-8 h-8 rounded-md bg-primary/20 border border-primary/30 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-primary">
                              {node.type.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-foreground truncate">{node.label}</div>
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{node.type}</div>
                          </div>
                          <button
                            onClick={() => onRemoveContextNode(node.id)}
                            className="flex-shrink-0 p-1.5 rounded-md hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-all opacity-0 group-hover:opacity-100"
                            title="Remove context node"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add Context Node Button */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddContextNode}
                  disabled={isGenerating}
                  className={`w-full border-dashed transition-all ${
                    contextSelectionMode
                      ? 'border-purple-500 bg-purple-500/20 text-purple-300 animate-pulse'
                      : 'border-primary/40 text-primary hover:bg-primary/10'
                  }`}
                >
                  <Plus size={14} className="mr-2" />
                  {contextSelectionMode ? 'Click nodes in graph...' : 'Add Context Nodes'}
                </Button>
                {contextSelectionMode && (
                  <div className="bg-purple-500/20 border border-purple-500/40 rounded p-2 text-xs text-purple-300">
                    <strong>Selection Mode Active:</strong> Click nodes in the graph to add them as context. Click "Done" in the banner when finished.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              <div className="text-sm text-red-400 font-semibold">Error:</div>
              <div className="text-sm text-foreground/90 mt-1">{error}</div>
            </div>
          )}

          {/* Generated Response */}
          {generatedText && (
            <div className="space-y-3">
              {/* Toggle Original/Improved View */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowOriginal(false)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    !showOriginal
                      ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                      : 'bg-secondary/30 text-muted-foreground hover:bg-secondary/50'
                  }`}
                >
                  Improved Version
                </button>
                <button
                  onClick={() => setShowOriginal(true)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    showOriginal
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                      : 'bg-secondary/30 text-muted-foreground hover:bg-secondary/50'
                  }`}
                >
                  Original Version
                </button>
              </div>

              {/* Content Display */}
              {showOriginal ? (
                <div className="bg-secondary/30 border border-border/50 rounded-lg p-4 max-h-[400px] overflow-y-auto">
                  <div className="text-xs font-bold text-muted-foreground uppercase mb-2">Original Data:</div>
                  <pre className="text-xs text-foreground whitespace-pre-wrap">
                    {JSON.stringify(nodeData, null, 2)}
                  </pre>
                </div>
              ) : improvedData ? (
                <div className="space-y-3">
                  {/* Diff View */}
                  <div className="bg-secondary/30 border border-border/50 rounded-lg p-4 max-h-[400px] overflow-y-auto">
                    {renderDiff()}
                  </div>

                  {/* Action Buttons - Compact Design */}
                  {!isGenerating && (
                    <div className="bg-card/95 backdrop-blur-sm border border-border/50 rounded-lg p-4 space-y-3">
                      {/* Status Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-border/30">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          <span className="text-sm font-semibold text-foreground">Review Complete</span>
                        </div>
                        <span className="text-xs text-muted-foreground">Choose an action</span>
                      </div>

                      {/* Action Buttons - Compact */}
                      <div className="flex gap-3">
                        {/* Remake Button */}
                        <button
                          onClick={handleRemake}
                          className="group flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 hover:border-amber-400 hover:shadow-[0_0_15px_rgba(251,191,36,0.3)] transition-all"
                          title="Generate a new version with the same settings"
                        >
                          <RotateCcw size={16} className="text-amber-400 group-hover:rotate-180 transition-transform duration-500" />
                          <div className="text-left">
                            <div className="font-semibold text-sm text-amber-400">Remake</div>
                            <div className="text-[10px] text-amber-300/60">Try again</div>
                          </div>
                        </button>

                        {/* Accept Button */}
                        <button
                          onClick={handleAccept}
                          className="group flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-green-500/50 bg-gradient-to-r from-green-500/20 to-emerald-500/20 hover:border-green-400 hover:shadow-[0_0_20px_rgba(34,197,94,0.4)] transition-all"
                          title="Apply these changes to the node"
                        >
                          <Check size={18} className="text-green-400 group-hover:scale-110 transition-transform" />
                          <div className="text-left">
                            <div className="font-bold text-sm text-green-400">Accept Changes</div>
                            <div className="text-[10px] text-green-300/60">Apply to node</div>
                          </div>
                        </button>
                      </div>

                      {/* Footer Info */}
                      <div className="flex items-center justify-between pt-3 border-t border-border/30 text-xs">
                        <span className="text-muted-foreground">💡 Scroll up to adjust settings</span>
                        <button
                          onClick={onClose}
                          className="text-muted-foreground hover:text-red-400 transition-colors flex items-center gap-1"
                        >
                          <X size={12} />
                          Discard
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-secondary/30 border border-border/50 rounded-lg p-4 max-h-[400px] overflow-y-auto">
                  <div className="text-xs font-bold text-green-400 uppercase mb-2">Generated JSON:</div>
                  <pre className="text-xs text-foreground whitespace-pre-wrap">
                    {generatedText}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Generating state - Compact */}
          {isGenerating && (
            <div className="bg-card/95 backdrop-blur-sm border border-border/50 rounded-lg p-6 text-center">
              <div className="relative w-16 h-16 mx-auto mb-4">
                <div className="absolute inset-0 border-4 border-primary/20 rounded-full" />
                <div className="absolute inset-0 border-4 border-t-primary border-r-purple-500 border-b-transparent border-l-transparent rounded-full animate-spin" />
                <Sparkles className="absolute inset-0 m-auto w-6 h-6 text-primary animate-pulse" />
              </div>
              <div className="font-bold text-foreground mb-2">Generating Improved Version...</div>
              <p className="text-xs text-muted-foreground">
                The AI is analyzing your node. This may take 10-30 seconds.
              </p>
            </div>
          )}

          {/* Placeholder when no generation yet - Compact */}
          {!generatedText && !isGenerating && (
            <div className="bg-secondary/20 border border-dashed border-border/50 rounded-lg p-6 text-center">
              <Sparkles className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
              <div className="font-bold text-foreground mb-2">Ready to Improve</div>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                Configure settings above, add context nodes if needed, then click "Generate" to improve this node.
              </p>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs text-green-400">Ready</span>
              </div>
            </div>
          )}
          </div>
        </div>

        {/* Footer - Compact */}
        <div className="flex items-center justify-between p-4 border-t border-border/50 bg-secondary/20">
          {/* Close button */}
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            className="border-border/50 hover:bg-secondary/50"
          >
            <X size={14} className="mr-2" />
            Close
          </Button>

          {/* Abort button during generation */}
          {isGenerating && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleAbort}
              className="border-red-500/50 text-red-400 hover:bg-red-500/20 hover:border-red-400 animate-pulse"
            >
              <X size={14} className="mr-2" />
              Abort Generation
            </Button>
          )}

          {/* Status indicator */}
          {isGenerating ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              Generating...
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              AI-powered improvement
            </div>
          )}
        </div>
      </div>
    </>
  );
};

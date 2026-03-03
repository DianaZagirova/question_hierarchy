import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, Send, X, Trash2, StopCircle, Sparkles, GitBranch, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { streamNodeChat, NodeChatMessage, saveChatHistory, archiveChatHistory, loadChatHistory } from '@/lib/api';
import { PipelineStep } from '@/types';
import { SelectedNodeData, getNodesByType } from '@/lib/chatContextBuilder';
import { NodeChatBranchSelector } from './NodeChatBranchSelector';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface NodeChatProps {
  isOpen: boolean;
  onClose: () => void;
  selectedNodes: SelectedNodeData[];
  onRemoveNode: (nodeId: string) => void;
  onClearNodes: () => void;
  onAddNodes: (nodes: SelectedNodeData[]) => void;
  q0: string;
  goal: string;
  lens: string;
  graphSummary: string;
  l6AnalysisSummary: string;
  steps: PipelineStep[];
  highlightedL6Ids: string[];
}

const NODE_TYPE_COLORS: Record<string, string> = {
  q0: 'bg-blue-500/25 border-blue-400/60 text-blue-200',
  goal: 'bg-purple-500/25 border-purple-400/60 text-purple-200',
  spv: 'bg-amber-500/25 border-amber-400/60 text-amber-200',
  ra: 'bg-emerald-500/25 border-emerald-400/60 text-emerald-200',
  domain: 'bg-cyan-500/25 border-cyan-400/60 text-cyan-200',
  scientific: 'bg-cyan-500/25 border-cyan-400/60 text-cyan-200',
  l3: 'bg-red-500/25 border-red-400/60 text-red-200',
  ih: 'bg-orange-500/25 border-orange-400/60 text-orange-200',
  l4: 'bg-lime-500/25 border-lime-400/60 text-lime-200',
  l5: 'bg-green-400/25 border-green-400/60 text-green-200',
  l6: 'bg-teal-500/25 border-teal-400/60 text-teal-200',
  common_l6: 'bg-yellow-500/25 border-yellow-400/60 text-yellow-200',
};

const getNodeTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    q0: 'Q0', goal: 'Goal', spv: 'SPV', ra: 'RA',
    domain: 'Domain', scientific: 'S-Node', l3: 'L3', ih: 'IH',
    l4: 'L4', l5: 'L5', l6: 'L6', common_l6: 'Common L6',
  };
  return labels[type] || type.toUpperCase();
};

const MIN_WIDTH = 380;
const MAX_WIDTH = 700;
const DEFAULT_WIDTH = 460;

export const NodeChat: React.FC<NodeChatProps> = ({
  isOpen,
  onClose,
  selectedNodes,
  onRemoveNode,
  onClearNodes,
  onAddNodes,
  q0,
  goal,
  lens,
  graphSummary,
  l6AnalysisSummary,
  steps,
  highlightedL6Ids,
}) => {
  const [messages, setMessages] = useState<NodeChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const abortRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const loadedRef = useRef(false);

  // Load chat history on first open
  useEffect(() => {
    if (isOpen && !loadedRef.current) {
      loadedRef.current = true;
      loadChatHistory().then(({ conversationId, messages: saved }) => {
        if (saved.length > 0) {
          conversationIdRef.current = conversationId;
          setMessages(saved);
        }
      });
    }
  }, [isOpen]);

  // Auto-save after messages change (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (messages.length === 0 || isStreaming) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const nodeIds = selectedNodes.map(n => n.id);
      saveChatHistory(conversationIdRef.current, messages, nodeIds).then(({ conversationId }) => {
        if (conversationId) conversationIdRef.current = conversationId;
      });
    }, 1000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [messages, isStreaming, selectedNodes]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // Resize drag handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startWidth: panelWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = resizeRef.current.startX - ev.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeRef.current.startWidth + delta));
      setPanelWidth(newWidth);
    };
    const onUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || isStreaming) return;

    const userMessage: NodeChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText('');
    setIsStreaming(true);
    setStreamingContent('');

    const nodesForContext = selectedNodes.map(n => ({
      id: n.id,
      type: n.type,
      label: n.label,
      ...(n.fullData ? { data: n.fullData } : {}),
    }));

    const abort = streamNodeChat(
      {
        selectedNodes: nodesForContext,
        messages: newMessages,
        q0,
        goal,
        lens,
        graphSummary,
        l6AnalysisSummary,
      },
      (token) => {
        setStreamingContent(prev => prev + token);
      },
      () => {
        setStreamingContent(prev => {
          if (prev) {
            setMessages(msgs => [...msgs, { role: 'assistant', content: prev }]);
          }
          return '';
        });
        setIsStreaming(false);
        abortRef.current = null;
      },
      (error) => {
        setStreamingContent('');
        setMessages(msgs => [...msgs, { role: 'assistant', content: `Error: ${error}` }]);
        setIsStreaming(false);
        abortRef.current = null;
      },
    );

    abortRef.current = abort;
  }, [inputText, isStreaming, selectedNodes, messages, q0, goal, lens, graphSummary, l6AnalysisSummary]);

  const handleStop = useCallback(() => {
    abortRef.current?.();
    setStreamingContent(prev => {
      if (prev) {
        setMessages(msgs => [...msgs, { role: 'assistant', content: prev + '\n\n*(stopped)*' }]);
      }
      return '';
    });
    setIsStreaming(false);
    abortRef.current = null;
  }, []);

  const handleClearChat = useCallback(() => {
    if (isStreaming) handleStop();
    // Archive the conversation in DB (keeps data, hides from UI)
    if (conversationIdRef.current && messages.length > 0) {
      archiveChatHistory(conversationIdRef.current);
    }
    conversationIdRef.current = null;
    setMessages([]);
    setStreamingContent('');
  }, [isStreaming, handleStop, messages.length]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleQuickAddBestL6 = useCallback(() => {
    const l6Nodes = getNodesByType('l6', steps);
    const bestSet = new Set(highlightedL6Ids);
    const best = l6Nodes.filter(n => bestSet.has(n.id));
    onAddNodes(best.length > 0 ? best : l6Nodes.slice(0, 5));
  }, [steps, highlightedL6Ids, onAddNodes]);

  const handleQuickAddGoals = useCallback(() => {
    onAddNodes(getNodesByType('goal', steps));
  }, [steps, onAddNodes]);

  const handleQuickAddL3s = useCallback(() => {
    onAddNodes(getNodesByType('l3', steps));
  }, [steps, onAddNodes]);

  if (!isOpen) return null;

  const suggestions = selectedNodes.length > 0
    ? [
        'Explain the relationship between these nodes',
        'Are there any gaps or weaknesses?',
        'Suggest improvements or alternatives',
      ]
    : [
        'What are the most promising experiments?',
        'Summarize the research strategy',
        'Which goals have the most coverage gaps?',
        'Compare the top L6 experiments',
      ];

  // Shared prose classes for markdown rendering
  const proseClasses = 'prose prose-invert prose-sm max-w-none [&_p]:my-1.5 [&_p]:leading-relaxed [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_li]:leading-relaxed [&_h1]:text-base [&_h1]:font-bold [&_h1]:text-foreground [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-foreground/90 [&_strong]:text-foreground [&_strong]:font-semibold [&_code]:text-[12px] [&_code]:bg-black/40 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-emerald-300 [&_pre]:bg-black/40 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:text-[12px] [&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-foreground/80 [&_table]:text-[12px] [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_a]:text-primary [&_a]:underline';

  return (
    <div
      className="absolute inset-y-0 right-0 bg-card border-l border-border shadow-2xl z-30 flex flex-col animate-in slide-in-from-right duration-300"
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 group hover:bg-primary/20 active:bg-primary/30 transition-colors"
        onMouseDown={handleResizeStart}
      >
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-12 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="w-3 h-3 text-muted-foreground" />
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-card">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-foreground">Research Chat</h3>
            <p className="text-xs text-muted-foreground">
              {selectedNodes.length > 0
                ? `${selectedNodes.length} node${selectedNodes.length !== 1 ? 's' : ''} focused`
                : 'Full pipeline context'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClearChat}
            className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
            title="Clear chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Selected Nodes & Quick Add */}
      <div className="px-4 py-3 border-b border-border/40 bg-muted/20">
        {selectedNodes.length === 0 ? (
          <div className="space-y-2.5">
            <p className="text-xs text-foreground/70">
              Ask anything about your pipeline, or add nodes for focused analysis:
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={handleQuickAddGoals}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-purple-500/15 border border-purple-400/40 text-purple-200 hover:bg-purple-500/25 hover:border-purple-400/60 transition-colors"
              >
                Add Goals
              </button>
              <button
                onClick={handleQuickAddBestL6}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-teal-500/15 border border-teal-400/40 text-teal-200 hover:bg-teal-500/25 hover:border-teal-400/60 transition-colors"
              >
                Add Best L6
              </button>
              <button
                onClick={handleQuickAddL3s}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-red-500/15 border border-red-400/40 text-red-200 hover:bg-red-500/25 hover:border-red-400/60 transition-colors"
              >
                Add All L3s
              </button>
              <button
                onClick={() => setShowBranchSelector(!showBranchSelector)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors ${
                  showBranchSelector
                    ? 'bg-primary/20 border border-primary/50 text-primary'
                    : 'bg-muted/40 border border-border/50 text-foreground/70 hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <GitBranch className="w-3 h-3" />
                Browse Tree
                {showBranchSelector ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground/90">
                Focused Nodes ({selectedNodes.length})
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowBranchSelector(!showBranchSelector)}
                  className={`flex items-center gap-0.5 text-xs transition-colors p-1 rounded ${
                    showBranchSelector ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  }`}
                  title="Browse tree to add nodes"
                >
                  <GitBranch className="w-3.5 h-3.5" />
                </button>
                {selectedNodes.length > 1 && (
                  <button
                    onClick={onClearNodes}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto">
              {selectedNodes.map(node => (
                <div
                  key={node.id}
                  className={`
                    group inline-flex items-center gap-1.5 px-2 py-1 rounded-md border
                    transition-all duration-200 hover:shadow-md animate-in fade-in zoom-in-95 duration-200
                    ${NODE_TYPE_COLORS[node.type] || 'bg-slate-500/25 border-slate-400/60 text-slate-200'}
                  `}
                >
                  <span className="text-[9px] font-bold uppercase tracking-wider opacity-80">
                    {getNodeTypeLabel(node.type)}
                  </span>
                  <span className="max-w-[120px] truncate text-[11px] font-medium">
                    {node.label?.replace(/^(Q0|Goal|L\d|IH|RA|SPV|Domain):?\s*/i, '')}
                  </span>
                  <button
                    onClick={() => onRemoveNode(node.id)}
                    className="ml-0.5 p-0.5 rounded hover:bg-red-500/30 hover:text-red-300 transition-all opacity-50 group-hover:opacity-100"
                    title="Remove node"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Branch Selector (collapsible) */}
        {showBranchSelector && (
          <div className="mt-2">
            <NodeChatBranchSelector
              steps={steps}
              highlightedL6Ids={highlightedL6Ids}
              onAddNodes={onAddNodes}
            />
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !streamingContent && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6 text-primary/60" />
            </div>
            <p className="text-sm font-medium text-foreground/80 mb-1">
              {selectedNodes.length > 0 ? 'Ask about your nodes' : 'Ask about your research pipeline'}
            </p>
            <p className="text-xs text-foreground/50 leading-relaxed mb-5 max-w-[280px]">
              {selectedNodes.length > 0
                ? 'Questions about validity, relationships, or implications of selected nodes.'
                : 'Full pipeline hierarchy and top experiments are loaded as context.'}
            </p>
            <div className="space-y-2 w-full max-w-[320px]">
              {suggestions.map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInputText(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="w-full text-left text-xs px-3.5 py-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 text-foreground/70 hover:text-foreground transition-colors border border-border/30 hover:border-border/50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`
                max-w-[92%] rounded-xl px-4 py-3 text-[13px] leading-relaxed
                ${msg.role === 'user'
                  ? 'bg-primary/15 border border-primary/30 text-foreground'
                  : 'bg-muted/30 border border-border/40 text-foreground'
                }
              `}
            >
              <div className={proseClasses}>
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap my-0">{msg.content}</p>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[92%] rounded-xl px-4 py-3 text-[13px] leading-relaxed bg-muted/30 border border-border/40 text-foreground">
              <div className={proseClasses}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                <span className="inline-block w-1.5 h-4 bg-primary/70 animate-pulse ml-0.5 align-middle rounded-sm" />
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isStreaming && !streamingContent && (
          <div className="flex justify-start">
            <div className="rounded-xl px-4 py-3 bg-muted/30 border border-border/40">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-primary/70 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-border/50 px-4 py-3 bg-card">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your research pipeline..."
            rows={1}
            className="flex-1 resize-none bg-muted/40 border border-border/50 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 max-h-[100px] overflow-y-auto transition-colors"
            style={{ minHeight: '40px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 100) + 'px';
            }}
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="p-2.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 transition-colors flex-shrink-0"
              title="Stop generating"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!inputText.trim()}
              className="p-2.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary border border-primary/40 transition-colors disabled:opacity-25 disabled:cursor-not-allowed flex-shrink-0"
              title="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

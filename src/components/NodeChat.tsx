import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, Send, X, Trash2, StopCircle, Sparkles } from 'lucide-react';
import { streamNodeChat, NodeChatMessage } from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface SelectedNodeData {
  id: string;
  type: string;
  label: string;
  fullData?: any;
}

interface NodeChatProps {
  isOpen: boolean;
  onClose: () => void;
  selectedNodes: SelectedNodeData[];
  onRemoveNode: (nodeId: string) => void;
  onClearNodes: () => void;
  q0: string;
  goal: string;
  lens: string;
}

const NODE_TYPE_COLORS: Record<string, string> = {
  q0: 'bg-blue-500/20 border-blue-500/50 text-blue-300',
  goal: 'bg-purple-500/20 border-purple-500/50 text-purple-300',
  spv: 'bg-amber-500/20 border-amber-500/50 text-amber-300',
  ra: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300',
  domain: 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300',
  scientific: 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300',
  l3: 'bg-red-500/20 border-red-500/50 text-red-300',
  ih: 'bg-orange-500/20 border-orange-500/50 text-orange-300',
  l4: 'bg-lime-500/20 border-lime-500/50 text-lime-300',
  l5: 'bg-green-400/20 border-green-400/50 text-green-300',
  l6: 'bg-teal-500/20 border-teal-500/50 text-teal-300',
  common_l6: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300',
};

const getNodeTypeLabel = (type: string): string => {
  const labels: Record<string, string> = {
    q0: 'Q0', goal: 'Goal', spv: 'SPV', ra: 'RA',
    domain: 'Domain', scientific: 'S-Node', l3: 'L3', ih: 'IH',
    l4: 'L4', l5: 'L5', l6: 'L6', common_l6: 'Common L6',
  };
  return labels[type] || type.toUpperCase();
};

export const NodeChat: React.FC<NodeChatProps> = ({
  isOpen,
  onClose,
  selectedNodes,
  onRemoveNode,
  onClearNodes,
  q0,
  goal,
  lens,
}) => {
  const [messages, setMessages] = useState<NodeChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const abortRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text || isStreaming || selectedNodes.length === 0) return;

    const userMessage: NodeChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText('');
    setIsStreaming(true);
    setStreamingContent('');

    // Prepare node data for context (compact version)
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
  }, [inputText, isStreaming, selectedNodes, messages, q0, goal, lens]);

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
    setMessages([]);
    setStreamingContent('');
  }, [isStreaming, handleStop]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-y-0 right-0 w-[420px] bg-card/98 backdrop-blur-md border-l border-border/50 shadow-2xl z-30 flex flex-col animate-in slide-in-from-right duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-gradient-to-r from-primary/5 to-accent/5">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h3 className="font-bold text-sm">Node Chat</h3>
            <p className="text-[10px] text-muted-foreground">
              {selectedNodes.length} node{selectedNodes.length !== 1 ? 's' : ''} selected
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClearChat}
            className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            title="Clear chat"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Selected Nodes Chips */}
      <div className="px-3 py-2 border-b border-border/20 max-h-[120px] overflow-y-auto">
        <div className="flex flex-wrap gap-1.5">
          {selectedNodes.map(node => (
            <div
              key={node.id}
              className={`
                inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium
                ${NODE_TYPE_COLORS[node.type] || 'bg-slate-500/20 border-slate-500/50 text-slate-300'}
              `}
            >
              <span className="font-bold">{getNodeTypeLabel(node.type)}</span>
              <span className="max-w-[120px] truncate opacity-80">
                {node.label?.replace(/^(Q0|Goal|L\d|IH|RA|SPV|Domain):?\s*/i, '')}
              </span>
              <button
                onClick={() => onRemoveNode(node.id)}
                className="ml-0.5 hover:text-red-400 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {selectedNodes.length > 1 && (
            <button
              onClick={onClearNodes}
              className="text-[10px] text-muted-foreground hover:text-red-400 px-2 py-0.5 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
        {selectedNodes.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic py-1">
            Click nodes in the graph to add them to the chat context
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !streamingContent && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 opacity-60">
            <MessageSquare className="w-10 h-10 text-primary/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground mb-1">Ask about your nodes</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Select nodes from the graph and ask questions about their scientific validity, relationships, or implications.
            </p>
            <div className="mt-4 space-y-1.5 w-full">
              {[
                'Explain the relationship between these nodes',
                'Are there any gaps or weaknesses?',
                'Suggest improvements or alternatives',
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInputText(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="w-full text-left text-[11px] px-3 py-2 rounded-lg bg-muted/30 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors border border-border/20"
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
                max-w-[90%] rounded-xl px-3 py-2 text-[12px] leading-relaxed
                ${msg.role === 'user'
                  ? 'bg-primary/20 border border-primary/30 text-foreground'
                  : 'bg-muted/30 border border-border/30 text-foreground'
                }
              `}
            >
              <div className="prose prose-invert prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_code]:text-[11px] [&_code]:bg-black/30 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-black/30 [&_pre]:p-2 [&_pre]:rounded-md [&_pre]:text-[11px] [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:italic [&_table]:text-[11px] [&_th]:px-2 [&_td]:px-2">
                {msg.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
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
            <div className="max-w-[90%] rounded-xl px-3 py-2 text-[12px] leading-relaxed bg-muted/30 border border-border/30 text-foreground">
              <div className="prose prose-invert prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs [&_code]:text-[11px] [&_code]:bg-black/30 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-black/30 [&_pre]:p-2 [&_pre]:rounded-md [&_pre]:text-[11px] [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:italic [&_table]:text-[11px] [&_th]:px-2 [&_td]:px-2">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse ml-0.5 align-middle" />
              </div>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isStreaming && !streamingContent && (
          <div className="flex justify-start">
            <div className="rounded-xl px-3 py-2 bg-muted/30 border border-border/30">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-border/30 px-3 py-3 bg-card/50">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedNodes.length === 0 ? 'Select nodes first...' : 'Ask about these nodes...'}
            disabled={selectedNodes.length === 0}
            rows={1}
            className="flex-1 resize-none bg-muted/30 border border-border/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-40 max-h-[100px] overflow-y-auto"
            style={{ minHeight: '38px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 100) + 'px';
            }}
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 transition-colors flex-shrink-0"
              title="Stop generating"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || selectedNodes.length === 0}
              className="p-2 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
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

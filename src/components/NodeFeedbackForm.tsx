import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Star, Send, Trash2, Loader2, Pencil, Check, X, ChevronDown, ChevronUp, Plus, AlertCircle } from 'lucide-react';
import { submitNodeFeedback, getNodeFeedback, deleteNodeFeedback, updateNodeFeedback } from '@/lib/api';
import type { NodeFeedbackEntry } from '@/lib/api';

const CATEGORIES = [
  { value: 'excellent', label: 'Excellent', color: 'text-green-400', bg: 'bg-green-500/10' },
  { value: 'needs_improvement', label: 'Needs Improvement', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  { value: 'incorrect', label: 'Incorrect', color: 'text-red-400', bg: 'bg-red-500/10' },
  { value: 'too_vague', label: 'Too Vague', color: 'text-orange-400', bg: 'bg-orange-500/10' },
  { value: 'too_ambitious', label: 'Too Ambitious', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  { value: 'not_novel', label: 'Not Novel', color: 'text-gray-400', bg: 'bg-gray-500/10' },
  { value: 'other', label: 'Other', color: 'text-blue-400', bg: 'bg-blue-500/10' },
];

interface NodeFeedbackFormProps {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  userSessionId: string;
  onFeedbackChange?: (nodeId: string, hasFeedback: boolean) => void;
}

// Interactive star rating component
const StarRating: React.FC<{
  value: number;
  onChange?: (val: number) => void;
  size?: number;
  interactive?: boolean;
}> = ({ value, onChange, size = 16, interactive = false }) => {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={() => interactive && onChange?.(star === value ? 0 : star)}
          onMouseEnter={() => interactive && setHover(star)}
          onMouseLeave={() => interactive && setHover(0)}
          className={`${interactive ? 'cursor-pointer hover:scale-125' : 'cursor-default'} transition-all duration-150`}
        >
          <Star
            size={size}
            className={`transition-colors ${
              star <= (interactive ? (hover || value) : value)
                ? 'fill-yellow-400 text-yellow-400'
                : 'text-gray-600 hover:text-gray-500'
            }`}
          />
        </button>
      ))}
    </div>
  );
};

// ── Feedback card (view mode) ──
const FeedbackCard: React.FC<{
  fb: NodeFeedbackEntry;
  highlight?: boolean;
  onEdit: (fb: NodeFeedbackEntry) => void;
  onDelete: (id: string) => void;
}> = ({ fb, highlight, onEdit, onDelete }) => {
  const catMeta = CATEGORIES.find(c => c.value === fb.category);
  return (
    <div className={`rounded-lg border transition-all ${
      highlight
        ? 'bg-teal-500/5 border-teal-500/30'
        : 'bg-background/40 border-border/30 hover:border-border/50'
    }`}>
      <div className="p-3">
        {/* Top row: stars + category + actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {fb.rating != null && fb.rating > 0 && <StarRating value={fb.rating} size={16} />}
            {fb.category && catMeta && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${catMeta.bg} ${catMeta.color}`}>
                {catMeta.label}
              </span>
            )}
          </div>
          {/* Always-visible edit & delete */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => onEdit(fb)}
              className="flex items-center gap-1 px-1.5 py-1 rounded text-xs text-muted-foreground/70 hover:text-primary hover:bg-primary/10 transition-colors"
              title="Edit this feedback"
            >
              <Pencil size={12} />
              <span className="hidden sm:inline">Edit</span>
            </button>
            <button
              onClick={() => onDelete(fb.feedbackId)}
              className="p-1 rounded text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
        {/* Comment text */}
        {fb.comment && (
          <div className="mt-2 text-sm text-foreground/80 leading-relaxed">{fb.comment}</div>
        )}
        {/* Metadata row */}
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground/50">
          {fb.author && <span className="font-medium">by {fb.author}</span>}
          <span>{new Date(fb.createdAt).toLocaleDateString()} {new Date(fb.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {fb.updatedAt !== fb.createdAt && <span className="italic">(edited)</span>}
        </div>
      </div>
    </div>
  );
};

// ── Inline error banner ──
const ErrorBanner: React.FC<{ message: string; onDismiss: () => void }> = ({ message, onDismiss }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
    <AlertCircle size={14} className="shrink-0" />
    <span className="flex-1">{message}</span>
    <button onClick={onDismiss} className="p-0.5 hover:text-red-300 transition-colors"><X size={14} /></button>
  </div>
);

export const NodeFeedbackForm: React.FC<NodeFeedbackFormProps> = ({ nodeId, nodeType, nodeLabel, userSessionId, onFeedbackChange }) => {
  // Form state
  const [rating, setRating] = useState<number>(0);
  const [category, setCategory] = useState<string>('');
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<NodeFeedbackEntry[]>([]);

  // UX state
  const [justSubmittedId, setJustSubmittedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editSaved, setEditSaved] = useState(false);

  // Edit mode state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRating, setEditRating] = useState(0);
  const [editCategory, setEditCategory] = useState('');
  const [editComment, setEditComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const successRef = useRef<HTMLDivElement>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use the logged-in user name from session
  const author = localStorage.getItem('omega-point-user-name') || '';

  const loadFeedback = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await getNodeFeedback(nodeId);
      setFeedback(result);
    } catch (err) {
      console.error('Failed to load feedback:', err);
      setError('Failed to load feedback');
    } finally {
      setIsLoading(false);
    }
  }, [nodeId]);

  // Full reset on node change
  useEffect(() => {
    loadFeedback();
    // Reset ALL state
    setRating(0);
    setCategory('');
    setComment('');
    setJustSubmittedId(null);
    setShowNewForm(false);
    setShowOlder(false);
    setEditingId(null);
    setEditRating(0);
    setEditCategory('');
    setEditComment('');
    setError(null);
    setEditSaved(false);
    // Cleanup timers
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, [loadFeedback]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const hasFeedback = feedback.length > 0;
  const formVisible = showNewForm || !hasFeedback;

  const handleSubmit = async () => {
    if (!rating && !comment && !category) return;

    try {
      setIsSubmitting(true);
      setError(null);
      const newFeedback = await submitNodeFeedback({
        node_id: nodeId,
        node_type: nodeType,
        user_session_id: userSessionId,
        node_label: nodeLabel || undefined,
        rating: rating || undefined,
        comment: comment || undefined,
        category: category || undefined,
        author: author || undefined,
      });

      // Add to list
      setFeedback(prev => [newFeedback, ...prev]);
      onFeedbackChange?.(nodeId, true);

      // Reset form & show success
      setRating(0);
      setCategory('');
      setComment('');
      setJustSubmittedId(newFeedback.feedbackId);
      setShowNewForm(false);

      // Auto-dismiss success banner after 6s
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setJustSubmittedId(null), 6000);

      // Scroll into view
      setTimeout(() => successRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      setError('Failed to submit. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (fb: NodeFeedbackEntry) => {
    setEditingId(fb.feedbackId);
    setEditRating(fb.rating || 0);
    setEditCategory(fb.category || '');
    setEditComment(fb.comment || '');
    setError(null);
    setEditSaved(false);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditRating(0);
    setEditCategory('');
    setEditComment('');
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    try {
      setIsSaving(true);
      setError(null);
      const updated = await updateNodeFeedback(editingId, {
        rating: editRating || undefined,
        comment: editComment || undefined,
        category: editCategory || undefined,
      });

      setFeedback(prev => prev.map(f => f.feedbackId === editingId ? updated : f));
      setEditingId(null);
      setEditSaved(true);
      setTimeout(() => setEditSaved(false), 4000);
    } catch (err) {
      console.error('Failed to update feedback:', err);
      setError('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (feedbackId: string) => {
    if (!window.confirm('Delete this feedback?')) return;
    try {
      setError(null);
      await deleteNodeFeedback(feedbackId);
      setFeedback(prev => {
        const remaining = prev.filter(f => f.feedbackId !== feedbackId);
        if (remaining.length === 0) onFeedbackChange?.(nodeId, false);
        return remaining;
      });
      if (editingId === feedbackId) setEditingId(null);
      if (justSubmittedId === feedbackId) setJustSubmittedId(null);
    } catch (err) {
      console.error('Failed to delete feedback:', err);
      setError('Failed to delete. Please try again.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 size={14} className="animate-spin" /> Loading feedback...
      </div>
    );
  }

  // Split: latest (first) vs older
  const latestFb = feedback[0] || null;
  const olderFb = feedback.slice(1);

  return (
    <div className="space-y-3">
      {/* ── ERROR BANNER ── */}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* ── SUCCESS BANNER (submit) ── */}
      {justSubmittedId && (
        <div ref={successRef} className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400">
          <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
            <Check size={14} />
          </div>
          <div>
            <div className="text-sm font-semibold">Feedback submitted!</div>
            <div className="text-xs text-green-400/70">You can modify it below or add more feedback.</div>
          </div>
        </div>
      )}

      {/* ── SUCCESS BANNER (edit saved) ── */}
      {editSaved && !justSubmittedId && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400">
          <Check size={14} className="shrink-0" />
          <span className="text-sm font-medium">Changes saved!</span>
        </div>
      )}

      {/* ── LATEST FEEDBACK (always visible when exists and not being edited) ── */}
      {latestFb && editingId !== latestFb.feedbackId && (
        <div>
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1 mb-1.5">
            Your Latest Feedback
          </div>
          <FeedbackCard
            fb={latestFb}
            highlight={justSubmittedId === latestFb.feedbackId}
            onEdit={handleStartEdit}
            onDelete={handleDelete}
          />
        </div>
      )}

      {/* ── EDIT MODE (inline, replaces the card being edited) ── */}
      {editingId && (() => {
        const fb = feedback.find(f => f.feedbackId === editingId);
        if (!fb) return null;
        return (
          <div className="rounded-lg border border-primary/30 bg-secondary/40 shadow-sm">
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Modify Feedback</span>
                  <span className="ml-2 text-xs text-muted-foreground/50">
                    {new Date(fb.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <button onClick={handleCancelEdit} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                  <X size={16} />
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground font-medium">Rating</span>
                <StarRating value={editRating} onChange={setEditRating} size={22} interactive />
                {editRating > 0 && <span className="text-sm text-yellow-400 font-medium">{editRating}/5</span>}
              </div>

              <div>
                <span className="text-sm text-muted-foreground font-medium block mb-1.5">Category</span>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setEditCategory(editCategory === cat.value ? '' : cat.value)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-all ${
                        editCategory === cat.value
                          ? `${cat.color} ${cat.bg} border-current`
                          : 'text-muted-foreground/60 border-border/30 hover:border-border/60'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                value={editComment}
                onChange={(e) => setEditComment(e.target.value)}
                rows={4}
                placeholder="Your feedback comment..."
                className="w-full px-3 py-2 text-sm bg-background/80 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground resize-y leading-relaxed placeholder:text-muted-foreground/40"
              />

              <div className="flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={isSaving}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-md bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 hover:border-green-400/50 transition-all disabled:opacity-50"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Save Changes
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-md bg-secondary/40 text-muted-foreground border border-border/30 hover:bg-secondary/60 transition-colors"
                >
                  <X size={14} /> Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── OLDER FEEDBACK (collapsible) ── */}
      {olderFb.length > 0 && (
        <div>
          <button
            onClick={() => setShowOlder(!showOlder)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors px-1"
          >
            {showOlder ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{olderFb.length} older feedback{olderFb.length > 1 ? 's' : ''}</span>
          </button>
          {showOlder && (
            <div className="mt-2 space-y-2">
              {olderFb.map((fb) => (
                editingId === fb.feedbackId ? null : (
                  <FeedbackCard
                    key={fb.feedbackId}
                    fb={fb}
                    onEdit={handleStartEdit}
                    onDelete={handleDelete}
                  />
                )
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── NEW FEEDBACK FORM ── */}
      {formVisible && !editingId ? (
        <div className="p-4 bg-gradient-to-b from-secondary/40 to-secondary/20 rounded-lg border border-border/50">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold text-muted-foreground uppercase tracking-wider">
              {hasFeedback ? 'Add Another Feedback' : 'Add Feedback'}
            </div>
            {author && (
              <span className="text-xs text-muted-foreground/60">as {author}</span>
            )}
          </div>

          {/* Rating */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-sm text-muted-foreground font-medium">Rating</span>
            <StarRating value={rating} onChange={setRating} size={22} interactive />
            {rating > 0 && (
              <span className="text-sm text-yellow-400 font-medium">{rating}/5</span>
            )}
          </div>

          {/* Category pills */}
          <div className="mb-3">
            <span className="text-sm text-muted-foreground font-medium block mb-1.5">Category</span>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(category === cat.value ? '' : cat.value)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-all ${
                    category === cat.value
                      ? `${cat.color} ${cat.bg} border-current shadow-sm`
                      : 'text-muted-foreground/60 border-border/30 hover:border-border/60 hover:text-muted-foreground'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Comment */}
          <div className="mb-3">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What could be improved? Share your thoughts..."
              rows={4}
              className="w-full px-3 py-2 text-sm bg-background/80 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/30 text-foreground placeholder:text-muted-foreground/40 resize-y transition-colors leading-relaxed"
            />
          </div>

          {/* Submit */}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || (!rating && !comment && !category)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold rounded-md transition-all duration-200 bg-gradient-to-r from-teal-500/15 to-cyan-500/15 text-teal-400 border border-teal-500/30 hover:from-teal-500/25 hover:to-cyan-500/25 hover:border-teal-400/50 hover:shadow-[0_0_10px_rgba(20,184,166,0.2)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none"
            >
              {isSubmitting ? (
                <><Loader2 size={14} className="animate-spin" /> Submitting...</>
              ) : (
                <><Send size={14} /> Submit Feedback</>
              )}
            </button>
            {hasFeedback && (
              <button
                onClick={() => { setShowNewForm(false); setRating(0); setCategory(''); setComment(''); }}
                className="px-3 py-2.5 text-sm font-semibold rounded-md bg-secondary/40 text-muted-foreground border border-border/30 hover:bg-secondary/60 transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : hasFeedback && !editingId && (
        /* "+ Add feedback" button when form is hidden */
        <button
          onClick={() => { setShowNewForm(true); setError(null); }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-teal-400/70 border border-dashed border-teal-500/20 hover:border-teal-500/40 hover:text-teal-400 hover:bg-teal-500/5 transition-all"
        >
          <Plus size={14} />
          Add more feedback
        </button>
      )}
    </div>
  );
};

import React, { useState, useEffect, useCallback } from 'react';
import { Star, Send, Trash2, Loader2, Pencil, Check, X } from 'lucide-react';
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
  userSessionId: string;
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

export const NodeFeedbackForm: React.FC<NodeFeedbackFormProps> = ({ nodeId, nodeType, userSessionId }) => {
  // New feedback form state
  const [rating, setRating] = useState<number>(0);
  const [category, setCategory] = useState<string>('');
  const [comment, setComment] = useState('');
  const [author, setAuthor] = useState(() => localStorage.getItem('feedback-author') || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<NodeFeedbackEntry[]>([]);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Edit mode state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRating, setEditRating] = useState(0);
  const [editCategory, setEditCategory] = useState('');
  const [editComment, setEditComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadFeedback = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await getNodeFeedback(nodeId);
      setFeedback(result);
    } catch (error) {
      console.error('Failed to load feedback:', error);
    } finally {
      setIsLoading(false);
    }
  }, [nodeId]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  const handleSubmit = async () => {
    if (!rating && !comment && !category) return;

    try {
      setIsSubmitting(true);
      const newFeedback = await submitNodeFeedback({
        node_id: nodeId,
        node_type: nodeType,
        user_session_id: userSessionId,
        rating: rating || undefined,
        comment: comment || undefined,
        category: category || undefined,
        author: author || undefined,
      });

      // Save author for next time
      if (author) localStorage.setItem('feedback-author', author);

      // Add to list immediately
      setFeedback(prev => [newFeedback, ...prev]);

      // Reset form
      setRating(0);
      setCategory('');
      setComment('');
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 2000);
    } catch (error) {
      console.error('Failed to submit feedback:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (fb: NodeFeedbackEntry) => {
    setEditingId(fb.feedbackId);
    setEditRating(fb.rating || 0);
    setEditCategory(fb.category || '');
    setEditComment(fb.comment || '');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditRating(0);
    setEditCategory('');
    setEditComment('');
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    try {
      setIsSaving(true);
      const updated = await updateNodeFeedback(editingId, {
        rating: editRating || undefined,
        comment: editComment || undefined,
        category: editCategory || undefined,
      });

      // Update in local list
      setFeedback(prev => prev.map(f => f.feedbackId === editingId ? updated : f));
      setEditingId(null);
    } catch (error) {
      console.error('Failed to update feedback:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (feedbackId: string) => {
    if (!window.confirm('Delete this feedback?')) return;
    try {
      await deleteNodeFeedback(feedbackId);
      setFeedback(prev => prev.filter(f => f.feedbackId !== feedbackId));
      if (editingId === feedbackId) setEditingId(null);
    } catch (error) {
      console.error('Failed to delete feedback:', error);
    }
  };

  return (
    <div className="space-y-3">
      {/* New feedback form */}
      <div className="p-3 bg-gradient-to-b from-secondary/40 to-secondary/20 rounded-lg border border-border/50">
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
          Add Feedback
        </div>

        {/* Author name */}
        <div className="mb-2">
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your name (optional)"
            className="w-full px-2.5 py-1.5 text-[11px] bg-background/80 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/30 text-foreground placeholder:text-muted-foreground/40 transition-colors"
          />
        </div>

        {/* Rating */}
        <div className="flex items-center gap-2.5 mb-2">
          <span className="text-xs text-muted-foreground font-medium w-10">Rating</span>
          <StarRating value={rating} onChange={setRating} size={18} interactive />
          {rating > 0 && (
            <span className="text-xs text-yellow-400 font-medium">{rating}/5</span>
          )}
        </div>

        {/* Category pills */}
        <div className="mb-2">
          <span className="text-xs text-muted-foreground font-medium block mb-1">Category</span>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(category === cat.value ? '' : cat.value)}
                className={`px-2 py-0.5 text-[9px] font-medium rounded-full border transition-all ${
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
        <div className="mb-2.5">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What could be improved? Share your thoughts..."
            rows={2}
            className="w-full px-2.5 py-1.5 text-[11px] bg-background/80 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/30 text-foreground placeholder:text-muted-foreground/40 resize-none transition-colors"
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || (!rating && !comment && !category)}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-md transition-all duration-200 ${
            submitSuccess
              ? 'bg-green-500/20 text-green-400 border border-green-500/40 shadow-[0_0_10px_rgba(34,197,94,0.2)]'
              : 'bg-gradient-to-r from-teal-500/15 to-cyan-500/15 text-teal-400 border border-teal-500/30 hover:from-teal-500/25 hover:to-cyan-500/25 hover:border-teal-400/50 hover:shadow-[0_0_10px_rgba(20,184,166,0.2)] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none'
          }`}
        >
          {isSubmitting ? (
            <><Loader2 size={12} className="animate-spin" /> Submitting...</>
          ) : submitSuccess ? (
            <><Check size={12} /> Saved!</>
          ) : (
            <><Send size={12} /> Submit Feedback</>
          )}
        </button>
      </div>

      {/* Existing feedback list */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground py-3">
          <Loader2 size={12} className="animate-spin" /> Loading feedback...
        </div>
      ) : feedback.length > 0 ? (
        <div className="space-y-1">
          <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider px-1">
            Feedback ({feedback.length})
          </div>
          <div className="space-y-1.5">
            {feedback.map((fb) => (
              <div
                key={fb.feedbackId}
                className={`rounded-lg border transition-all ${
                  editingId === fb.feedbackId
                    ? 'bg-secondary/40 border-primary/30 shadow-sm'
                    : 'bg-background/40 border-border/30 hover:border-border/50'
                }`}
              >
                {editingId === fb.feedbackId ? (
                  /* Edit mode */
                  <div className="p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-medium w-10">Rating</span>
                      <StarRating value={editRating} onChange={setEditRating} size={16} interactive />
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {CATEGORIES.map((cat) => (
                        <button
                          key={cat.value}
                          type="button"
                          onClick={() => setEditCategory(editCategory === cat.value ? '' : cat.value)}
                          className={`px-2 py-0.5 text-[9px] font-medium rounded-full border transition-all ${
                            editCategory === cat.value
                              ? `${cat.color} ${cat.bg} border-current`
                              : 'text-muted-foreground/60 border-border/30 hover:border-border/60'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>

                    <textarea
                      value={editComment}
                      onChange={(e) => setEditComment(e.target.value)}
                      rows={2}
                      className="w-full px-2 py-1.5 text-[11px] bg-background/80 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/40 text-foreground resize-none"
                    />

                    <div className="flex gap-1.5">
                      <button
                        onClick={handleSaveEdit}
                        disabled={isSaving}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
                      >
                        {isSaving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                        Save
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs font-semibold rounded bg-secondary/40 text-muted-foreground hover:bg-secondary/60 transition-colors"
                      >
                        <X size={10} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="p-2.5 group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        {fb.rating && <StarRating value={fb.rating} size={12} />}
                        {fb.category && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                            CATEGORIES.find(c => c.value === fb.category)?.bg || 'bg-secondary/40'
                          } ${
                            CATEGORIES.find(c => c.value === fb.category)?.color || 'text-muted-foreground'
                          }`}>
                            {CATEGORIES.find(c => c.value === fb.category)?.label || fb.category}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => handleStartEdit(fb)}
                          className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          title="Edit feedback"
                        >
                          <Pencil size={10} />
                        </button>
                        <button
                          onClick={() => handleDelete(fb.feedbackId)}
                          className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete feedback"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>
                    {fb.comment && (
                      <div className="mt-1.5 text-[11px] text-foreground/80 leading-relaxed">{fb.comment}</div>
                    )}
                    <div className="mt-1.5 flex items-center gap-2 text-[9px] text-muted-foreground/50">
                      {fb.author && <span className="font-medium">by {fb.author}</span>}
                      <span>{new Date(fb.createdAt).toLocaleDateString()} {new Date(fb.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {fb.updatedAt !== fb.createdAt && <span className="italic">(edited)</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

/**
 * Chat Context Builder — builds compact pipeline summaries for the Node Chat system prompt.
 * Walks step outputs to produce a compressed hierarchy tree and L6 analysis summary.
 */
import { PipelineStep } from '@/types';

export interface SelectedNodeData {
  id: string;
  type: string;
  label: string;
  fullData?: any;
}

// ─── Build compressed hierarchy tree for chat context ───────────────────────

export function buildGraphSummaryForChat(
  steps: PipelineStep[],
  highlightedL6Ids: string[] = []
): string {
  const lines: string[] = [];
  const bestSet = new Set(highlightedL6Ids);

  // Step 1: Q0
  const s1 = steps.find(s => s.id === 1);
  const q0Text = s1?.output?.text || s1?.input || '';
  if (q0Text) lines.push(`Q0: ${truncate(q0Text, 120)}`);

  // Step 2: Goals
  const s2 = steps.find(s => s.id === 2);
  const goals = s2?.output?.goals || [];

  // Step 3: RAs (keyed by goal id)
  const s3 = steps.find(s => s.id === 3);

  // Step 6: L3 questions
  const s6 = steps.find(s => s.id === 6);
  const l3arr: any[] = s6?.output?.l3_questions || s6?.output?.seed_questions || [];

  // Step 7: IHs
  const s7 = steps.find(s => s.id === 7);
  const iharr: any[] = s7?.output?.instantiation_hypotheses || [];

  // Step 8: L4s
  const s8 = steps.find(s => s.id === 8);
  const l4arr: any[] = s8?.output?.l4_questions || [];

  // Step 9: L5s + L6s
  const s9 = steps.find(s => s.id === 9);
  const l5arr: any[] = s9?.output?.l5_nodes || [];
  const l6arr: any[] = s9?.output?.l6_tasks || [];

  // Build hierarchy: Goal → L3 → IH → L4 → L5 → L6
  for (const g of goals) {
    const gLabel = g.title || g.name || g.id;
    lines.push(`\n${g.id}: ${truncate(gLabel, 80)}`);

    // RAs under this goal
    const goalRAs = s3?.output?.[g.id] || [];
    if (Array.isArray(goalRAs) && goalRAs.length > 0) {
      lines.push(`  [${goalRAs.length} RAs]`);
    }

    // L3s under this goal
    const goalL3s = l3arr.filter(q => q.parent_goal_id === g.id || q.goal_id === g.id);
    for (const l3 of goalL3s) {
      const l3Text = l3.text || l3.title || l3.id;
      lines.push(`  ${l3.id}: ${truncate(l3Text, 80)}`);

      // IHs under this L3
      const l3IHs = iharr.filter(ih => ih.parent_l3_id === l3.id || ih.l3_id === l3.id);
      for (const ih of l3IHs) {
        const ihText = ih.process_hypothesis || ih.title || ih.id;
        lines.push(`    ${ih.id}: ${truncate(ihText, 70)}`);

        // L4s under this IH
        const ihL4s = l4arr.filter(q => q.parent_ih_id === ih.id || q.ih_id === ih.id);
        for (const l4 of ihL4s) {
          const l4Text = l4.text || l4.title || l4.id;
          lines.push(`      ${l4.id}: ${truncate(l4Text, 65)}`);

          // L5s under this L4
          const l4L5s = l5arr.filter(n => n.parent_l4_id === l4.id || n.l4_id === l4.id);
          for (const l5 of l4L5s) {
            const l5Text = l5.text || l5.title || l5.id;
            lines.push(`        ${l5.id}: ${truncate(l5Text, 60)}`);

            // L6s under this L5
            const l5L6s = l6arr.filter(t => t.parent_l5_id === l5.id || t.l5_id === l5.id);
            for (const l6 of l5L6s) {
              const l6Text = l6.title || l6.text || l6.id;
              const marker = bestSet.has(l6.id) ? ' [BEST]' : '';
              lines.push(`          ${l6.id}: ${truncate(l6Text, 55)}${marker}`);
            }
          }
        }
      }
    }
  }

  return lines.join('\n');
}

// ─── Build L6 analysis summary ──────────────────────────────────────────────

export function buildL6AnalysisSummary(l6AnalysisResult: any): string {
  if (!l6AnalysisResult?.selected_experiments?.length) return '';
  const lines: string[] = [];

  if (l6AnalysisResult.overall_assessment) {
    lines.push(`Overall: ${truncate(l6AnalysisResult.overall_assessment, 200)}`);
  }
  if (l6AnalysisResult.coverage_gaps) {
    lines.push(`Gaps: ${truncate(l6AnalysisResult.coverage_gaps, 200)}`);
  }

  lines.push('');
  for (const exp of l6AnalysisResult.selected_experiments) {
    const parts = [`#${exp.rank} [${exp.l6_id}]`];
    if (exp.strategic_value) parts.push(`Value: ${truncate(exp.strategic_value, 80)}`);
    if (exp.impact_potential) parts.push(`Impact: ${truncate(exp.impact_potential, 80)}`);
    lines.push(parts.join(' | '));
  }

  return lines.join('\n');
}

// ─── Get all descendants of a node ──────────────────────────────────────────

export function getNodeDescendants(
  nodeId: string,
  nodeType: string,
  steps: PipelineStep[]
): SelectedNodeData[] {
  const results: SelectedNodeData[] = [];

  const s6 = steps.find(s => s.id === 6);
  const s7 = steps.find(s => s.id === 7);
  const s8 = steps.find(s => s.id === 8);
  const s9 = steps.find(s => s.id === 9);

  const l3arr: any[] = s6?.output?.l3_questions || s6?.output?.seed_questions || [];
  const iharr: any[] = s7?.output?.instantiation_hypotheses || [];
  const l4arr: any[] = s8?.output?.l4_questions || [];
  const l5arr: any[] = s9?.output?.l5_nodes || [];
  const l6arr: any[] = s9?.output?.l6_tasks || [];

  if (nodeType === 'goal') {
    const childL3s = l3arr.filter(q => q.parent_goal_id === nodeId || q.goal_id === nodeId);
    for (const l3 of childL3s) {
      results.push({ id: l3.id, type: 'l3', label: l3.text || l3.title || l3.id, fullData: l3 });
      results.push(...getNodeDescendants(l3.id, 'l3', steps));
    }
  } else if (nodeType === 'l3') {
    const childIHs = iharr.filter(ih => ih.parent_l3_id === nodeId || ih.l3_id === nodeId);
    for (const ih of childIHs) {
      results.push({ id: ih.id, type: 'ih', label: ih.process_hypothesis || ih.title || ih.id, fullData: ih });
      results.push(...getNodeDescendants(ih.id, 'ih', steps));
    }
  } else if (nodeType === 'ih') {
    const childL4s = l4arr.filter(q => q.parent_ih_id === nodeId || q.ih_id === nodeId);
    for (const l4 of childL4s) {
      results.push({ id: l4.id, type: 'l4', label: l4.text || l4.title || l4.id, fullData: l4 });
      results.push(...getNodeDescendants(l4.id, 'l4', steps));
    }
  } else if (nodeType === 'l4') {
    const childL5s = l5arr.filter(n => n.parent_l4_id === nodeId || n.l4_id === nodeId);
    for (const l5 of childL5s) {
      results.push({ id: l5.id, type: 'l5', label: l5.text || l5.title || l5.id, fullData: l5 });
      results.push(...getNodeDescendants(l5.id, 'l5', steps));
    }
  } else if (nodeType === 'l5') {
    const childL6s = l6arr.filter(t => t.parent_l5_id === nodeId || t.l5_id === nodeId);
    for (const l6 of childL6s) {
      results.push({ id: l6.id, type: 'l6', label: l6.title || l6.text || l6.id, fullData: l6 });
    }
  }

  return results;
}

// ─── Get all nodes of a given type ──────────────────────────────────────────

export function getNodesByType(
  type: string,
  steps: PipelineStep[]
): SelectedNodeData[] {
  const s2 = steps.find(s => s.id === 2);
  const s6 = steps.find(s => s.id === 6);
  const s7 = steps.find(s => s.id === 7);
  const s8 = steps.find(s => s.id === 8);
  const s9 = steps.find(s => s.id === 9);

  switch (type) {
    case 'goal': {
      const goals = s2?.output?.goals || [];
      return goals.map((g: any) => ({
        id: g.id, type: 'goal', label: g.title || g.name || g.id, fullData: g,
      }));
    }
    case 'l3': {
      const arr = s6?.output?.l3_questions || s6?.output?.seed_questions || [];
      return arr.map((q: any) => ({
        id: q.id, type: 'l3', label: q.text || q.title || q.id, fullData: q,
      }));
    }
    case 'ih': {
      const arr = s7?.output?.instantiation_hypotheses || [];
      return arr.map((ih: any) => ({
        id: ih.id, type: 'ih', label: ih.process_hypothesis || ih.title || ih.id, fullData: ih,
      }));
    }
    case 'l4': {
      const arr = s8?.output?.l4_questions || [];
      return arr.map((q: any) => ({
        id: q.id, type: 'l4', label: q.text || q.title || q.id, fullData: q,
      }));
    }
    case 'l5': {
      const arr = s9?.output?.l5_nodes || [];
      return arr.map((n: any) => ({
        id: n.id, type: 'l5', label: n.text || n.title || n.id, fullData: n,
      }));
    }
    case 'l6': {
      const arr = s9?.output?.l6_tasks || [];
      return arr.map((t: any) => ({
        id: t.id, type: 'l6', label: t.title || t.text || t.id, fullData: t,
      }));
    }
    default:
      return [];
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (!text) return '';
  const clean = text.replace(/\n/g, ' ').trim();
  return clean.length <= maxLen ? clean : clean.slice(0, maxLen - 3) + '...';
}

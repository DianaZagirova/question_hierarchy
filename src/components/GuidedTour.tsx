import { useState, useEffect } from 'react';
import Joyride, {
  CallBackProps,
  STATUS,
  Step,
  ACTIONS,
  EVENTS,
  TooltipRenderProps,
} from 'react-joyride';

interface GuidedTourProps {
  run: boolean;
  onFinish: () => void;
}

const TOUR_COMPLETED_KEY = 'omega-point-tour-completed';

const tourSteps: Step[] = [
  // 1 — Welcome + goal input
  {
    target: '[data-tour-goal-input]',
    title: 'Step 1: Enter Your Goal',
    content:
      'Start by typing a big, ambitious, general research goal. The more audacious, the better — the pipeline is designed for moonshot science.\n\nGreat examples:\n• "Achieve radical life extension"\n• "Reverse biological aging"\n• "Cure all neurodegenerative disease"\n\nThe system will decompose this into concrete, executable lab experiments that nobody has done before.',
    placement: 'bottom',
    disableBeacon: true,
  },
  // 2 — Run buttons
  {
    target: '[data-tour-run-buttons]',
    title: 'Launch the Pipeline',
    content:
      '• "Run All" — executes all 10 steps end-to-end (~10-18 min)\n• "Step 1" — runs only the first step so you can review before continuing\n\nWhile running, this becomes a "Stop" button. You can abort at any time.',
    placement: 'left',
  },
  // 3 — Save / Export / Reset
  {
    target: '[data-tour-secondary-actions]',
    title: 'Save, Export & Reset',
    content:
      '• Save — snapshot your progress as a named version\n• Export — download all results as a JSON file\n• I/O Check — save raw inputs/outputs for debugging\n• Reset — clear all pipeline data and start fresh',
    placement: 'bottom',
  },
  // 4 — Epistemic Lens
  {
    target: '[data-tour-lens]',
    title: 'Epistemic Lens',
    content:
      'Optional but powerful. Choose a conceptual framework (e.g. "Complex Adaptive Systems", "Reliability Engineering") that shapes how all 10 AI agents interpret your goal.\n\nYou can also write a fully custom lens. Try different lenses on the same goal for surprisingly different decompositions.',
    placement: 'bottom',
  },
  // 5 — Tabs
  {
    target: '[data-tour-tabs]',
    title: 'View Tabs',
    content:
      '• Overview — system architecture & pipeline diagram\n• Agents — configure the 10 AI agents, their prompts, models, and temperatures\n• Split View — pipeline + graph side by side (default)\n• Pipeline — full-width step-by-step cards\n• Graph — full-width interactive knowledge graph\n• Versions — your saved snapshots to restore anytime',
    placement: 'bottom',
  },
  // 6 — Pipeline panel
  {
    target: '[data-tour-pipeline-panel]',
    title: 'Pipeline Steps',
    content:
      'Each card is one of the 10 decomposition steps:\n\n1. Goal → 2. Pillars → 3. Requirements → 4. Domains & Evidence → 6. Questions → 7. Hypotheses → 8. Tactics → 9. Protocols → 10. Unified Experiments\n\nEach card has Run, Retry, Edit (JSON), and Clear buttons. After Step 2, you can select a single goal pillar to focus subsequent steps on.',
    placement: 'right',
  },
  // 7 — Best Experiments (L6)
  {
    target: '[data-tour-best-experiments]',
    title: 'Best Experiments (L6)',
    content:
      'After the pipeline completes, this panel appears at the bottom. Click "Find Best Experiments" to have AI rank all generated experiments.\n\nEach experiment card shows:\n• SIMT: System, Intervention, Meter, Threshold/Time\n• Genius score — how original and ambitious\n• Feasibility score — how realistic to execute\n• Strategic value & discrimination power\n• Eye icon — click to locate the experiment on the graph\n• Copy icon — copy full experiment details to clipboard',
    placement: 'top',
  },
  // 8 — Graph panel
  {
    target: '[data-tour-graph-panel]',
    title: 'Knowledge Graph',
    content:
      'Interactive visualization of the full decomposition tree — every node is a piece of the analysis.\n\n• Click a node to inspect its details\n• Right-click a node to open the context menu\n• Scroll to zoom, drag to pan\n• "Zen" button hides all controls for a clean view\n• Expand icon opens the graph fullscreen\n• The color legend at the bottom shows what each node type means',
    placement: 'left',
  },
  // 9 — Graph controls + Research Chat
  {
    target: '[data-tour-graph-controls]',
    title: 'Graph Toolbar',
    content:
      'The toolbar in the top-left of the graph:\n\n• Search — find any node by text\n• Layer Filters — show/hide node types with presets: Overview, Strategy, Lab\n• Jump to Q0 / Goals — quick navigation\n• Smart Expand — auto-reveal relevant branches\n• Compact Mode — denser layout for large graphs\n• Reset View — restore default zoom & pan position',
    placement: 'right',
  },
  // 10 — Research Chat (separate step for emphasis)
  {
    target: '[data-tour-graph-controls]',
    title: 'Research Chat',
    content:
      'The chat icon in the toolbar opens the Research Chat — a powerful AI assistant for deep analysis.\n\nHow to use it:\n1. Right-click any node → "Add to Chat" (or "Add Branch" for a whole subtree, or "Add All" for all nodes of a type)\n2. Open the chat panel\n3. Ask questions about the selected nodes — the AI has full context of your pipeline\n\nUse it to explore hypotheses, compare experiments, or get strategic advice.',
    placement: 'right',
  },
  // 11 — Node inspector + feedback
  {
    target: '[data-tour-graph-panel]',
    title: 'Node Inspector & Feedback',
    content:
      'Click any node to open the inspector panel (top-right). It has three action buttons:\n\n• AI Improve — ask LLM to enhance the node. You can select other nodes as context.\n• Edit — directly modify the node\'s data in a JSON editor\n• Feedback — rate the node (thumbs up/down) and leave a comment\n\nYour feedback is saved to the database and linked to your session. This is valuable — it helps the community identify which nodes and experiments are most promising.',
    placement: 'left',
  },
  // 12 — Session management + sharing
  {
    target: '[data-tour-session-switcher]',
    title: 'Sessions & Community Sharing',
    content:
      'The session switcher has two tabs:\n\n"My Sessions" — your personal research goals. Create, rename, duplicate, or delete sessions. Your work auto-saves.\n\n"Community" — browse sessions published by other researchers. Clone any community session to explore or build on it.\n\nTo share your work: hover over a session → click the share icon to publish it to the Community tab for everyone to see and clone.',
    placement: 'bottom-end',
  },
  // 13 — Telegram sharing
  {
    target: '[data-tour-session-switcher]',
    title: 'Telegram Integration',
    content:
      'If you log in via Telegram, you get a "Share" button in the header that sends a formatted report of your current session directly to your Telegram chat.\n\nThe report includes your goal, master question (Q0), key findings, and experiment summaries — perfect for sharing progress with your team.',
    placement: 'bottom-end',
  },
  // 14 — Help
  {
    target: '[data-tour-help]',
    title: 'Replay This Tour',
    content:
      'Click the "?" button here anytime to replay this guided tour.\n\nNow go enter an ambitious goal and let the pipeline surprise you!',
    placement: 'bottom-end',
  },
];

/** Custom tooltip for polished dark-theme look */
function CustomTooltip({
  continuous,
  index,
  step,
  backProps,
  primaryProps,
  skipProps,
  closeProps,
  tooltipProps,
  size,
  isLastStep,
}: TooltipRenderProps) {
  const progress = `${index + 1} of ${size}`;

  return (
    <div
      {...tooltipProps}
      style={{
        background: 'linear-gradient(160deg, hsl(222 47% 11%), hsl(222 47% 8%))',
        border: '1px solid hsl(222 47% 20%)',
        borderRadius: 14,
        padding: 0,
        maxWidth: 400,
        minWidth: 290,
        boxShadow:
          '0 0 40px rgba(74, 222, 128, 0.08), 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(74, 222, 128, 0.05)',
        overflow: 'hidden',
        fontFamily: 'inherit',
      }}
    >
      {/* Green accent bar at top */}
      <div
        style={{
          height: 3,
          background: `linear-gradient(90deg, hsl(142 76% 56%), hsl(180 100% 50%))`,
          borderRadius: '14px 14px 0 0',
        }}
      />

      <div style={{ padding: '18px 20px 16px' }}>
        {/* Header: title + step counter */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          {step.title && (
            <h3
              style={{
                margin: 0,
                fontSize: 15,
                fontWeight: 700,
                color: 'hsl(142 76% 56%)',
                letterSpacing: '-0.01em',
              }}
            >
              {step.title as string}
            </h3>
          )}
          <span
            style={{
              fontSize: 11,
              color: 'hsl(215 20% 45%)',
              fontWeight: 500,
              flexShrink: 0,
              marginLeft: 12,
              background: 'hsl(222 47% 14%)',
              padding: '2px 8px',
              borderRadius: 10,
            }}
          >
            {progress}
          </span>
        </div>

        {/* Content */}
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.65,
            color: 'hsl(215 20% 72%)',
            whiteSpace: 'pre-line',
          }}
        >
          {step.content}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '0 20px', marginBottom: 2 }}>
        <div
          style={{
            height: 2,
            background: 'hsl(222 47% 14%)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${((index + 1) / size) * 100}%`,
              background: 'linear-gradient(90deg, hsl(142 76% 56%), hsl(180 100% 50%))',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Footer with buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderTop: '1px solid hsl(222 47% 14%)',
          background: 'hsl(222 47% 7%)',
        }}
      >
        {/* Left: skip */}
        <button
          {...skipProps}
          style={{
            background: 'none',
            border: 'none',
            color: 'hsl(215 20% 40%)',
            fontSize: 12,
            cursor: 'pointer',
            padding: '4px 0',
            fontFamily: 'inherit',
          }}
        >
          Skip tour
        </button>

        {/* Right: back + next */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {index > 0 && (
            <button
              {...backProps}
              style={{
                background: 'none',
                border: '1px solid hsl(222 47% 22%)',
                color: 'hsl(215 20% 65%)',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                padding: '6px 14px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Back
            </button>
          )}
          {continuous && (
            <button
              {...primaryProps}
              style={{
                background: 'linear-gradient(135deg, hsl(142 76% 56%), hsl(142 76% 46%))',
                border: 'none',
                color: 'hsl(222 47% 6%)',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 18px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(74, 222, 128, 0.25)',
              }}
            >
              {isLastStep ? 'Done' : 'Next'}
            </button>
          )}
          {!continuous && (
            <button
              {...closeProps}
              style={{
                background: 'linear-gradient(135deg, hsl(142 76% 56%), hsl(142 76% 46%))',
                border: 'none',
                color: 'hsl(222 47% 6%)',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                padding: '6px 18px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(74, 222, 128, 0.25)',
              }}
            >
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function GuidedTour({ run, onFinish }: GuidedTourProps) {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (run) {
      setStepIndex(0);
    }
  }, [run]);

  const handleCallback = (data: CallBackProps) => {
    const { status, action, type, index } = data;
    const finishedStatuses: string[] = [STATUS.FINISHED, STATUS.SKIPPED];

    if (finishedStatuses.includes(status)) {
      localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
      onFinish();
    }

    if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
      const nextIndex = index + (action === ACTIONS.PREV ? -1 : 1);
      setStepIndex(nextIndex);
    }
  };

  return (
    <Joyride
      steps={tourSteps}
      run={run}
      stepIndex={stepIndex}
      callback={handleCallback}
      continuous
      showSkipButton
      showProgress
      disableOverlayClose={false}
      spotlightClicks={false}
      spotlightPadding={8}
      scrollToFirstStep
      tooltipComponent={CustomTooltip}
      styles={{
        options: {
          zIndex: 10000,
          arrowColor: 'hsl(222, 47%, 11%)',
          overlayColor: 'rgba(0, 0, 0, 0.75)',
        },
        spotlight: {
          borderRadius: 12,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.75), 0 0 20px rgba(74, 222, 128, 0.15)',
        },
        overlay: {
          mixBlendMode: 'unset' as any,
        },
      }}
      floaterProps={{
        styles: {
          floater: {
            filter: 'none',
          },
          arrow: {
            color: 'hsl(222, 47%, 11%)',
            length: 8,
            spread: 16,
          },
        },
        hideArrow: false,
      }}
    />
  );
}

export { TOUR_COMPLETED_KEY };

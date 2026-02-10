import React, { useState } from 'react';
import { DEFAULT_AGENTS } from '@/config/agents';
import { ChevronRight, ChevronDown, Sparkles, Info, AlertCircle } from 'lucide-react';

interface AgentDetailsProps {
  agent: typeof DEFAULT_AGENTS[0];
  stepNumber: number;
}

const AgentDetails: React.FC<AgentDetailsProps> = ({ agent, stepNumber }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Map agent IDs to detailed descriptions
  const agentDetails: Record<string, { purpose: string; whyNeeded: string; nuance: string }> = {
    'agent-initiator': {
      purpose: 'Converts a vague goal into a precise, decomposable, engineering-grade master question (Q₀).',
      whyNeeded: 'Real-world projects begin with loosely-stated objectives. The Initiator ensures all downstream logic has a non-ambiguous, testable anchor and precise success/failure definitions, so that every next step is grounded.',
      nuance: 'Outputs must be solution-neutral, baseline-anchored, contextualized by "lenses" (high-level system metaphors), and decomposable into sub-goals. Outputs a dense JSON containing Q₀ only.',
    },
    'agent-immortalist': {
      purpose: 'Decomposes Q₀ into 3–7 MECE (Mutually Exclusive, Collectively Exhaustive) goal pillars ("Goal Pillars") and constructs a domain-agnostic "Bridge Lexicon" of Failure Channels (FCCs) and System Property Variables (SPVs).',
      whyNeeded: 'Q₀ is often too broad for direct scientific investigation. Splitting it into MECE pillars ensures complete, non-overlapping coverage with no blind spots, while the Bridge Lexicon creates a common vocabulary for causality and control that can bridge engineering and science.',
      nuance: 'Bans implementation detail at this stage (no gene or drug names), tags each goal with FCCs/SPVs, and ensures each FCC/SPV is used at least once to prevent "orphan" failure modes.',
    },
    'agent-requirement-engineer': {
      purpose: 'Breaks down each Goal Pillar into a finite, testable set of solution-agnostic Requirement Atoms (RAs) with explicit done-criteria and failure scenarios.',
      whyNeeded: 'Goal Pillars are still fairly abstract. RAs provide the granularity and specificity required for scientific testability, traceability, and experimental design—without collapsing prematurely into specific interventions.',
      nuance: 'Forces atomicity (finite checklist, 5–9 atoms), requires every atom to be measurable by at least two objective axes (e.g. meter class, timescale), and mandates explicit "unknown-unknown" coverage so gaps in observability are always considered.',
    },
    'agent-domain-mapper': {
      purpose: 'For each Goal Pillar, identifies 8–12 distinct, actionable research domains that collectively span all requirement atoms and high-priority SPVs.',
      whyNeeded: 'Tackling all possible interventions is computationally and scientifically intractable. By mapping to the right research domains, the system ensures coverage and prevents both tunnel vision (too narrow) and dispersion (too broad).',
      nuance: 'Each domain is scoped to contain ~25 actionable interventions, is rated for relevance and evidence maturity, and must target distinct SPVs or failure channels. Domains are MECE to maximize coverage without redundancy.',
    },
    'agent-biologist': {
      purpose: 'Within a chosen domain, enumerates 15–25 established, evidence-based scientific "Pillars" (e.g. methods, mechanisms, validated interventions) that relate to the Goal Pillar and its requirement atoms.',
      whyNeeded: 'This is the "scientific reality check" stage—what real, established mechanisms do we have for influencing the target system properties?',
      nuance: 'Pillars span readiness levels (lab, animal, clinical), must link directly to requirement atoms/SPVs, and their relevance (solves, partially_solves, proxies_for, violates, enables_measurement) is explicitly classified. Each "pillar" includes mechanism, evidence quality, capability mapping, fragility scoring, and detailed relationship to requirements.',
    },
    'agent-judge': {
      purpose: '[DEPRECATED] Previously audited and ranked scientific pillars against requirements.',
      whyNeeded: 'This agent previously classified "fit" and detailed critical gaps.',
      nuance: 'Its logic has been relocated directly into the Domain Specialist and later stages to streamline the flow and avoid redundant reviews.',
    },
    'agent-l3-explorer': {
      purpose: 'Analyzes the remaining "gap" between requirements and available scientific pillars, generating high-impact, discriminating Level 3 (L3) "Seed Questions."',
      whyNeeded: 'Merely mapping needs to interventions isn\'t enough; key epistemic and mechanistic unknowns remain. The L3 questions directly target these unknowns and are designed to drive the science forward by unearthing critical, non-obvious system constraints.',
      nuance: 'Each L3 question is strategic (not trivial), tailored to the exact nature of the gap, and leverages multiple "scenario logics" (Genesis Probe, Contextual Decoupling, etc.) to ensure innovation and depth.',
    },
    'agent-instantiator': {
      purpose: 'For every L3 question, enumerates 2–10 competing "Instantiation Hypotheses" (IHs), each representing a distinct, plausible realization of the required mechanism in the physical or informational domain.',
      whyNeeded: 'Science advances by discriminating between alternate hypotheses. Generating true diversity (not just variants within one mainstream view) maximizes the system\'s power to reveal root causes and mechanisms.',
      nuance: 'IHs must differ by realization domain (e.g., structure, signaling, resource allocation), cite traceable SPVs, and be falsifiable by testable predictions or measurements (meter classes).',
    },
    'agent-explorer': {
      purpose: 'Decomposes each L3 question and its IHs into concrete, flat L4 "Tactical Questions" that are sharply designed to distinguish between IHs or discover missing failure channels.',
      whyNeeded: 'This is the crucial translation from theory to tactical experimentation. Tactical nodes (L4) are specific enough that they can be unambiguously decomposed into concrete experimental designs.',
      nuance: 'At least half the L4 nodes must be explicit "discriminator" questions. Every set must include "unknown-exploration" to prevent blind spots.',
    },
    'agent-tactical-engineer': {
      purpose: 'For each L4 tactical node, iteratively drills down to L5 and L6 layers until all experimental leaves satisfy S-I-M-T (System, Intervention, Meter, Time) criteria.',
      whyNeeded: 'Experimental work fails without unambiguous, detailed, feasible task specs. This node guarantees all "leaf" actions are direct, measurable, and maximize discriminability between leading hypotheses.',
      nuance: 'All leaf tasks must specify feasibility, dependency, and traceability back to the intended system property. Tool/model development is surfaced if existing capabilities are inadequate.',
    },
    'agent-common-l6-synthesizer': {
      purpose: 'For each L4/L5 path, critically evaluates whether the diverse L6 tasks can be unified into a single, meaningful experiment—or not.',
      whyNeeded: 'Scientific resources are finite. Unifying tasks wastes effort only if the unification is real and preserves experimental rigor; otherwise, splitting is preferable.',
      nuance: 'Decision process is ruthless. Returns either a fully specified "common experiment" JSON with rationale or a hard rejection with detailed reasoning and suggested closest groupings.',
    },
  };

  const details = agentDetails[agent.id];
  const isDeprecated = agent.id === 'agent-judge';

  return (
    <div className={`mb-6 ${isDeprecated ? 'opacity-60' : ''}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full text-left group"
      >
        <div className="flex items-start gap-4 p-4 bg-card/30 hover:bg-card/50 border border-border/30 hover:border-primary/40 rounded-lg transition-all duration-200">
          <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
            {agent.icon}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h3 className="text-lg font-bold text-foreground">
                {stepNumber}. {agent.name}
              </h3>
              {isDeprecated && (
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/40">
                  Deprecated
                </span>
              )}
            </div>
            <p className="text-sm text-primary font-semibold">{agent.role}</p>
          </div>

          <div className="flex-shrink-0">
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            ) : (
              <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
            )}
          </div>
        </div>
      </button>

      {isExpanded && details && (
        <div className="mt-2 ml-16 space-y-3 animate-in slide-in-from-top-2 duration-300">
          <div className="bg-secondary/20 border border-border/30 rounded-lg p-4">
            <div className="flex items-start gap-2 mb-2">
              <Info className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-blue-400 mb-1">Purpose</h4>
                <p className="text-sm text-foreground/80 leading-relaxed">{details.purpose}</p>
              </div>
            </div>
          </div>

          <div className="bg-secondary/20 border border-border/30 rounded-lg p-4">
            <div className="flex items-start gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-emerald-400 mb-1">Why Needed</h4>
                <p className="text-sm text-foreground/80 leading-relaxed">{details.whyNeeded}</p>
              </div>
            </div>
          </div>

          <div className="bg-secondary/20 border border-border/30 rounded-lg p-4">
            <div className="flex items-start gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-bold text-amber-400 mb-1">Implementation Nuance</h4>
                <p className="text-sm text-foreground/80 leading-relaxed">{details.nuance}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const SystemOverview: React.FC = () => {
  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div className="bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 rounded-xl p-8 border-2 border-primary/30 shadow-[0_0_40px_rgba(34,197,94,0.15)]">
        <h1 className="text-3xl font-bold gradient-text mb-4 flex items-center gap-3">
          <Sparkles className="w-8 h-8 text-primary" />
          System Overview
        </h1>
        <div className="space-y-4 text-foreground/90 leading-relaxed">
          <p>
            This system is a <strong>multi-agent, staged workflow</strong> designed for decomposing vague, high-level objectives
            into actionable, testable, and scientifically grounded tasks in complex domains such as biology and engineering.
            Each "agent" in the sequence takes structured inputs from previous nodes, transforms them according to strict logic
            and epistemic constraints, and passes its outputs as machine-readable JSON to the next node.
          </p>
          <p>
            <strong>Nodes represent both cognitive roles and architecture-necessary transformations</strong> for unbroken,
            auditable traceability from initial question to concrete experiment.
          </p>
        </div>
      </div>

      {/* Architecture Flow */}
      <div className="bg-card/50 backdrop-blur-sm rounded-xl p-6 border border-border/30">
        <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
          <Info className="w-6 h-6 text-primary" />
          End-to-End Logic Flow
        </h2>
        <div className="bg-secondary/20 border border-primary/20 rounded-lg p-4 font-mono text-xs text-foreground/80 overflow-x-auto">
          <div className="whitespace-nowrap">
            <span className="text-blue-400">Vague Objective</span>
            {' → '}
            <span className="text-purple-400">Q₀</span>
            {' → '}
            <span className="text-emerald-400">Goal Pillars/Bridge Lexicon</span>
            {' → '}
            <span className="text-cyan-400">Requirement Atoms</span>
            {' → '}
            <span className="text-amber-400">Research Domains</span>
            {' → '}
            <span className="text-red-400">Scientific Pillars</span>
            {' → '}
            <span className="text-orange-400">L3 Gaps/Seed Questions</span>
            {' → '}
            <span className="text-lime-400">Competing Hypotheses</span>
            {' → '}
            <span className="text-teal-400">Tactical Discriminators</span>
            {' → '}
            <span className="text-pink-400">Concrete Experiments</span>
            {' → '}
            <span className="text-primary">Unified Experiment Synthesis</span>
          </div>
        </div>
      </div>

      {/* Agent Breakdown */}
      <div className="bg-card/50 backdrop-blur-sm rounded-xl p-6 border border-border/30">
        <h2 className="text-xl font-bold text-foreground mb-6 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Node/Agent Breakdown
        </h2>

        <div className="space-y-0">
          {DEFAULT_AGENTS.map((agent, index) => (
            <AgentDetails
              key={agent.id}
              agent={agent}
              stepNumber={index + 1}
            />
          ))}
        </div>
      </div>

      {/* Key Design Principles */}
      <div className="bg-gradient-to-r from-primary/5 to-accent/5 rounded-xl p-6 border border-primary/20">
        <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Architectural Design Principles
        </h2>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
            <p className="text-sm text-foreground/80 leading-relaxed">
              <strong className="text-foreground">Strictly Layered, Modular Pipeline:</strong> Converts vague objectives into
              executable scientific plans while enforcing solution-neutrality and domain-independence until the proper stage.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
            <p className="text-sm text-foreground/80 leading-relaxed">
              <strong className="text-foreground">Enforced MECE & Comprehensiveness:</strong> Mandatory MECE decomposition,
              unknown-unknowns exploration, domain constraints, and discriminator questions guarantee complete coverage and
              robustness against tunnel vision.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
            <p className="text-sm text-foreground/80 leading-relaxed">
              <strong className="text-foreground">Integrated Assessment:</strong> Judge's evaluation logic has been merged
              into agents at Stages 4b onward to reduce redundancy, maintaining cohesive forward progress and integrated
              feedback for gaps.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
            <p className="text-sm text-foreground/80 leading-relaxed">
              <strong className="text-foreground">Schema-Governed Outputs:</strong> Each node's output is strictly governed
              by JSON schema, facilitating auditability, automation, and scalable review/extension for future systems or domains.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
            <p className="text-sm text-foreground/80 leading-relaxed">
              <strong className="text-foreground">Full Traceability:</strong> Unbroken chain from initial question to concrete
              experiment, minimizing epistemic risk and ensuring maximal practical utility for scientific and engineering projects.
            </p>
          </div>
        </div>
      </div>

      {/* Bridge Lexicon Reference */}
      <div className="bg-card/50 backdrop-blur-sm rounded-xl p-6 border border-border/30">
        <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
          <Info className="w-6 h-6 text-primary" />
          Bridge Lexicon Reference
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-secondary/20 border border-border/30 rounded-lg p-4">
            <h3 className="text-sm font-bold text-primary mb-2">Key Concepts</h3>
            <ul className="space-y-2 text-xs text-foreground/70">
              <li><strong className="text-foreground">Q₀:</strong> Master question (engineering-grade goal)</li>
              <li><strong className="text-foreground">Goals (G):</strong> MECE teleological pillars</li>
              <li><strong className="text-foreground">RAs:</strong> Requirement Atoms (testable specs)</li>
              <li><strong className="text-foreground">S-Nodes:</strong> Scientific pillars (interventions)</li>
              <li><strong className="text-foreground">L3-L6:</strong> Question hierarchy (strategic → tactical → executable)</li>
            </ul>
          </div>
          <div className="bg-secondary/20 border border-border/30 rounded-lg p-4">
            <h3 className="text-sm font-bold text-primary mb-2">Technical Vocabulary</h3>
            <ul className="space-y-2 text-xs text-foreground/70">
              <li><strong className="text-foreground">FCCs:</strong> Failure Channel Categories</li>
              <li><strong className="text-foreground">SPVs:</strong> System Property Variables</li>
              <li><strong className="text-foreground">IH:</strong> Instantiation Hypotheses</li>
              <li><strong className="text-foreground">SIMT:</strong> System-Intervention-Meter-Threshold</li>
              <li><strong className="text-foreground">MECE:</strong> Mutually Exclusive, Collectively Exhaustive</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

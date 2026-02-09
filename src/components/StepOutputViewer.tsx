import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Code } from 'lucide-react';
import { PipelineStep } from '@/types';

interface StepOutputViewerProps {
  output: any;
  stepId: number;
  step?: PipelineStep;
}

export const StepOutputViewer: React.FC<StepOutputViewerProps> = ({ output, stepId, step }) => {
  const [showRaw, setShowRaw] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['main']));

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const renderGoalPillar = (goal: any, index: number, bridgeLex?: any) => {
    const failureChannels = goal.bridge_tags?.failure_channels || [];
    const systemProps = goal.bridge_tags?.system_properties_required || [];
    
    return (
      <div key={goal.id || index} className="border-l-4 border-purple-500 pl-4 py-2 mb-4 bg-purple-500/10 rounded-r">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h4 className="font-bold text-purple-400 text-lg">{goal.id || `G-${index + 1}`}: {goal.title || 'Untitled'}</h4>
            {goal.catastrophe_primary && (
              <p className="text-sm text-purple-300 mt-1"><span className="font-semibold">Primary Catastrophe:</span> {goal.catastrophe_primary}</p>
            )}
          </div>
        </div>
        
        <div className="mt-3 space-y-2">
          {goal.state_definition && (
            <div className="bg-secondary/30 p-3 rounded">
              <p className="text-xs font-semibold text-muted-foreground uppercase">State Definition</p>
              <p className="text-sm text-foreground mt-1">{goal.state_definition}</p>
            </div>
          )}
          
          {goal.done_criteria && (
            <div className="bg-secondary/30 p-3 rounded">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Done Criteria</p>
              <p className="text-sm text-foreground mt-1">{goal.done_criteria}</p>
            </div>
          )}
          
          {goal.triz_contradiction && (
            <div className="bg-secondary/30 p-3 rounded">
              <p className="text-xs font-semibold text-muted-foreground uppercase">TRIZ Contradiction</p>
              <p className="text-sm text-foreground mt-1">{goal.triz_contradiction}</p>
            </div>
          )}
          
          {(failureChannels.length > 0 || systemProps.length > 0) && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              {failureChannels.length > 0 && (
                <div className="bg-pink-500/10 p-2 rounded border border-pink-500/30">
                  <p className="text-xs font-semibold text-pink-400">Failure Channels</p>
                  <div className="space-y-1 mt-1">
                    {failureChannels.map((fcc: string, i: number) => {
                      const fccInfo = lookupBridgeLexiconItem(fcc, bridgeLex);
                      return (
                        <div key={i} className="text-xs bg-pink-500/20 text-pink-300 px-2 py-1 rounded border border-pink-500/30">
                          <span className="font-mono">{fcc}</span>
                          {fccInfo && <span className="text-pink-200 ml-1">— {fccInfo.name}</span>}
                          {fccInfo?.definition && <p className="text-[10px] text-foreground/60 mt-0.5 leading-relaxed">{fccInfo.definition}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {systemProps.length > 0 && (
                <div className="bg-amber-500/10 p-2 rounded border border-amber-500/30">
                  <p className="text-xs font-semibold text-amber-400">System Properties</p>
                  <div className="space-y-1 mt-1">
                    {systemProps.map((spv: any, i: number) => {
                      const spvInfo = lookupBridgeLexiconItem(spv.spv_id, bridgeLex);
                      return (
                        <div key={i} className="text-xs bg-amber-500/20 text-amber-300 px-2 py-1 rounded border border-amber-500/30">
                          <span className="font-mono">{spv.spv_id}</span> <span className="text-amber-400/60">({spv.importance})</span>
                          {spvInfo && <span className="text-amber-200 ml-1">— {spvInfo.name}</span>}
                          {spvInfo?.definition && <p className="text-[10px] text-foreground/60 mt-0.5 leading-relaxed">{spvInfo.definition}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderRequirementAtom = (ra: any, index: number) => {
    // Safely handle arrays
    const meterClasses = Array.isArray(ra.meter_classes) 
      ? ra.meter_classes 
      : (ra.meter_classes ? [ra.meter_classes] : []);
    
    const perturbationClasses = Array.isArray(ra.perturbation_classes)
      ? ra.perturbation_classes
      : (ra.perturbation_classes ? [ra.perturbation_classes] : []);
    
    return (
      <div key={ra.ra_id || index} className="border-l-4 border-emerald-500 pl-4 py-3 mb-4 bg-emerald-500/10 rounded-r">
        {/* Header */}
        <div className="flex items-start justify-between">
          <h5 className="font-bold text-emerald-400 text-base flex-1">
            {ra.ra_id || `RA-${index + 1}`}: {ra.atom_title || 'Untitled'}
          </h5>
          {ra.meter_status && (
            <span className={`text-xs px-2 py-0.5 rounded border ml-2 ${
              ra.meter_status === 'EXISTS_2026' 
                ? 'bg-green-500/20 text-green-300 border-green-500/30'
                : ra.meter_status === 'PARTIAL_2026'
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                : 'bg-red-500/20 text-red-300 border-red-500/30'
            }`}>
              {ra.meter_status}
            </span>
          )}
        </div>
        
        {/* Requirement Statement */}
        {ra.requirement_statement && (
          <div className="mt-2 bg-secondary/30 p-3 rounded">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Requirement</p>
            <p className="text-sm text-foreground mt-1">{ra.requirement_statement}</p>
          </div>
        )}
        
        {/* Done Criteria */}
        {ra.done_criteria && (
          <div className="mt-2 bg-secondary/30 p-3 rounded">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Done Criteria</p>
            <p className="text-sm text-foreground mt-1">{ra.done_criteria}</p>
          </div>
        )}
        
        {/* Key Properties Grid */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {ra.state_variable && (
            <div className="bg-blue-500/10 p-2 rounded border border-blue-500/30">
              <span className="font-semibold text-blue-400">State Variable:</span>
              <p className="text-blue-300 mt-0.5">{ra.state_variable}</p>
            </div>
          )}
          {ra.failure_shape && (
            <div className="bg-red-500/10 p-2 rounded border border-red-500/30">
              <span className="font-semibold text-red-400">Failure Shape:</span>
              <p className="text-red-300 mt-0.5">{ra.failure_shape}</p>
            </div>
          )}
          {ra.timescale && (
            <div className="bg-purple-500/10 p-2 rounded border border-purple-500/30">
              <span className="font-semibold text-purple-400">Timescale:</span>
              <p className="text-purple-300 mt-0.5">{ra.timescale}</p>
            </div>
          )}
        </div>
        
        {/* Perturbation Classes */}
        {perturbationClasses.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-muted-foreground">Perturbation Classes:</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {perturbationClasses.map((pc: string, i: number) => (
                <span key={i} className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded border border-orange-500/30">
                  {pc}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {/* Meter Classes */}
        {meterClasses.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-muted-foreground">Meter Classes:</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {meterClasses.map((meter: string, i: number) => (
                <span key={i} className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">
                  {meter}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {/* Multiple Realizability Check */}
        {ra.multiple_realizability_check && (
          <div className="mt-2 bg-secondary/30 p-3 rounded">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Multiple Realizability</p>
            <p className="text-sm text-foreground mt-1">{ra.multiple_realizability_check}</p>
          </div>
        )}
        
        {/* Notes */}
        {ra.notes && (
          <div className="mt-2 bg-secondary/30 p-2 rounded">
            <p className="text-xs font-semibold text-muted-foreground">Notes:</p>
            <p className="text-xs text-foreground mt-1">{ra.notes}</p>
          </div>
        )}
      </div>
    );
  };

  const renderMatchingEdge = (edge: any, index: number) => {
    const relationshipColors = {
      solves: 'bg-green-100 border-green-400 text-green-900',
      partially_solves: 'bg-amber-100 border-amber-400 text-amber-900',
      violates: 'bg-red-100 border-red-400 text-red-900',
      proxies_for: 'bg-blue-100 border-blue-400 text-blue-900',
      enables_measurement_for: 'bg-purple-100 border-purple-400 text-purple-900',
    };
    
    const colorClass = relationshipColors[edge.relationship as keyof typeof relationshipColors] || 'bg-gray-100 border-gray-400 text-gray-900';
    
    return (
      <div key={index} className={`border-l-4 pl-4 py-2 mb-3 rounded-r ${colorClass}`}>
        <div className="flex items-center justify-between">
          <h5 className="font-bold">{edge.source_s_id} → {edge.relationship}</h5>
          <span className="text-xs font-semibold">Confidence: {(edge.confidence_score * 100).toFixed(0)}%</span>
        </div>
        <p className="text-sm mt-1">{edge.rationale}</p>
        
        {edge.gap_analysis && (
          <div className="mt-2 bg-white bg-opacity-50 p-2 rounded">
            <p className="text-xs font-semibold">Gap: {edge.gap_analysis.primary_delta}</p>
            <p className="text-xs mt-1">{edge.gap_analysis.description}</p>
          </div>
        )}
      </div>
    );
  };

  const renderL3Question = (q: any, index: number) => (
    <div key={q.id || index} className="border-l-4 border-rose-500 pl-4 py-3 mb-4 bg-rose-500/10 rounded-r">
      <div className="flex items-start justify-between">
        <h5 className="font-bold text-rose-400 flex-1 text-base">{q.id}</h5>
        {q.strategy_used && (
          <span className="text-xs bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded ml-2 border border-rose-500/30">
            {q.strategy_used}
          </span>
        )}
      </div>
      
      {/* Question Text */}
      {q.text && (
        <div className="mt-2 bg-secondary/30 p-3 rounded">
          <p className="text-sm text-foreground font-semibold">{q.text}</p>
        </div>
      )}
      
      {/* Rationale */}
      {q.rationale && (
        <div className="mt-2 bg-secondary/30 p-3 rounded">
          <p className="text-xs font-semibold text-muted-foreground uppercase">Rationale</p>
          <p className="text-sm text-foreground mt-1">{q.rationale}</p>
        </div>
      )}
      
      {/* Discriminator Target */}
      {q.discriminator_target && (
        <div className="mt-2">
          <p className="text-xs font-semibold text-muted-foreground">Discriminator Target:</p>
          <p className="text-xs text-rose-300 mt-1">{q.discriminator_target}</p>
        </div>
      )}
      
      {/* Priority/Category */}
      {(q.priority || q.strategic_category) && (
        <div className="mt-2 flex gap-2">
          {q.priority && (
            <span className="text-xs bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded border border-rose-500/30">
              Priority: {q.priority}
            </span>
          )}
          {q.strategic_category && (
            <span className="text-xs bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded border border-rose-500/30">
              {q.strategic_category}
            </span>
          )}
        </div>
      )}
    </div>
  );

  const renderIH = (ih: any, index: number) => {
    const meterClasses = Array.isArray(ih.meter_classes) ? ih.meter_classes : (ih.meter_classes ? [ih.meter_classes] : []);
    const mapsToRAs = Array.isArray(ih.maps_to_ra_ids) ? ih.maps_to_ra_ids : (ih.maps_to_ra_ids ? [ih.maps_to_ra_ids] : []);
    
    return (
      <div key={ih.ih_id || index} className="border-l-4 border-orange-500 pl-4 py-3 mb-4 bg-orange-500/10 rounded-r">
        <div className="flex items-start justify-between">
          <h5 className="font-bold text-orange-400 flex-1 text-base">{ih.ih_id}</h5>
          <div className="flex gap-2">
            {ih.domain_category && (
              <span className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded border border-orange-500/30">
                {ih.domain_category}
              </span>
            )}
            {ih.confidence_score && (
              <span className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded border border-orange-500/30">
                {(ih.confidence_score * 100).toFixed(0)}%
              </span>
            )}
          </div>
        </div>
        
        {/* Process Hypothesis */}
        {ih.process_hypothesis && (
          <div className="mt-2 bg-secondary/30 p-3 rounded">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Process Hypothesis</p>
            <p className="text-sm text-foreground mt-1 font-semibold">{ih.process_hypothesis}</p>
          </div>
        )}
        
        {/* Mechanism Sketch */}
        {ih.mechanism_sketch && (
          <div className="mt-2 bg-secondary/30 p-3 rounded">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Mechanism</p>
            <p className="text-sm text-foreground mt-1">{ih.mechanism_sketch}</p>
          </div>
        )}
        
        {/* Discriminating Prediction */}
        {ih.discriminating_prediction && (
          <div className="mt-2 bg-secondary/30 p-3 rounded">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Discriminating Prediction</p>
            <p className="text-sm text-foreground mt-1">{ih.discriminating_prediction}</p>
          </div>
        )}
        
        {/* Target SPV & Lens Origin */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {ih.target_spv && (
            <div className="bg-blue-500/10 p-2 rounded border border-blue-500/30">
              <span className="font-semibold text-blue-400">Target SPV:</span>
              <p className="text-blue-300 mt-0.5">{ih.target_spv}</p>
            </div>
          )}
          {ih.lens_origin && (
            <div className="bg-purple-500/10 p-2 rounded border border-purple-500/30">
              <span className="font-semibold text-purple-400">Lens Origin:</span>
              <p className="text-purple-300 mt-0.5">{ih.lens_origin}</p>
            </div>
          )}
        </div>
        
        {/* Maps to RAs */}
        {mapsToRAs.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-muted-foreground">Maps to RAs:</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {mapsToRAs.map((id: string, i: number) => (
                <span key={i} className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30">{id}</span>
              ))}
            </div>
          </div>
        )}
        
        {/* Meter Classes */}
        {meterClasses.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-muted-foreground">Meter Classes:</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {meterClasses.map((meter: string, i: number) => (
                <span key={i} className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded border border-orange-500/30">{meter}</span>
              ))}
            </div>
          </div>
        )}
        
        {/* Distinguishes IHs */}
        {ih.distinguishes_ih_ids && ih.distinguishes_ih_ids.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-muted-foreground">Distinguishes IHs:</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {ih.distinguishes_ih_ids.map((id: string, i: number) => (
                <span key={i} className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded border border-orange-500/30">{id}</span>
              ))}
            </div>
          </div>
        )}
        
        {/* Notes */}
        {(ih.testability_notes || ih.notes) && (
          <div className="mt-2 bg-secondary/30 p-2 rounded">
            <p className="text-xs font-semibold text-muted-foreground">Notes:</p>
            <p className="text-xs text-foreground mt-1">{ih.testability_notes || ih.notes}</p>
          </div>
        )}
      </div>
    );
  };

  const renderL4Question = (q: any, index: number) => {
    const distinguishesIHs = Array.isArray(q.distinguishes_ih_ids) ? q.distinguishes_ih_ids : [];
    
    return (
      <div key={q.id || index} className="border-l-4 border-lime-500 pl-4 py-3 mb-4 bg-lime-500/10 rounded-r">
        <div className="flex items-start justify-between">
          <h5 className="font-bold text-lime-400 flex-1 text-base">{q.id}</h5>
          <div className="flex gap-2">
            {q.type && (
              <span className="text-xs bg-lime-500/20 text-lime-300 px-2 py-0.5 rounded border border-lime-500/30">
                {q.type}
              </span>
            )}
            {q.lens && (
              <span className="text-xs bg-lime-500/20 text-lime-300 px-2 py-0.5 rounded border border-lime-500/30">
                {q.lens}
              </span>
            )}
            {q.priority && (
              <span className="text-xs bg-lime-500/20 text-lime-300 px-2 py-0.5 rounded border border-lime-500/30">
                {q.priority}
              </span>
            )}
          </div>
        </div>
        
        {/* Question Text */}
        {q.text && (
          <div className="mt-2 bg-secondary/30 p-3 rounded">
            <p className="text-sm text-foreground font-semibold">{q.text}</p>
          </div>
        )}
        
        {/* Rationale */}
        {q.rationale && (
          <div className="mt-2 bg-secondary/30 p-3 rounded">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Rationale</p>
            <p className="text-sm text-foreground mt-1">{q.rationale}</p>
          </div>
        )}
        
        {/* Distinguishes IHs */}
        {distinguishesIHs.length > 0 && (
          <div className="mt-2">
            <p className="text-xs font-semibold text-muted-foreground">Distinguishes IHs:</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {distinguishesIHs.map((id: string, i: number) => (
                <span key={i} className="text-xs bg-lime-500/20 text-lime-300 px-2 py-0.5 rounded border border-lime-500/30">{id}</span>
              ))}
            </div>
          </div>
        )}
        
        {/* Measurement Approach */}
        {q.measurement_approach && (
          <div className="mt-2 bg-secondary/30 p-2 rounded">
            <p className="text-xs font-semibold text-muted-foreground">Measurement Approach:</p>
            <p className="text-xs text-foreground mt-1">{q.measurement_approach}</p>
          </div>
        )}
      </div>
    );
  };

  const renderL5Node = (l5: any, index: number) => (
    <div key={l5.id || index} className="border-l-4 border-lime-400 pl-4 py-2 mb-3 bg-lime-400/10 rounded-r">
      <h5 className="font-bold text-lime-400">{l5.id}</h5>
      <p className="text-xs text-lime-300 mb-1">
        <span className="font-semibold">Type:</span> {l5.type}
      </p>
      <p className="text-sm text-foreground mt-1">{l5.text}</p>
      
      {l5.rationale && (
        <div className="mt-2 bg-secondary/30 p-2 rounded">
          <p className="text-xs font-semibold text-muted-foreground">Rationale</p>
          <p className="text-xs text-foreground mt-1">{l5.rationale}</p>
        </div>
      )}
      
      {l5.parent_l4_id && (
        <p className="text-xs text-lime-300 mt-2">
          <span className="font-semibold">Parent L4:</span> {l5.parent_l4_id}
        </p>
      )}
    </div>
  );

  const renderL6Task = (task: any, index: number) => (
    <div key={task.id || index} className="border-l-4 border-teal-500 pl-4 py-2 mb-3 bg-teal-500/10 rounded-r">
      <h5 className="font-bold text-teal-400">{task.id}: {task.title}</h5>
      <p className="text-xs text-teal-300 mb-1">
        <span className="font-semibold">Type:</span> {task.type}
      </p>
      
      {task.simt_parameters && (
        <div className="mt-2 space-y-1 text-xs">
          <div className="bg-secondary/30 p-2 rounded">
            <span className="font-semibold">System (S):</span> {task.simt_parameters.system}
          </div>
          <div className="bg-secondary/30 p-2 rounded">
            <span className="font-semibold">Intervention (I):</span> {task.simt_parameters.intervention}
          </div>
          <div className="bg-secondary/30 p-2 rounded">
            <span className="font-semibold">Meter (M):</span> {task.simt_parameters.meter}
          </div>
          <div className="bg-secondary/30 p-2 rounded">
            <span className="font-semibold">Threshold/Time (T):</span> {task.simt_parameters.threshold_time}
          </div>
        </div>
      )}
      
      {task.expected_impact && (
        <div className="mt-2 bg-secondary/30 p-2 rounded">
          <p className="text-xs font-semibold text-muted-foreground">Expected Impact</p>
          <p className="text-xs text-foreground mt-1">{task.expected_impact}</p>
        </div>
      )}
      
      <div className="flex gap-2 mt-2 text-xs">
        {task.parent_l5_id && (
          <p className="text-teal-300">
            <span className="font-semibold">Parent L5:</span> {task.parent_l5_id}
          </p>
        )}
        {task.parent_l4_id && (
          <p className="text-teal-300">
            <span className="font-semibold">Parent L4:</span> {task.parent_l4_id}
          </p>
        )}
        {task.spv_link && (
          <p className="text-teal-300">
            <span className="font-semibold">SPV:</span> {task.spv_link}
          </p>
        )}
      </div>
    </div>
  );

  const renderContent = () => {
    if (!output) return null;

    // Step 1: Q0
    if (stepId === 1) {
      const q0Text = output.Q0 || output.q0 || output.text || output.master_question;
      if (q0Text) {
        return (
          <div className="space-y-3">
            <div className="bg-primary/10 border-l-4 border-primary p-4 rounded-r">
              <h3 className="font-bold text-primary text-lg mb-2">Master Question (Q₀)</h3>
              <p className="text-foreground">{q0Text}</p>
            </div>
          </div>
        );
      }
    }

    // Step 2: Goals + Bridge Lexicon
    if (stepId === 2) {
      // Handle different key formats
      const goals = output.goals || output.Goal_Pillars || output.goal_pillars || [];
      const bridgeLexicon = output.bridge_lexicon || output.Bridge_Lexicon || output.bridgeLexicon || {};
      
      return (
        <div className="space-y-4">
          {goals && goals.length > 0 && (
            <div>
              <button
                onClick={() => toggleSection('goals')}
                className="flex items-center gap-2 font-bold text-lg mb-3 hover:text-purple-400 text-foreground"
              >
                {expandedSections.has('goals') ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                Goal Pillars ({goals.length})
              </button>
              {expandedSections.has('goals') && goals.map((goal: any, i: number) => renderGoalPillar(goal, i, bridgeLexicon))}
            </div>
          )}
          
          {bridgeLexicon && Object.keys(bridgeLexicon).length > 0 && (
            <div>
              <button
                onClick={() => toggleSection('lexicon')}
                className="flex items-center gap-2 font-bold text-lg mb-3 hover:text-pink-400 text-foreground"
              >
                {expandedSections.has('lexicon') ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                Bridge Lexicon
              </button>
              {expandedSections.has('lexicon') && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="font-semibold text-pink-400 mb-2">Failure Channels ({(bridgeLexicon.failure_channels || bridgeLexicon.Failure_Channels || []).length})</h4>
                    {(bridgeLexicon.failure_channels || bridgeLexicon.Failure_Channels || []).map((fcc: any, i: number) => (
                      <div key={i} className="bg-pink-500/10 border border-pink-500/30 p-2 rounded mb-2 text-sm">
                        <p className="font-semibold text-pink-400">{fcc.id || fcc.ID}: {fcc.name || fcc.Name}</p>
                        <p className="text-foreground text-xs mt-1">{fcc.definition || fcc.Definition}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h4 className="font-semibold text-amber-400 mb-2">System Properties ({(bridgeLexicon.system_properties || bridgeLexicon.System_Properties || []).length})</h4>
                    {(bridgeLexicon.system_properties || bridgeLexicon.System_Properties || []).map((spv: any, i: number) => (
                      <div key={i} className="bg-amber-500/10 border border-amber-500/30 p-2 rounded mb-2 text-sm">
                        <p className="font-semibold text-amber-400">{spv.id || spv.ID}: {spv.name || spv.Name}</p>
                        <p className="text-foreground text-xs mt-1">{spv.definition || spv.Definition}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // Step 3: Requirement Atoms
    if (stepId === 3) {
      let ras: any[] = [];
      
      if (Array.isArray(output)) {
        ras = output;
      } else if (output && typeof output === 'object') {
        // Try to extract RAs from various possible structures
        if (output.requirement_atoms) {
          ras = Array.isArray(output.requirement_atoms) ? output.requirement_atoms : Object.values(output.requirement_atoms).flat();
        } else if (output.RAs) {
          ras = Array.isArray(output.RAs) ? output.RAs : Object.values(output.RAs).flat();
        } else {
          // Flatten all values
          ras = Object.values(output).flat().filter((item: any) => item && typeof item === 'object');
        }
      }
      
      return (
        <div>
          <h3 className="font-bold text-lg mb-3 text-foreground">Requirement Atoms ({ras.length})</h3>
          {ras.length > 0 ? (
            ras.map(renderRequirementAtom)
          ) : (
            <p className="text-sm text-muted-foreground">No requirement atoms found</p>
          )}
        </div>
      );
    }

    // Step 4: Scientific Knowledge Base (2-Phase Output)
    if (stepId === 4) {
      // Check for phase data from step4Phases
      const phase4aData = step?.step4Phases?.phase4a_domain_mapping;
      const phase4bData = step?.step4Phases?.phase4b_domain_scans;
      
      return (
        <div>
          <h3 className="font-bold text-lg mb-3 text-foreground flex items-center gap-2">
            🔬 Scientific Knowledge Base 
            <span className="text-sm font-normal text-muted-foreground">(2-Phase Collection)</span>
          </h3>
          
          {/* Phase 4a Results: Domain Mapping */}
          {phase4aData && (
            <div className="mb-6 border border-blue-500/30 rounded-lg p-4 bg-blue-500/5">
              <h4 className="font-semibold text-md mb-3 text-blue-400 flex items-center gap-2">
                <span className="bg-blue-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">✓</span>
                Phase 4a: Domain Mapping Results
              </h4>
              {Object.entries(phase4aData).map(([goalId, goalData]: [string, any]) => {
                const domains = goalData?.research_domains || [];
                return (
                  <div key={goalId} className="mb-4">
                    <h5 className="font-semibold text-sm mb-2 text-foreground">{goalId}: Research Domains ({domains.length})</h5>
                    <div className="grid grid-cols-2 gap-2">
                      {domains.map((domain: any) => (
                        <div key={domain.domain_id} className="bg-secondary/30 p-2 rounded text-xs border border-border/50">
                          <div className="font-semibold text-foreground">{domain.domain_name}</div>
                          <div className="text-muted-foreground mt-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                              domain.relevance_to_goal === 'HIGH' ? 'bg-green-500/20 text-green-400' :
                              domain.relevance_to_goal === 'MED' ? 'bg-yellow-500/20 text-yellow-400' :
                              'bg-gray-500/20 text-gray-400'
                            }`}>
                              {domain.relevance_to_goal}
                            </span>
                            <span className="ml-2">{domain.expected_intervention_count} interventions</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Phase 4b Results: Domain Scans */}
          {phase4bData && (
            <div className="mb-6 border border-purple-500/30 rounded-lg p-4 bg-purple-500/5">
              <h4 className="font-semibold text-md mb-3 text-purple-400 flex items-center gap-2">
                <span className="bg-purple-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">✓</span>
                Phase 4b: Domain Scan Results
              </h4>
              {Object.entries(phase4bData).map(([goalId, goalData]: [string, any]) => {
                const domainScans = goalData?.domains || {};
                const totalScans = Object.keys(domainScans).length;
                let totalSNodesInGoal = 0;
                Object.values(domainScans).forEach((scan: any) => {
                  totalSNodesInGoal += scan.scientific_pillars?.length || 0;
                });
                
                return (
                  <div key={goalId} className="mb-4">
                    <h5 className="font-semibold text-sm mb-2 text-foreground">
                      {goalId}: {totalSNodesInGoal} S-nodes from {totalScans} domains
                    </h5>
                    <div className="text-xs text-green-400 font-semibold">
                      ✓ Domain scans completed
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // Step 5: Matching Edges (organized by goal)
    if (stepId === 5) {
      let edges: any[] = [];
      let edgesByGoal: Record<string, any> = {};
      let operationalMode: string | null = null;
      
      if (Array.isArray(output)) {
        edges = output;
      } else if (output && typeof output === 'object') {
        // New format: organized by goal ID
        Object.entries(output).forEach(([goalId, goalData]: [string, any]) => {
          if (goalData?.edges) {
            edgesByGoal[goalId] = goalData;
            edges.push(...(Array.isArray(goalData.edges) ? goalData.edges : [goalData.edges]));
            if (goalData.mode) operationalMode = goalData.mode;
          }
        });
        
        // Fallback: old format
        if (edges.length === 0) {
          if (output.edges) {
            edges = Array.isArray(output.edges) ? output.edges : Object.values(output.edges).flat();
          } else {
            edges = Object.values(output).flat().filter((item: any) => 
              item && typeof item === 'object' && (item.source_s_id || item.relationship)
            );
          }
        }
      }
      
      return (
        <div>
          <h3 className="font-bold text-lg mb-3 text-foreground">
            Matching Results ({edges.length} edges)
            {operationalMode && (
              <span className="ml-2 text-xs px-2 py-1 rounded bg-primary/20 text-primary font-mono">
                {operationalMode === 'goal_specific' ? 'NEW MODE: Evaluating G-S Links' : 'LEGACY MODE: Creating Links'}
              </span>
            )}
          </h3>
          
          {Object.keys(edgesByGoal).length > 0 ? (
            // Group by goal
            Object.entries(edgesByGoal).map(([goalId, goalData]: [string, any]) => (
              <div key={goalId} className="mb-6">
                <h4 className="font-semibold text-md mb-2 text-primary">
                  {goalId}: {goalData.target_goal_title || 'Goal Edges'}
                </h4>
                {goalData.audit_summary && (
                  <div className="bg-blue-500/10 p-3 rounded mb-3 text-sm border border-blue-500/30">
                    <p className="font-semibold text-blue-400">Audit Summary</p>
                    <p className="text-foreground mt-1">{goalData.audit_summary}</p>
                  </div>
                )}
                {goalData.edges?.map(renderMatchingEdge)}
              </div>
            ))
          ) : edges.length > 0 ? (
            // Old format: single list
            <>
              {output.audit_summary && (
                <div className="bg-blue-500/10 p-3 rounded mb-4 text-sm border border-blue-500/30">
                  <p className="font-semibold text-blue-400">Audit Summary</p>
                  <p className="text-foreground mt-1">{output.audit_summary}</p>
                </div>
              )}
              {edges.map(renderMatchingEdge)}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No matching edges found</p>
          )}
        </div>
      );
    }

    // Step 6: L3 Questions
    if (stepId === 6) {
      let questions: any[] = [];
      
      if (Array.isArray(output)) {
        questions = output;
      } else if (output && typeof output === 'object') {
        if (output.l3_questions) {
          questions = Array.isArray(output.l3_questions) ? output.l3_questions : Object.values(output.l3_questions).flat();
        } else if (output.seed_questions) {
          questions = Array.isArray(output.seed_questions) ? output.seed_questions : Object.values(output.seed_questions).flat();
        } else {
          questions = Object.values(output).flat().filter((item: any) => item && typeof item === 'object');
        }
      }
      
      return (
        <div>
          <h3 className="font-bold text-lg mb-3 text-foreground">L3 Seed Questions ({questions.length})</h3>
          {questions.length > 0 ? (
            questions.map(renderL3Question)
          ) : (
            <p className="text-sm text-muted-foreground">No L3 questions found</p>
          )}
        </div>
      );
    }

    // Step 7: Instantiation Hypotheses
    if (stepId === 7) {
      let ihs: any[] = [];
      
      if (Array.isArray(output)) {
        ihs = output;
      } else if (output && typeof output === 'object') {
        if (output.instantiation_hypotheses) {
          ihs = Array.isArray(output.instantiation_hypotheses) ? output.instantiation_hypotheses : Object.values(output.instantiation_hypotheses).flat();
        } else if (output.IHs) {
          ihs = Array.isArray(output.IHs) ? output.IHs : Object.values(output.IHs).flat();
        } else {
          ihs = Object.values(output).flat().filter((item: any) => item && typeof item === 'object' && item.ih_id);
        }
      }
      
      return (
        <div>
          <h3 className="font-bold text-lg mb-3 text-foreground">Instantiation Hypotheses ({ihs.length})</h3>
          {ihs.length > 0 ? (
            ihs.map(renderIH)
          ) : (
            <p className="text-sm text-muted-foreground">No instantiation hypotheses found</p>
          )}
        </div>
      );
    }

    // Step 8: L4 Questions
    if (stepId === 8) {
      let l4Questions: any[] = [];
      
      if (Array.isArray(output)) {
        l4Questions = output;
      } else if (output && typeof output === 'object') {
        if (output.l4_questions) {
          l4Questions = Array.isArray(output.l4_questions) ? output.l4_questions : Object.values(output.l4_questions).flat();
        } else if (output.child_nodes_L4) {
          l4Questions = Array.isArray(output.child_nodes_L4) ? output.child_nodes_L4 : Object.values(output.child_nodes_L4).flat();
        } else {
          l4Questions = Object.values(output).flat().filter((item: any) => item && typeof item === 'object' && item.id && item.text);
        }
      }
      
      return (
        <div>
          <h3 className="font-bold text-lg mb-3 text-foreground">L4 Questions ({l4Questions.length})</h3>
          {l4Questions.length > 0 ? (
            l4Questions.map(renderL4Question)
          ) : (
            <p className="text-sm text-muted-foreground">No L4 questions found</p>
          )}
        </div>
      );
    }

    // Step 9: L5 Nodes and L6 Tasks
    if (stepId === 9) {
      let l5Nodes: any[] = [];
      let l6Tasks: any[] = [];
      
      if (output && typeof output === 'object') {
        // Extract L5 nodes
        if (output.l5_nodes) {
          l5Nodes = Array.isArray(output.l5_nodes) ? output.l5_nodes : [];
        }
        
        // Extract L6 tasks
        if (output.l6_tasks) {
          l6Tasks = Array.isArray(output.l6_tasks) ? output.l6_tasks : [];
        } else if (Array.isArray(output)) {
          l6Tasks = output;
        }
      }
      
      return (
        <div className="space-y-4">
          {l5Nodes.length > 0 && (
            <div>
              <h3 className="font-bold text-lg mb-3 text-foreground">L5 Mechanistic Drills ({l5Nodes.length})</h3>
              {l5Nodes.map(renderL5Node)}
            </div>
          )}
          
          {l6Tasks.length > 0 && (
            <div>
              <h3 className="font-bold text-lg mb-3 text-foreground">L6 Leaf Tasks ({l6Tasks.length})</h3>
              {l6Tasks.map(renderL6Task)}
            </div>
          )}
          
          {l5Nodes.length === 0 && l6Tasks.length === 0 && (
            <p className="text-sm text-muted-foreground">No L5 or L6 nodes found</p>
          )}
        </div>
      );
    }

    // Step 10: Common L6 Experiment Synthesis
    if (stepId === 10) {
      const commonL6Results = output?.common_l6_results || [];
      const summary = output?.batch_summary;
      
      return (
        <div className="space-y-4">
          {summary && (
            <div className="flex gap-3 mb-3 text-sm">
              <span className="px-2 py-1 rounded bg-slate-100 border">L4 processed: <strong>{summary.l4_processed}</strong></span>
              <span className="px-2 py-1 rounded bg-green-50 border border-green-200 text-green-700">Feasible: <strong>{summary.feasible}</strong></span>
              <span className="px-2 py-1 rounded bg-red-50 border border-red-200 text-red-700">Not feasible: <strong>{summary.not_feasible}</strong></span>
            </div>
          )}
          
          {commonL6Results.map((result: any, idx: number) => (
            <div key={idx} className={`p-4 rounded-lg border-2 ${result.feasible ? 'border-yellow-500/60 bg-yellow-50/50' : 'border-red-800/40 bg-red-50/30'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{result.feasible ? '⚗️' : '✗'}</span>
                <span className="font-bold text-sm">{result.l4_reference_id}</span>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${result.feasible ? 'bg-yellow-200 text-yellow-800' : 'bg-red-200 text-red-800'}`}>
                  {result.feasible ? 'FEASIBLE' : 'NOT FEASIBLE'}
                </span>
                {result.confidence && (
                  <span className="text-xs text-muted-foreground">Confidence: {Math.round(result.confidence * 100)}%</span>
                )}
              </div>
              
              {result.feasible && result.common_experiment && (
                <div className="space-y-2 ml-6">
                  <p className="font-semibold text-sm">{result.common_experiment.title}</p>
                  <p className="text-xs text-muted-foreground italic">{result.common_experiment.unified_hypothesis}</p>
                  {result.common_experiment.design && (
                    <div className="text-xs space-y-1 bg-white/60 p-2 rounded border">
                      <p><strong>System:</strong> {result.common_experiment.design.system}</p>
                      <p><strong>Readout:</strong> {result.common_experiment.design.primary_readout}</p>
                      <p><strong>Timeline:</strong> {result.common_experiment.design.timeline}</p>
                      <p><strong>Success:</strong> {result.common_experiment.design.success_criteria}</p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">{result.common_experiment.l6_coverage}</p>
                </div>
              )}
              
              {!result.feasible && (
                <div className="space-y-1 ml-6">
                  {(result.rejection_reasons || []).map((reason: string, rIdx: number) => (
                    <p key={rIdx} className="text-xs text-red-600">• {reason}</p>
                  ))}
                  {result.closest_partial_grouping && (
                    <p className="text-xs text-muted-foreground mt-1 italic">Partial grouping: {result.closest_partial_grouping}</p>
                  )}
                </div>
              )}
              
              {result.reasoning && (
                <details className="mt-2 ml-6">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">Show reasoning</summary>
                  <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{result.reasoning}</p>
                </details>
              )}
            </div>
          ))}
          
          {commonL6Results.length === 0 && (
            <p className="text-sm text-muted-foreground">No common L6 synthesis results found</p>
          )}
        </div>
      );
    }

    // Default: show formatted JSON
    return (
      <pre className="text-xs overflow-auto max-h-96 bg-white p-3 rounded border select-text whitespace-pre-wrap break-words">
        {JSON.stringify(output, null, 2)}
      </pre>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-sm font-medium">Output:</p>
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="text-xs flex items-center gap-1 text-gray-600 hover:text-gray-900"
        >
          <Code size={14} />
          {showRaw ? 'Show Formatted' : 'Show Raw JSON'}
        </button>
      </div>
      
      <div className="bg-secondary/20 rounded p-4 border border-border/30 select-text">
        {showRaw ? (
          <pre className="text-xs overflow-auto max-h-96 bg-secondary/30 p-3 rounded border border-border/30 text-foreground select-text whitespace-pre-wrap break-words">
            {JSON.stringify(output, null, 2)}
          </pre>
        ) : (
          renderContent()
        )}
      </div>
    </div>
  );
};

/**
 * Helper function to lookup SPV or FCC definition from bridge lexicon
 */
const lookupBridgeLexiconItem = (id: string, bridgeLexicon: any) => {
  if (!bridgeLexicon || !id) return null;
  
  // Check System Properties
  const spvs = bridgeLexicon.system_properties || bridgeLexicon.System_Properties || [];
  const spv = spvs.find((s: any) => (s.id || s.ID) === id);
  if (spv) return { name: spv.name || spv.Name, definition: spv.definition || spv.Definition, type: 'spv' };
  
  // Check Failure Channels
  const fccs = bridgeLexicon.failure_channels || bridgeLexicon.Failure_Channels || [];
  const fcc = fccs.find((f: any) => (f.id || f.ID) === id);
  if (fcc) return { name: fcc.name || fcc.Name, definition: fcc.definition || fcc.Definition, type: 'fcc' };
  
  return null;
};

/**
 * Export helper function to render node details for graph visualization
 * Maps node types to their appropriate rendering functions
 */
export const renderNodeDetails = (nodeType: string, nodeData: any, bridgeLexicon?: any) => {
  switch (nodeType) {
    case 'goal':
      const goalMeterClasses = nodeData.evidence_of_state?.meter_classes || [];
      
      return (
        <div className="space-y-2">
          {nodeData.catastrophe_primary && (
            <div className="bg-red-500/10 border border-red-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-red-400">Primary Catastrophe</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.catastrophe_primary}</p>
            </div>
          )}
          {nodeData.state_definition && (
            <div className="bg-purple-500/10 border border-purple-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-purple-400">State Definition</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.state_definition}</p>
            </div>
          )}
          {nodeData.done_criteria && (
            <div className="bg-purple-500/10 border border-purple-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-purple-400">Done Criteria</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.done_criteria}</p>
            </div>
          )}
          {nodeData.failure_mode_simulation && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-amber-400">Failure Mode Simulation</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.failure_mode_simulation}</p>
            </div>
          )}
          {nodeData.triz_contradiction && (
            <div className="bg-purple-500/10 border border-purple-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-purple-400">TRIZ Contradiction</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.triz_contradiction}</p>
            </div>
          )}
          {nodeData.evidence_of_state && (
            <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-blue-400 mb-2">Evidence of State</p>
              {goalMeterClasses.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] text-blue-300 font-semibold">Meter Classes:</p>
                  {goalMeterClasses.map((mc: string, i: number) => {
                    const mcInfo = lookupBridgeLexiconItem(mc, bridgeLexicon);
                    return (
                      <div key={i} className="bg-blue-500/10 border border-blue-500/20 rounded p-2">
                        <p className="text-sm font-mono text-blue-300">{mc}</p>
                        {mcInfo && (
                          <div className="mt-1">
                            <p className="text-xs font-semibold text-blue-200">{mcInfo.name}</p>
                            <p className="text-xs text-foreground/70 leading-relaxed mt-0.5">{mcInfo.definition}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {nodeData.evidence_of_state.meter_status && (
                <p className="text-xs mt-2 text-foreground">Status: {nodeData.evidence_of_state.meter_status}</p>
              )}
            </div>
          )}
          {nodeData.bridge_tags?.failure_channels?.length > 0 && (
            <div className="bg-pink-500/10 border border-pink-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-pink-400 mb-2">Failure Channels</p>
              <div className="space-y-1.5">
                {nodeData.bridge_tags.failure_channels.map((fccId: string, i: number) => {
                  const fccInfo = lookupBridgeLexiconItem(fccId, bridgeLexicon);
                  return (
                    <div key={i} className="bg-pink-500/10 border border-pink-500/20 rounded p-2">
                      <p className="text-xs font-mono text-pink-300">{fccId}</p>
                      {fccInfo && (
                        <div className="mt-1">
                          <p className="text-xs font-semibold text-pink-200">{fccInfo.name}</p>
                          {fccInfo.definition && <p className="text-xs text-foreground/70 leading-relaxed mt-0.5">{fccInfo.definition}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {nodeData.bridge_tags?.system_properties_required?.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-amber-400 mb-2">System Properties</p>
              <div className="space-y-1.5">
                {nodeData.bridge_tags.system_properties_required.map((sp: any, i: number) => {
                  const spvInfo = lookupBridgeLexiconItem(sp.spv_id, bridgeLexicon);
                  return (
                    <div key={i} className="bg-amber-500/10 border border-amber-500/20 rounded p-2">
                      <p className="text-xs font-mono text-amber-300">{sp.spv_id} <span className="text-amber-400/60">({sp.importance})</span></p>
                      {spvInfo && (
                        <div className="mt-1">
                          <p className="text-xs font-semibold text-amber-200">{spvInfo.name}</p>
                          {spvInfo.definition && <p className="text-xs text-foreground/70 leading-relaxed mt-0.5">{spvInfo.definition}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {nodeData.scope_note && (
            <div className="bg-purple-500/10 border border-purple-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-purple-400">Scope Note</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.scope_note}</p>
            </div>
          )}
        </div>
      );
    
    case 'ra':
      const meterClasses = Array.isArray(nodeData.meter_classes) ? nodeData.meter_classes : [];
      const perturbationClasses = Array.isArray(nodeData.perturbation_classes) ? nodeData.perturbation_classes : [];
      
      // Lookup state variable definition
      const stateVarInfo = nodeData.state_variable ? lookupBridgeLexiconItem(nodeData.state_variable, bridgeLexicon) : null;
      
      // Lookup failure shape definition
      const failureShapeInfo = nodeData.failure_shape ? lookupBridgeLexiconItem(nodeData.failure_shape, bridgeLexicon) : null;
      
      return (
        <div className="space-y-2">
          {nodeData.requirement_statement && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-emerald-400">Requirement</p>
              <p className="text-sm mt-1 text-foreground leading-relaxed">{nodeData.requirement_statement}</p>
            </div>
          )}
          {nodeData.done_criteria && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-emerald-400">Done Criteria</p>
              <p className="text-sm mt-1 text-foreground leading-relaxed">{nodeData.done_criteria}</p>
            </div>
          )}
          
          {/* State Variable - Expanded */}
          {nodeData.state_variable && (
            <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-blue-400 mb-1">State Variable</p>
              <p className="text-sm font-mono text-blue-300 mb-2">{nodeData.state_variable}</p>
              {stateVarInfo && (
                <div className="mt-2 pt-2 border-t border-blue-500/20">
                  <p className="text-xs font-semibold text-blue-300">{stateVarInfo.name}</p>
                  <p className="text-xs mt-1 text-foreground/80 leading-relaxed">{stateVarInfo.definition}</p>
                </div>
              )}
            </div>
          )}
          
          {/* Failure Shape - Expanded */}
          {nodeData.failure_shape && (
            <div className="bg-red-500/10 border border-red-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-red-400 mb-1">Failure Shape</p>
              <p className="text-sm font-mono text-red-300 mb-2">{nodeData.failure_shape}</p>
              {failureShapeInfo && (
                <div className="mt-2 pt-2 border-t border-red-500/20">
                  <p className="text-xs font-semibold text-red-300">{failureShapeInfo.name}</p>
                  <p className="text-xs mt-1 text-foreground/80 leading-relaxed">{failureShapeInfo.definition}</p>
                </div>
              )}
            </div>
          )}
          
          {nodeData.timescale && (
            <div className="bg-purple-500/10 border border-purple-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-purple-400">Timescale</p>
              <p className="text-sm mt-1 text-foreground">{nodeData.timescale}</p>
            </div>
          )}
          
          {/* Perturbation Classes - Expanded with definitions */}
          {perturbationClasses.length > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-orange-400 mb-2">Perturbation Classes</p>
              <div className="space-y-2">
                {perturbationClasses.map((pc: string, i: number) => {
                  const pcInfo = lookupBridgeLexiconItem(pc, bridgeLexicon);
                  return (
                    <div key={i} className="bg-orange-500/10 border border-orange-500/20 rounded p-2">
                      <p className="text-sm font-mono text-orange-300">{pc}</p>
                      {pcInfo && (
                        <div className="mt-1">
                          <p className="text-xs font-semibold text-orange-200">{pcInfo.name}</p>
                          <p className="text-xs text-foreground/70 leading-relaxed mt-0.5">{pcInfo.definition}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Meter Classes - Expanded with definitions */}
          {meterClasses.length > 0 && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-emerald-400 mb-2">Meter Classes</p>
              <div className="space-y-2">
                {meterClasses.map((mc: string, i: number) => {
                  const mcInfo = lookupBridgeLexiconItem(mc, bridgeLexicon);
                  return (
                    <div key={i} className="bg-emerald-500/10 border border-emerald-500/20 rounded p-2">
                      <p className="text-sm font-mono text-emerald-300">{mc}</p>
                      {mcInfo && (
                        <div className="mt-1">
                          <p className="text-xs font-semibold text-emerald-200">{mcInfo.name}</p>
                          <p className="text-xs text-foreground/70 leading-relaxed mt-0.5">{mcInfo.definition}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Multiple Realizability Check */}
          {nodeData.multiple_realizability_check && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-cyan-400">Multiple Realizability</p>
              <p className="text-sm mt-1 text-foreground leading-relaxed">{nodeData.multiple_realizability_check}</p>
            </div>
          )}

          {nodeData.meter_status && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-emerald-400">Meter Status</p>
              <p className="text-sm mt-1 text-foreground">{nodeData.meter_status}</p>
            </div>
          )}
        </div>
      );
    
    case 'scientific':
      const capabilities = Array.isArray(nodeData.capabilities) ? nodeData.capabilities : [];
      const constraints = Array.isArray(nodeData.constraints) ? nodeData.constraints : [];
      const failureModes = Array.isArray(nodeData.known_failure_modes) ? nodeData.known_failure_modes : [];
      const assumptions = Array.isArray(nodeData.fundamental_assumptions) ? nodeData.fundamental_assumptions : [];
      
      return (
        <div className="space-y-2">
          {/* Header Info */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {nodeData.node_type && (
              <div className="bg-cyan-500/20 text-cyan-300 px-2 py-1 rounded font-semibold">
                {nodeData.node_type}
              </div>
            )}
            {nodeData.front && (
              <div className="bg-cyan-500/20 text-cyan-300 px-2 py-1 rounded font-semibold">
                Front: {nodeData.front}
              </div>
            )}
          </div>

          {/* Mechanism */}
          {nodeData.mechanism && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-cyan-400">Mechanism</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.mechanism}</p>
            </div>
          )}

          {/* Verified Effect */}
          {nodeData.verified_effect && (
            <div className="bg-green-500/10 border border-green-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-green-400">Verified Effect</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.verified_effect}</p>
            </div>
          )}

          {/* Readiness & Model */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {nodeData.readiness_level && (
              <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
                <p className="font-semibold text-cyan-400">Readiness</p>
                <p className="text-foreground font-semibold">{nodeData.readiness_level}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {nodeData.readiness_level === 'RL-1' ? 'Lab-stage: early research, in-vitro or animal models only' :
                   nodeData.readiness_level === 'RL-2' ? 'Model-stage: human data exists but limited trials or observational' :
                   nodeData.readiness_level === 'RL-3' ? 'Deployed: proven in humans with clinical evidence' :
                   ''}
                </p>
              </div>
            )}
            {nodeData.best_supported_model && (
              <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
                <p className="font-semibold text-cyan-400">Model</p>
                <p className="text-foreground">{nodeData.best_supported_model}</p>
              </div>
            )}
          </div>

          {/* Fragility & Momentum */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {nodeData.fragility_score !== undefined && (
              <div className="bg-amber-500/10 border border-amber-500/30 p-2 rounded">
                <p className="font-semibold text-amber-400">Fragility Score</p>
                <p className="text-foreground">{nodeData.fragility_score}/10</p>
              </div>
            )}
            {nodeData.research_momentum && (
              <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
                <p className="font-semibold text-cyan-400">Momentum</p>
                <p className="text-foreground">{nodeData.research_momentum}</p>
              </div>
            )}
          </div>

          {/* Relationship to Goal (from Step 4b) */}
          {nodeData.relationship_to_goal && (
            <div className="bg-blue-500/10 border border-blue-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-blue-400">Relationship to Goal</p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs font-semibold px-2 py-1 rounded ${
                  nodeData.relationship_to_goal === 'solves' ? 'bg-green-500/20 text-green-400' :
                  nodeData.relationship_to_goal === 'partially_solves' ? 'bg-yellow-500/20 text-yellow-400' :
                  nodeData.relationship_to_goal === 'proxies_for' ? 'bg-orange-500/20 text-orange-400' :
                  nodeData.relationship_to_goal === 'violates' ? 'bg-red-500/20 text-red-400' :
                  nodeData.relationship_to_goal === 'enables_measurement_for' ? 'bg-purple-500/20 text-purple-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {nodeData.relationship_to_goal}
                </span>
                {nodeData.relationship_confidence !== undefined && (
                  <span className="text-xs text-foreground">
                    Confidence: {(nodeData.relationship_confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Gap Analysis */}
          {nodeData.gap_analysis && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-yellow-400">Gap Analysis</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.gap_analysis}</p>
            </div>
          )}

          {/* Violation Risk */}
          {nodeData.violation_risk && (
            <div className="bg-red-500/10 border border-red-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-red-400">Violation Risk</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.violation_risk}</p>
            </div>
          )}

          {/* Human Context */}
          {nodeData.human_context && (
            <div className="bg-blue-500/10 border border-blue-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-blue-400">Human Context</p>
              <p className="text-xs mt-1 text-foreground">
                {nodeData.human_context.present ? '✓ Present' : '✗ Not Present'}
                {nodeData.human_context.note && ` - ${nodeData.human_context.note}`}
              </p>
            </div>
          )}

          {/* Capabilities */}
          {capabilities.length > 0 && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-cyan-400">Capabilities</p>
              <div className="space-y-1 mt-1">
                {capabilities.map((cap: any, i: number) => {
                  const spvInfo = lookupBridgeLexiconItem(cap.spv_id, bridgeLexicon);
                  return (
                    <div key={i} className="text-xs bg-cyan-500/20 p-2 rounded border border-cyan-500/40">
                      <div className="font-semibold text-cyan-300">
                        {cap.spv_id}{spvInfo ? ` — ${spvInfo.name}` : ''}: {cap.effect_direction}
                      </div>
                      {spvInfo?.definition && (
                        <div className="text-[10px] text-foreground/60 mt-0.5 italic">{spvInfo.definition}</div>
                      )}
                      {cap.rationale && (
                        <div className="text-foreground mt-1 text-[10px]">{cap.rationale}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Constraints */}
          {constraints.length > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-orange-400">Constraints</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                {constraints.map((constraint: string, i: number) => (
                  <li key={i} className="text-xs text-foreground">{constraint}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Known Failure Modes */}
          {failureModes.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-red-400">Known Failure Modes</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                {failureModes.map((mode: string, i: number) => (
                  <li key={i} className="text-xs text-foreground">{mode}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Fundamental Assumptions */}
          {assumptions.length > 0 && (
            <div className="bg-purple-500/10 border border-purple-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-purple-400">Fundamental Assumptions</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                {assumptions.map((assumption: string, i: number) => (
                  <li key={i} className="text-xs text-foreground">{assumption}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    
    case 'l3_group':
      const sa = nodeData.strategic_assessment;
      const ba = nodeData.bridge_alignment;
      const spvFocus = sa?.spv_focus || [];
      return (
        <div className="space-y-3">
          {nodeData.target_goal_title && (
            <div className="bg-rose-500/10 border border-rose-500/30 p-3 rounded">
              <p className="text-xs font-semibold text-rose-400">Goal Title (Metaphor)</p>
              <p className="text-sm mt-1 text-foreground font-semibold">{nodeData.target_goal_title}</p>
            </div>
          )}
          {nodeData.cluster_status && (
            <div className="inline-block bg-rose-500/20 text-rose-300 px-2 py-1 rounded text-xs font-semibold">
              Cluster: {nodeData.cluster_status}
            </div>
          )}
          {sa && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-rose-400 uppercase tracking-wide">Strategic Assessment</p>
              {sa.the_delta_summary && (
                <div className="bg-rose-500/10 border border-rose-500/30 p-3 rounded">
                  <p className="text-[10px] font-semibold text-rose-300 mb-1">The Delta (Gap)</p>
                  <p className="text-xs text-foreground leading-relaxed">{sa.the_delta_summary}</p>
                </div>
              )}
              {sa.epistemic_block && (
                <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded">
                  <p className="text-[10px] font-semibold text-amber-300 mb-1">Epistemic Block</p>
                  <p className="text-xs text-foreground leading-relaxed">{sa.epistemic_block}</p>
                </div>
              )}
              {spvFocus.length > 0 && (
                <div className="bg-blue-500/10 border border-blue-500/30 p-3 rounded">
                  <p className="text-[10px] font-semibold text-blue-300 mb-1">SPV Focus</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {spvFocus.map((spv: string, i: number) => (
                      <span key={i} className="bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded text-[10px] font-mono">
                        {spv}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {ba && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-emerald-400 uppercase tracking-wide">Bridge Alignment</p>
              {ba.primary_spv_impact && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 rounded">
                  <p className="text-[10px] font-semibold text-emerald-300 mb-1">Primary SPV Impact</p>
                  <p className="text-xs text-foreground leading-relaxed">{ba.primary_spv_impact}</p>
                </div>
              )}
              {ba.catastrophe_prevention && (
                <div className="bg-red-500/10 border border-red-500/30 p-3 rounded">
                  <p className="text-[10px] font-semibold text-red-300 mb-1">Catastrophe Prevention</p>
                  <p className="text-xs text-foreground leading-relaxed">{ba.catastrophe_prevention}</p>
                </div>
              )}
            </div>
          )}
          {nodeData.questions && (
            <div className="text-[10px] text-muted-foreground mt-2">
              {nodeData.questions.length} L3 question{nodeData.questions.length !== 1 ? 's' : ''} generated
            </div>
          )}
        </div>
      );

    case 'l3':
      return (
        <div className="space-y-2">
          {nodeData.text && (
            <div className="bg-rose-500/10 border border-rose-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-rose-400">Question</p>
              <p className="text-xs mt-1 text-foreground font-semibold">{nodeData.text}</p>
            </div>
          )}
          {nodeData.rationale && (
            <div className="bg-rose-500/10 border border-rose-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-rose-400">Rationale</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.rationale}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {nodeData.strategy_used && (
              <div className="bg-rose-500/10 border border-rose-500/30 p-2 rounded">
                <p className="font-semibold text-rose-400">Strategy</p>
                <p className="text-foreground">{nodeData.strategy_used}</p>
              </div>
            )}
            {nodeData.discriminator_target && (
              <div className="bg-rose-500/10 border border-rose-500/30 p-2 rounded">
                <p className="font-semibold text-rose-400">Target</p>
                <p className="text-foreground">{nodeData.discriminator_target}</p>
              </div>
            )}
          </div>
        </div>
      );
    
    case 'ih':
      const mapsToRaIds = Array.isArray(nodeData.maps_to_ra_ids) ? nodeData.maps_to_ra_ids : [];
      const meterClassesIH = Array.isArray(nodeData.meter_classes) ? nodeData.meter_classes : [];

      return (
        <div className="space-y-2">
          {nodeData.domain_category && (
            <div className="inline-block bg-orange-500/20 text-orange-300 px-2 py-1 rounded text-xs font-semibold">
              {nodeData.domain_category}
            </div>
          )}
          {nodeData.process_hypothesis && (
            <div className="bg-orange-500/10 border border-orange-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-orange-400">Process Hypothesis</p>
              <p className="text-xs mt-1 text-foreground font-semibold">{nodeData.process_hypothesis}</p>
            </div>
          )}
          {nodeData.discriminating_prediction && (
            <div className="bg-orange-500/10 border border-orange-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-orange-400">Discriminating Prediction</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.discriminating_prediction}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {nodeData.target_spv && (
              <div className="bg-blue-500/10 border border-blue-500/30 p-2 rounded">
                <p className="text-xs font-semibold text-blue-400">Target SPV</p>
                <p className="text-xs mt-1 text-foreground">{nodeData.target_spv}</p>
              </div>
            )}
            {nodeData.lens_origin && (
              <div className="bg-purple-500/10 border border-purple-500/30 p-2 rounded">
                <p className="text-xs font-semibold text-purple-400">Lens Origin</p>
                <p className="text-xs mt-1 text-foreground">{nodeData.lens_origin}</p>
              </div>
            )}
          </div>
          {mapsToRaIds.length > 0 && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-emerald-400">Maps to RAs</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {mapsToRaIds.map((raId: string, i: number) => (
                  <span key={i} className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded">{raId}</span>
                ))}
              </div>
            </div>
          )}
          {meterClassesIH.length > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-orange-400">Meter Classes</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {meterClassesIH.map((mc: string, i: number) => (
                  <span key={i} className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded">{mc}</span>
                ))}
              </div>
            </div>
          )}
          {nodeData.notes && (
            <div className="bg-secondary/30 p-2 rounded">
              <p className="text-xs font-semibold text-muted-foreground">Notes</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.notes}</p>
            </div>
          )}
        </div>
      );
    
    case 'l4':
      const distinguishesIHIdsL4 = Array.isArray(nodeData.distinguishes_ih_ids) ? nodeData.distinguishes_ih_ids : [];
      
      return (
        <div className="space-y-2">
          {nodeData.type && nodeData.lens && (
            <div className="flex gap-2">
              <span className="inline-block bg-lime-500/20 text-lime-300 px-2 py-1 rounded text-xs font-semibold">
                {nodeData.type}
              </span>
              <span className="inline-block bg-lime-500/20 text-lime-300 px-2 py-1 rounded text-xs font-semibold">
                {nodeData.lens}
              </span>
            </div>
          )}
          {nodeData.text && (
            <div className="bg-lime-500/10 border border-lime-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-lime-400">Question</p>
              <p className="text-xs mt-1 text-foreground font-semibold">{nodeData.text}</p>
            </div>
          )}
          {nodeData.rationale && (
            <div className="bg-lime-500/10 border border-lime-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-lime-400">Rationale</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.rationale}</p>
            </div>
          )}
          {distinguishesIHIdsL4.length > 0 && (
            <div className="bg-lime-500/10 border border-lime-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-lime-400">Distinguishes IHs</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {distinguishesIHIdsL4.map((ihId: string, i: number) => (
                  <span key={i} className="text-xs bg-lime-500/20 text-lime-300 px-2 py-0.5 rounded">{ihId}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    
    case 'l5':
      return (
        <div className="space-y-2">
          {nodeData.type && (
            <div className="flex gap-2">
              <span className="inline-block bg-lime-400/20 text-lime-300 px-2 py-1 rounded text-xs font-semibold">
                {nodeData.type}
              </span>
            </div>
          )}
          {nodeData.text && (
            <div className="bg-lime-400/10 border border-lime-400/30 p-2 rounded">
              <p className="text-xs font-semibold text-lime-400">Mechanistic Drill / Requirement</p>
              <p className="text-xs mt-1 text-foreground font-semibold">{nodeData.text}</p>
            </div>
          )}
          {nodeData.rationale && (
            <div className="bg-lime-400/10 border border-lime-400/30 p-2 rounded">
              <p className="text-xs font-semibold text-lime-400">Rationale</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.rationale}</p>
            </div>
          )}
          {nodeData.parent_l4_id && (
            <div className="bg-lime-400/10 border border-lime-400/30 p-2 rounded">
              <p className="text-xs font-semibold text-lime-400">Parent L4</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.parent_l4_id}</p>
            </div>
          )}
        </div>
      );
    
    case 'l6':
      const simtParams = nodeData.simt_parameters || {};
      
      return (
        <div className="space-y-2">
          {nodeData.type && (
            <div className="inline-block bg-teal-500/20 text-teal-300 px-2 py-1 rounded text-xs font-semibold">
              {nodeData.type}
            </div>
          )}
          {nodeData.parent_l4_id && (
            <div className="bg-teal-500/10 border border-teal-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-teal-400">Parent L4</p>
              <p className="text-xs mt-1 text-foreground font-mono">{nodeData.parent_l4_id}</p>
            </div>
          )}
          {nodeData.title && (
            <div className="bg-teal-500/10 border border-teal-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-teal-400">Title</p>
              <p className="text-xs mt-1 text-foreground font-semibold">{nodeData.title}</p>
            </div>
          )}
          {nodeData.description && (
            <div className="bg-teal-500/10 border border-teal-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-teal-400">Description</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.description}</p>
            </div>
          )}
          {Object.keys(simtParams).length > 0 && (
            <div className="bg-teal-500/10 border border-teal-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-teal-400">SIMT Parameters</p>
              <div className="grid grid-cols-2 gap-2 mt-1 text-xs">
                {simtParams.system && (
                  <div>
                    <span className="font-semibold text-teal-300">System:</span> {simtParams.system}
                  </div>
                )}
                {simtParams.intervention && (
                  <div>
                    <span className="font-semibold text-teal-300">Intervention:</span> {simtParams.intervention}
                  </div>
                )}
                {simtParams.meter && (
                  <div>
                    <span className="font-semibold text-teal-300">Meter:</span> {simtParams.meter}
                  </div>
                )}
                {simtParams.threshold_time && (
                  <div>
                    <span className="font-semibold text-teal-300">Time:</span> {simtParams.threshold_time}
                  </div>
                )}
              </div>
            </div>
          )}
          {nodeData.expected_impact && (
            <div className="bg-green-500/10 border border-green-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-green-400">Expected Impact</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.expected_impact}</p>
            </div>
          )}
          {nodeData.spv_link && (
            <div className="bg-teal-500/10 border border-teal-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-teal-400">SPV Link</p>
              <p className="text-xs mt-1 text-foreground font-mono">{nodeData.spv_link}</p>
            </div>
          )}
          {nodeData.readiness_assessment && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-amber-400">Readiness Assessment</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.readiness_assessment}</p>
            </div>
          )}
        </div>
      );
    
    case 'spv':
      return (
        <div className="space-y-2">
          {(nodeData.id || nodeData.ID) && (
            <div className="inline-block bg-amber-500/20 text-amber-300 px-2 py-1 rounded text-xs font-semibold">
              {nodeData.id || nodeData.ID}
            </div>
          )}
          {(nodeData.name || nodeData.Name) && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-amber-400">Name</p>
              <p className="text-xs mt-1 text-foreground font-semibold">{nodeData.name || nodeData.Name}</p>
            </div>
          )}
          {(nodeData.definition || nodeData.Definition) && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-amber-400">Definition</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.definition || nodeData.Definition}</p>
            </div>
          )}
        </div>
      );
    
    case 'domain':
    case 'domain_group':
      return (
        <div className="space-y-2">
          {nodeData.domain_id && (
            <div className="inline-block bg-cyan-500/20 text-cyan-300 px-2 py-1 rounded text-xs font-semibold">
              {nodeData.domain_id}
            </div>
          )}
          {nodeData.s_node_count !== undefined && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-cyan-400">Interventions in Domain</p>
              <p className="text-xs mt-1 text-foreground font-bold">{nodeData.s_node_count}</p>
            </div>
          )}
          {nodeData.domain_name && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-cyan-400">Domain Name</p>
              <p className="text-xs mt-1 text-foreground font-semibold">{nodeData.domain_name}</p>
            </div>
          )}
          {nodeData.scope_definition && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-cyan-400">Scope Definition</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.scope_definition}</p>
            </div>
          )}
          {nodeData.relevance_to_goal && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-cyan-400">Relevance to Goal</p>
              <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                nodeData.relevance_to_goal === 'HIGH' ? 'bg-green-500/20 text-green-400' :
                nodeData.relevance_to_goal === 'MED' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-gray-500/20 text-gray-400'
              }`}>
                {nodeData.relevance_to_goal}
              </span>
            </div>
          )}
          {nodeData.expected_intervention_count && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-cyan-400">Expected Interventions</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.expected_intervention_count}</p>
            </div>
          )}
          {nodeData.key_research_fronts && nodeData.key_research_fronts.length > 0 && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-cyan-400">Key Research Fronts</p>
              <ul className="list-disc list-inside text-xs mt-1 text-foreground space-y-1">
                {nodeData.key_research_fronts.map((front: string, idx: number) => (
                  <li key={idx}>{front}</li>
                ))}
              </ul>
            </div>
          )}
          {nodeData.rationale && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-cyan-400">Rationale</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.rationale}</p>
            </div>
          )}
        </div>
      );
    
    case 'common_l6': {
      const exp = nodeData.common_experiment || {};
      const design = exp.design || {};
      const arms = Array.isArray(design.intervention_arms) ? design.intervention_arms : [];
      const secondaryReadouts = Array.isArray(design.secondary_readouts) ? design.secondary_readouts : [];

      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-block bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded text-xs font-bold">FEASIBLE</span>
            {nodeData.confidence && (
              <span className="text-xs text-muted-foreground">Confidence: {Math.round(nodeData.confidence * 100)}%</span>
            )}
          </div>
          {nodeData.l4_reference_id && (
            <div className="text-xs text-muted-foreground">L4: <span className="font-mono">{nodeData.l4_reference_id}</span></div>
          )}
          {exp.title && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-yellow-400">Experiment Title</p>
              <p className="text-xs mt-1 text-foreground font-semibold">{exp.title}</p>
            </div>
          )}
          {exp.unified_hypothesis && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-yellow-400">Unified Hypothesis</p>
              <p className="text-xs mt-1 text-foreground italic">{exp.unified_hypothesis}</p>
            </div>
          )}
          {design.system && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-yellow-400">System</p>
              <p className="text-xs mt-1 text-foreground">{design.system}</p>
            </div>
          )}
          {arms.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-yellow-400">Intervention Arms</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                {arms.map((arm: string, i: number) => (
                  <li key={i} className="text-xs text-foreground">{arm}</li>
                ))}
              </ul>
            </div>
          )}
          {design.primary_readout && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-yellow-400">Primary Readout</p>
              <p className="text-xs mt-1 text-foreground">{design.primary_readout}</p>
            </div>
          )}
          {secondaryReadouts.length > 0 && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-yellow-400">Secondary Readouts</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                {secondaryReadouts.map((r: string, i: number) => (
                  <li key={i} className="text-xs text-foreground">{r}</li>
                ))}
              </ul>
            </div>
          )}
          {design.timeline && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-yellow-400">Timeline</p>
              <p className="text-xs mt-1 text-foreground">{design.timeline}</p>
            </div>
          )}
          {design.success_criteria && (
            <div className="bg-green-500/10 border border-green-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-green-400">Success Criteria</p>
              <p className="text-xs mt-1 text-foreground">{design.success_criteria}</p>
            </div>
          )}
          {exp.l6_coverage && (
            <div className="bg-blue-500/10 border border-blue-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-blue-400">L6 Coverage</p>
              <p className="text-xs mt-1 text-foreground">{exp.l6_coverage}</p>
            </div>
          )}
          {exp.advantages_over_individual && (
            <div className="bg-blue-500/10 border border-blue-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-blue-400">Advantages Over Individual Experiments</p>
              <p className="text-xs mt-1 text-foreground">{exp.advantages_over_individual}</p>
            </div>
          )}
          {nodeData.reasoning && (
            <div className="bg-secondary/30 border border-border/30 p-2 rounded">
              <p className="text-xs font-semibold text-muted-foreground">Reasoning</p>
              <p className="text-xs mt-1 text-foreground whitespace-pre-wrap">{nodeData.reasoning}</p>
            </div>
          )}
        </div>
      );
    }

    case 'common_l6_fail': {
      const rejectionReasons = Array.isArray(nodeData.rejection_reasons) ? nodeData.rejection_reasons : [];

      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="inline-block bg-red-800/30 text-red-400 px-2 py-1 rounded text-xs font-bold">NOT FEASIBLE</span>
            {nodeData.confidence && (
              <span className="text-xs text-muted-foreground">Confidence: {Math.round(nodeData.confidence * 100)}%</span>
            )}
          </div>
          {nodeData.l4_reference_id && (
            <div className="text-xs text-muted-foreground">L4: <span className="font-mono">{nodeData.l4_reference_id}</span></div>
          )}
          {rejectionReasons.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-red-400">Rejection Reasons</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                {rejectionReasons.map((reason: string, i: number) => (
                  <li key={i} className="text-xs text-foreground">{reason}</li>
                ))}
              </ul>
            </div>
          )}
          {nodeData.closest_partial_grouping && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-2 rounded">
              <p className="text-xs font-semibold text-amber-400">Closest Partial Grouping</p>
              <p className="text-xs mt-1 text-foreground">{nodeData.closest_partial_grouping}</p>
            </div>
          )}
          {nodeData.reasoning && (
            <div className="bg-secondary/30 border border-border/30 p-2 rounded">
              <p className="text-xs font-semibold text-muted-foreground">Reasoning</p>
              <p className="text-xs mt-1 text-foreground whitespace-pre-wrap">{nodeData.reasoning}</p>
            </div>
          )}
        </div>
      );
    }

    default:
      return (
        <pre className="bg-secondary/30 border border-border/30 p-3 rounded text-xs overflow-auto max-h-64 text-foreground select-text">
          {JSON.stringify(nodeData, null, 2)}
        </pre>
      );
  }
};

import React, { useState, useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { useSessionStore } from './store/useSessionStore';
import { SessionSwitcher } from './components/SessionSwitcher';
import { AgentCard } from './components/AgentCard';
import { PipelineView } from './components/PipelineView';
import { GraphVisualization } from './components/GraphVisualization';
import { GraphVisualizationWrapper } from './components/GraphVisualizationWrapper';
// SplitView component available but using custom split implementation
import { ParticleBackground } from './components/ParticleBackground';
import { Button } from './components/ui/Button';
import { Input } from './components/ui/Input';
import { Card, CardHeader, CardTitle, CardContent } from './components/ui/Card';
import { executeStep, executeStepBatch, createAbortController, abortStep, cleanupAbortController } from './lib/api';
import { Users, GitBranch, Save, History, Network, LayoutGrid, Download, Shield, Zap, Target, X, Play, RefreshCw, Upload, FileJson } from 'lucide-react';

function App() {
  const [activeTab, setActiveTab] = useState<'agents' | 'split' | 'pipeline' | 'graph' | 'versions' | 'scientific'>('split');
  const [scientificPillars, setScientificPillars] = useState<any>(null);
  const [splitRatio, setSplitRatio] = useState(35); // Percentage for pipeline width
  const [isDragging, setIsDragging] = useState(false);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null); // For single-goal pipeline
  const [selectedL3Id, setSelectedL3Id] = useState<string | null>(null); // For single-L3 pipeline
  const [selectedL4Id, setSelectedL4Id] = useState<string | null>(null); // For single-L4 pipeline
  const [globalLens, setGlobalLens] = useState<string>(''); // Global lens for all agents
  const [useImprovedGraph, setUseImprovedGraph] = useState(true); // Toggle for improved graph visualization
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { 
    currentGoal, 
    setGoal, 
    agents, 
    updateAgent, 
    steps, 
    updateStepStatus,
    updateStep4Phase,
    skipStep,
    clearStep,
    resetToDefaults,
    saveVersion,
    versions,
    loadVersion,
    deleteVersion,
    resetPipeline
  } = useAppStore();

  // Helper function to enrich goal with SPV definitions
  const enrichGoalWithSPVs = (goal: any, allSPVs: any[]) => {
    const enrichedGoal = { ...goal };
    if (enrichedGoal.bridge_tags?.system_properties_required) {
      enrichedGoal.bridge_tags.system_properties_required = enrichedGoal.bridge_tags.system_properties_required.map((sp: any) => {
        const spvDef = allSPVs.find((spv: any) => (spv.id || spv.ID) === sp.spv_id);
        return {
          ...sp,
          name: spvDef?.name,
          definition: spvDef?.definition
        };
      });
    }
    return enrichedGoal;
  };

  // Load complete pipeline JSON
  const handleLoadPipelineJSON = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        
        // Validate structure
        const validationErrors: string[] = [];
        
        if (!json.goal || typeof json.goal !== 'string') {
          validationErrors.push('Missing or invalid "goal" field');
        }
        
        if (!json.steps || !Array.isArray(json.steps)) {
          validationErrors.push('Missing or invalid "steps" array');
        }
        
        if (validationErrors.length > 0) {
          alert('Invalid pipeline JSON:\n' + validationErrors.join('\n'));
          return;
        }
        
        // Validate each step
        const stepValidation = json.steps.map((step: any, idx: number) => {
          const errors: string[] = [];
          if (!step.id) errors.push(`Step ${idx}: missing id`);
          if (!step.name) errors.push(`Step ${idx}: missing name`);
          if (step.status && !['pending', 'running', 'completed', 'error', 'skipped'].includes(step.status)) {
            errors.push(`Step ${idx}: invalid status "${step.status}"`);
          }
          return errors;
        }).flat();
        
        if (stepValidation.length > 0) {
          alert('Step validation errors:\n' + stepValidation.join('\n'));
          return;
        }
        
        // Load the data
        setGoal(json.goal);
        
        // Update each step with the loaded data
        json.steps.forEach((loadedStep: any) => {
          const status = loadedStep.status || 'pending';
          const output = loadedStep.output || null;
          const error = loadedStep.error || undefined;
          
          updateStepStatus(loadedStep.id, status, output, error);
        });
        
        // Clear selections
        setSelectedGoalId(null);
        setSelectedL3Id(null);
        setSelectedL4Id(null);
        
        alert(`Successfully loaded pipeline: "${json.goal}"\n${json.steps.filter((s: any) => s.status === 'completed').length} completed steps`);
        
      } catch (error) {
        alert('Error parsing JSON: ' + (error as Error).message);
      }
    };
    reader.readAsText(file);
  };

  const handleRunStep = async (stepId: number) => {
    const step = steps.find(s => s.id === stepId);
    if (!step) return;

    const agent = agents.find(a => a.id === step.agentId);
    if (!agent || !agent.enabled) {
      updateStepStatus(stepId, 'error', null, 'Agent is disabled');
      return;
    }

    updateStepStatus(stepId, 'running');
    
    // Create abort controller for this step
    const controller = createAbortController(stepId);

    try {
      // Prepare input based on step
      let input = step.input || currentGoal;
      
      // For steps that depend on previous outputs
      if (stepId > 1) {
        const previousOutputs = steps.slice(0, stepId - 1).reduce((acc, s) => {
          if (s.output) {
            acc[`step${s.id}`] = s.output;
          }
          return acc;
        }, {} as Record<string, any>);
        
        input = {
          goal: currentGoal,
          ...previousOutputs
        };
      }

      // STEP 3: Batch process all Goal Pillars (or single goal if selected)
      if (stepId === 3) {
        const step2Output = steps[1]?.output;
        let goals = step2Output?.goals || [];
        
        console.log(`[Step 3] selectedGoalId:`, selectedGoalId);
        console.log(`[Step 3] Total goals available:`, goals.length);
        
        // Filter to single goal if selected
        if (selectedGoalId) {
          goals = goals.filter((g: any) => g.id === selectedGoalId);
          if (goals.length === 0) {
            updateStepStatus(stepId, 'error', null, `Selected goal ${selectedGoalId} not found`);
            return;
          }
          console.log(`Step 3: Processing SINGLE goal ${selectedGoalId}`);
        } else {
          console.log(`Step 3: Processing ${goals.length} Goal Pillars in batch`);
        }
        
        if (goals.length === 0) {
          updateStepStatus(stepId, 'error', null, 'No Goal Pillars found from Step 2');
          return;
        }
        
        // Prepare batch items - one per goal
        const bridgeLexicon = step2Output?.bridge_lexicon || {};
        const items = goals.map((goal: any) => ({
          goal_pillar: goal,
          step1: steps[0]?.output,
          step2: { bridge_lexicon: bridgeLexicon },
          goal: currentGoal
        }));

        const batchResult = await executeStepBatch(stepId, agent, items, controller.signal, globalLens);
        
        // Aggregate results by goal ID
        const rasByGoal: Record<string, any[]> = selectedGoalId ? (steps[2]?.output || {}) : {};
        batchResult.batch_results.forEach((result: any, idx: number) => {
          if (result.success && result.data) {
            const goalId = goals[idx].id;
            const ras = result.data.requirement_atoms || result.data.RAs || [];
            rasByGoal[goalId] = Array.isArray(ras) ? ras : [ras];
          }
        });

        updateStepStatus(stepId, 'completed', rasByGoal);
        return;
      }

      // STEP 5: DISABLED - Judge agent disabled, function integrated into Step 4b
      if (stepId === 5) {
        console.log(`[Step 5] ⚠️  Step 5 (Judge) is DISABLED - relationship assessment integrated into Step 4b`);
        updateStepStatus(stepId, 'skipped', null, 'Step 5 Judge disabled - relationship assessment now in Step 4b');
        return;
      }

      // STEP 6: Batch process all Goals for L3 questions (or single goal if selected)
      if (stepId === 6) {
        const step2Output = steps[1]?.output;
        let goals = step2Output?.goals || [];
        const bridgeLexicon = step2Output?.bridge_lexicon || {};
        const allSPVs = bridgeLexicon.system_properties || [];
        
        console.log(`[Step 6] 🎯 Goal Selection Debug:`);
        console.log(`  - selectedGoalId:`, selectedGoalId);
        console.log(`  - Total goals available:`, goals.length);
        console.log(`  - Goal IDs:`, goals.map((g: any) => g.id));
        
        // Filter to single goal if selected
        if (selectedGoalId) {
          const beforeFilter = goals.length;
          goals = goals.filter((g: any) => g.id === selectedGoalId);
          console.log(`  - ✅ FILTERING: ${beforeFilter} goals → ${goals.length} goal(s)`);
          
          if (goals.length === 0) {
            console.error(`  - ❌ ERROR: Selected goal ${selectedGoalId} not found in available goals`);
            updateStepStatus(stepId, 'error', null, `Selected goal ${selectedGoalId} not found`);
            return;
          }
          console.log(`  - ✅ Processing SINGLE goal: ${selectedGoalId}`);
        } else {
          console.log(`  - ⚠️  NO GOAL SELECTED: Processing ALL ${goals.length} goals in batch`);
        }
        
        if (goals.length === 0) {
          updateStepStatus(stepId, 'error', null, 'No Goal Pillars found from Step 2');
          return;
        }
        
        // Prepare batch items with enriched SPV definitions
        const step2Data = steps[1]?.output;
        const step3Data = steps[2]?.output;
        const step4Data = steps[3]?.output;

        console.log('[Step 6] Preparing batch items:');
        console.log('  - Step 2 data:', !!step2Data);
        console.log('  - Step 3 data:', !!step3Data);
        console.log('  - Step 4 data:', !!step4Data);
        console.log('  - Goals to process:', goals.length);

        const items = goals.map((goal: any) => {
          const enrichedGoal = enrichGoalWithSPVs(goal, allSPVs);

          return {
            goal_pillar: enrichedGoal,
            step2: step2Data,
            step3: step3Data,
            step4: step4Data,
            step5: step4Data, // CRITICAL: Pass Step 4 as Step 5 since Judge is skipped (relationship data is in Step 4)
            goal: currentGoal
          };
        });

        const batchResult = await executeStepBatch(stepId, agent, items, controller.signal, globalLens);

        console.log('[Step 6] 🔍 BATCH RESULT DEBUG:');
        console.log('  - batch_results length:', batchResult?.batch_results?.length);
        console.log('  - successful:', batchResult?.successful);
        console.log('  - failed:', batchResult?.failed);

        // Aggregate all L3 questions
        const existingL3s = selectedGoalId ? (steps[5]?.output?.l3_questions || []) : [];
        const allL3Questions: any[] = [...existingL3s];

        batchResult.batch_results.forEach((result: any, idx: number) => {
          console.log(`[Step 6] Processing batch result ${idx + 1}:`, {
            success: result.success,
            hasData: !!result.data,
            dataKeys: result.data ? Object.keys(result.data) : []
          });

          if (result.success && result.data) {
            console.log(`[Step 6] Result data structure:`, result.data);

            const l3s = result.data.l3_questions || result.data.seed_questions || [];
            const targetGoalId = result.data.target_goal_id;

            console.log(`[Step 6] Extracted data:`, {
              l3s_length: l3s.length,
              targetGoalId: targetGoalId,
              l3s_sample: l3s[0]
            });

            // CRITICAL FIX: Add target_goal_id to each L3 question for graph visualization
            l3s.forEach((l3: any) => {
              if (targetGoalId && !l3.target_goal_id) {
                l3.target_goal_id = targetGoalId;
              }
            });

            console.log(`[Step 6] ✅ Extracted ${l3s.length} L3 questions for goal ${targetGoalId}`);
            if (l3s.length > 0) {
              console.log(`[Step 6] Sample L3 ID: ${l3s[0]?.id}`);
              console.log(`[Step 6] Sample L3 text: ${l3s[0]?.text?.substring(0, 100)}`);
            }

            allL3Questions.push(...l3s);
          } else {
            console.error(`[Step 6] ❌ Batch result ${idx + 1} failed or has no data:`, result.error);
          }
        });

        console.log(`[Step 6] ✅ Total L3 questions collected: ${allL3Questions.length}`);
        console.log(`[Step 6] All L3 IDs:`, allL3Questions.map(q => q?.id));

        const existingSummary = selectedGoalId ? (steps[5]?.output?.batch_summary || {}) : {};
        updateStepStatus(stepId, 'completed', {
          l3_questions: allL3Questions,
          batch_summary: {
            goals_processed: (existingSummary.goals_processed || 0) + goals.length,
            l3_generated: allL3Questions.length,
            successful: (existingSummary.successful || 0) + batchResult.successful,
            failed: (existingSummary.failed || 0) + batchResult.failed
          }
        });
        return;
      }

      // STEP 7: Batch process all L3 questions for Instantiation Hypotheses (or single L3 if selected)
      if (stepId === 7) {
        const step6Output = steps[5]?.output;
        let l3Questions = step6Output?.l3_questions || step6Output?.seed_questions || [];
        const step2Output = steps[1]?.output;
        const goals = step2Output?.goals || [];
        const bridgeLexicon = step2Output?.bridge_lexicon || {};
        const allSPVs = bridgeLexicon.system_properties || [];
        
        console.log(`[Step 7] selectedL3Id:`, selectedL3Id);
        console.log(`[Step 7] Total L3 questions available:`, l3Questions.length);
        
        // Filter to single L3 if selected
        if (selectedL3Id) {
          l3Questions = l3Questions.filter((l3: any) => l3.id === selectedL3Id);
          if (l3Questions.length === 0) {
            updateStepStatus(stepId, 'error', null, `Selected L3 ${selectedL3Id} not found`);
            return;
          }
          console.log(`Step 7: Processing SINGLE L3 ${selectedL3Id}`);
        } else {
          console.log(`Step 7: Processing ${l3Questions.length} L3 questions in batch`);
        }
        
        if (l3Questions.length === 0) {
          updateStepStatus(stepId, 'error', null, 'No L3 questions found from Step 6');
          return;
        }
        
        // Prepare batch items with enriched parent goal
        const items = l3Questions.map((l3q: any) => {
          // Find parent goal and enrich with SPV definitions
          const parentGoal = goals.find((g: any) => g.id === l3q.parent_goal_id);
          const enrichedParentGoal = parentGoal ? enrichGoalWithSPVs(parentGoal, allSPVs) : null;
          
          return {
            l3_question: l3q,
            parent_goal: enrichedParentGoal,
            step3: steps[2]?.output,
            step5: steps[4]?.output,
            goal: currentGoal
          };
        });

        const batchResult = await executeStepBatch(stepId, agent, items, controller.signal, globalLens);
        
        // Aggregate results
        const allIHs: any[] = [];
        batchResult.batch_results.forEach((result: any) => {
          if (result.success && result.data) {
            const ihs = result.data.instantiation_hypotheses || result.data.IHs || [];
            allIHs.push(...(Array.isArray(ihs) ? ihs : [ihs]));
          }
        });

        updateStepStatus(stepId, 'completed', {
          instantiation_hypotheses: allIHs,
          batch_summary: {
            l3_processed: l3Questions.length,
            ih_generated: allIHs.length,
            successful: batchResult.successful,
            failed: batchResult.failed
          }
        });
        return;
      }

      // STEP 8: Batch process all L3 questions (or single L3 if selected)
      if (stepId === 8) {
        const step6Output = steps[5]?.output;
        let l3Questions = step6Output?.l3_questions || step6Output?.seed_questions || [];
        const step2Output = steps[1]?.output;
        const goals = step2Output?.goals || [];
        const bridgeLexicon = step2Output?.bridge_lexicon || {};
        const allSPVs = bridgeLexicon.system_properties || [];
        
        console.log(`[Step 8] selectedL3Id:`, selectedL3Id);
        console.log(`[Step 8] Total L3 questions available:`, l3Questions.length);
        
        // Filter to single L3 if selected
        if (selectedL3Id) {
          l3Questions = l3Questions.filter((l3: any) => l3.id === selectedL3Id);
          if (l3Questions.length === 0) {
            updateStepStatus(stepId, 'error', null, `Selected L3 ${selectedL3Id} not found`);
            return;
          }
          console.log(`Step 8: Processing SINGLE L3 ${selectedL3Id}`);
        } else {
          console.log(`Step 8: Processing ${l3Questions.length} L3 questions in batch`);
        }
        
        if (l3Questions.length === 0) {
          updateStepStatus(stepId, 'error', null, 'No L3 questions found from Step 6');
          return;
        }
        
        // Prepare batch items with enriched parent goal
        const items = l3Questions.map((l3q: any) => {
          // Find parent goal and enrich with SPV definitions
          const parentGoal = goals.find((g: any) => g.id === l3q.parent_goal_id);
          const enrichedParentGoal = parentGoal ? enrichGoalWithSPVs(parentGoal, allSPVs) : null;
          
          return {
            l3_question: l3q,
            parent_goal: enrichedParentGoal,
            step3: steps[2]?.output,
            step7: steps[6]?.output,
            step5: steps[4]?.output,
            goal: currentGoal
          };
        });

        const batchResult = await executeStepBatch(stepId, agent, items, controller.signal, globalLens);
        
        // Aggregate results
        const allL4Questions: any[] = [];
        batchResult.batch_results.forEach((result: any) => {
          if (result.success && result.data) {
            const l4s = result.data.l4_questions || result.data.child_nodes_L4 || [];
            allL4Questions.push(...l4s);
          }
        });

        updateStepStatus(stepId, 'completed', {
          l4_questions: allL4Questions,
          batch_summary: {
            l3_processed: l3Questions.length,
            l4_generated: allL4Questions.length,
            successful: batchResult.successful,
            failed: batchResult.failed
          }
        });
        return;
      }

      // STEP 9: Batch process all L4 questions (or single L4 if selected)
      if (stepId === 9) {
        const step8Output = steps[7]?.output;
        let l4Questions = step8Output?.l4_questions || [];
        
        console.log(`[Step 9] selectedL4Id:`, selectedL4Id);
        console.log(`[Step 9] Total L4 questions available:`, l4Questions.length);
        
        // Filter to single L4 if selected
        if (selectedL4Id) {
          l4Questions = l4Questions.filter((l4: any) => l4.id === selectedL4Id);
          if (l4Questions.length === 0) {
            updateStepStatus(stepId, 'error', null, `Selected L4 ${selectedL4Id} not found`);
            return;
          }
          console.log(`Step 9: Processing SINGLE L4 ${selectedL4Id}`);
        } else {
          console.log(`Step 9: Processing ${l4Questions.length} L4 questions in batch`);
        }
        
        if (l4Questions.length === 0) {
          updateStepStatus(stepId, 'error', null, 'No L4 questions found from Step 8');
          return;
        }
        
        // Prepare batch items - no step2, no step7
        const items = l4Questions.map((l4q: any) => ({
          l4_question: l4q,
          step3: steps[2]?.output,
          step5: steps[4]?.output,
          goal: currentGoal
        }));

        const batchResult = await executeStepBatch(stepId, agent, items, controller.signal, globalLens);
        
        // Aggregate results - preserve L5 and L6 hierarchy
        const allL5Nodes: any[] = [];
        const allL6Tasks: any[] = [];
        
        batchResult.batch_results.forEach((result: any) => {
          if (result.success && result.data) {
            // Check if we have the hierarchical format (drill_branches with L5 nodes)
            if (result.data.drill_branches && Array.isArray(result.data.drill_branches)) {
              result.data.drill_branches.forEach((branch: any) => {
                // Add L5 node
                const l5Node = {
                  id: branch.id,
                  type: branch.type,
                  text: branch.text,
                  rationale: branch.rationale,
                  parent_l4_id: result.data.l4_reference_id
                };
                allL5Nodes.push(l5Node);
                
                // Add L6 tasks under this L5
                const l6Tasks = branch.leaf_specs || [];
                l6Tasks.forEach((task: any) => {
                  allL6Tasks.push({
                    ...task,
                    parent_l5_id: branch.id,
                    parent_l4_id: result.data.l4_reference_id
                  });
                });
              });
            } 
            // Fallback: flat L6 tasks (legacy format)
            else if (result.data.l6_tasks) {
              const l6s = Array.isArray(result.data.l6_tasks) ? result.data.l6_tasks : [];
              allL6Tasks.push(...l6s);
            }
          }
        });

        updateStepStatus(stepId, 'completed', {
          l5_nodes: allL5Nodes,
          l6_tasks: allL6Tasks,
          batch_summary: {
            l4_processed: l4Questions.length,
            l5_generated: allL5Nodes.length,
            l6_generated: allL6Tasks.length,
            successful: batchResult.successful,
            failed: batchResult.failed
          }
        });
        return;
      }

      // STEP 10: Common Experiment Synthesis (per L4 branch)
      // For each L4, gather ALL L6 tasks across ALL L5 branches and ask if a single experiment can unify them
      if (stepId === 10) {
        const step1Output = steps[0]?.output;
        const step8Output = steps[7]?.output;
        const step9Output = steps[8]?.output;
        
        // Get Q0 text
        let q0Text = '';
        if (step1Output) {
          if (typeof step1Output === 'string') q0Text = step1Output;
          else q0Text = step1Output.Q0 || step1Output.q0 || step1Output.question || '';
        }
        
        const l4Questions = step8Output?.l4_questions || [];
        const allL6Tasks = step9Output?.l6_tasks || [];
        
        if (l4Questions.length === 0) {
          updateStepStatus(stepId, 'error', null, 'No L4 questions found from Step 8');
          return;
        }
        if (allL6Tasks.length === 0) {
          updateStepStatus(stepId, 'error', null, 'No L6 tasks found from Step 9');
          return;
        }
        
        console.log(`[Step 10] Processing ${l4Questions.length} L4 branches for common experiment synthesis`);
        
        // Build batch items: one per L4, with all its L6 tasks
        const items = l4Questions.map((l4q: any) => {
          const l4Id = l4q.id;
          // Gather all L6 tasks that belong to this L4 (via parent_l4_id)
          const l6ForThisL4 = allL6Tasks.filter((t: any) => t.parent_l4_id === l4Id);
          
          return {
            q0: q0Text,
            l4_question: l4q,
            l6_tasks: l6ForThisL4.map((t: any) => ({
              id: t.id,
              title: t.title,
              type: t.type,
              parent_l5_id: t.parent_l5_id,
              simt_parameters: t.simt_parameters,
              expected_impact: t.expected_impact,
            })),
            l6_count: l6ForThisL4.length,
            goal: currentGoal
          };
        }).filter((item: any) => item.l6_count > 0); // Skip L4s with no L6 tasks
        
        if (items.length === 0) {
          updateStepStatus(stepId, 'error', null, 'No L4 branches have L6 tasks to synthesize');
          return;
        }
        
        console.log(`[Step 10] Sending ${items.length} L4 branches (with L6 tasks) to Convergence Critic`);
        
        const batchResult = await executeStepBatch(stepId, agent, items, controller.signal, globalLens);
        
        // Aggregate results
        const commonL6Results: any[] = [];
        batchResult.batch_results.forEach((result: any) => {
          if (result.success && result.data) {
            commonL6Results.push(result.data);
          }
        });
        
        const feasibleCount = commonL6Results.filter((r: any) => r.feasible).length;
        const notFeasibleCount = commonL6Results.filter((r: any) => !r.feasible).length;
        
        updateStepStatus(stepId, 'completed', {
          common_l6_results: commonL6Results,
          batch_summary: {
            l4_processed: items.length,
            feasible: feasibleCount,
            not_feasible: notFeasibleCount,
            successful: batchResult.successful,
            failed: batchResult.failed
          }
        });
        return;
      }

      // STEP 4: 2-Phase Scientific Knowledge Collection (Phase 4c REMOVED)
      // Phase 4a: Domain Mapping → Phase 4b: Domain Scans (parallel)
      if (stepId === 4) {
        const step2Output = steps[1]?.output;
        const step3Output = steps[2]?.output;
        let goals = step2Output?.goals || [];
        const bridgeLexicon = step2Output?.bridge_lexicon || {};
        const filteredBridgeLexicon = {
          system_properties: bridgeLexicon.system_properties || []
        };
        
        console.log(`
========================================`);
        console.log(`[Step 4] 🚀 3-PHASE SCIENTIFIC KNOWLEDGE COLLECTION`);
        console.log(`========================================`);
        console.log(`[Step 4] Selected Goal ID:`, selectedGoalId || 'ALL GOALS (Batch Mode)');
        console.log(`[Step 4] Total goals available:`, goals.length);
        console.log(`[Step 4] Goals to process:`, goals.map((g: any) => g.id));
        console.log(`[Step 4] Bridge Lexicon SPVs:`, filteredBridgeLexicon.system_properties.length);
        
        // Filter to single goal if selected
        if (selectedGoalId) {
          goals = goals.filter((g: any) => g.id === selectedGoalId);
          if (goals.length === 0) {
            updateStepStatus(stepId, 'error', null, `Selected goal ${selectedGoalId} not found`);
            return;
          }
          console.log(`Step 4: Processing SINGLE goal ${selectedGoalId}`);
        }
        
        if (goals.length === 0) {
          updateStepStatus(stepId, 'error', null, 'No Goal Pillars found from Step 2');
          return;
        }
        
        // ===== PHASE 4a: DOMAIN MAPPING =====
        console.log(`
----------------------------------------`);
        console.log(`[Step 4a] 🗺️  PHASE 1: DOMAIN MAPPING`);
        console.log(`----------------------------------------`);
        console.log(`[Step 4a] Processing ${goals.length} goal(s)...`);
        console.log(`[Step 4a] Available agents:`, agents.map(a => a.id));
        console.log(`[Step 4a] Timestamp:`, new Date().toISOString());
        updateStepStatus(stepId, 'running', { phase: '4a_domain_mapping', progress: 0 });
        
        const domainMapperAgent = agents.find(a => a.id === 'agent-domain-mapper');
        if (!domainMapperAgent) {
          console.error('[Step 4a] Domain Mapper agent not found!');
          console.error('[Step 4a] Available agents:', agents.map(a => ({ id: a.id, name: a.name })));
          updateStepStatus(stepId, 'error', null, 'Domain Mapper agent not found. Try resetting to defaults or clearing browser cache.');
          return;
        }
        console.log(`[Step 4a] Found Domain Mapper agent:`, domainMapperAgent.name);
        
        const domainMappingItems = goals.map((goal: any) => {
          const ras = step3Output?.[goal.id] || [];
          console.log(`[Step 4a] Preparing input for Goal ${goal.id}:`);
          console.log(`  - Goal Title: ${goal.title}`);
          console.log(`  - RAs available: ${ras.length}`);
          console.log(`  - SPVs in bridge lexicon: ${filteredBridgeLexicon.system_properties.length}`);

          // ⚡ OPTIMIZATION: Create minimal objects with only needed fields to reduce API payload
          const minimalGoal = {
            id: goal.id,
            title: goal.title,
            catastrophe_primary: goal.catastrophe_primary,
            bridge_tags: goal.bridge_tags
          };

          // Truncate Q0 if too long (keep first 1500 chars to reduce input tokens)
          const q0Text = steps[0]?.output?.Q0 || '';
          const truncatedQ0 = q0Text.length > 1500 ? q0Text.substring(0, 1500) + '...[truncated]' : q0Text;

          // Minimal RAs with only essential fields
          const minimalRAs = ras.map((ra: any) => ({
            ra_id: ra.ra_id,
            atom_title: ra.atom_title,
            requirement_statement: ra.requirement_statement
          }));

          // Filter bridge_lexicon to only include SPVs referenced by this goal
          const relevantSPVIds = (goal.bridge_tags?.system_properties_required || []).map((sp: any) => sp.spv_id);
          const minimalBridgeLexicon = {
            system_properties: filteredBridgeLexicon.system_properties.filter((spv: any) =>
              relevantSPVIds.includes(spv.id || spv.ID)
            )
          };

          // Log optimization impact
          const originalSize = JSON.stringify({ Q0_reference: steps[0]?.output?.Q0, target_goal: goal, requirement_atoms: ras, bridge_lexicon: filteredBridgeLexicon }).length;
          const optimizedSize = JSON.stringify({ Q0_reference: truncatedQ0, target_goal: minimalGoal, requirement_atoms: minimalRAs, bridge_lexicon: minimalBridgeLexicon }).length;
          console.log(`  ⚡ Payload size: ${originalSize} → ${optimizedSize} bytes (${((1 - optimizedSize/originalSize) * 100).toFixed(1)}% reduction)`);
          console.log(`  ⚡ SPVs filtered: ${filteredBridgeLexicon.system_properties.length} → ${minimalBridgeLexicon.system_properties.length}`);

          return {
            Q0_reference: truncatedQ0,
            target_goal: minimalGoal,
            requirement_atoms: minimalRAs,
            bridge_lexicon: minimalBridgeLexicon,
            goal: currentGoal
          };
        });
        
        console.log(`[Step 4a] Prepared ${domainMappingItems.length} batch items for domain mapping`);
        
        console.log(`[Step 4a] ⏳ Executing batch call to Domain Mapper agent...`);
        const domainMappingStartTime = Date.now();
        
        const domainMappingResult = await executeStepBatch(
          stepId,
          domainMapperAgent,
          domainMappingItems,
          controller.signal,
          globalLens,
          { phase: '4a' }
        );
        
        const domainMappingDuration = ((Date.now() - domainMappingStartTime) / 1000).toFixed(2);
        console.log(`[Step 4a] ✅ Domain mapping completed in ${domainMappingDuration}s`);
        console.log(`[Step 4a] Batch results:`, {
          successful: domainMappingResult.successful,
          failed: domainMappingResult.failed,
          total: domainMappingResult.batch_results.length
        });
        
        const domainsByGoal: Record<string, any> = {};
        let totalDomainsIdentified = 0;
        
        console.log(`[Step 4a] Processing domain mapping results...`);
        domainMappingResult.batch_results.forEach((result: any, idx: number) => {
          const goalId = goals[idx].id;
          
          if (result.success && result.data) {
            domainsByGoal[goalId] = result.data;
            const domains = result.data.research_domains || [];
            totalDomainsIdentified += domains.length;
            
            console.log(`[Step 4a] ✓ Goal ${goalId}:`);
            console.log(`  - Domains identified: ${domains.length}`);
            console.log(`  - Domain IDs: ${domains.map((d: any) => d.domain_id).join(', ')}`);
            console.log(`  - Relevance breakdown:`, {
              HIGH: domains.filter((d: any) => d.relevance_to_goal === 'HIGH').length,
              MED: domains.filter((d: any) => d.relevance_to_goal === 'MED').length,
              LOW: domains.filter((d: any) => d.relevance_to_goal === 'LOW').length
            });
            
            // Log each domain with details
            domains.forEach((domain: any) => {
              console.log(`    • ${domain.domain_id}: ${domain.domain_name} [${domain.relevance_to_goal}] - Expected: ${domain.expected_intervention_count} interventions`);
            });
          } else {
            console.error(`[Step 4a] ✗ Goal ${goalId}: FAILED`);
            console.error(`  - Error:`, result.error || 'Unknown error');
          }
        });
        
        console.log(`[Step 4a] 📊 Phase 1 Summary:`);
        console.log(`  - Total domains identified: ${totalDomainsIdentified}`);
        console.log(`  - Goals processed: ${Object.keys(domainsByGoal).length}/${goals.length}`);
        
        // Save Phase 4a results immediately
        updateStep4Phase('phase4a_domain_mapping', domainsByGoal);
        console.log(`[Step 4a] ✅ Phase 1 results saved to store`);
        
        // ===== PHASE 4b: DOMAIN-SPECIFIC SCANS (PARALLEL) =====
        console.log(`
----------------------------------------`);
        console.log(`[Step 4b] 🔬 PHASE 2: DOMAIN-SPECIFIC SCANS (PARALLEL)`);
        console.log(`----------------------------------------`);
        console.log(`[Step 4b] Timestamp:`, new Date().toISOString());
        
        // 🔧 FIX: Filter domainsByGoal to only selected goal if specified
        let filteredDomainsByGoal = domainsByGoal;
        if (selectedGoalId) {
          filteredDomainsByGoal = {};
          if (domainsByGoal[selectedGoalId]) {
            filteredDomainsByGoal[selectedGoalId] = domainsByGoal[selectedGoalId];
            console.log(`[Step 4b] ✅ Filtered to SINGLE goal: ${selectedGoalId}`);
            console.log(`[Step 4b] Domains for ${selectedGoalId}: ${domainsByGoal[selectedGoalId].research_domains?.length || 0}`);
          } else {
            console.error(`[Step 4b] ✗ Selected goal ${selectedGoalId} not found in Phase 4a results`);
            updateStepStatus(stepId, 'error', null, `Selected goal ${selectedGoalId} has no domain mapping`);
            return;
          }
        } else {
          console.log(`[Step 4b] Processing ALL goals (${Object.keys(domainsByGoal).length} goals)`);
        }
        
        updateStepStatus(stepId, 'running', { 
          phase: '4b_domain_scans', 
          progress: 50,
          domain_mapping: filteredDomainsByGoal 
        });
        
        const domainSpecialistAgent = agents.find(a => a.id === 'agent-biologist');
        if (!domainSpecialistAgent) {
          console.error('[Step 4b] Domain Specialist agent not found!');
          console.error('[Step 4b] Available agents:', agents.map(a => ({ id: a.id, name: a.name })));
          updateStepStatus(stepId, 'error', null, 'Domain Specialist (agent-biologist) not found. Try resetting to defaults.');
          return;
        }
        console.log(`[Step 4b] Found Domain Specialist agent:`, domainSpecialistAgent.name);
        
        // Collect all domain scan items (one per domain per goal)
        const allDomainScanItems: any[] = [];
        console.log(`[Step 4b] Preparing domain scan items...`);
        
        Object.entries(filteredDomainsByGoal).forEach(([goalId, domainData]: [string, any]) => {
          const goal = goals.find((g: any) => g.id === goalId);
          const domains = domainData.research_domains || [];
          
          console.log(`[Step 4b] Goal ${goalId}: Preparing ${domains.length} domain scans`);
          
          domains.forEach((domain: any, idx: number) => {
            const ras = step3Output?.[goalId] || [];
            console.log(`  [${idx + 1}/${domains.length}] ${domain.domain_id}: ${domain.domain_name}`);
            console.log(`    - Relevance: ${domain.relevance_to_goal}`);
            console.log(`    - Expected interventions: ${domain.expected_intervention_count}`);
            console.log(`    - RAs available: ${ras.length}`);

            // ⚡ OPTIMIZATION: Create minimal objects with only needed fields
            const minimalGoal = {
              id: goal.id,
              title: goal.title,
              catastrophe_primary: goal.catastrophe_primary,
              bridge_tags: goal.bridge_tags
            };

            // Truncate Q0 if too long
            const q0Text = steps[0]?.output?.Q0 || '';
            const truncatedQ0 = q0Text.length > 1500 ? q0Text.substring(0, 1500) + '...[truncated]' : q0Text;

            // Minimal RAs with only essential fields
            const minimalRAs = ras.map((ra: any) => ({
              ra_id: ra.ra_id,
              atom_title: ra.atom_title,
              requirement_statement: ra.requirement_statement
            }));

            // Filter bridge_lexicon to only include SPVs referenced by this goal
            const relevantSPVIds = (goal.bridge_tags?.system_properties_required || []).map((sp: any) => sp.spv_id);
            const minimalBridgeLexicon = {
              system_properties: filteredBridgeLexicon.system_properties.filter((spv: any) =>
                relevantSPVIds.includes(spv.id || spv.ID)
              )
            };

            // Log first item's optimization impact
            if (allDomainScanItems.length === 0) {
              const originalSize = JSON.stringify({ Q0_reference: steps[0]?.output?.Q0, target_goal: goal, requirement_atoms: ras, bridge_lexicon: filteredBridgeLexicon }).length;
              const optimizedSize = JSON.stringify({ Q0_reference: truncatedQ0, target_goal: minimalGoal, requirement_atoms: minimalRAs, bridge_lexicon: minimalBridgeLexicon }).length;
              console.log(`    ⚡ Payload size per domain: ${originalSize} → ${optimizedSize} bytes (${((1 - optimizedSize/originalSize) * 100).toFixed(1)}% reduction)`);
              console.log(`    ⚡ SPVs filtered: ${filteredBridgeLexicon.system_properties.length} → ${minimalBridgeLexicon.system_properties.length}`);
            }

            allDomainScanItems.push({
              Q0_reference: truncatedQ0,
              target_goal: minimalGoal,
              requirement_atoms: minimalRAs,
              bridge_lexicon: minimalBridgeLexicon,
              target_domain: domain,
              goal: currentGoal
            });
          });
        });
        
        console.log(`[Step 4b] 📦 Total domain scan items prepared: ${allDomainScanItems.length}`);
        console.log(`[Step 4b] This will execute as ${allDomainScanItems.length} parallel API calls`);
        
        console.log(`[Step 4b] ⏳ Executing ${allDomainScanItems.length} parallel domain scans...`);
        const domainScanStartTime = Date.now();
        
        const domainScanResult = await executeStepBatch(
          stepId,
          domainSpecialistAgent,
          allDomainScanItems,
          controller.signal,
          globalLens,
          { phase: '4b' }
        );
        
        const domainScanDuration = ((Date.now() - domainScanStartTime) / 1000).toFixed(2);
        console.log(`[Step 4b] ✅ Domain scans completed in ${domainScanDuration}s`);
        console.log(`[Step 4b] Batch results:`, {
          successful: domainScanResult.successful,
          failed: domainScanResult.failed,
          total: domainScanResult.batch_results.length,
          avgTimePerScan: `${(parseFloat(domainScanDuration) / allDomainScanItems.length).toFixed(2)}s`
        });
        
        // Organize results by goal and domain
        const domainScansByGoal: Record<string, any> = {};
        let totalSNodes = 0;
        let successfulScans = 0;
        let failedScans = 0;
        
        console.log(`[Step 4b] Processing domain scan results...`);
        
        domainScanResult.batch_results.forEach((result: any, idx: number) => {
          const item = allDomainScanItems[idx];
          const goalId = item.target_goal.id;
          const domainId = item.target_domain.domain_id;
          const domainName = item.target_domain.domain_name;
          
          if (result.success && result.data) {
            if (!domainScansByGoal[goalId]) {
              domainScansByGoal[goalId] = { domains: {} };
            }
            
            domainScansByGoal[goalId].domains[domainId] = result.data;
            const sNodeCount = result.data.scientific_pillars?.length || 0;
            totalSNodes += sNodeCount;
            successfulScans++;
            
            console.log(`[Step 4b] ✓ ${domainId} (${domainName}):`);
            console.log(`  - S-nodes collected: ${sNodeCount}`);
            console.log(`  - Goal: ${goalId}`);
            
            // Log sample S-nodes
            if (sNodeCount > 0) {
              const sNodes = result.data.scientific_pillars || [];
              console.log(`  - Sample interventions:`);
              sNodes.slice(0, 3).forEach((sNode: any, i: number) => {
                console.log(`    ${i + 1}. ${sNode.id}: ${sNode.title}`);
              });
              if (sNodeCount > 3) {
                console.log(`    ... and ${sNodeCount - 3} more`);
              }
            }
          } else {
            failedScans++;
            console.error(`[Step 4b] ✗ ${domainId} (${domainName}): FAILED`);
            console.error(`  - Goal: ${goalId}`);
            console.error(`  - Error:`, result.error || 'Unknown error');
          }
        });
        
        console.log(`[Step 4b] 📊 Phase 2 Summary:`);
        console.log(`  - Total S-nodes collected: ${totalSNodes}`);
        console.log(`  - Successful scans: ${successfulScans}/${allDomainScanItems.length}`);
        console.log(`  - Failed scans: ${failedScans}`);
        console.log(`  - Average S-nodes per domain: ${(totalSNodes / successfulScans).toFixed(1)}`);
        
        // Per-goal breakdown
        Object.entries(domainScansByGoal).forEach(([goalId, data]: [string, any]) => {
          const domainCount = Object.keys(data.domains).length;
          const goalSNodes = Object.values(data.domains).reduce((sum: number, d: any) => 
            sum + (d.scientific_pillars?.length || 0), 0);
          console.log(`  - ${goalId}: ${goalSNodes} S-nodes from ${domainCount} domains`);
        });
        
        // Save Phase 4b results immediately
        updateStep4Phase('phase4b_domain_scans', domainScansByGoal);
        console.log(`[Step 4b] ✅ Phase 2 results saved to store`);

        // ===== FINALIZE OUTPUT (Phase 4c REMOVED - No Deduplication) =====
        console.log(`
----------------------------------------`);
        console.log(`[Step 4] 📊 FINALIZING OUTPUT (No Deduplication)`);
        console.log(`----------------------------------------`);

        // Create final output directly from Phase 4b results (no deduplication)
        const finalOutput: Record<string, any> = {};
        let totalFinalSNodes = 0;

        Object.entries(domainScansByGoal).forEach(([goalId, data]: [string, any]) => {
          const domainScans = data.domains || {};

          // Collect all S-nodes from all domains for this goal
          const allSNodes: any[] = [];
          Object.values(domainScans).forEach((scan: any) => {
            const pillars = scan.scientific_pillars || [];
            allSNodes.push(...pillars);
          });

          finalOutput[goalId] = {
            domain_mapping: domainsByGoal[goalId],
            raw_domain_scans: data,
            scientific_pillars: allSNodes // Direct passthrough - no deduplication
          };

          totalFinalSNodes += allSNodes.length;

          console.log(`[Step 4] Goal ${goalId}:`);
          console.log(`  - S-nodes: ${allSNodes.length}`);
          console.log(`  - Domains: ${Object.keys(domainScans).length}`);
        });

        console.log(`
========================================`);
        console.log(`[Step 4] 🎉 2-PHASE COLLECTION COMPLETE!`);
        console.log(`========================================`);
        console.log(`[Step 4] 📊 Final Summary:`);
        console.log(`  - Total S-nodes: ${totalFinalSNodes}`);
        console.log(`  - Goals processed: ${Object.keys(finalOutput).length}/${goals.length}`);
        console.log(`  - Domains mapped: ${totalDomainsIdentified}`);
        console.log(`  - Domain scans executed: ${allDomainScanItems.length}`);
        console.log(`  - Deduplication: SKIPPED (as requested)`);
        console.log(`========================================\n`);

        // Mark as completed
        updateStepStatus(stepId, 'completed', finalOutput);
        console.log(`[Step 4] ✅ Status updated to 'completed'`);
        console.log(`[Step 4] ✅ Output contains ${Object.keys(finalOutput).length} goals`);
        return;
      }

      // Default: single execution for other steps
      const result = await executeStep({
        stepId,
        agentConfig: agent,
        input,
        signal: controller.signal,
        globalLens
      });

      console.log(`Step ${stepId} result:`, result);
      console.log(`Step ${stepId} result keys:`, Object.keys(result || {}));
      console.log(`Step ${stepId} result type:`, typeof result);
      
      // Ensure we have valid data
      if (!result || typeof result !== 'object') {
        console.error(`Step ${stepId} returned invalid result:`, result);
        updateStepStatus(stepId, 'error', null, 'Invalid response from server');
        cleanupAbortController(stepId);
        return;
      }
      
      updateStepStatus(stepId, 'completed', result);
      console.log(`Step ${stepId} status updated to completed`);
      cleanupAbortController(stepId);
    } catch (error: any) {
      // Check if it was aborted
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        updateStepStatus(stepId, 'pending');
      } else {
        updateStepStatus(stepId, 'error', null, error.message || 'Unknown error occurred');
      }
      cleanupAbortController(stepId);
    }
  };

  const handleAbortStep = (stepId: number) => {
    abortStep(stepId);
    updateStepStatus(stepId, 'pending');
  };

  // Run specific Step 4 phase
  const handleRunStep4Phase = async (phase: '4a' | '4b' | '4c') => {
    const step = steps.find(s => s.id === 4);
    if (!step) return;

    const step2Output = steps[1]?.output;
    const step3Output = steps[2]?.output;
    let goals = step2Output?.goals || [];
    const bridgeLexicon = step2Output?.bridge_lexicon || {};
    const filteredBridgeLexicon = {
      system_properties: bridgeLexicon.system_properties || []
    };

    // Filter to single goal if selected
    if (selectedGoalId) {
      goals = goals.filter((g: any) => g.id === selectedGoalId);
      if (goals.length === 0) {
        alert(`Selected goal ${selectedGoalId} not found`);
        return;
      }
    }

    if (goals.length === 0) {
      alert('No Goal Pillars found from Step 2');
      return;
    }

    const _controller = createAbortController(4); // Created but not used in current phase logic

    try {
      if (phase === '4a') {
        // Run Phase 4a: Domain Mapping
        console.log(`[Step 4a] 🗺️ Running Phase 1: DOMAIN MAPPING`);
        updateStepStatus(4, 'running', { phase: '4a_domain_mapping', progress: 0 });

        const domainMapperAgent = agents.find(a => a.id === 'agent-domain-mapper');
        if (!domainMapperAgent) {
          alert('Domain Mapper agent not found');
          return;
        }

        const domainMappingItems = goals.map((goal: any) => ({
          Q0_reference: steps[0]?.output?.Q0,
          target_goal: goal,
          requirement_atoms: step3Output?.[goal.id] || [],
          bridge_lexicon: filteredBridgeLexicon,
          goal: currentGoal
        }));

        const domainMappingResult = await executeStepBatch(
          4,
          domainMapperAgent,
          domainMappingItems,
          undefined,
          globalLens,
          { phase: '4a' }
        );

        const domainsByGoal: Record<string, any> = {};
        domainMappingResult.batch_results.forEach((result: any, idx: number) => {
          if (result.success && result.data) {
            domainsByGoal[goals[idx].id] = result.data;
          }
        });

        updateStep4Phase('phase4a_domain_mapping', domainsByGoal);
        updateStepStatus(4, 'running', { phase: '4a_complete', progress: 50 });
        alert(`Phase 4a completed! ${Object.keys(domainsByGoal).length} goals mapped to research domains.`);

      } else if (phase === '4b') {
        // Run Phase 4b: Domain Scans
        const domainsByGoal = step.step4Phases?.phase4a_domain_mapping;
        if (!domainsByGoal) {
          alert('Phase 4a must be completed first');
          return;
        }

        console.log(`[Step 4b] 🔬 Running Phase 2: DOMAIN-SPECIFIC SCANS`);
        updateStepStatus(4, 'running', { phase: '4b_domain_scans', progress: 50 });

        const domainSpecialistAgent = agents.find(a => a.id === 'agent-biologist');
        if (!domainSpecialistAgent) {
          alert('Domain Specialist agent not found');
          return;
        }

        const allDomainScanItems: any[] = [];
        Object.entries(domainsByGoal).forEach(([goalId, domainData]: [string, any]) => {
          const goal = goals.find((g: any) => g.id === goalId);
          const domains = domainData.research_domains || [];
          
          domains.forEach((domain: any) => {
            allDomainScanItems.push({
              Q0_reference: steps[0]?.output?.Q0,
              target_goal: goal,
              requirement_atoms: step3Output?.[goalId] || [],
              bridge_lexicon: filteredBridgeLexicon,
              target_domain: domain,
              goal: currentGoal
            });
          });
        });

        const domainScanResult = await executeStepBatch(
          4,
          domainSpecialistAgent,
          allDomainScanItems,
          undefined,
          globalLens,
          { phase: '4b' }
        );

        const domainScansByGoal: Record<string, any> = {};
        domainScanResult.batch_results.forEach((result: any, idx: number) => {
          const item = allDomainScanItems[idx];
          const goalId = item.target_goal.id;
          const domainId = item.target_domain.domain_id;
          
          if (result.success && result.data) {
            if (!domainScansByGoal[goalId]) {
              domainScansByGoal[goalId] = { domains: {} };
            }
            domainScansByGoal[goalId].domains[domainId] = result.data;
          }
        });

        updateStep4Phase('phase4b_domain_scans', domainScansByGoal);
        updateStepStatus(4, 'running', { phase: '4b_complete', progress: 100 });
        alert(`Phase 4b completed! ${domainScanResult.successful} domain scans completed.`);

      }
      // Phase 4c REMOVED - No longer needed (no deduplication)

      cleanupAbortController(4);
    } catch (error: any) {
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        updateStepStatus(4, 'running');
      } else {
        alert(`Error in Phase ${phase}: ${error.message}`);
      }
      cleanupAbortController(4);
    }
  };

  // Run pipeline for a single goal only
  const handleRunStepForSingleGoal = async (stepId: number, goalId: string) => {
    const step = steps.find(s => s.id === stepId);
    if (!step) return;

    const agent = agents.find(a => a.id === step.agentId);
    if (!agent || !agent.enabled) {
      alert('Agent is disabled');
      return;
    }

    const step2Output = steps[1]?.output;
    const goals = step2Output?.goals || [];
    const targetGoal = goals.find((g: any) => g.id === goalId);
    
    if (!targetGoal) {
      alert(`Goal ${goalId} not found`);
      return;
    }

    updateStepStatus(stepId, 'running');
    const controller = createAbortController(stepId);

    try {
      const bridgeLexicon = step2Output?.bridge_lexicon || {};
      const allSPVs = bridgeLexicon.system_properties || [];

      // Filter SPVs for this specific goal
      const requiredSPVIds = (targetGoal.bridge_tags?.system_properties_required || [])
        .map((sp: any) => sp.spv_id);
      const filteredSPVs = allSPVs.filter((spv: any) => 
        requiredSPVIds.includes(spv.id || spv.ID)
      );

      let result: any;

      // STEP 3: Single goal RA generation
      if (stepId === 3) {
        const input = {
          goal_pillar: targetGoal,
          step1: steps[0]?.output,
          step2: { bridge_lexicon: bridgeLexicon },
          goal: currentGoal
        };

        result = await executeStep({
          stepId,
          agentConfig: agent,
          input,
          signal: controller.signal
        });

        // Merge with existing RAs
        const existingRAs = steps[2]?.output || {};
        const updatedRAs = {
          ...existingRAs,
          [goalId]: result.requirement_atoms || result.RAs || []
        };
        
        updateStepStatus(stepId, 'completed', updatedRAs);
        alert(`Generated RAs for goal ${goalId}`);
      }
      
      // STEP 5: DISABLED - Judge agent disabled, function integrated into Step 4b
      else if (stepId === 5) {
        console.log(`[Step 5] ⚠️  Step 5 (Judge) is DISABLED - relationship assessment integrated into Step 4b`);
        updateStepStatus(stepId, 'skipped', null, 'Step 5 Judge disabled - relationship assessment now in Step 4b');
        return;
      }
      
      // STEP 6: Single goal L3 generation
      else if (stepId === 6) {
        const input = {
          goal_pillar: targetGoal,
          step2: { bridge_lexicon: { system_properties: filteredSPVs } },
          step3: steps[2]?.output,
          step4: steps[3]?.output, // Use Step 4 (has relationship assessments, replaces Step 5)
          goal: currentGoal
        };

        result = await executeStep({
          stepId,
          agentConfig: agent,
          input,
          signal: controller.signal
        });

        // Merge with existing L3s
        const existingL3s = steps[5]?.output?.l3_questions || [];
        const newL3s = result.l3_questions || result.seed_questions || [];
        const updatedL3s = [...existingL3s, ...newL3s];
        
        updateStepStatus(stepId, 'completed', {
          l3_questions: updatedL3s,
          batch_summary: {
            goals_processed: (steps[5]?.output?.batch_summary?.goals_processed || 0) + 1,
            l3_generated: updatedL3s.length,
            successful: (steps[5]?.output?.batch_summary?.successful || 0) + 1,
            failed: steps[5]?.output?.batch_summary?.failed || 0
          }
        });
        alert(`Generated ${newL3s.length} L3 questions for goal ${goalId}`);
      }
      
      else {
        alert(`Single-goal execution not supported for step ${stepId}`);
      }

      cleanupAbortController(stepId);
    } catch (error: any) {
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        updateStepStatus(stepId, 'pending');
      } else {
        updateStepStatus(stepId, 'error', null, error.message || 'Unknown error occurred');
      }
      cleanupAbortController(stepId);
    }
  };

  // Save inputs and outputs for verification
  const handleSaveInputsOutputs = () => {
    const checkData: any = {
      timestamp: new Date().toISOString(),
      goal: currentGoal,
      steps: {}
    };

    steps.forEach(step => {
      if (step.output) {
        const stepData: any = {
          id: step.id,
          name: step.name,
          status: step.status,
          output: step.output
        };

        // Add input reconstruction for each step
        if (step.id === 1) {
          stepData.input = currentGoal;
        } else if (step.id === 2) {
          stepData.input = {
            goal: currentGoal,
            step1: steps[0]?.output
          };
        } else if (step.id === 3) {
          const step2Output = steps[1]?.output;
          const goals = step2Output?.goals || [];
          const bridgeLexicon = step2Output?.bridge_lexicon || {};
          stepData.input_per_goal = goals.map((goal: any) => ({
            goal_pillar: goal,
            step1: steps[0]?.output,
            step2: { bridge_lexicon: bridgeLexicon },
            goal: currentGoal
          }));
        } else if (step.id === 4) {
          const step2Output = steps[1]?.output;
          const step3Output = steps[2]?.output;
          const bridgeLexicon = step2Output?.bridge_lexicon || {};
          
          // Filter goals and RAs if single goal selected
          let goals = step2Output?.goals || [];
          let filteredStep3 = step3Output;
          
          if (selectedGoalId) {
            goals = goals.filter((g: any) => g.id === selectedGoalId);
            if (step3Output && typeof step3Output === 'object') {
              filteredStep3 = { [selectedGoalId]: step3Output[selectedGoalId] || [] };
            }
          }
          
          stepData.input = {
            goal: currentGoal,
            step1: steps[0]?.output,
            step2: {
              goals: goals,
              bridge_lexicon: {
                system_properties: bridgeLexicon.system_properties || []
              }
            },
            step3: filteredStep3
          };
        } else if (step.id === 5) {
          const step2Output = steps[1]?.output;
          const goals = step2Output?.goals || [];
          const bridgeLexicon = step2Output?.bridge_lexicon || {};
          const allSPVs = bridgeLexicon.system_properties || [];
          stepData.input_per_goal = goals.map((goal: any) => {
            const enrichedGoal = enrichGoalWithSPVs(goal, allSPVs);
            return {
              goal_pillar: enrichedGoal,
              step3: steps[2]?.output,
              step4: steps[3]?.output,
              goal: currentGoal
            };
          });
        } else if (step.id === 6) {
          const step2Output = steps[1]?.output;
          const goals = step2Output?.goals || [];
          const bridgeLexicon = step2Output?.bridge_lexicon || {};
          const allSPVs = bridgeLexicon.system_properties || [];
          stepData.input_per_goal = goals.map((goal: any) => {
            const enrichedGoal = enrichGoalWithSPVs(goal, allSPVs);
            return {
              goal_pillar: enrichedGoal,
              step3: steps[2]?.output,
              step5: steps[4]?.output,
              goal: currentGoal
            };
          });
        } else if (step.id === 7) {
          const step6Output = steps[5]?.output;
          const l3Questions = step6Output?.l3_questions || [];
          const step2Output = steps[1]?.output;
          const goals = step2Output?.goals || [];
          const bridgeLexicon = step2Output?.bridge_lexicon || {};
          const allSPVs = bridgeLexicon.system_properties || [];
          stepData.input_per_l3 = l3Questions.map((l3q: any) => {
            const parentGoal = goals.find((g: any) => g.id === l3q.parent_goal_id);
            const enrichedParentGoal = parentGoal ? enrichGoalWithSPVs(parentGoal, allSPVs) : null;
            return {
              l3_question: l3q,
              parent_goal: enrichedParentGoal,
              step3: steps[2]?.output,
              step5: steps[4]?.output,
              goal: currentGoal
            };
          });
        } else if (step.id === 8) {
          const step6Output = steps[5]?.output;
          const l3Questions = step6Output?.l3_questions || [];
          const step2Output = steps[1]?.output;
          const goals = step2Output?.goals || [];
          const bridgeLexicon = step2Output?.bridge_lexicon || {};
          const allSPVs = bridgeLexicon.system_properties || [];
          stepData.input_per_l3 = l3Questions.map((l3q: any) => {
            const parentGoal = goals.find((g: any) => g.id === l3q.parent_goal_id);
            const enrichedParentGoal = parentGoal ? enrichGoalWithSPVs(parentGoal, allSPVs) : null;
            return {
              l3_question: l3q,
              parent_goal: enrichedParentGoal,
              step3: steps[2]?.output,
              step7: steps[6]?.output,
              step5: steps[4]?.output,
              goal: currentGoal
            };
          });
        } else if (step.id === 9) {
          const step8Output = steps[7]?.output;
          const l4Questions = step8Output?.l4_questions || [];
          stepData.input_per_l4 = l4Questions.map((l4q: any) => ({
            l4_question: l4q,
            step3: steps[2]?.output,
            step5: steps[4]?.output,
            goal: currentGoal
          }));
        }

        checkData.steps[`step${step.id}`] = stepData;
      }
    });

    const blob = new Blob([JSON.stringify(checkData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `check_inputs_outputs_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveToFile = () => {
    const data = {
      goal: currentGoal,
      timestamp: new Date().toISOString(),
      steps: steps.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        output: s.output,
        timestamp: s.timestamp
      })),
      agents: agents
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `omega-point-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Session management
  const { initialize: initSessions, updateActiveSessionMeta, saveCurrentToSession } = useSessionStore();

  useEffect(() => {
    initSessions();
  }, []);

  // Auto-save session meta when goal changes
  useEffect(() => {
    if (currentGoal) {
      updateActiveSessionMeta(currentGoal);
    }
  }, [currentGoal]);

  // Auto-save session data periodically and on unload
  useEffect(() => {
    const interval = setInterval(() => {
      saveCurrentToSession();
    }, 30000); // every 30 seconds

    const handleBeforeUnload = () => {
      saveCurrentToSession();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveCurrentToSession]);

  const enabledAgents = agents.filter(agent => agent.enabled);
  const teamPower = enabledAgents.reduce((sum) => sum + 100, 0);

  return (
    <div className="min-h-screen bg-background text-foreground overflow-hidden">
      <ParticleBackground />
      
      {/* Header */}
      <header className="relative z-20 border-b border-primary/30 bg-card/80 backdrop-blur-md shadow-[0_0_30px_rgba(34,197,94,0.1)]">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg neon-border">
                <Shield className="w-6 h-6 text-background" />
              </div>
              <div className="absolute inset-0 rounded-xl blur-xl glow-pulse -z-10" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <span className="neon-text">OMEGA</span>
                <span className="gradient-text">POINT</span>
                <span className="text-[10px] px-2 py-0.5 rounded neon-border text-primary font-mono">v3.0</span>
              </h1>
              <p className="text-[11px] text-muted-foreground uppercase tracking-widest">
                Ontological Mapping & Epistemic Generation Agents
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <SessionSwitcher />
            <div className="hidden md:flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary/30 neon-border">
              <Zap className="w-4 h-4 text-primary" />
              <span className="text-sm font-mono neon-text">{teamPower}</span>
              <span className="text-[10px] text-muted-foreground">Team Power</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-primary glow-pulse" />
              <span className="hidden sm:inline neon-text text-xs">System Online</span>
            </div>
          </div>
        </div>
      </header>

      <div className="relative z-10 container mx-auto p-6">

        {/* Goal Input */}
        <Card className="mb-6 neon-border bg-card/50 backdrop-blur-sm shadow-[0_0_30px_rgba(34,197,94,0.1)]">
          <CardHeader className="border-b border-primary/20 bg-gradient-to-r from-primary/10 via-transparent to-accent/10 pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider flex items-center gap-2 text-primary">
              <Target size={16} className="text-primary" />
              Primary Objective
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              <div className="flex gap-3">
                <Input
                  placeholder="Define your longevity research objective or master question (Q₀)..."
                  value={currentGoal}
                  onChange={(e) => setGoal(e.target.value)}
                  className="flex-1 bg-secondary/30 border-primary/30 focus:border-primary focus:ring-primary/30 transition-all focus:shadow-[0_0_15px_rgba(34,197,94,0.2)]"
                />
              <Button
                onClick={() => handleRunStep(1)}
                disabled={!currentGoal || steps[0].status === 'running' || steps[0].status === 'completed'}
                className="bg-gradient-to-r from-primary to-accent hover:shadow-[0_0_30px_rgba(34,197,94,0.5)] transition-all neon-border"
              >
                <Play size={16} className="mr-1" />
                Start
              </Button>
              <Button
                onClick={() => {
                  saveVersion();
                  alert('Version saved successfully!');
                }}
                disabled={!currentGoal || steps.every(s => s.status === 'pending')}
                className="bg-gradient-to-r from-primary to-primary/80 hover:shadow-[0_0_30px_rgba(34,197,94,0.4)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                title={!currentGoal ? 'Enter a goal first' : steps.every(s => s.status === 'pending') ? 'Run at least one step first' : 'Save current state as a version'}
              >
                <Save size={16} className="mr-2" />
                Save
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  handleSaveToFile();
                  alert('Results saved to file successfully!');
                }}
                disabled={!currentGoal || steps.every(s => s.status === 'pending')}
                className="neon-border text-primary hover:bg-primary/10 hover:shadow-[0_0_20px_rgba(34,197,94,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:border-muted"
                title={!currentGoal ? 'Enter a goal first' : steps.every(s => s.status === 'pending') ? 'Run at least one step first' : 'Download all results as JSON'}
              >
                <Download className="w-4 h-4 mr-2" />
                Save Results
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  handleSaveInputsOutputs();
                  alert('Input/Output check file saved successfully!');
                }}
                disabled={!currentGoal || steps.every(s => s.status === 'pending')}
                className="neon-border text-accent hover:bg-accent/10 hover:shadow-[0_0_20px_rgba(6,182,212,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:border-muted"
                title={!currentGoal ? 'Enter a goal first' : steps.every(s => s.status === 'pending') ? 'Run at least one step first' : 'Save inputs and outputs for verification'}
              >
                <Download className="w-4 h-4 mr-2" />
                Check I/O
              </Button>
              <Button
                variant="outline"
                onClick={() => resetPipeline()}
                className="border-border/50 hover:bg-secondary/50 hover:border-primary/30"
              >
                Reset
              </Button>
              </div>
              
              {/* Global Lens Selector */}
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
                  Epistemic Lens (Optional)
                </label>
                <select
                  value={globalLens}
                  onChange={(e) => setGlobalLens(e.target.value)}
                  className="w-full bg-secondary/30 border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary/30 transition-all"
                >
                  <option value="">No lens selected (agents will use their defaults)</option>
                  <option value="Distributed Consensus Architecture. View Homo sapiens as a multi-agent system where health is a 'collective agreement' between subsystems. Aging is not 'breaking,' it is 'de-synchronization' or 'loss of consensus' where individual parts stop following the global protocol.">
                    Distributed Consensus Architecture
                  </option>
                  <option value="Information Theory & Error Correction. View aging as progressive accumulation of errors in biological information processing, storage, and transmission. Health is high-fidelity information flow; aging is rising noise and corrupted signals.">
                    Information Theory & Error Correction
                  </option>
                  <option value="Complex Adaptive Systems. View the organism as a network of interacting agents with emergent properties. Aging is loss of network robustness, reduced adaptability, and failure of distributed coordination.">
                    Complex Adaptive Systems
                  </option>
                  <option value="Reliability Engineering. View the body as a mission-critical system with redundancy, fault tolerance, and graceful degradation. Aging is the progressive loss of safety margins and backup systems.">
                    Reliability Engineering
                  </option>
                  <option value="Cybernetic Control Systems. View health as stable homeostatic regulation via feedback loops. Aging is drift in setpoints, degraded sensor accuracy, and weakened actuator response.">
                    Cybernetic Control Systems
                  </option>
                </select>
                {globalLens && (
                  <p className="text-xs text-muted-foreground mt-1.5 italic">
                    {globalLens}
                  </p>
                )}
              </div>
            </div>
            {!currentGoal && (
              <p className="text-xs text-primary/80 mt-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary glow-pulse" />
                Please enter a goal to begin the pipeline
              </p>
            )}
          </CardContent>
        </Card>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-card/50 backdrop-blur-sm rounded-xl p-2 shadow-lg neon-border">
          <button
            onClick={() => setActiveTab('agents')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'agents'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <Users size={18} />
            Agent Team ({agents.filter(a => a.enabled).length}/{agents.length})
          </button>
          <button
            onClick={() => setActiveTab('split')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'split'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <LayoutGrid size={18} />
            Split View
          </button>
          <button
            onClick={() => setActiveTab('pipeline')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'pipeline'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <GitBranch size={18} />
            Pipeline
          </button>
          <button
            onClick={() => setActiveTab('graph')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'graph'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <Network size={18} />
            Graph View
          </button>
          <button
            onClick={() => setActiveTab('scientific')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'scientific'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <Network size={18} />
            Scientific Pillars
          </button>
          <button
            onClick={() => setActiveTab('versions')}
            className={`px-6 py-3 font-semibold rounded-lg transition-all flex items-center gap-2 ${
              activeTab === 'versions'
                ? 'bg-gradient-to-r from-primary to-accent text-background shadow-[0_0_30px_rgba(34,197,94,0.5)] neon-border'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-primary hover:border-primary/30 border border-transparent'
            }`}
          >
            <History size={18} />
            Versions ({versions.length})
          </button>
        </div>

        {/* Content */}
        {activeTab === 'split' && (
          <div ref={containerRef} className="flex gap-0 h-[800px] relative">
            <div 
              style={{ width: `${splitRatio}%` }}
              className="overflow-auto bg-card/50 backdrop-blur-sm rounded-l-lg shadow-lg border border-border/30 p-4 select-text"
            >
              <h2 className="text-lg font-bold mb-4 gradient-text">Pipeline Steps</h2>
              
              {/* Single Goal Selector */}
              {steps[1]?.output?.goals && steps[1].output.goals.length > 0 && (
                <Card className="mb-4 bg-primary/5 border-primary/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Run for Single Goal
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <select
                      value={selectedGoalId || ''}
                      onChange={(e) => setSelectedGoalId(e.target.value || null)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
                    >
                      <option value="">🌐 All Goals (Batch Mode)</option>
                      {steps[1].output.goals.map((goal: any) => (
                        <option key={goal.id} value={goal.id}>
                          🎯 {goal.id}: {goal.title}
                        </option>
                      ))}
                    </select>
                    {selectedGoalId ? (
                      <>
                        <div className="text-xs text-primary font-semibold flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-primary glow-pulse" />
                          Single Goal Mode: {selectedGoalId}
                        </div>
                        {(() => {
                          const selectedGoal = steps[1].output.goals.find((g: any) => g.id === selectedGoalId);
                          return selectedGoal ? (
                            <div className="mt-2 p-3 bg-background/50 border border-primary/20 rounded text-xs space-y-1 max-h-48 overflow-y-auto">
                              <div className="font-semibold text-primary mb-2">📋 Goal Properties:</div>
                              <div><span className="text-muted-foreground">ID:</span> <span className="text-foreground font-mono">{selectedGoal.id}</span></div>
                              <div><span className="text-muted-foreground">Title:</span> <span className="text-foreground">{selectedGoal.title}</span></div>
                              {selectedGoal.state_definition && (
                                <div><span className="text-muted-foreground">State:</span> <span className="text-foreground">{selectedGoal.state_definition.substring(0, 150)}...</span></div>
                              )}
                              {selectedGoal.catastrophe_primary && (
                                <div><span className="text-muted-foreground">Catastrophe:</span> <span className="text-foreground">{selectedGoal.catastrophe_primary}</span></div>
                              )}
                              {selectedGoal.bridge_tags?.failure_channels && (
                                <div><span className="text-muted-foreground">FCCs:</span> <span className="text-foreground">{selectedGoal.bridge_tags.failure_channels.join(', ')}</span></div>
                              )}
                              {selectedGoal.bridge_tags?.system_properties_required && (
                                <div><span className="text-muted-foreground">SPVs:</span> <span className="text-foreground">{selectedGoal.bridge_tags.system_properties_required.map((sp: any) => sp.spv_id).join(', ')}</span></div>
                              )}
                            </div>
                          ) : null;
                        })()}
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                        Batch Mode: All {steps[1].output.goals.length} goals will be processed
                      </div>
                    )}
                    {selectedGoalId && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRunStepForSingleGoal(3, selectedGoalId)}
                          disabled={steps[2]?.status === 'running'}
                          className="flex-1"
                        >
                          Step 3 (RAs)
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRunStepForSingleGoal(5, selectedGoalId)}
                          disabled={steps[4]?.status === 'running'}
                          className="flex-1"
                        >
                          Step 5 (Match)
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRunStepForSingleGoal(6, selectedGoalId)}
                          disabled={steps[5]?.status === 'running'}
                          className="flex-1"
                        >
                          Step 6 (L3)
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* L3 Question Selection */}
              {steps[5]?.output?.l3_questions && steps[5].output.l3_questions.length > 0 && (
                <Card className="mb-4 bg-accent/5 border-accent/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Zap className="w-4 h-4" />
                      Run for Single L3 Question
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <select
                      value={selectedL3Id || ''}
                      onChange={(e) => setSelectedL3Id(e.target.value || null)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
                    >
                      <option value="">🌐 All L3 Questions (Batch Mode)</option>
                      {steps[5].output.l3_questions.map((l3: any) => (
                        <option key={l3.id} value={l3.id}>
                          ❓ {l3.id}: {l3.text?.substring(0, 60)}...
                        </option>
                      ))}
                    </select>
                    {selectedL3Id ? (
                      <>
                        <div className="text-xs text-accent font-semibold flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-accent glow-pulse" />
                          Single L3 Mode: {selectedL3Id}
                        </div>
                        {(() => {
                          const selectedL3 = steps[5].output.l3_questions.find((l3: any) => l3.id === selectedL3Id);
                          return selectedL3 ? (
                            <div className="mt-2 p-3 bg-background/50 border border-accent/20 rounded text-xs space-y-1 max-h-48 overflow-y-auto">
                              <div className="font-semibold text-accent mb-2">❓ L3 Question Properties:</div>
                              <div><span className="text-muted-foreground">ID:</span> <span className="text-foreground font-mono">{selectedL3.id}</span></div>
                              <div><span className="text-muted-foreground">Text:</span> <span className="text-foreground">{selectedL3.text}</span></div>
                              {selectedL3.parent_goal_id && (
                                <div><span className="text-muted-foreground">Parent Goal:</span> <span className="text-foreground font-mono">{selectedL3.parent_goal_id}</span></div>
                              )}
                              {selectedL3.strategy_used && (
                                <div><span className="text-muted-foreground">Strategy:</span> <span className="text-foreground">{selectedL3.strategy_used}</span></div>
                              )}
                              {selectedL3.rationale && (
                                <div><span className="text-muted-foreground">Rationale:</span> <span className="text-foreground">{selectedL3.rationale.substring(0, 150)}...</span></div>
                              )}
                              {selectedL3.discriminator_target && (
                                <div><span className="text-muted-foreground">Target:</span> <span className="text-foreground">{selectedL3.discriminator_target}</span></div>
                              )}
                            </div>
                          ) : null;
                        })()}
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                        Batch Mode: All {steps[5].output.l3_questions.length} L3 questions
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* L4 Question Selection */}
              {steps[7]?.output?.l4_questions && steps[7].output.l4_questions.length > 0 && (
                <Card className="mb-4 bg-secondary/5 border-secondary/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Network className="w-4 h-4" />
                      Run for Single L4 Question
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <select
                      value={selectedL4Id || ''}
                      onChange={(e) => setSelectedL4Id(e.target.value || null)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm"
                    >
                      <option value="">🌐 All L4 Questions (Batch Mode)</option>
                      {steps[7].output.l4_questions.map((l4: any) => (
                        <option key={l4.id} value={l4.id}>
                          🔍 {l4.id}: {l4.text?.substring(0, 60)}...
                        </option>
                      ))}
                    </select>
                    {selectedL4Id ? (
                      <>
                        <div className="text-xs text-secondary font-semibold flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-secondary glow-pulse" />
                          Single L4 Mode: {selectedL4Id}
                        </div>
                        {(() => {
                          const selectedL4 = steps[7].output.l4_questions.find((l4: any) => l4.id === selectedL4Id);
                          return selectedL4 ? (
                            <div className="mt-2 p-3 bg-background/50 border border-secondary/20 rounded text-xs space-y-1 max-h-48 overflow-y-auto">
                              <div className="font-semibold text-secondary mb-2">🔍 L4 Question Properties:</div>
                              <div><span className="text-muted-foreground">ID:</span> <span className="text-foreground font-mono">{selectedL4.id}</span></div>
                              <div><span className="text-muted-foreground">Text:</span> <span className="text-foreground">{selectedL4.text}</span></div>
                              {selectedL4.parent_l3_id && (
                                <div><span className="text-muted-foreground">Parent L3:</span> <span className="text-foreground font-mono">{selectedL4.parent_l3_id}</span></div>
                              )}
                              {selectedL4.type && (
                                <div><span className="text-muted-foreground">Type:</span> <span className="text-foreground">{selectedL4.type}</span></div>
                              )}
                              {selectedL4.lens && (
                                <div><span className="text-muted-foreground">Lens:</span> <span className="text-foreground">{selectedL4.lens}</span></div>
                              )}
                              {selectedL4.distinguishes_ih_ids && selectedL4.distinguishes_ih_ids.length > 0 && (
                                <div><span className="text-muted-foreground">Distinguishes IHs:</span> <span className="text-foreground font-mono">{selectedL4.distinguishes_ih_ids.join(', ')}</span></div>
                              )}
                              {selectedL4.rationale && (
                                <div><span className="text-muted-foreground">Rationale:</span> <span className="text-foreground">{selectedL4.rationale.substring(0, 150)}...</span></div>
                              )}
                            </div>
                          ) : null;
                        })()}
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-muted-foreground" />
                        Batch Mode: All {steps[7].output.l4_questions.length} L4 questions
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              
              <PipelineView
                steps={steps}
                agents={agents}
                onRunStep={handleRunStep}
                onSkipStep={skipStep}
                onClearStep={clearStep}
                onAbortStep={handleAbortStep}
                onRunStep4Phase={handleRunStep4Phase}
              />
            </div>
            
            {/* Resizable Divider */}
            <div
              className={`w-2 bg-border/50 hover:bg-primary/50 cursor-col-resize relative group flex-shrink-0 ${
                isDragging ? 'bg-primary' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsDragging(true);
                
                const container = containerRef.current;
                if (!container) return;
                
                const containerRect = container.getBoundingClientRect();
                
                const handleMouseMove = (moveEvent: MouseEvent) => {
                  moveEvent.preventDefault();
                  
                  const containerWidth = containerRect.width;
                  const mouseX = moveEvent.clientX - containerRect.left;
                  const newRatio = (mouseX / containerWidth) * 100;
                  
                  // Constrain between 20% and 70%
                  const constrainedRatio = Math.min(Math.max(newRatio, 20), 70);
                  setSplitRatio(constrainedRatio);
                };
                
                const handleMouseUp = () => {
                  setIsDragging(false);
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                  document.body.style.cursor = '';
                  document.body.style.userSelect = '';
                };
                
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            >
              <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary/20 transition-colors" />
            </div>
            
            <div 
              style={{ width: `${100 - splitRatio}%` }}
              className="bg-card/50 backdrop-blur-sm rounded-r-lg shadow-lg border border-border/30 select-text"
            >
              <div className="flex items-center justify-between p-4 border-b border-border/30">
                <h2 className="text-lg font-bold gradient-text">Knowledge Graph</h2>
                <button
                  onClick={() => setUseImprovedGraph(!useImprovedGraph)}
                  className="px-3 py-1 text-xs bg-primary/20 hover:bg-primary/30 rounded transition-colors"
                >
                  {useImprovedGraph ? 'Legacy View' : 'Modern View'}
                </button>
              </div>
              <div className="h-[calc(100%-70px)]">
                {useImprovedGraph ? (
                  <GraphVisualizationWrapper steps={steps} />
                ) : (
                  <GraphVisualization steps={steps} />
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'pipeline' && (
          <PipelineView
            steps={steps}
            agents={agents}
            onRunStep={handleRunStep}
            onRunStep4Phase={handleRunStep4Phase}
            onSkipStep={skipStep}
            onClearStep={clearStep}
            onAbortStep={handleAbortStep}
          />
        )}

        {activeTab === 'graph' && (
          <div className="h-[800px] bg-card/50 backdrop-blur-sm rounded-lg shadow-lg border border-border/30 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border/30">
              <h2 className="text-lg font-bold gradient-text">Knowledge Graph</h2>
              <button
                onClick={() => setUseImprovedGraph(!useImprovedGraph)}
                className="px-3 py-1 text-xs bg-primary/20 hover:bg-primary/30 rounded transition-colors"
              >
                {useImprovedGraph ? 'Legacy View' : 'Modern View'}
              </button>
            </div>
            <div className="h-[calc(100%-60px)]">
              {useImprovedGraph ? (
                <GraphVisualizationWrapper steps={steps} />
              ) : (
                <GraphVisualization steps={steps} />
              )}
            </div>
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold gradient-text">Agent Configuration</h2>
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm('Reset all agents to default configuration? This will clear all customizations and cached data.')) {
                    resetToDefaults();
                    window.location.reload();
                  }
                }}
                className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
              >
                <RefreshCw size={16} className="mr-2" />
                Reset to Defaults
              </Button>
            </div>
            <div className="flex flex-col gap-4">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onUpdate={(updates) => updateAgent(agent.id, updates)}
                />
              ))}
            </div>
          </div>
        )}

        {activeTab === 'scientific' && (
          <div className="space-y-4">
            <Card className="bg-card/50 border-border/30">
              <CardHeader>
                <CardTitle className="gradient-text">Scientific Pillars Management</CardTitle>
                <p className="text-sm text-muted-foreground mt-2">
                  Upload a JSON file with predefined scientific pillars to automatically populate Step 4 results.
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Upload Scientific Pillars JSON</label>
                    <input
                      type="file"
                      accept=".json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            try {
                              const json = JSON.parse(event.target?.result as string);
                              
                              // Validate format
                              if (!json.scientific_pillars || !Array.isArray(json.scientific_pillars)) {
                                alert('Invalid format: Missing "scientific_pillars" array');
                                return;
                              }
                              
                              // Check required fields
                              const requiredFields = ['id', 'title', 'capabilities'];
                              const isValid = json.scientific_pillars.every((pillar: any) => 
                                requiredFields.every(field => pillar.hasOwnProperty(field))
                              );
                              
                              if (!isValid) {
                                alert('Invalid format: Each pillar must have id, title, and capabilities');
                                return;
                              }
                              
                              setScientificPillars(json);
                              
                              // Automatically load as Step 4 output
                              updateStepStatus(4, 'completed', json);
                              
                              alert(`Successfully loaded ${json.scientific_pillars.length} scientific pillars!`);
                            } catch (error) {
                              alert('Error parsing JSON: ' + (error as Error).message);
                            }
                          };
                          reader.readAsText(file);
                        }
                      }}
                      className="block w-full text-sm text-muted-foreground
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-lg file:border-0
                        file:text-sm file:font-semibold
                        file:bg-primary/20 file:text-primary
                        hover:file:bg-primary/30 file:cursor-pointer
                        cursor-pointer border border-border/50 rounded-lg"
                    />
                  </div>
                  
                  {scientificPillars && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                      <p className="text-sm text-emerald-400 font-medium mb-2">
                        ✓ Loaded {scientificPillars.scientific_pillars?.length || 0} Scientific Pillars
                      </p>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {scientificPillars.scientific_pillars?.slice(0, 5).map((pillar: any) => (
                          <div key={pillar.id} className="flex items-center gap-2">
                            <span className="text-primary">•</span>
                            <span className="font-mono">{pillar.id}</span>
                            <span>-</span>
                            <span>{pillar.title}</span>
                          </div>
                        ))}
                        {scientificPillars.scientific_pillars?.length > 5 && (
                          <p className="text-muted-foreground/70 italic">
                            ... and {scientificPillars.scientific_pillars.length - 5} more
                          </p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setScientificPillars(null);
                          updateStepStatus(4, 'pending', null);
                        }}
                        className="mt-3 border-rose-500/50 text-rose-400 hover:bg-rose-500/10"
                      >
                        Clear Pillars
                      </Button>
                    </div>
                  )}
                  
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                    <p className="text-sm text-blue-400 font-medium mb-2">Expected JSON Format:</p>
                    <pre className="text-xs text-muted-foreground overflow-x-auto bg-background/50 p-3 rounded">
{`{
  "scientific_pillars": [
    {
      "id": "S_001",
      "title": "Intervention Name",
      "capabilities": [
        {
          "spv_id": "SPV_1",
          "effect_direction": "INCREASE",
          "rationale": "Explanation..."
        }
      ],
      "mechanism": "Description...",
      "verified_effect": "Evidence...",
      ...
    }
  ]
}`}
                    </pre>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'versions' && (
          <div className="space-y-4">
            {/* Load Pipeline JSON */}
            <Card className="bg-card/50 border-border/30">
              <CardHeader>
                <CardTitle className="gradient-text flex items-center gap-2">
                  <Upload size={20} />
                  Load Complete Pipeline
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-2">
                  Upload a complete pipeline JSON file to restore all steps, outputs, and visualize the knowledge graph.
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Upload Pipeline JSON</label>
                    <input
                      type="file"
                      accept=".json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleLoadPipelineJSON(file);
                          e.target.value = ''; // Reset input
                        }
                      }}
                      className="block w-full text-sm text-muted-foreground
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-lg file:border-0
                        file:text-sm file:font-semibold
                        file:bg-primary/20 file:text-primary
                        hover:file:bg-primary/30 file:cursor-pointer
                        cursor-pointer border border-border/50 rounded-lg"
                    />
                  </div>
                  
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                    <p className="text-sm text-blue-400 font-medium mb-2 flex items-center gap-2">
                      <FileJson size={16} />
                      Expected JSON Structure:
                    </p>
                    <pre className="text-xs text-muted-foreground overflow-x-auto bg-background/50 p-3 rounded">
{`{
  "goal": "radical life extension",
  "timestamp": "2026-01-25T20:38:17.321Z",
  "steps": [
    {
      "id": 1,
      "name": "Goal Formalization",
      "status": "completed",
      "output": { ... }
    },
    ...
  ]
}`}
                    </pre>
                  </div>
                  
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                    <p className="text-xs text-amber-400">
                      <strong>Note:</strong> Loading a pipeline will replace your current work. Save your current pipeline first if needed.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {versions.length === 0 ? (
              <Card className="bg-card/50 border-border/30">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-3">
                    <History size={48} className="text-muted-foreground/50" />
                    <p className="text-lg font-medium">No saved versions yet</p>
                    <p className="text-sm">Complete some pipeline steps and click "Save" to create one.</p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-muted-foreground">
                    {versions.length} saved {versions.length === 1 ? 'version' : 'versions'}
                  </p>
                </div>
                {versions.map((version) => (
                  <Card key={version.id} className="group bg-card/50 border-border/30 hover:border-primary/50 hover:shadow-[0_0_30px_rgba(59,130,246,0.2)] transition-all">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <CardTitle className="text-lg gradient-text truncate">{version.goal}</CardTitle>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <History size={12} />
                              {new Date(version.timestamp).toLocaleString()}
                            </span>
                            <span className="flex items-center gap-1">
                              <GitBranch size={12} />
                              {version.steps.filter(s => s.status === 'completed').length}/{version.steps.length} steps
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => loadVersion(version.id)}
                            className="bg-primary/20 hover:bg-primary/30 text-primary border-primary/30 hover:shadow-[0_0_20px_rgba(59,130,246,0.3)]"
                          >
                            <Download size={14} className="mr-1" />
                            Load
                          </Button>
                          <button
                            onClick={() => deleteVersion(version.id)}
                            className="p-2 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Delete version"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex gap-2 flex-wrap">
                        {version.steps.map((step) => (
                          <span
                            key={step.id}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                              step.status === 'completed'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.1)]'
                                : step.status === 'error'
                                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-[0_0_10px_rgba(239,68,68,0.1)]'
                                : step.status === 'running'
                                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse'
                                : 'bg-secondary/50 text-muted-foreground border border-border/30'
                            }`}
                          >
                            {step.status === 'completed' ? '✓' : step.status === 'error' ? '✗' : '○'} Step {step.id}
                          </span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

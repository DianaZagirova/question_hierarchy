from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI
import os
import json
import time
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)

def interpolate_prompt(agent_config):
    """Interpolate placeholders in agent system prompts with actual values"""
    prompt = agent_config['systemPrompt']
    
    # Replace lens placeholder
    if agent_config.get('lens'):
        prompt = re.sub(r'\{\{LENS\}\}', agent_config['lens'], prompt)
        prompt = prompt.replace('[LENS]', agent_config['lens'])  # Legacy support
    
    # Replace selected lens from settings
    if agent_config.get('settings', {}).get('selectedLens'):
        prompt = re.sub(r'\{\{LENS\}\}', agent_config['settings']['selectedLens'], prompt)
    
    # Replace node count placeholders
    if agent_config.get('settings', {}).get('nodeCount'):
        node_count = agent_config['settings']['nodeCount']
        min_count = str(node_count['min'])
        max_count = str(node_count['max'])
        
        # For Goal Pillars
        prompt = re.sub(r'\{\{MIN_GOALS\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_GOALS\}\}', max_count, prompt)
        
        # For Research Domains
        prompt = re.sub(r'\{\{MIN_DOMAINS\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_DOMAINS\}\}', max_count, prompt)
        
        # For L3 Questions
        prompt = re.sub(r'\{\{MIN_L3\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_L3\}\}', max_count, prompt)
        
        # For Instantiation Hypotheses (IH)
        prompt = re.sub(r'\{\{MIN_IH\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_IH\}\}', max_count, prompt)
        
        # For L4 Questions
        prompt = re.sub(r'\{\{MIN_L4\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_L4\}\}', max_count, prompt)
        
        # For L5 Nodes
        prompt = re.sub(r'\{\{MIN_L5\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_L5\}\}', max_count, prompt)
        
        # For Scientific Pillars
        prompt = re.sub(r'\{\{MIN_PILLARS\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_PILLARS\}\}', max_count, prompt)
    
    # Replace any custom parameters
    if agent_config.get('settings', {}).get('customParams'):
        for key, value in agent_config['settings']['customParams'].items():
            placeholder = r'\{\{' + key + r'\}\}'
            prompt = re.sub(placeholder, str(value), prompt)
    
    return prompt

# Initialize OpenAI client
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.now().isoformat()
    })

def execute_single_item(step_id, agent_config, input_data):
    """Execute a single item (helper function for batch processing)"""
    start_time = time.time()
    
    # Prepare the prompt based on step
    user_prompt = prepare_user_prompt(step_id, input_data)

    # Prepare system prompt with interpolated values
    system_prompt = interpolate_prompt(agent_config)
    
    # Add JSON instruction to system prompt (required by OpenAI for json_object mode)
    if "JSON" not in system_prompt and "json" not in system_prompt:
        system_prompt += "\n\nIMPORTANT: You must respond with valid JSON only."

    print(f"[Step {step_id}] Calling OpenAI API with model: {agent_config['model']}")
    
    # Call OpenAI API with performance optimizations
    api_start = time.time()
    completion = client.chat.completions.create(
        model=agent_config['model'],
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=agent_config['temperature'],
        response_format={"type": "json_object"},
        max_tokens=24000,  # Limit response length for faster generation
        timeout=120  # 2 minute timeout to prevent hanging
    )

    api_duration = time.time() - api_start
    response_text = completion.choices[0].message.content
    
    # Log token usage and timing
    usage = completion.usage
    print(f"[Step {step_id}] API call completed in {api_duration:.2f}s")
    print(f"[Step {step_id}] Tokens - Prompt: {usage.prompt_tokens}, Completion: {usage.completion_tokens}, Total: {usage.total_tokens}")

    # Parse JSON response
    try:
        result = json.loads(response_text)
        total_duration = time.time() - start_time
        print(f"[Step {step_id}] Total execution time: {total_duration:.2f}s")
        return result
    except json.JSONDecodeError as parse_error:
        print(f'[Step {step_id}] Failed to parse JSON response: {parse_error}')
        return {'raw_response': response_text, 'parse_error': str(parse_error)}

@app.route('/api/execute-step', methods=['POST'])
def execute_step():
    """Execute a single pipeline step"""
    try:
        data = request.json
        step_id = data.get('stepId')
        agent_config = data.get('agentConfig')
        input_data = data.get('input')

        print(f'\n=== Executing Step {step_id} ===')
        print(f'Agent: {agent_config.get("name")}')
        print(f"User Prompt (truncated): {str(input_data)[:200]}...")

        result = execute_single_item(step_id, agent_config, input_data)
        
        print(f"\nResponse received ({len(str(result))} chars)")
        print(f"Parsed JSON keys: {list(result.keys())}")

        return jsonify(result)

    except Exception as error:
        print(f'Error executing step: {error}')
        error_details = str(error)
        
        # Extract more details from OpenAI errors if available
        if hasattr(error, 'response'):
            try:
                error_details = error.response.text
            except:
                pass
        
        return jsonify({
            'error': str(error),
            'details': error_details
        }), 500

@app.route('/api/execute-step-batch', methods=['POST'])
def execute_step_batch():
    """Execute a step multiple times with different inputs"""
    try:
        data = request.json
        step_id = data.get('stepId')
        agent_config = data.get('agentConfig')
        items = data.get('items', [])
        
        print(f'\n=== Executing Step {step_id} in BATCH mode ===')
        print(f'Agent: {agent_config.get("name")}')
        print(f'Items to process: {len(items)}')
        print(f'Processing in PARALLEL with max 10 workers...')
        
        results = [None] * len(items)  # Pre-allocate results list
        
        # Process items in parallel using ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=10) as executor:
            # Submit all tasks
            future_to_idx = {
                executor.submit(execute_single_item, step_id, agent_config, item): idx 
                for idx, item in enumerate(items)
            }
            
            # Process completed tasks as they finish
            completed = 0
            for future in as_completed(future_to_idx):
                idx = future_to_idx[future]
                completed += 1
                try:
                    result = future.result()
                    results[idx] = {
                        'success': True,
                        'data': result,
                        'item_index': idx
                    }
                    print(f"✓ Item {idx + 1}/{len(items)} completed ({completed}/{len(items)} total)")
                except Exception as item_error:
                    print(f"✗ Item {idx + 1}/{len(items)} failed: {item_error}")
                    results[idx] = {
                        'success': False,
                        'error': str(item_error),
                        'item_index': idx
                    }
        
        successful_count = sum(1 for r in results if r['success'])
        print(f"\n=== Batch Complete: {successful_count}/{len(items)} successful ===")
        
        return jsonify({
            'batch_results': results,
            'total_processed': len(items),
            'successful': successful_count,
            'failed': len(items) - successful_count
        })
    
    except Exception as error:
        print(f'Error in batch execution: {error}')
        return jsonify({
            'error': str(error),
            'details': 'Batch execution failed'
        }), 500

def prepare_user_prompt(step_id, input_data):
    """Prepare user prompt based on step ID and input data"""
    
    # STEP 1: INPUT: Goal from the user | OUTPUT: Q_0 string
    if step_id == 1:
        return f"User Goal: {input_data}"
    
    # STEP 2: INPUT: Q_0 string | OUTPUT: JSON with goal pillars + bridge lexicon
    elif step_id == 2:
        # Extract Q0 from Step 1 output
        q0_text = None
        if isinstance(input_data, dict):
            step1_data = input_data.get('step1', {})
            if isinstance(step1_data, dict):
                # Try different possible keys
                q0_text = step1_data.get('q0') or step1_data.get('text') or step1_data.get('master_question') or step1_data.get('Q0')
            elif isinstance(step1_data, str):
                q0_text = step1_data
            
            # Fallback to original goal
            if not q0_text:
                q0_text = input_data.get('goal', '')
        
        print(f"\nStep 2 Debug: Q0 = {q0_text[:100] if q0_text else 'None'}...")
        return f"Q0: {q0_text}\n\nGenerate the Goal Pillars and Bridge Lexicon."
    
    # STEP 3: INPUT: Q_0 string, G data (one by one) | OUTPUT: JSON with RA for each G
    elif step_id == 3:
        step1_data = input_data.get('step1', {}) if isinstance(input_data, dict) else {}
        
        # Get Q0
        q0_text = step1_data.get('q0') or step1_data.get('Q0') or step1_data.get('text') or input_data.get('goal', '')
        
        # Get the specific goal pillar for this batch item
        goal = input_data.get('goal_pillar', {})
        
        if not goal:
            # Fallback to old behavior (first goal)
            step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
            goals = step2_data.get('goals', [])
            goal = goals[0] if goals else {}
        
        print(f"\nStep 3 Debug: Processing goal {goal.get('id', 'unknown')}")
        
        return f"""Q0: {q0_text}

Goal Pillar:
{json.dumps(goal, indent=2)}

Generate Requirement Atoms for this specific goal pillar."""
    
    # STEP 4: INPUT: Q0, target_goal (G), requirement_atoms (RAs), bridge_lexicon (SPVs) | OUTPUT: JSON with S-Nodes for this specific Goal
    elif step_id == 4:
        # NEW: Direct properties in batch mode
        q0_reference = input_data.get('Q0_reference', '')
        target_goal = input_data.get('target_goal', {})
        requirement_atoms = input_data.get('requirement_atoms', [])
        bridge_lexicon = input_data.get('bridge_lexicon', {})
        
        # Fallback to old structure if new properties not found
        if not bridge_lexicon:
            step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
            bridge_lexicon = step2_data.get('bridge_lexicon', {})
        
        spvs = bridge_lexicon.get('system_properties', [])
        
        print(f"\nStep 4 Debug:")
        print(f"  Q0: {q0_reference[:50] if q0_reference else 'N/A'}...")
        print(f"  Target Goal: {target_goal.get('id', 'N/A')}")
        print(f"  Requirement Atoms: {len(requirement_atoms)}")
        print(f"  SPVs: {len(spvs)}")
        
        return f"""Q0 Reference: {q0_reference}

Target Goal (G):
{json.dumps(target_goal, indent=2)}

Requirement Atoms (RAs) for this Goal:
{json.dumps(requirement_atoms, indent=2)}

Bridge Lexicon (System Property Variables):
{json.dumps(bridge_lexicon, indent=2)}

Generate Scientific Pillars (S-Nodes) for 2026 that are specifically relevant to THIS GOAL and can affect the required system properties."""
    
    elif step_id == 5:  # Strategic Matching (NEW MODE: Evaluate existing G-S links)
        # NEW: Direct properties in batch mode
        goal = input_data.get('goal_pillar', {})
        ras = input_data.get('requirement_atoms', [])
        bridge_lexicon = input_data.get('bridge_lexicon', {})
        scientific_pillars = input_data.get('scientific_toolkit', [])
        
        # Fallback to old structure if new properties not found
        if not goal or not scientific_pillars:
            step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
            step3_data = input_data.get('step3', {}) if isinstance(input_data, dict) else {}
            step4_data = input_data.get('step4', {}) if isinstance(input_data, dict) else {}
            
            if not goal:
                goals = step2_data.get('goals', [])
                goal = goals[0] if goals else {}
            
            if not bridge_lexicon:
                bridge_lexicon = step2_data.get('bridge_lexicon', {})
            
            if not ras:
                goal_id = goal.get('id', '')
                if isinstance(step3_data, dict) and goal_id in step3_data:
                    ras = step3_data[goal_id]
                elif isinstance(step3_data, list):
                    ras = step3_data
            
            if not scientific_pillars:
                scientific_pillars = step4_data.get('scientific_pillars', [])
        
        goal_id = goal.get('id', '')
        
        print(f"\nStep 5 Debug (NEW MODE - Evaluate G-S Links):")
        print(f"  Processing Goal: {goal_id}")
        print(f"  RAs found: {len(ras)}")
        print(f"  Scientific Pillars (S-Nodes for this Goal): {len(scientific_pillars)}")
        print(f"  Bridge Lexicon FCCs: {len(bridge_lexicon.get('failure_channels', []))}")
        print(f"  Bridge Lexicon SPVs: {len(bridge_lexicon.get('system_properties', []))}")
        
        # Determine mode based on whether S-nodes are goal-specific
        mode_hint = "goal_specific" if scientific_pillars else "general_toolkit"
        
        return f"""TARGET GOAL (G):
{json.dumps(goal, indent=2)}

REQUIREMENT ATOMS (RAs) for this Goal:
{json.dumps(ras, indent=2)}

BRIDGE LEXICON (System Property Variables):
{json.dumps(bridge_lexicon, indent=2)}

SCIENTIFIC TOOLKIT (S-Nodes created for THIS GOAL in Step 4):
{json.dumps(scientific_pillars, indent=2)}

MISSION: Evaluate each S-Node above and classify the G-S relationship.
- These S-Nodes were created specifically for Goal {goal_id}
- Validate each link: Does this S-Node genuinely address the Goal's requirements?
- Classify the relationship type (solves, partially_solves, proxies_for, enables_measurement_for, violates)
- Remove invalid links by marking them as "violates"
- Set mode to "{mode_hint}" in your output

Perform strategic evaluation and classification of the G-S links."""
    
    # STEP 6: INPUT: mapping results of step 5 (goal_edge_sets) with G definition, selected S, bridge lexicon
    elif step_id == 6:
        step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
        step4_data = input_data.get('step4', {}) if isinstance(input_data, dict) else {}
        step5_data = input_data.get('step5', {}) if isinstance(input_data, dict) else {}
        
        # Get the specific goal pillar for this batch item
        goal = input_data.get('goal_pillar', {})
        
        if not goal:
            # Fallback to old behavior
            goals = step2_data.get('goals', [])
            goal = goals[0] if goals else {}
        
        goal_id = goal.get('id', '')
        bridge_lexicon = step2_data.get('bridge_lexicon', {})
        scientific_pillars = step4_data.get('scientific_pillars', [])
        
        # Get matching edges for this specific goal
        if goal_id in step5_data:
            matching_edges = step5_data[goal_id].get('edges', [])
        else:
            matching_edges = step5_data.get('edges', [])
        
        print(f"\nStep 6 Debug: Processing Goal {goal_id} with {len(matching_edges)} matching edges")
        
        return f"""CRITICAL: You are generating L3 questions for Goal ID: {goal_id}

ALL L3 question IDs MUST use this exact format: Q_L3_{goal_id}_N
where N is the question number (1, 2, 3, 4, 5).

For example, if the Goal ID is "M_G2", your L3 IDs must be:
- Q_L3_M_G2_1
- Q_L3_M_G2_2
- Q_L3_M_G2_3
- Q_L3_M_G2_4
- Q_L3_M_G2_5

Goal Definition:
{json.dumps(goal, indent=2)}

Bridge Lexicon:
{json.dumps(bridge_lexicon, indent=2)}

Matching Results (Goal-to-Science edges):
{json.dumps(matching_edges, indent=2)}

Selected Scientific Pillars:
{json.dumps(scientific_pillars[:5], indent=2)}

Generate L3 Seed Questions that target the gaps and deltas revealed in the matching.
Remember: Use {goal_id} in ALL L3 question IDs!"""
    
    # STEP 7: INPUT: 1 L3 question + context | OUTPUT: Instantiation Hypotheses
    elif step_id == 7:
        step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
        step3_data = input_data.get('step3', {}) if isinstance(input_data, dict) else {}
        step4_data = input_data.get('step4', {}) if isinstance(input_data, dict) else {}
        step5_data = input_data.get('step5', {}) if isinstance(input_data, dict) else {}
        
        # Check if this is a batch call with single L3 question
        if 'l3_question' in input_data:
            l3_question = input_data['l3_question']
            # For batch processing, we just need the single L3 question
            l3_questions_list = [l3_question]
        else:
            # Fallback to old behavior
            step6_data = input_data.get('step6', {}) if isinstance(input_data, dict) else {}
            l3_questions = step6_data.get('l3_questions', [])
            l3_question = l3_questions[0] if l3_questions else {}
            l3_questions_list = l3_questions
        
        goals = step2_data.get('goals', [])
        goal = goals[0] if goals else {}
        bridge_lexicon = step2_data.get('bridge_lexicon', {})
        
        # Get RAs
        ras = []
        if isinstance(step3_data, list):
            ras = step3_data
        elif isinstance(step3_data, dict):
            for value in step3_data.values():
                if isinstance(value, list):
                    ras.extend(value)
        
        print(f"\nStep 7 Debug: Processing L3 question: {l3_question.get('id', 'unknown')}")
        
        return f"""Goal with Requirement Atoms:
{json.dumps({'goal': goal, 'requirement_atoms': ras}, indent=2)}

Bridge Lexicon:
{json.dumps(bridge_lexicon, indent=2)}

L3 Question to analyze:
{json.dumps(l3_question, indent=2)}

Generate Instantiation Hypotheses (IHs) for this L3 question."""
    
    # STEP 8: INPUT: 1 L3 question + context | OUTPUT: L4 tactical questions for that L3
    elif step_id == 8:
        # Check if this is a batch call with single L3 question
        if 'l3_question' in input_data:
            l3_question = input_data['l3_question']
            step2_data = input_data.get('step2', {})
            step3_data = input_data.get('step3', {})
            step7_data = input_data.get('step7', {})
        else:
            # Legacy: process first L3 from step 6
            step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
            step3_data = input_data.get('step3', {}) if isinstance(input_data, dict) else {}
            step6_data = input_data.get('step6', {}) if isinstance(input_data, dict) else {}
            step7_data = input_data.get('step7', {}) if isinstance(input_data, dict) else {}
            
            l3_questions = step6_data.get('l3_questions', step6_data.get('seed_questions', []))
            l3_question = l3_questions[0] if l3_questions else {}
        
        goals = step2_data.get('goals', [])
        goal = goals[0] if goals else {}
        bridge_lexicon = step2_data.get('bridge_lexicon', {})
        
        # Get RAs
        ras = []
        if isinstance(step3_data, list):
            ras = step3_data
        elif isinstance(step3_data, dict):
            for value in step3_data.values():
                if isinstance(value, list):
                    ras.extend(value)
        
        # Get IHs
        ihs = step7_data.get('instantiation_hypotheses', []) if isinstance(step7_data, dict) else []
        if not ihs and isinstance(step7_data, list):
            ihs = step7_data
        
        print(f"\nStep 8 Debug: Processing L3 question {l3_question.get('id', 'unknown')}")
        print(f"  IHs available: {len(ihs)}")
        
        return f"""L3 Seed Question:
{json.dumps(l3_question, indent=2)}

Goal Context:
{json.dumps(goal, indent=2)}

Requirement Atoms:
{json.dumps(ras[:3], indent=2)}

Bridge Lexicon (SPVs):
{json.dumps(bridge_lexicon.get('system_properties', [])[:5], indent=2)}

Instantiation Hypotheses:
{json.dumps(ihs, indent=2)}

Generate L4 Tactical Questions that discriminate between these hypotheses for this specific L3 question."""
    
    # STEP 9: INPUT: 1 L4 question + context | OUTPUT: L5/L6 tasks for that L4
    elif step_id == 9:
        # Check if this is a batch call with single L4 question
        if 'l4_question' in input_data:
            l4_question = input_data['l4_question']
            step2_data = input_data.get('step2', {})
            step3_data = input_data.get('step3', {})
            step7_data = input_data.get('step7', {})
        else:
            # Legacy: process first L4 from step 8
            step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
            step3_data = input_data.get('step3', {}) if isinstance(input_data, dict) else {}
            step7_data = input_data.get('step7', {}) if isinstance(input_data, dict) else {}
            step8_data = input_data.get('step8', {}) if isinstance(input_data, dict) else {}
            
            l4_questions = step8_data.get('l4_questions', step8_data.get('child_nodes_L4', []))
            l4_question = l4_questions[0] if l4_questions else {}
        
        goals = step2_data.get('goals', [])
        goal = goals[0] if goals else {}
        bridge_lexicon = step2_data.get('bridge_lexicon', {})
        
        # Get RAs
        ras = []
        if isinstance(step3_data, list):
            ras = step3_data
        elif isinstance(step3_data, dict):
            for value in step3_data.values():
                if isinstance(value, list):
                    ras.extend(value)
        
        # Get IHs for context
        ihs = step7_data.get('instantiation_hypotheses', []) if isinstance(step7_data, dict) else []
        if not ihs and isinstance(step7_data, list):
            ihs = step7_data
        
        print(f"\nStep 9 Debug: Processing L4 question {l4_question.get('id', 'unknown')}")
        print(f"  IHs available: {len(ihs)}")
        
        return f"""L4 Tactical Question:
{json.dumps(l4_question, indent=2)}

Instantiation Hypotheses Context:
{json.dumps(ihs[:3], indent=2)}

Goal Context:
{json.dumps(goal, indent=2)}

Requirement Atoms:
{json.dumps(ras[:2], indent=2)}

Bridge Lexicon (SPVs):
{json.dumps(bridge_lexicon.get('system_properties', [])[:5], indent=2)}

Generate L5 mechanistic sub-questions and L6 experiment-ready tasks (with S-I-M-T parameters) for this specific L4 question."""
    
    else:
        return json.dumps(input_data)

if __name__ == '__main__':
    port = int(os.getenv('PORT', 3001))
    
    print(f"\n🚀 OMEGA-POINT Server running on port {port}")
    print(f"📡 API endpoint: http://localhost:{port}/api")
    api_key_status = '✓ Configured' if os.getenv('OPENAI_API_KEY') else '✗ Missing'
    print(f"🔑 OpenAI API Key: {api_key_status}\n")
    
    app.run(host='0.0.0.0', port=port, debug=True)

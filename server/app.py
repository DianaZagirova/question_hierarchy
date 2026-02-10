from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from openai import OpenAI
import os
import json
import time
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Max parallel workers for batch execution (configurable via .env)
MAX_BATCH_WORKERS = int(os.getenv('MAX_BATCH_WORKERS', '15'))

# In production, serve the built frontend from ../dist
DIST_DIR = os.path.join(os.path.dirname(__file__), '..', 'dist')
IS_PRODUCTION = os.getenv('NODE_ENV', 'development') == 'production'

if IS_PRODUCTION and os.path.isdir(DIST_DIR):
    app = Flask(__name__, static_folder=DIST_DIR, static_url_path='')
else:
    app = Flask(__name__)

CORS(app)

# ─── Thread-safe batch progress store ────────────────────────────────────────
# Keyed by step_id. Each entry tracks real-time progress for a running batch.
_progress_lock = threading.Lock()
_progress_store: dict = {}  # step_id -> { completed, total, successful, failed, elapsed, eta, items: [...] }

def _update_progress(step_id, completed, total, successful, failed, elapsed, eta, latest_item=None):
    """Thread-safe update of batch progress for a step."""
    with _progress_lock:
        entry = _progress_store.get(step_id, {'items': []})
        entry.update({
            'step_id': step_id,
            'completed': completed,
            'total': total,
            'successful': successful,
            'failed': failed,
            'elapsed': round(elapsed, 1),
            'eta': round(eta, 1),
            'percent': round((completed / total) * 100, 1) if total > 0 else 0,
            'timestamp': time.time(),
        })
        if latest_item:
            entry['items'].append(latest_item)
            # Keep only last 20 items to avoid memory bloat
            if len(entry['items']) > 20:
                entry['items'] = entry['items'][-20:]
        _progress_store[step_id] = entry

def _clear_progress(step_id):
    with _progress_lock:
        _progress_store.pop(step_id, None)

def _get_progress(step_id):
    with _progress_lock:
        return _progress_store.get(step_id, None)

@app.route('/api/progress/<int:step_id>', methods=['GET'])
def stream_progress(step_id):
    """SSE endpoint: streams real-time batch progress for a given step."""
    def generate():
        last_completed = -1
        idle_count = 0
        while True:
            progress = _get_progress(step_id)
            if progress and progress.get('completed', 0) != last_completed:
                last_completed = progress['completed']
                idle_count = 0
                yield f"data: {json.dumps(progress)}\n\n"
                # If batch is done, send final event and stop
                if progress['completed'] >= progress['total']:
                    yield f"data: {json.dumps({**progress, 'done': True})}\n\n"
                    return
            else:
                idle_count += 1
            # If no progress for 5 minutes, stop the stream
            if idle_count > 300:
                yield f"data: {json.dumps({'done': True, 'timeout': True})}\n\n"
                return
            time.sleep(1)

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )

def interpolate_prompt(agent_config, global_lens=None):
    """Interpolate placeholders in agent system prompts with actual values.
    
    Lens priority: globalLens (user-configured) > selectedLens > agent.lens
    """
    prompt = agent_config['systemPrompt']
    
    # Determine effective lens: globalLens takes priority
    effective_lens = global_lens or agent_config.get('settings', {}).get('selectedLens') or agent_config.get('lens') or 'No specific focus'
    prompt = re.sub(r'\{\{LENS\}\}', effective_lens, prompt)
    prompt = prompt.replace('[LENS]', effective_lens)  # Legacy support
    
    # Replace node count placeholders (min, max, and target/default)
    if agent_config.get('settings', {}).get('nodeCount'):
        node_count = agent_config['settings']['nodeCount']
        min_count = str(node_count['min'])
        max_count = str(node_count['max'])
        target_count = str(node_count.get('default', node_count['min']))
        
        # For Goal Pillars
        prompt = re.sub(r'\{\{MIN_GOALS\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_GOALS\}\}', max_count, prompt)
        prompt = re.sub(r'\{\{TARGET_GOALS\}\}', target_count, prompt)
        
        # For Research Domains
        prompt = re.sub(r'\{\{MIN_DOMAINS\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_DOMAINS\}\}', max_count, prompt)
        prompt = re.sub(r'\{\{TARGET_DOMAINS\}\}', target_count, prompt)
        
        # For L3 Questions
        prompt = re.sub(r'\{\{MIN_L3\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_L3\}\}', max_count, prompt)
        prompt = re.sub(r'\{\{TARGET_L3\}\}', target_count, prompt)
        
        # For Instantiation Hypotheses (IH)
        prompt = re.sub(r'\{\{MIN_IH\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_IH\}\}', max_count, prompt)
        prompt = re.sub(r'\{\{TARGET_IH\}\}', target_count, prompt)
        
        # For L4 Questions
        prompt = re.sub(r'\{\{MIN_L4\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_L4\}\}', max_count, prompt)
        prompt = re.sub(r'\{\{TARGET_L4\}\}', target_count, prompt)
        
        # For L5 Nodes
        prompt = re.sub(r'\{\{MIN_L5\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_L5\}\}', max_count, prompt)
        prompt = re.sub(r'\{\{TARGET_L5\}\}', target_count, prompt)
        
        # For Scientific Pillars
        prompt = re.sub(r'\{\{MIN_PILLARS\}\}', min_count, prompt)
        prompt = re.sub(r'\{\{MAX_PILLARS\}\}', max_count, prompt)
        prompt = re.sub(r'\{\{TARGET_PILLARS\}\}', target_count, prompt)
    
    # Replace any custom parameters
    if agent_config.get('settings', {}).get('customParams'):
        for key, value in agent_config['settings']['customParams'].items():
            placeholder = r'\{\{' + key + r'\}\}'
            prompt = re.sub(placeholder, str(value), prompt)
    
    return prompt

# ============================================================
# Provider-aware client initialization
# Supports: "openai" (default) and "openrouter"
# ============================================================
API_PROVIDER = os.getenv('API_PROVIDER', 'openai').lower().strip()

if API_PROVIDER == 'openrouter':
    openrouter_key = os.getenv('OPENROUTER_API_KEY')
    openrouter_base = os.getenv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1')
    if not openrouter_key:
        print("\n⚠️  WARNING: API_PROVIDER=openrouter but OPENROUTER_API_KEY is not set!")
    client = OpenAI(
        api_key=openrouter_key,
        base_url=openrouter_base,
    )
    print(f"🔌 Provider: OpenRouter ({openrouter_base})")
else:
    client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
    print(f"🔌 Provider: OpenAI (direct)")


def resolve_model(model_name):
    """
    Map model names for the active provider.
    OpenRouter requires 'openai/' prefix for OpenAI models.
    If the model already contains '/' it's assumed to be a full path
    (e.g. 'anthropic/claude-3.5-sonnet') and is used as-is.
    """
    if API_PROVIDER != 'openrouter':
        return model_name
    # Already a full provider/model path
    if '/' in model_name:
        return model_name
    # Prefix with openai/ for standard OpenAI model names
    return f'openai/{model_name}'

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.now().isoformat(),
        'provider': API_PROVIDER,
    })

def execute_single_item(step_id, agent_config, input_data, global_lens=None):
    """Execute a single item (helper function for batch processing)"""
    start_time = time.time()
    
    # Enhanced logging for Step 4
    if step_id == 4:
        # Determine if this is Phase 4a or 4b based on input structure
        if 'target_domain' in input_data:
            phase = "4b (Domain Scan)"
            domain_id = input_data.get('target_domain', {}).get('domain_id', 'unknown')
            domain_name = input_data.get('target_domain', {}).get('domain_name', 'unknown')
            goal_id = input_data.get('target_goal', {}).get('id', 'unknown')
            print(f"\n{'='*60}")
            print(f"[Step 4b] 🔬 DOMAIN SCAN STARTING")
            print(f"{'='*60}")
            print(f"  Goal: {goal_id}")
            print(f"  Domain: {domain_id}")
            print(f"  Domain Name: {domain_name}")
            print(f"  Agent: {agent_config.get('name', 'Unknown')}")
            print(f"  Model: {agent_config.get('model', 'Unknown')}")
            print(f"  Temperature: {agent_config.get('temperature', 'Unknown')}")
        else:
            phase = "4a (Domain Mapping)"
            goal_id = input_data.get('target_goal', {}).get('id', 'unknown')
            print(f"\n{'='*60}")
            print(f"[Step 4a] 🗺️  DOMAIN MAPPING STARTING")
            print(f"{'='*60}")
            print(f"  Goal: {goal_id}")
            print(f"  Agent: {agent_config.get('name', 'Unknown')}")
            print(f"  Model: {agent_config.get('model', 'Unknown')}")
            print(f"  Temperature: {agent_config.get('temperature', 'Unknown')}")
    
    # Prepare the prompt based on step
    user_prompt = prepare_user_prompt(step_id, input_data)
    
    # Log prompt size
    if step_id == 4:
        print(f"  Input size: {len(user_prompt)} characters")

    # Prepare system prompt with interpolated values (globalLens overrides agent-level lens)
    system_prompt = interpolate_prompt(agent_config, global_lens)
    
    # Add JSON instruction to system prompt (required by OpenAI for json_object mode)
    if "JSON" not in system_prompt and "json" not in system_prompt:
        system_prompt += "\n\nIMPORTANT: You must respond with valid JSON only."

    # Step-specific timeout settings (Step 4 needs more time for domain scans)
    if step_id == 4:
        timeout_seconds = 300  # 5 minutes for Step 4 (domain specialist)
        max_tokens = 32000  # Allow larger responses for Step 4
        print(f"  Timeout: {timeout_seconds}s")
        print(f"  Max tokens: {max_tokens}")
    elif step_id in [6, 7, 8, 9]:  # L3, IH, L4, L5 steps
        timeout_seconds = 240  # 4 minutes
        max_tokens = 28000
    else:
        timeout_seconds = 180  # 3 minutes for other steps
        max_tokens = 24000

    if step_id == 4:
        print(f"  ⏳ Sending request to OpenAI...")
    else:
        print(f"[Step {step_id}] Calling OpenAI API with model: {agent_config['model']} (timeout: {timeout_seconds}s)")
    
    # Call OpenAI API with step-specific optimizations
    api_start = time.time()
    model = resolve_model(agent_config['model'])
    
    api_kwargs = dict(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=agent_config['temperature'],
        response_format={"type": "json_object"},
        max_tokens=max_tokens,
        timeout=timeout_seconds,
    )
    
    # OpenRouter supports extra headers for tracking
    if API_PROVIDER == 'openrouter':
        api_kwargs['extra_headers'] = {
            'HTTP-Referer': 'https://omega-point.local',
            'X-Title': 'Omega Point Pipeline',
        }
    
    completion = client.chat.completions.create(**api_kwargs)

    api_duration = time.time() - api_start
    response_text = completion.choices[0].message.content
    
    # Log token usage and timing
    usage = completion.usage
    
    if step_id == 4:
        print(f"  ✅ API call completed in {api_duration:.2f}s")
        print(f"  📊 Tokens - Prompt: {usage.prompt_tokens}, Completion: {usage.completion_tokens}, Total: {usage.total_tokens}")
        print(f"  💰 Estimated cost: ${(usage.prompt_tokens * 0.00001 + usage.completion_tokens * 0.00003):.4f}")
    else:
        print(f"[Step {step_id}] API call completed in {api_duration:.2f}s")
        print(f"[Step {step_id}] Tokens - Prompt: {usage.prompt_tokens}, Completion: {usage.completion_tokens}, Total: {usage.total_tokens}")

    # Parse JSON response
    try:
        result = json.loads(response_text)
        total_duration = time.time() - start_time
        
        if step_id == 4:
            # Enhanced logging for Step 4 results
            if 'target_domain' in input_data:
                # Phase 4b - Domain Scan
                pillars = result.get('scientific_pillars', [])
                print(f"  📦 Generated {len(pillars)} scientific pillars")
                if pillars:
                    # Show sample pillars
                    print(f"  📋 Sample interventions:")
                    for i, pillar in enumerate(pillars[:3]):
                        print(f"     {i+1}. {pillar.get('id', 'N/A')}: {pillar.get('title', 'N/A')[:60]}...")
                    if len(pillars) > 3:
                        print(f"     ... and {len(pillars) - 3} more")
                print(f"  ⏱️  Total execution time: {total_duration:.2f}s")
                print(f"{'='*60}\n")
            else:
                # Phase 4a - Domain Mapping
                domains = result.get('research_domains', [])
                print(f"  🗺️  Identified {len(domains)} research domains")
                if domains:
                    print(f"  📋 Domains:")
                    for i, domain in enumerate(domains):
                        print(f"     {i+1}. {domain.get('domain_id', 'N/A')}: {domain.get('domain_name', 'N/A')} [{domain.get('relevance_to_goal', 'N/A')}]")
                print(f"  ⏱️  Total execution time: {total_duration:.2f}s")
                print(f"{'='*60}\n")
        else:
            print(f"[Step {step_id}] Total execution time: {total_duration:.2f}s")
        
        return result
    except json.JSONDecodeError as parse_error:
        if step_id == 4:
            print(f"  ❌ Failed to parse JSON response: {parse_error}")
            print(f"  📄 Response preview: {response_text[:200]}...")
            print(f"{'='*60}\n")
        else:
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
        global_lens = data.get('globalLens')  # User-configured epistemic lens

        print(f'\n=== Executing Step {step_id} ===')
        print(f'Agent: {agent_config.get("name")}')
        print(f"User Prompt (truncated): {str(input_data)[:200]}...")

        result = execute_single_item(step_id, agent_config, input_data, global_lens)
        
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
    """
    Execute a step multiple times with different inputs in parallel.
    
    NOTE: Flask's development server doesn't detect client disconnections,
    so if the frontend aborts, the backend will continue processing until
    all tasks complete. This is expected behavior for the dev server.
    For production, use Gunicorn which handles disconnects properly.
    """
    try:
        data = request.json
        step_id = data.get('stepId')
        agent_config = data.get('agentConfig')
        items = data.get('items', [])
        phase_info = data.get('phase_info', {})  # Get phase information for Step 4
        global_lens = data.get('globalLens')  # User-configured epistemic lens
        
        print(f'\n{"#"*70}')
        print(f'### BATCH EXECUTION: Step {step_id} - {agent_config.get("name")}')
        print(f'{"#"*70}')
        print(f'📦 Total items to process: {len(items)}')
        
        # Adjust max workers — maximize parallelism for speed
        # Capped by MAX_BATCH_WORKERS env var (default 15)
        max_workers = min(len(items), MAX_BATCH_WORKERS)
        print(f'⚡ Processing {len(items)} items in PARALLEL with {max_workers} workers (MAX_BATCH_WORKERS={MAX_BATCH_WORKERS})...')
        
        results = [None] * len(items)  # Pre-allocate results list
        _clear_progress(step_id)  # Reset progress for this step
        
        # Process items in parallel using ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            future_to_idx = {
                executor.submit(execute_single_item, step_id, agent_config, item, global_lens): idx 
                for idx, item in enumerate(items)
            }
            
            # Process completed tasks as they finish
            completed = 0
            successful_so_far = 0
            failed_so_far = 0
            batch_start_time = time.time()
            
            # Initialize progress
            _update_progress(step_id, 0, len(items), 0, 0, 0, 0)
            
            for future in as_completed(future_to_idx):
                idx = future_to_idx[future]
                completed += 1
                
                # Calculate progress
                # For Step 4, adjust progress to reflect actual phase weights:
                # Phase 4a (domain mapping) = ~10% of total work
                # Phase 4b (domain scans) = ~90% of total work
                if step_id == 4 and phase_info.get('phase') == '4b':
                    # Phase 4b: Map 0-100% of items to 10-100% overall progress
                    phase_progress = (completed / len(items)) * 90  # 90% of total
                    overall_progress = 10 + phase_progress  # Add 10% from Phase 4a
                    progress_pct = overall_progress
                    phase_label = f"Phase 2 (Domain Scans): {completed}/{len(items)}"
                elif step_id == 4 and phase_info.get('phase') == '4a':
                    # Phase 4a: Map 0-100% of items to 0-10% overall progress
                    phase_progress = (completed / len(items)) * 10
                    progress_pct = phase_progress
                    phase_label = f"Phase 1 (Domain Mapping): {completed}/{len(items)}"
                else:
                    progress_pct = (completed / len(items)) * 100
                    phase_label = f"{completed}/{len(items)}"
                
                elapsed = time.time() - batch_start_time
                avg_time_per_item = elapsed / completed if completed > 0 else 0
                remaining_items = len(items) - completed
                eta_seconds = avg_time_per_item * remaining_items
                eta_minutes = eta_seconds / 60
                
                try:
                    result = future.result()  # Wait for completion
                    results[idx] = {
                        'success': True,
                        'data': result,
                        'item_index': idx
                    }
                    successful_so_far += 1
                    
                    # Update real-time progress via SSE store
                    _update_progress(
                        step_id, completed, len(items),
                        successful_so_far, failed_so_far,
                        elapsed, eta_seconds,
                        latest_item={'index': idx, 'success': True}
                    )
                    
                    if step_id == 4:
                        print(f"\n{'─'*60}")
                        print(f"✅ PROGRESS: {phase_label} ({progress_pct:.1f}% overall)")
                        print(f"⏱️  Elapsed: {elapsed/60:.1f} min | Avg: {avg_time_per_item:.1f}s/item")
                        if remaining_items > 0:
                            print(f"⏳ ETA: {eta_minutes:.1f} min ({remaining_items} items remaining)")
                        print(f"{'─'*60}")
                    else:
                        print(f"✓ Item {idx + 1}/{len(items)} completed ({completed}/{len(items)} total)")
                        
                except Exception as item_error:
                    if step_id == 4:
                        print(f"\n{'─'*60}")
                        print(f"❌ FAILED: Item {idx + 1}/{len(items)}")
                        print(f"Error: {item_error}")
                        print(f"Progress: {phase_label} ({progress_pct:.1f}% overall)")
                        print(f"{'─'*60}")
                    else:
                        print(f"✗ Item {idx + 1}/{len(items)} failed: {item_error}")
                    
                    results[idx] = {
                        'success': False,
                        'error': str(item_error),
                        'item_index': idx
                    }
                    failed_so_far += 1
                    
                    # Update real-time progress via SSE store
                    _update_progress(
                        step_id, completed, len(items),
                        successful_so_far, failed_so_far,
                        elapsed, eta_seconds,
                        latest_item={'index': idx, 'success': False, 'error': str(item_error)}
                    )
        
        # Filter out None results (should all be filled)
        completed_results = [r for r in results if r is not None]
        successful_count = sum(1 for r in completed_results if r.get('success'))
        failed_count = len(completed_results) - successful_count
        total_batch_time = time.time() - batch_start_time
        
        if step_id == 4:
            print(f"\n{'#'*70}")
            print(f"### BATCH COMPLETE: Step {step_id}")
            print(f"{'#'*70}")
            print(f"✅ Successful: {successful_count}/{len(items)}")
            print(f"❌ Failed: {failed_count}/{len(items)}")
            print(f"⏱️  Total time: {total_batch_time/60:.1f} minutes")
            print(f"📊 Average: {total_batch_time/len(items):.1f}s per item")
            print(f"{'#'*70}\n")
        else:
            print(f"\n=== Batch Complete: {successful_count}/{len(items)} successful ===")
        
        _clear_progress(step_id)  # Clean up progress store
        
        return jsonify({
            'batch_results': completed_results,
            'total_processed': len(completed_results),
            'successful': successful_count,
            'failed': len(completed_results) - successful_count
        })
    
    except Exception as error:
        print(f'Error in batch execution: {error}')
        _clear_progress(step_id)  # Clean up on error too
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

        # UPDATED: Step 5 is skipped, get scientific pillars from Step 4 (which includes relationship data)
        # Step 4 output structure: { goal_id: { scientific_pillars: [...], domain_mapping: {...}, ... } }
        scientific_pillars = []
        if goal_id in step4_data:
            # New structure: Step 4 output is keyed by goal_id
            goal_data = step4_data.get(goal_id, {})
            scientific_pillars = goal_data.get('scientific_pillars', [])
        else:
            # Legacy fallback
            scientific_pillars = step4_data.get('scientific_pillars', [])

        # UPDATED: Extract relationship summary from scientific pillars (Step 5 function integrated into Step 4)
        # Each pillar now has relationship_to_goal, relationship_confidence, gap_analysis fields
        relationship_summary = []
        for pillar in scientific_pillars[:20]:  # Sample first 20 for context
            if isinstance(pillar, dict):
                relationship_summary.append({
                    'pillar_id': pillar.get('id', 'N/A'),
                    'title': pillar.get('title', 'N/A'),
                    'relationship': pillar.get('relationship_to_goal', 'unknown'),
                    'confidence': pillar.get('relationship_confidence', 0.0),
                    'gap': pillar.get('gap_analysis', '')
                })

        print(f"\nStep 6 Debug: Processing Goal {goal_id}")
        print(f"  - Scientific pillars: {len(scientific_pillars)}")
        print(f"  - Relationship summary: {len(relationship_summary)} samples")

        q0_ref = input_data.get('Q0_reference', '')
        
        return f"""Master Project Question (Q0):
{q0_ref}

CRITICAL: You are generating L3 questions for Goal ID: {goal_id}

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

Scientific Reality (Interventions with Relationship Assessment):
{json.dumps(relationship_summary, indent=2)}

Context: The above interventions were identified for this goal and assessed for their relationship to the goal:
- "solves": Directly satisfies requirements with RL-3 evidence
- "partially_solves": Moves SPVs correctly but has gaps (magnitude/execution/timescale/knowledge)
- "proxies_for": Changes biomarkers but doesn't control underlying SPVs
- "enables_measurement_for": Provides required meters

Generate L3 Seed Questions that target the strategic gaps revealed by analyzing:
1. What capabilities are missing (no interventions found)
2. What partial solutions need strengthening (partially_solves with gaps)
3. What unknowns need resolution (proxies without mechanism understanding)

Remember: Use {goal_id} in ALL L3 question IDs!"""
    
    # STEP 7: INPUT: 1 L3 question + context | OUTPUT: Instantiation Hypotheses
    elif step_id == 7:
        step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
        step3_data = input_data.get('step3', {}) if isinstance(input_data, dict) else {}
        step5_data = input_data.get('step5', {}) if isinstance(input_data, dict) else {}
        
        # Check if this is a batch call with single L3 question
        if 'l3_question' in input_data:
            l3_question = input_data['l3_question']
        else:
            # Fallback to old behavior
            step6_data = input_data.get('step6', {}) if isinstance(input_data, dict) else {}
            l3_questions = step6_data.get('l3_questions', [])
            l3_question = l3_questions[0] if l3_questions else {}
        
        # Use parent_goal from input (goal-specific), fallback to step2 goals[0]
        goal = input_data.get('parent_goal', {})
        if not goal:
            goals = step2_data.get('goals', [])
            goal = goals[0] if goals else {}
        bridge_lexicon = step2_data.get('bridge_lexicon', {})
        
        # Get RAs — now goal-specific (list) or legacy (dict keyed by goal ID)
        ras = []
        if isinstance(step3_data, list):
            ras = step3_data
        elif isinstance(step3_data, dict):
            for value in step3_data.values():
                if isinstance(value, list):
                    ras.extend(value)
        
        # Get goal-specific S-nodes from step5
        goal_id = goal.get('id', '')
        scientific_pillars = []
        if goal_id and goal_id in step5_data:
            goal_s_data = step5_data.get(goal_id, {})
            scientific_pillars = goal_s_data.get('scientific_pillars', [])
        
        print(f"\nStep 7 Debug: Processing L3 question: {l3_question.get('id', 'unknown')}")
        print(f"  Parent Goal: {goal_id}, RAs: {len(ras)}, S-nodes: {len(scientific_pillars)}")
        
        q0_ref = input_data.get('Q0_reference', '')
        
        return f"""Master Project Question (Q0):
{q0_ref}

Parent Goal:
{json.dumps(goal, indent=2)}

Requirement Atoms (for this Goal):
{json.dumps(ras[:5], indent=2)}

Bridge Lexicon:
{json.dumps(bridge_lexicon, indent=2)}

Scientific Reality (S-nodes for this Goal):
{json.dumps([{'id': s.get('id'), 'title': s.get('title'), 'relationship_to_goal': s.get('relationship_to_goal'), 'mechanism': s.get('mechanism')} for s in scientific_pillars[:15]], indent=2)}

L3 Question to analyze:
{json.dumps(l3_question, indent=2)}

Generate Instantiation Hypotheses (IHs) for this L3 question. All hypotheses must be relevant to the Master Project Question (Q0) above."""
    
    # STEP 8: INPUT: 1 L3 question + context | OUTPUT: L4 tactical questions for that L3
    elif step_id == 8:
        # Check if this is a batch call with single L3 question
        if 'l3_question' in input_data:
            l3_question = input_data['l3_question']
            step3_data = input_data.get('step3', {})
            step7_data = input_data.get('step7', {})
        else:
            # Legacy: process first L3 from step 6
            step3_data = input_data.get('step3', {}) if isinstance(input_data, dict) else {}
            step6_data = input_data.get('step6', {}) if isinstance(input_data, dict) else {}
            step7_data = input_data.get('step7', {}) if isinstance(input_data, dict) else {}
            
            l3_questions = step6_data.get('l3_questions', step6_data.get('seed_questions', []))
            l3_question = l3_questions[0] if l3_questions else {}
        
        # Use parent_goal from input (goal-specific), fallback to step2
        goal = input_data.get('parent_goal', {})
        if not goal:
            step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
            goals = step2_data.get('goals', [])
            goal = goals[0] if goals else {}
        
        # Get RAs — now goal-specific (list) or legacy (dict keyed by goal ID)
        ras = []
        if isinstance(step3_data, list):
            ras = step3_data
        elif isinstance(step3_data, dict):
            for value in step3_data.values():
                if isinstance(value, list):
                    ras.extend(value)
        
        # Get IHs — now pre-filtered to this L3's IHs only
        ihs = step7_data.get('instantiation_hypotheses', []) if isinstance(step7_data, dict) else []
        if not ihs and isinstance(step7_data, list):
            ihs = step7_data
        
        q0_ref = input_data.get('Q0_reference', '')
        
        print(f"\nStep 8 Debug: Processing L3 question {l3_question.get('id', 'unknown')}")
        print(f"  Parent Goal: {goal.get('id', 'unknown')}, RAs: {len(ras)}, IHs: {len(ihs)}")
        
        return f"""Master Project Question (Q0):
{q0_ref}

L3 Seed Question:
{json.dumps(l3_question, indent=2)}

Parent Goal Context:
{json.dumps(goal, indent=2)}

Requirement Atoms (for this Goal):
{json.dumps(ras[:5], indent=2)}

Instantiation Hypotheses (for this L3):
{json.dumps(ihs, indent=2)}

Generate L4 Tactical Questions that discriminate between these hypotheses for this specific L3 question. All tactical questions must serve the Master Project Question (Q0) above."""
    
    # STEP 9: INPUT: 1 L4 question + context | OUTPUT: L5/L6 tasks for that L4
    elif step_id == 9:
        step3_data = input_data.get('step3', {}) if isinstance(input_data, dict) else {}
        step5_data = input_data.get('step5', {}) if isinstance(input_data, dict) else {}
        
        # Check if this is a batch call with single L4 question
        if 'l4_question' in input_data:
            l4_question = input_data['l4_question']
        else:
            # Legacy: process first L4 from step 8
            step8_data = input_data.get('step8', {}) if isinstance(input_data, dict) else {}
            l4_questions = step8_data.get('l4_questions', step8_data.get('child_nodes_L4', []))
            l4_question = l4_questions[0] if l4_questions else {}
        
        # Get RAs — now goal-specific (list) or legacy (dict keyed by goal ID)
        ras = []
        if isinstance(step3_data, list):
            ras = step3_data
        elif isinstance(step3_data, dict):
            for value in step3_data.values():
                if isinstance(value, list):
                    ras.extend(value)
        
        # Get goal-specific S-nodes from step5
        scientific_pillars = []
        if isinstance(step5_data, dict):
            for goal_id, goal_data in step5_data.items():
                if isinstance(goal_data, dict):
                    scientific_pillars.extend(goal_data.get('scientific_pillars', []))
        
        # Build S-node summary for prompt
        s_node_summary = [{'id': s.get('id'), 'title': s.get('title'), 'relationship_to_goal': s.get('relationship_to_goal')} for s in scientific_pillars[:10]]
        
        q0_ref = input_data.get('Q0_reference', '')
        
        print(f"\nStep 9 Debug: Processing L4 question {l4_question.get('id', 'unknown')}")
        print(f"  RAs: {len(ras)}, S-nodes: {len(scientific_pillars)}")
        
        return f"""Master Project Question (Q0):
{q0_ref}

L4 Tactical Question:
{json.dumps(l4_question, indent=2)}

Requirement Atoms (for parent Goal):
{json.dumps(ras[:3], indent=2)}

Scientific Reality (S-nodes for parent Goal):
{json.dumps(s_node_summary, indent=2)}

Generate L5 mechanistic sub-questions and L6 experiment-ready tasks (with S-I-M-T parameters) for this specific L4 question."""
    
    # STEP 10: INPUT: Q0, L4 question, all L6 tasks for that L4 branch | OUTPUT: Common experiment or impossibility verdict
    elif step_id == 10:
        q0_text = input_data.get('q0', '')
        l4_question = input_data.get('l4_question', {})
        l6_tasks = input_data.get('l6_tasks', [])
        
        print(f"\nStep 10 Debug: Processing L4 {l4_question.get('id', 'unknown')}")
        print(f"  L6 tasks: {len(l6_tasks)}")
        
        return f"""MASTER QUESTION (Q0):
{q0_text}

L4 TACTICAL QUESTION:
{json.dumps(l4_question, indent=2)}

ALL L6 EXPERIMENT TASKS FOR THIS L4 BRANCH ({len(l6_tasks)} tasks):
{json.dumps(l6_tasks, indent=2)}

Analyze whether a single, unified experiment can meaningfully address ALL the above L6 tasks.
Be brutally critical — do NOT force unification if the tasks are fundamentally incompatible."""
    
    else:
        return json.dumps(input_data)

# ============================================================
# NODE CHAT: Chat with LLM about selected graph nodes
# ============================================================
@app.route('/api/improve-node', methods=['POST'])
def improve_node():
    """Stream an LLM response to improve a node's data.

    Takes the current node data, context nodes, Q0, goal, lens, and returns
    improved JSON data while preserving structure and keys.
    """
    data = request.json
    node_data = data.get('nodeData', {})
    node_type = data.get('nodeType', 'unknown')
    node_label = data.get('nodeLabel', 'Node')
    context_nodes = data.get('contextNodes', [])
    q0 = data.get('q0', '')
    goal = data.get('goal', '')
    lens = data.get('lens', '')
    model = data.get('model', 'gpt-4.1')
    temperature = float(data.get('temperature', 0.7))
    custom_prompt = data.get('customPrompt', '')

    # Build system prompt for node improvement
    system_prompt = f"""You are an expert scientific research assistant for the Omega Point project. Your task is to improve and refine the data for a specific node in a hierarchical knowledge graph.

## MASTER PROJECT CONTEXT

**Master Question (Q0):**
{q0 if q0 else 'Not specified'}

**Current Goal:**
{goal if goal else 'Not specified'}

**Epistemic Lens:**
{lens if lens else 'None specified'}

## NODE TO IMPROVE

**Node Type:** {node_type}
**Node Label:** {node_label}

**Current Node Data:**
{json.dumps(node_data, indent=2)}

## CONTEXT NODES (for reference)

{json.dumps(context_nodes, indent=2) if context_nodes else 'No additional context nodes provided'}

## INSTRUCTIONS

1. **Improve the Content**: Enhance descriptions, rationales, mechanisms, and text fields to be more:
   - Precise and technically accurate
   - Detailed and comprehensive
   - Well-structured and clear
   - Scientifically rigorous
   - Aligned with the project's Q0 and epistemic lens

2. **CRITICAL: Preserve Structure**
   - Keep ALL existing keys/fields
   - Do NOT add new top-level keys
   - Do NOT remove any keys
   - Do NOT change IDs (id, parent_node_id, parent_goal_id, etc.)
   - Do NOT change type fields
   - Do NOT change numerical scores unless clearly improving accuracy
   - ONLY improve textual content, descriptions, and rationales

3. **Output Format**
   - Return ONLY valid JSON matching the exact structure of the input
   - No markdown, no code blocks, no explanations
   - Just the improved JSON object

4. **Quality Standards**
   - Be specific rather than vague
   - Use concrete examples where appropriate
   - Maintain scientific accuracy
   - Ensure consistency with project context
   - Avoid generic or placeholder text
"""

    # Append custom instructions if provided
    if custom_prompt and custom_prompt.strip():
        system_prompt += f"""

## ADDITIONAL CUSTOM INSTRUCTIONS

{custom_prompt.strip()}

**Important:** Apply these custom instructions while still following all structure preservation rules above.
"""

    system_prompt += "\n\nReturn the improved node data as a single JSON object now:"

    # User prompt with current data
    user_prompt = f"Please improve this {node_type} node data while preserving all keys and structure:\n\n{json.dumps(node_data, indent=2)}"

    def generate():
        try:
            resolved = resolve_model(model)
            api_kwargs = dict(
                model=resolved,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=temperature,
                max_tokens=4096,
                stream=True,
                response_format={"type": "json_object"},
            )
            if API_PROVIDER == 'openrouter':
                api_kwargs['extra_headers'] = {
                    'HTTP-Referer': 'https://omega-point.local',
                    'X-Title': 'Omega Point Node Improvement',
                }

            stream = client.chat.completions.create(**api_kwargs)
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    yield f"data: {json.dumps({'token': token})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            print(f"[Node Improvement] Error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )

@app.route('/api/node-chat', methods=['POST'])
def node_chat():
    """Stream a chat response about selected graph nodes.

    Always includes Q0, goal, and lens in the system context.
    Accepts conversation history for multi-turn chat.
    """
    data = request.json
    selected_nodes = data.get('selectedNodes', [])
    messages_history = data.get('messages', [])
    q0 = data.get('q0', '')
    goal = data.get('goal', '')
    lens = data.get('lens', '')
    model = data.get('model', 'gpt-4.1')

    # Build system prompt with permanent context
    system_prompt = f"""You are an expert scientific research advisor for the Omega Point project. You help the user analyze, question, and reason about nodes in a hierarchical knowledge graph that decomposes a master research question into actionable experiments.

MASTER QUESTION (Q0):
{q0}

CURRENT GOAL:
{goal}

EPISTEMIC LENS:
{lens if lens else 'None specified'}

SELECTED NODES ({len(selected_nodes)} node(s)):
{json.dumps(selected_nodes, indent=2)}

INSTRUCTIONS:
- Answer questions about the selected nodes, their relationships, scientific validity, and implications.
- You can suggest improvements, identify gaps, propose alternatives, or explain mechanisms.
- Be concise but thorough. Use scientific terminology appropriate to the domain.
- Reference specific node IDs when discussing them.
- If the user asks about connections between nodes, reason about causal chains and dependencies.
- You may use markdown formatting in your responses."""

    # Build messages for the API call
    api_messages = [{"role": "system", "content": system_prompt}]
    
    # Add conversation history
    for msg in messages_history:
        api_messages.append({
            "role": msg.get("role", "user"),
            "content": msg.get("content", "")
        })

    print(f"\n[Node Chat] Model: {model}, Nodes: {len(selected_nodes)}, History: {len(messages_history)} messages")

    def generate():
        try:
            resolved = resolve_model(model)
            api_kwargs = dict(
                model=resolved,
                messages=api_messages,
                temperature=0.7,
                max_tokens=4096,
                stream=True,
            )
            if API_PROVIDER == 'openrouter':
                api_kwargs['extra_headers'] = {
                    'HTTP-Referer': 'https://omega-point.local',
                    'X-Title': 'Omega Point Node Chat',
                }

            stream = client.chat.completions.create(**api_kwargs)
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    token = chunk.choices[0].delta.content
                    yield f"data: {json.dumps({'token': token})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            print(f"[Node Chat] Error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )

# SPA catch-all: serve index.html for any non-API route (production only)
if IS_PRODUCTION and os.path.isdir(DIST_DIR):
    from flask import send_from_directory as _send

    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve_spa(path):
        # If the path matches a real file in dist/, serve it
        full = os.path.join(DIST_DIR, path)
        if path and os.path.isfile(full):
            return _send(DIST_DIR, path)
        # Otherwise serve index.html (client-side routing)
        return _send(DIST_DIR, 'index.html')

if __name__ == '__main__':
    port = int(os.getenv('PORT', 3001))
    
    print(f"\n🚀 OMEGA-POINT Server running on port {port}")
    print(f"📡 API endpoint: http://localhost:{port}/api")
    print(f"🔌 API Provider: {API_PROVIDER}")
    print(f"🌍 Mode: {'PRODUCTION' if IS_PRODUCTION else 'DEVELOPMENT'}")
    if IS_PRODUCTION:
        print(f"📁 Serving frontend from: {os.path.abspath(DIST_DIR)}")
    if API_PROVIDER == 'openrouter':
        key_status = '✓ Configured' if os.getenv('OPENROUTER_API_KEY') else '✗ Missing'
        print(f"🔑 OpenRouter API Key: {key_status}")
    else:
        key_status = '✓ Configured' if os.getenv('OPENAI_API_KEY') else '✗ Missing'
        print(f"🔑 OpenAI API Key: {key_status}")
    
    app.run(host='0.0.0.0', port=port, debug=not IS_PRODUCTION)

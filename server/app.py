from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from openai import OpenAI
import os
import json
import time
import re
import threading
import sys
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from dotenv import load_dotenv

# Import multi-session support modules
from database import db
from redis_client import redis_client
from session_middleware import get_session_id, require_session, with_session, optional_session

# Configure logging to stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    stream=sys.stdout,
    force=True
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Initialize database and Redis connections
try:
    db.initialize()
    logger.info("✓ Database connection established")
    sys.stdout.flush()
except Exception as e:
    logger.warning(f"⚠ Database initialization failed: {e}")
    logger.warning("  Continuing without database support...")
    sys.stdout.flush()

try:
    redis_client.initialize()
    logger.info("✓ Redis connection established")
    sys.stdout.flush()
except Exception as e:
    logger.warning(f"⚠ Redis initialization failed: {e}")
    logger.warning("  Continuing without Redis support...")
    sys.stdout.flush()

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

# ─── Helper Functions ─────────────────────────────────────────────────────────

def set_secure_cookie(response, key, value, max_age=None):
    """
    Set a secure cookie with production-ready settings
    In production: secure=True (HTTPS only), samesite='Strict'
    In development: secure=False, samesite='Lax'
    For localhost: secure=False (even in production mode, for local testing)
    """
    # Check if request is from localhost (for local testing)
    is_localhost = request.host.startswith('localhost') or request.host.startswith('127.0.0.1')

    response.set_cookie(
        key,
        value,
        httponly=True,
        secure=IS_PRODUCTION and not is_localhost,  # Disable secure for localhost
        samesite='Lax' if is_localhost else ('Strict' if IS_PRODUCTION else 'Lax'),
        max_age=max_age or (7 * 24 * 60 * 60)  # 7 days default
    )
    return response

# ─── Thread-safe batch progress store ────────────────────────────────────────
# Now uses Redis for cross-worker coordination with session-scoped keys
# Fallback to in-memory store if Redis is unavailable
_progress_lock = threading.Lock()
_progress_store: dict = {}  # Fallback: session_id:step_id -> { ... }

def _update_progress(session_id, step_id, completed, total, successful, failed, elapsed, eta, latest_item=None):
    """Update batch progress for a session+step (Redis primary, in-memory fallback)."""
    # Try Redis first
    try:
        if redis_client.client:
            # Get existing items from Redis
            existing = redis_client.get_progress(session_id, step_id)
            items = existing.get('items', []) if existing else []

            # Add new item
            if latest_item:
                items.append(latest_item)
                if len(items) > 20:
                    items = items[-20:]

            # Update Redis
            redis_client.update_progress(
                session_id=session_id,
                step_id=step_id,
                completed=completed,
                total=total,
                successful=successful,
                failed=failed,
                elapsed=round(elapsed, 1),
                eta=round(eta, 1),
                percent=round((completed / total) * 100, 1) if total > 0 else 0,
                items=items
            )
            return
    except Exception as e:
        logger.warning(f"Redis progress update failed, using fallback: {e}")

    # Fallback to in-memory store
    with _progress_lock:
        key = f"{session_id}:{step_id}"
        entry = _progress_store.get(key, {'items': []})
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
            if len(entry['items']) > 20:
                entry['items'] = entry['items'][-20:]
        _progress_store[key] = entry

def _clear_progress(session_id, step_id):
    """Clear progress for a session+step"""
    # Try Redis first
    try:
        if redis_client.client:
            redis_client.clear_progress(session_id, step_id)
            return
    except Exception as e:
        logger.warning(f"Redis progress update failed, using fallback: {e}")

    # Fallback to in-memory store
    with _progress_lock:
        key = f"{session_id}:{step_id}"
        _progress_store.pop(key, None)

def _get_progress(session_id, step_id):
    """Get progress for a session+step"""
    # Try Redis first
    try:
        if redis_client.client:
            progress = redis_client.get_progress(session_id, step_id)
            if progress:
                # Add metadata for compatibility
                progress['step_id'] = step_id
                progress['timestamp'] = time.time()
                return progress
    except Exception as e:
        logger.warning(f"Redis progress update failed, using fallback: {e}")

    # Fallback to in-memory store
    with _progress_lock:
        key = f"{session_id}:{step_id}"
        return _progress_store.get(key, None)

@app.route('/api/progress/<int:step_id>', methods=['GET'])
def stream_progress(step_id):
    """SSE endpoint: streams real-time batch progress for a given step."""
    # Extract session_id from query param (SSE can't use custom headers)
    session_id = request.args.get('session_id')

    # Validate session
    if not session_id or not db.is_valid_session(session_id):
        def error_stream():
            yield f"data: {json.dumps({'error': 'Invalid session'})}\n\n"
        return Response(
            error_stream(),
            mimetype='text/event-stream',
            headers={'Cache-Control': 'no-cache'}
        )

    def generate():
        last_completed = -1
        idle_count = 0
        while True:
            progress = _get_progress(session_id, step_id)
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

# ─── Session Management Endpoints ─────────────────────────────────────────────

@app.route('/api/session/new', methods=['POST'])
def create_session():
    """Create a new user session and return session_id"""
    try:
        # Use get_json(silent=True) to handle missing Content-Type gracefully
        metadata = request.get_json(silent=True) or {}
        session_id = db.create_session(metadata=metadata)

        response = jsonify({
            'session_id': session_id,
            'created': True
        })

        # Set secure HTTP-only cookie for browser clients
        set_secure_cookie(response, 'session_id', session_id)

        return response
    except Exception as e:
        logger.error(f"Error creating session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/session/validate', methods=['GET'])
def validate_session():
    """Validate existing session or create a new one"""
    session_id = get_session_id()

    if session_id and db.is_valid_session(session_id):
        # Valid session, update access time
        db.update_session_access(session_id)
        return jsonify({
            'session_id': session_id,
            'valid': True
        })
    else:
        # Invalid or missing session, create new one
        try:
            new_session_id = db.create_session()
            response = jsonify({
                'session_id': new_session_id,
                'valid': False,
                'created': True
            })

            # Set secure HTTP-only cookie
            set_secure_cookie(response, 'session_id', new_session_id)

            return response
        except Exception as e:
            logger.error(f"Error validating/creating session: {e}", exc_info=True)
            return jsonify({'error': str(e)}), 500


@app.route('/api/session/state', methods=['GET'])
@with_session(db)
def get_session_state(session_id):
    """Retrieve full session state from database"""
    try:
        state_key = request.args.get('key')
        state_data = db.get_session_state(session_id, state_key)

        if state_data is None and state_key:
            return jsonify({'error': 'State not found'}), 404

        return jsonify({
            'session_id': session_id,
            'state': state_data or {}
        })
    except Exception as e:
        logger.error(f"Error retrieving session state: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/session/state', methods=['PUT'])
@with_session(db)
def save_session_state(session_id):
    """Save session state to database"""
    try:
        data = request.json or {}

        # Support both single key-value and multiple keys
        if 'state_key' in data and 'state_data' in data:
            # Single key-value
            db.save_session_state(session_id, data['state_key'], data['state_data'])
        else:
            # Multiple keys (e.g., {'app_state': {...}, 'step_4': {...}})
            for key, value in data.items():
                db.save_session_state(session_id, key, value)

        return jsonify({
            'session_id': session_id,
            'saved': True
        })
    except Exception as e:
        logger.error(f"Error saving session state: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ─── User Session Management (UI Sessions) ────────────────────────────────────

@app.route('/api/user-sessions', methods=['GET'])
@with_session(db)
def list_user_sessions(session_id):
    """Get all user sessions (UI sessions) for the current browser session"""
    try:
        # Retrieve sessions list from state
        sessions_data = db.get_session_state(session_id, 'user_sessions')

        if sessions_data is None:
            # No sessions yet, return empty list
            return jsonify({'sessions': []})

        return jsonify({'sessions': sessions_data.get('sessions', [])})
    except Exception as e:
        logger.error(f"Error listing user sessions: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/user-sessions', methods=['POST'])
@with_session(db)
def create_user_session(session_id):
    """Create a new user session (UI session)"""
    try:
        data = request.json or {}
        user_session_name = data.get('name', 'New Session')

        # Get existing sessions
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])

        # Create new session
        import uuid
        new_session = {
            'id': f"s-{int(time.time())}-{uuid.uuid4().hex[:6]}",
            'name': user_session_name,
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat(),
            'goalPreview': ''
        }

        sessions.append(new_session)

        # Save updated sessions list
        db.save_session_state(session_id, 'user_sessions', {'sessions': sessions})

        return jsonify({'session': new_session})
    except Exception as e:
        logger.error(f"Error creating user session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/user-sessions/<user_session_id>', methods=['GET'])
@with_session(db)
def get_user_session_data(session_id, user_session_id):
    """Get data for a specific user session"""
    try:
        # Retrieve session data with key pattern
        session_data = db.get_session_state(session_id, f'user_session_{user_session_id}')

        if session_data is None:
            return jsonify({'error': 'Session not found'}), 404

        return jsonify({'data': session_data})
    except Exception as e:
        logger.error(f"Error getting user session data: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/user-sessions/<user_session_id>', methods=['PUT'])
@with_session(db)
def update_user_session_data(session_id, user_session_id):
    """Update data for a specific user session"""
    try:
        data = request.json or {}

        # Save session data
        db.save_session_state(session_id, f'user_session_{user_session_id}', data)

        # Update metadata in sessions list
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])

        for sess in sessions:
            if sess['id'] == user_session_id:
                sess['updatedAt'] = datetime.utcnow().isoformat()
                if 'goalPreview' in data:
                    sess['goalPreview'] = data['goalPreview'][:80]
                break

        db.save_session_state(session_id, 'user_sessions', {'sessions': sessions})

        return jsonify({'saved': True})
    except Exception as e:
        logger.error(f"Error updating user session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/user-sessions/<user_session_id>', methods=['DELETE'])
@with_session(db)
def delete_user_session(session_id, user_session_id):
    """Delete a user session"""
    try:
        # Get sessions list
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])

        # Can't delete if it's the only session
        if len(sessions) <= 1:
            return jsonify({'error': 'Cannot delete the last session'}), 400

        # Remove session from list
        sessions = [s for s in sessions if s['id'] != user_session_id]

        # Save updated list
        db.save_session_state(session_id, 'user_sessions', {'sessions': sessions})

        # Note: We could also delete the session data, but keeping it allows recovery
        # db.save_session_state(session_id, f'user_session_{user_session_id}', None)

        return jsonify({'deleted': True})
    except Exception as e:
        logger.error(f"Error deleting user session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/user-sessions/<user_session_id>/duplicate', methods=['POST'])
@with_session(db)
def duplicate_user_session(session_id, user_session_id):
    """Duplicate a user session"""
    try:
        import uuid

        # Get original session data
        original_data = db.get_session_state(session_id, f'user_session_{user_session_id}')
        if original_data is None:
            return jsonify({'error': 'Session not found'}), 404

        # Get sessions list
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])

        # Find original session metadata
        original_session = next((s for s in sessions if s['id'] == user_session_id), None)
        if not original_session:
            return jsonify({'error': 'Session not found'}), 404

        # Create new session
        new_session_id = f"s-{int(time.time())}-{uuid.uuid4().hex[:6]}"
        new_session = {
            'id': new_session_id,
            'name': f"{original_session['name']} (copy)",
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat(),
            'goalPreview': original_session.get('goalPreview', '')
        }

        sessions.append(new_session)

        # Save duplicated data
        db.save_session_state(session_id, f'user_session_{new_session_id}', original_data)
        db.save_session_state(session_id, 'user_sessions', {'sessions': sessions})

        return jsonify({'session': new_session})
    except Exception as e:
        logger.error(f"Error duplicating user session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/user-sessions/<user_session_id>/rename', methods=['PUT'])
@with_session(db)
def rename_user_session(session_id, user_session_id):
    """Rename a user session"""
    try:
        data = request.json or {}
        new_name = data.get('name', 'Unnamed Session')

        # Get sessions list
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])

        # Update session name
        for sess in sessions:
            if sess['id'] == user_session_id:
                sess['name'] = new_name
                sess['updatedAt'] = datetime.utcnow().isoformat()
                break

        # Save updated list
        db.save_session_state(session_id, 'user_sessions', {'sessions': sessions})

        return jsonify({'renamed': True})
    except Exception as e:
        logger.error(f"Error renaming user session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ─── Export/Import Endpoints ───────────────────────────────────────────────────

@app.route('/api/export/all', methods=['GET'])
@with_session(db)
def export_all_sessions(session_id):
    """Export all user sessions and their data as JSON"""
    try:
        # Get all sessions
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])

        # Collect all session data
        export_data = {
            'metadata': {
                'exported_at': datetime.utcnow().isoformat(),
                'version': '1.0',
                'total_sessions': len(sessions)
            },
            'sessions': []
        }

        for sess in sessions:
            # Get session data
            session_data = db.get_session_state(session_id, f'user_session_{sess["id"]}')

            export_data['sessions'].append({
                'metadata': sess,
                'data': session_data
            })

        return jsonify(export_data)
    except Exception as e:
        logger.error(f"Error exporting sessions: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/export/session/<user_session_id>', methods=['GET'])
@with_session(db)
def export_single_session(session_id, user_session_id):
    """Export a single user session as JSON"""
    try:
        # Get sessions list to find metadata
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])

        session_meta = next((s for s in sessions if s['id'] == user_session_id), None)
        if not session_meta:
            return jsonify({'error': 'Session not found'}), 404

        # Get session data
        session_data = db.get_session_state(session_id, f'user_session_{user_session_id}')

        export_data = {
            'metadata': {
                'exported_at': datetime.utcnow().isoformat(),
                'version': '1.0'
            },
            'session': {
                'metadata': session_meta,
                'data': session_data
            }
        }

        return jsonify(export_data)
    except Exception as e:
        logger.error(f"Error exporting session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/import/sessions', methods=['POST'])
@with_session(db)
def import_sessions(session_id):
    """Import sessions from JSON export"""
    try:
        import_data = request.json or {}

        if 'sessions' not in import_data:
            return jsonify({'error': 'Invalid import format - missing sessions array'}), 400

        # Get current sessions
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])

        imported_count = 0
        imported_sessions = []

        for session_entry in import_data['sessions']:
            try:
                session_meta = session_entry.get('metadata', {})
                session_data = session_entry.get('data', {})

                # Generate new ID to avoid conflicts
                new_session_id = f"s-{int(time.time())}-{uuid.uuid4().hex[:6]}"

                # Create new session metadata
                new_session = {
                    'id': new_session_id,
                    'name': f"{session_meta.get('name', 'Imported Session')} (imported)",
                    'createdAt': datetime.utcnow().isoformat(),
                    'updatedAt': datetime.utcnow().isoformat(),
                    'goalPreview': session_meta.get('goalPreview', '')
                }

                sessions.append(new_session)

                # Save session data
                if session_data:
                    db.save_session_state(session_id, f'user_session_{new_session_id}', session_data)

                imported_sessions.append(new_session)
                imported_count += 1

            except Exception as session_error:
                logger.error(f"Error importing individual session: {session_error}")
                continue

        # Save updated sessions list
        db.save_session_state(session_id, 'user_sessions', {'sessions': sessions})

        return jsonify({
            'imported': imported_count,
            'sessions': imported_sessions
        })
    except Exception as e:
        logger.error(f"Error importing sessions: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/import/session', methods=['POST'])
@with_session(db)
def import_single_session(session_id):
    """Import a single session from JSON export"""
    try:
        import_data = request.json or {}

        if 'session' not in import_data:
            return jsonify({'error': 'Invalid import format - missing session object'}), 400

        session_entry = import_data['session']
        session_meta = session_entry.get('metadata', {})
        session_data = session_entry.get('data', {})

        # Get current sessions
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])

        # Generate new ID
        new_session_id = f"s-{int(time.time())}-{uuid.uuid4().hex[:6]}"

        # Create new session metadata
        new_session = {
            'id': new_session_id,
            'name': f"{session_meta.get('name', 'Imported Session')} (imported)",
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat(),
            'goalPreview': session_meta.get('goalPreview', '')
        }

        sessions.append(new_session)

        # Save session data
        if session_data:
            db.save_session_state(session_id, f'user_session_{new_session_id}', session_data)

        # Save updated sessions list
        db.save_session_state(session_id, 'user_sessions', {'sessions': sessions})

        return jsonify({
            'imported': True,
            'session': new_session
        })
    except Exception as e:
        logger.error(f"Error importing session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ─── End Export/Import Endpoints ───────────────────────────────────────────────

# ─── Default Agent Configs ─────────────────────────────────────────────────────

@app.route('/api/default-agents', methods=['GET'])
def get_default_agents():
    """Return default agent configurations (parsed from agents.ts)"""
    import os, re
    try:
        agents_path = next(
            (p for p in ['src/config/agents.ts', '/app/src/config/agents.ts'] if os.path.exists(p)),
            None
        )
        if not agents_path:
            return jsonify({'error': 'agents.ts not found'}), 404

        with open(agents_path) as f:
            content = f.read()

        # Extract each agent block by matching id: '...' through to the next id: or end
        # Find all agent id positions, then slice content between them
        id_positions = [m.start() for m in re.finditer(r"id:\s*'agent-", content)]
        if not id_positions:
            raise ValueError("No agent blocks found in agents.ts")

        agents = []
        for i, pos in enumerate(id_positions):
            end = id_positions[i + 1] if i + 1 < len(id_positions) else len(content)
            block = content[pos:end]

            id_m = re.search(r"id:\s*'([^']+)'", block)
            name_m = re.search(r"name:\s*'([^']+)'", block)
            if not (id_m and name_m):
                continue

            model_m = re.search(r"model:\s*'([^']+)'", block)
            temp_m = re.search(r"temperature:\s*([\d.]+)", block)
            enabled_m = re.search(r"enabled:\s*(true|false)", block)
            desc_m = re.search(r"description:\s*'([^']*)'", block)
            prompt_m = re.search(r'systemPrompt:\s*`(.*?)`', block, re.DOTALL)
            nc_m = re.search(r'nodeCount:\s*\{[^}]*default:\s*(\d+)[^}]*min:\s*(\d+)[^}]*max:\s*(\d+)', block)

            agent = {
                'id': id_m.group(1),
                'name': name_m.group(1),
                'model': model_m.group(1) if model_m else 'gpt-4.1',
                'temperature': float(temp_m.group(1)) if temp_m else 0.4,
                'enabled': enabled_m.group(1) == 'true' if enabled_m else True,
                'description': desc_m.group(1) if desc_m else '',
                'systemPrompt': prompt_m.group(1) if prompt_m else '',
                'settings': {},
            }
            if nc_m:
                agent['settings']['nodeCount'] = {
                    'default': int(nc_m.group(1)),
                    'min': int(nc_m.group(2)),
                    'max': int(nc_m.group(3)),
                }
            agents.append(agent)

        # Map to step IDs for convenience
        step_map = {
            'agent-initiator': 1,
            'agent-immortalist': 2,
            'agent-requirement-engineer': 3,
            'agent-domain-mapper': '4a',
            'agent-biologist': '4b',
            'agent-judge': 5,
            'agent-l3-explorer': 6,
            'agent-instantiator': 7,
            'agent-explorer': 8,
            'agent-tactical-engineer': 9,
            'agent-common-l6-synthesizer': 10,
        }
        for a in agents:
            a['stepId'] = step_map.get(a['id'])

        return jsonify({'agents': agents, 'total': len(agents)})
    except Exception as e:
        logger.error(f"Error reading agent configs: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ─── Community Sessions ────────────────────────────────────────────────────────

@app.route('/api/community-sessions', methods=['GET'])
def list_community_sessions():
    """List all published community sessions (no auth required)"""
    try:
        limit = request.args.get('limit', 50, type=int)
        offset = request.args.get('offset', 0, type=int)
        sessions, total = db.list_community_sessions(limit=limit, offset=offset)
        return jsonify({'sessions': sessions, 'total': total})
    except Exception as e:
        logger.error(f"Error listing community sessions: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/community-sessions/<community_id>', methods=['GET'])
def get_community_session(community_id):
    """Get full community session data (for cloning)"""
    try:
        result = db.get_community_session(community_id)
        if not result:
            return jsonify({'error': 'Community session not found'}), 404
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error getting community session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/community-sessions/<community_id>/clone', methods=['POST'])
@with_session(db)
def clone_community_session(session_id, community_id):
    """Clone a community session into the current user's sessions"""
    try:
        import uuid as uuid_mod

        # Get community session data
        community = db.get_community_session(community_id)
        if not community:
            return jsonify({'error': 'Community session not found'}), 404

        # Get current user sessions
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])

        # Create new local session from community data
        new_session_id = f"s-{int(time.time())}-{uuid_mod.uuid4().hex[:6]}"
        new_session = {
            'id': new_session_id,
            'name': f"{community['name']}",
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat(),
            'goalPreview': community.get('goalPreview', ''),
            'clonedFrom': community_id,
        }

        sessions.append(new_session)

        # Save session data
        if community.get('data'):
            db.save_session_state(session_id, f'user_session_{new_session_id}', community['data'])
        db.save_session_state(session_id, 'user_sessions', {'sessions': sessions})

        # Increment clone counter
        db.increment_community_clone_count(community_id)

        return jsonify({'session': new_session})
    except Exception as e:
        logger.error(f"Error cloning community session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/user-sessions/<user_session_id>/publish', methods=['POST'])
@with_session(db)
def publish_user_session(session_id, user_session_id):
    """Publish a user session to the community"""
    try:
        data = request.json or {}
        author = data.get('author', 'Anonymous')
        tags = data.get('tags', [])

        # Get session metadata
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])
        session_meta = next((s for s in sessions if s['id'] == user_session_id), None)

        if not session_meta:
            return jsonify({'error': 'Session not found'}), 404

        # Get session data
        session_data = db.get_session_state(session_id, f'user_session_{user_session_id}')
        if not session_data:
            return jsonify({'error': 'Session has no data'}), 400

        # Publish to community
        community_id = f"c-{user_session_id}"
        db.publish_community_session(
            community_id=community_id,
            name=session_meta.get('name', 'Unnamed Session'),
            author=author,
            goal_preview=session_meta.get('goalPreview', ''),
            session_data=session_data,
            browser_session_id=session_id,
            tags=tags,
        )

        return jsonify({'published': True, 'communityId': community_id})
    except Exception as e:
        logger.error(f"Error publishing session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ─── End Community Sessions ────────────────────────────────────────────────────

# ─── End User Session Management ───────────────────────────────────────────────

# ─── End Session Management Endpoints ─────────────────────────────────────────

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
        logger.warning("⚠️  WARNING: API_PROVIDER=openrouter but OPENROUTER_API_KEY is not set!")
    client = OpenAI(
        api_key=openrouter_key,
        base_url=openrouter_base,
    )
    logger.info(f"🔌 Provider: OpenRouter ({openrouter_base})")
else:
    client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
    logger.info(f"🔌 Provider: OpenAI (direct)")


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
    # Validate required agent_config fields
    required_fields = ['name', 'model', 'temperature', 'systemPrompt']
    missing_fields = [field for field in required_fields if field not in agent_config]
    if missing_fields:
        raise ValueError(f"agent_config missing required fields: {', '.join(missing_fields)}. "
                        f"Available fields: {', '.join(agent_config.keys())}")

    start_time = time.time()

    # Enhanced logging for Step 4
    if step_id == 4:
        # Determine if this is Phase 4a or 4b based on input structure
        if 'target_domain' in input_data:
            phase = "4b (Domain Scan)"
            domain_id = input_data.get('target_domain', {}).get('domain_id', 'unknown')
            domain_name = input_data.get('target_domain', {}).get('domain_name', 'unknown')
            goal_id = input_data.get('target_goal', {}).get('id', 'unknown')
            logger.info(f"\n{'='*60}")
            logger.info(f"[Step 4b] 🔬 DOMAIN SCAN STARTING")
            logger.info(f"{'='*60}")
            logger.info(f"  Goal: {goal_id}")
            logger.info(f"  Domain: {domain_id}")
            logger.info(f"  Domain Name: {domain_name}")
            logger.info(f"  Agent: {agent_config.get('name', 'Unknown')}")
            logger.info(f"  Model: {agent_config.get('model', 'Unknown')}")
            logger.info(f"  Temperature: {agent_config.get('temperature', 'Unknown')}")
        else:
            phase = "4a (Domain Mapping)"
            goal_id = input_data.get('target_goal', {}).get('id', 'unknown')
            logger.info(f"\n{'='*60}")
            logger.info(f"[Step 4a] 🗺️  DOMAIN MAPPING STARTING")
            logger.info(f"{'='*60}")
            logger.info(f"  Goal: {goal_id}")
            logger.info(f"  Agent: {agent_config.get('name', 'Unknown')}")
            logger.info(f"  Model: {agent_config.get('model', 'Unknown')}")
            logger.info(f"  Temperature: {agent_config.get('temperature', 'Unknown')}")
    
    # Prepare the prompt based on step
    user_prompt = prepare_user_prompt(step_id, input_data)
    
    # Log prompt size
    if step_id == 4:
        logger.info(f"  Input size: {len(user_prompt)} characters")

    # Prepare system prompt with interpolated values (globalLens overrides agent-level lens)
    system_prompt = interpolate_prompt(agent_config, global_lens)
    
    # Add JSON instruction to system prompt (required by OpenAI for json_object mode)
    if "JSON" not in system_prompt and "json" not in system_prompt:
        system_prompt += "\n\nIMPORTANT: You must respond with valid JSON only."

    # Step-specific timeout settings
    # Steps with many nodes need more time and token capacity
    if step_id == 4:
        timeout_seconds = 300  # 5 minutes for Step 4 (domain specialist)
        max_tokens = 32000  # Allow larger responses for Step 4
        logger.info(f"  Timeout: {timeout_seconds}s")
        logger.info(f"  Max tokens: {max_tokens}")
    elif step_id == 9:
        timeout_seconds = 360  # 6 minutes for Step 9 (L5/L6 generation with hierarchies)
        max_tokens = 32000  # Large token budget for drill-down hierarchies
    elif step_id == 10:
        timeout_seconds = 300  # 5 minutes for Step 10 (convergence analysis across many L6 tasks)
        max_tokens = 28000
    elif step_id in [6, 7, 8]:  # L3, IH, L4 steps
        timeout_seconds = 240  # 4 minutes
        max_tokens = 28000
    else:
        timeout_seconds = 180  # 3 minutes for other steps
        max_tokens = 24000

    if step_id == 4:
        logger.info(f"  ⏳ Sending request to OpenAI...")
    else:
        logger.info(f"[Step {step_id}] Calling OpenAI API with model: {agent_config['model']} (timeout: {timeout_seconds}s)")
    
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
        logger.info(f"  ✅ API call completed in {api_duration:.2f}s")
        logger.info(f"  📊 Tokens - Prompt: {usage.prompt_tokens}, Completion: {usage.completion_tokens}, Total: {usage.total_tokens}")
        logger.info(f"  💰 Estimated cost: ${(usage.prompt_tokens * 0.00001 + usage.completion_tokens * 0.00003):.4f}")
    else:
        logger.info(f"[Step {step_id}] API call completed in {api_duration:.2f}s")
        logger.info(f"[Step {step_id}] Tokens - Prompt: {usage.prompt_tokens}, Completion: {usage.completion_tokens}, Total: {usage.total_tokens}")

    # Parse JSON response
    try:
        result = json.loads(response_text)
        total_duration = time.time() - start_time
        
        if step_id == 4:
            # Enhanced logging for Step 4 results
            if 'target_domain' in input_data:
                # Phase 4b - Domain Scan
                pillars = result.get('scientific_pillars', [])
                logger.info(f"  📦 Generated {len(pillars)} scientific pillars")
                if pillars:
                    # Show sample pillars
                    logger.info(f"  📋 Sample interventions:")
                    for i, pillar in enumerate(pillars[:3]):
                        logger.info(f"     {i+1}. {pillar.get('id', 'N/A')}: {pillar.get('title', 'N/A')[:60]}...")
                    if len(pillars) > 3:
                        logger.info(f"     ... and {len(pillars) - 3} more")
                logger.info(f"  ⏱️  Total execution time: {total_duration:.2f}s")
                logger.info(f"{'='*60}\n")
            else:
                # Phase 4a - Domain Mapping
                domains = result.get('research_domains', [])
                logger.info(f"  🗺️  Identified {len(domains)} research domains")
                if domains:
                    logger.info(f"  📋 Domains:")
                    for i, domain in enumerate(domains):
                        logger.info(f"     {i+1}. {domain.get('domain_id', 'N/A')}: {domain.get('domain_name', 'N/A')} [{domain.get('relevance_to_goal', 'N/A')}]")
                logger.info(f"  ⏱️  Total execution time: {total_duration:.2f}s")
                logger.info(f"{'='*60}\n")
        else:
            logger.info(f"[Step {step_id}] Total execution time: {total_duration:.2f}s")
        
        return result
    except json.JSONDecodeError as parse_error:
        if step_id == 4:
            logger.error(f"  ❌ Failed to parse JSON response: {parse_error}")
            logger.info(f"  📄 Response preview: {response_text[:200]}...")
            logger.info(f"{'='*60}\n")
        else:
            print(f'[Step {step_id}] Failed to parse JSON response: {parse_error}')
        return {'raw_response': response_text, 'parse_error': str(parse_error)}

@app.route('/api/execute-step', methods=['POST'])
@with_session(db)
def execute_step(session_id):
    """Execute a single pipeline step"""
    try:
        data = request.json
        step_id = data.get('stepId')
        agent_config = data.get('agentConfig')
        input_data = data.get('input')
        global_lens = data.get('globalLens')  # User-configured epistemic lens

        logger.info(f'\n=== Executing Step {step_id} (Session: {session_id[:8]}...) ===')
        logger.info(f'Agent: {agent_config.get("name")}')
        logger.info(f"User Prompt (truncated): {str(input_data)[:200]}...")

        result = execute_single_item(step_id, agent_config, input_data, global_lens)

        logger.info(f"\nResponse received ({len(str(result))} chars)")
        logger.info(f"Parsed JSON keys: {list(result.keys())}")

        # Save step output to database
        try:
            state_key = f'step_{step_id}_output'
            db.save_session_state(session_id, state_key, result)
        except Exception as e:
            logger.warning(f"Warning: Failed to save step output to database: {e}")

        return jsonify(result)

    except Exception as error:
        logger.error(f'Error executing step: {error}')
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
@with_session(db)
def execute_step_batch(session_id):
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
        print(f'### BATCH EXECUTION: Step {step_id} - {agent_config.get("name")} (Session: {session_id[:8]}...)')
        print(f'{"#"*70}')
        print(f'📦 Total items to process: {len(items)}')

        # Adjust max workers — maximize parallelism for speed
        # Capped by MAX_BATCH_WORKERS env var (default 15)
        max_workers = min(len(items), MAX_BATCH_WORKERS)
        print(f'⚡ Processing {len(items)} items in PARALLEL with {max_workers} workers (MAX_BATCH_WORKERS={MAX_BATCH_WORKERS})...')

        results = [None] * len(items)  # Pre-allocate results list
        _clear_progress(session_id, step_id)  # Reset progress for this session+step
        
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
            _update_progress(session_id, step_id, 0, len(items), 0, 0, 0, 0)
            
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
                        session_id, step_id, completed, len(items),
                        successful_so_far, failed_so_far,
                        elapsed, eta_seconds,
                        latest_item={'index': idx, 'success': True}
                    )
                    
                    if step_id == 4:
                        logger.info(f"\n{'─'*60}")
                        logger.info(f"✅ PROGRESS: {phase_label} ({progress_pct:.1f}% overall)")
                        logger.info(f"⏱️  Elapsed: {elapsed/60:.1f} min | Avg: {avg_time_per_item:.1f}s/item")
                        if remaining_items > 0:
                            logger.info(f"⏳ ETA: {eta_minutes:.1f} min ({remaining_items} items remaining)")
                        logger.info(f"{'─'*60}")
                    else:
                        logger.info(f"✓ Item {idx + 1}/{len(items)} completed ({completed}/{len(items)} total)")
                        
                except Exception as item_error:
                    if step_id == 4:
                        logger.info(f"\n{'─'*60}")
                        logger.info(f"❌ FAILED: Item {idx + 1}/{len(items)}")
                        logger.error(f"Error: {item_error}")
                        logger.info(f"Progress: {phase_label} ({progress_pct:.1f}% overall)")
                        logger.info(f"{'─'*60}")
                    else:
                        logger.info(f"✗ Item {idx + 1}/{len(items)} failed: {item_error}")
                    
                    results[idx] = {
                        'success': False,
                        'error': str(item_error),
                        'item_index': idx
                    }
                    failed_so_far += 1
                    
                    # Update real-time progress via SSE store
                    _update_progress(
                        session_id, step_id, completed, len(items),
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
            logger.info(f"\n{'#'*70}")
            logger.info(f"### BATCH COMPLETE: Step {step_id}")
            logger.info(f"{'#'*70}")
            logger.info(f"✅ Successful: {successful_count}/{len(items)}")
            logger.info(f"❌ Failed: {failed_count}/{len(items)}")
            logger.info(f"⏱️  Total time: {total_batch_time/60:.1f} minutes")
            logger.info(f"📊 Average: {total_batch_time/len(items):.1f}s per item")
            logger.info(f"{'#'*70}\n")
        else:
            logger.info(f"\n=== Batch Complete: {successful_count}/{len(items)} successful ===")

        _clear_progress(session_id, step_id)  # Clean up progress store

        # Save batch results to database
        batch_summary = {
            'batch_results': completed_results,
            'total_processed': len(completed_results),
            'successful': successful_count,
            'failed': len(completed_results) - successful_count,
            'completed_at': datetime.now().isoformat()
        }
        try:
            state_key = f'step_{step_id}_batch'
            db.save_session_state(session_id, state_key, batch_summary)
        except Exception as e:
            logger.warning(f"Warning: Failed to save batch results to database: {e}")

        return jsonify(batch_summary)

    except Exception as error:
        logger.error(f'Error in batch execution: {error}', exc_info=True)
        try:
            _clear_progress(session_id, step_id)  # Clean up on error too
        except:
            pass  # session_id/step_id might not be defined if error happened early
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
        
        logger.info(f"\nStep 2 Debug: Q0 = {q0_text[:100] if q0_text else 'None'}...")
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
        
        logger.info(f"\nStep 3 Debug: Processing goal {goal.get('id', 'unknown')}")
        
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
        
        logger.info(f"\nStep 4 Debug:")
        logger.info(f"  Q0: {q0_reference[:50] if q0_reference else 'N/A'}...")
        logger.info(f"  Target Goal: {target_goal.get('id', 'N/A')}")
        logger.info(f"  Requirement Atoms: {len(requirement_atoms)}")
        logger.info(f"  SPVs: {len(spvs)}")
        
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
        
        logger.info(f"\nStep 5 Debug (NEW MODE - Evaluate G-S Links):")
        logger.info(f"  Processing Goal: {goal_id}")
        logger.info(f"  RAs found: {len(ras)}")
        logger.info(f"  Scientific Pillars (S-Nodes for this Goal): {len(scientific_pillars)}")
        logger.info(f"  Bridge Lexicon FCCs: {len(bridge_lexicon.get('failure_channels', []))}")
        logger.info(f"  Bridge Lexicon SPVs: {len(bridge_lexicon.get('system_properties', []))}")
        
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

        logger.info(f"\nStep 6 Debug: Processing Goal {goal_id}")
        logger.info(f"  - Scientific pillars: {len(scientific_pillars)}")
        logger.info(f"  - Relationship summary: {len(relationship_summary)} samples")

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
        
        logger.info(f"\nStep 7 Debug: Processing L3 question: {l3_question.get('id', 'unknown')}")
        logger.info(f"  Parent Goal: {goal_id}, RAs: {len(ras)}, S-nodes: {len(scientific_pillars)}")
        
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
        
        logger.info(f"\nStep 8 Debug: Processing L3 question {l3_question.get('id', 'unknown')}")
        logger.info(f"  Parent Goal: {goal.get('id', 'unknown')}, RAs: {len(ras)}, IHs: {len(ihs)}")
        
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
    # NOTE: L4 and later nodes do NOT receive S-nodes (step5), only RAs (step3)
    elif step_id == 9:
        step3_data = input_data.get('step3', {}) if isinstance(input_data, dict) else {}

        # Check if this is a batch call with single L4 question
        if 'l4_question' in input_data:
            l4_question = input_data['l4_question']
        else:
            # Legacy: process first L4 from step 8
            step8_data = input_data.get('step8', {}) if isinstance(input_data, dict) else {}
            l4_questions = step8_data.get('l4_questions', step8_data.get('child_nodes_L4', []))
            l4_question = l4_questions[0] if l4_questions else {}

        # Debug: Log raw input data structure
        logger.info(f"\n{'='*60}")
        logger.info(f"[Step 9 Debug] L4 question: {l4_question.get('id', 'unknown')}")
        logger.info(f"[Step 9 Debug] L4 parent_l3_id: {l4_question.get('parent_l3_id', 'N/A')}")
        logger.info(f"[Step 9 Debug] L4 parent_goal_id: {l4_question.get('parent_goal_id', 'N/A')}")
        logger.info(f"[Step 9 Debug] input_data keys: {list(input_data.keys()) if isinstance(input_data, dict) else 'N/A'}")
        logger.info(f"[Step 9 Debug] step3_data type: {type(step3_data).__name__}")
        if isinstance(step3_data, dict):
            logger.info(f"[Step 9 Debug] step3_data keys: {list(step3_data.keys())}")
        elif isinstance(step3_data, list):
            logger.info(f"[Step 9 Debug] step3_data length: {len(step3_data)}")
        logger.info(f"{'='*60}")

        # Get RAs — now goal-specific (list) or legacy (dict keyed by goal ID)
        ras = []
        if isinstance(step3_data, list):
            ras = step3_data
        elif isinstance(step3_data, dict):
            for value in step3_data.values():
                if isinstance(value, list):
                    ras.extend(value)

        q0_ref = input_data.get('Q0_reference', '')

        logger.info(f"\nStep 9 Debug: Processing L4 question {l4_question.get('id', 'unknown')}")
        logger.info(f"  RAs: {len(ras)}")
        
        return f"""Master Project Question (Q0):
{q0_ref}

L4 Tactical Question:
{json.dumps(l4_question, indent=2)}

Requirement Atoms (for parent Goal):
{json.dumps(ras[:3], indent=2)}

Generate L5 mechanistic sub-questions and L6 experiment-ready tasks (with S-I-M-T parameters) for this specific L4 question."""
    
    # STEP 10: INPUT: Q0, L4 question, all L6 tasks for that L4 branch | OUTPUT: Common experiment or impossibility verdict
    elif step_id == 10:
        q0_text = input_data.get('q0', '')
        l4_question = input_data.get('l4_question', {})
        l6_tasks = input_data.get('l6_tasks', [])
        
        logger.info(f"\nStep 10 Debug: Processing L4 {l4_question.get('id', 'unknown')}")
        logger.info(f"  L6 tasks: {len(l6_tasks)}")
        
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
@with_session(db)
def improve_node(session_id):
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
            logger.info(f"[Node Improvement] Error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
            'Transfer-Encoding': 'chunked',
            'Content-Type': 'text/event-stream; charset=utf-8',
        }
    )

@app.route('/api/node-chat', methods=['POST'])
@with_session(db)
def node_chat(session_id):
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

    logger.info(f"\n[Node Chat] Model: {model}, Nodes: {len(selected_nodes)}, History: {len(messages_history)} messages")

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
            logger.info(f"[Node Chat] Error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
            'Transfer-Encoding': 'chunked',
            'Content-Type': 'text/event-stream; charset=utf-8',
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
    
    logger.info(f"\n🚀 OMEGA-POINT Server running on port {port}")
    logger.info(f"📡 API endpoint: http://localhost:{port}/api")
    logger.info(f"🔌 API Provider: {API_PROVIDER}")
    logger.info(f"🌍 Mode: {'PRODUCTION' if IS_PRODUCTION else 'DEVELOPMENT'}")
    if IS_PRODUCTION:
        logger.info(f"📁 Serving frontend from: {os.path.abspath(DIST_DIR)}")
    if API_PROVIDER == 'openrouter':
        key_status = '✓ Configured' if os.getenv('OPENROUTER_API_KEY') else '✗ Missing'
        logger.info(f"🔑 OpenRouter API Key: {key_status}")
    else:
        key_status = '✓ Configured' if os.getenv('OPENAI_API_KEY') else '✗ Missing'
        logger.info(f"🔑 OpenAI API Key: {key_status}")
    
    app.run(host='0.0.0.0', port=port, debug=not IS_PRODUCTION)

from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from openai import OpenAI
import os
import json
import time
import re
import math
import random
import threading
import sys
import logging
import hashlib
import hmac
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from dotenv import load_dotenv

# Import multi-session support modules
import uuid
from sqlalchemy import text
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

# Import Step 4 Optimized modules (after logging configured)
try:
    from step4_integration import execute_step4_for_flask, get_cache_statistics_for_flask, cleanup_step4
    STEP4_OPTIMIZED_AVAILABLE = True
    logger.info("✓ Step 4 Optimized modules loaded")
except ImportError as e:
    STEP4_OPTIMIZED_AVAILABLE = False
    logger.warning(f"⚠ Step 4 Optimized not available: {e}")
    logger.warning("  Continuing with standard Step 4 implementation...")

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

# ─── Periodic cleanup thread ─────────────────────────────────────────────────
def _periodic_cleanup():
    """Background daemon that cleans up expired sessions and orphaned feedback."""
    import time as _time
    _time.sleep(60)  # let app fully start
    while True:
        try:
            expired = db.cleanup_expired_sessions()
            orphaned = db.cleanup_old_orphaned_feedback(days=90)
            if expired or orphaned:
                logger.info(f"Cleanup: removed {expired} expired sessions, {orphaned} orphaned feedback entries")
        except Exception as exc:
            logger.warning(f"Periodic cleanup error: {exc}")
        _time.sleep(6 * 3600)  # every 6 hours

_cleanup_thread = threading.Thread(target=_periodic_cleanup, daemon=True)
_cleanup_thread.start()
logger.info("Started periodic cleanup thread (runs every 6h)")
sys.stdout.flush()

# Max parallel workers for batch execution (configurable via .env)
# Reduced to 15 to prevent 429 rate-limit storms on OpenRouter
MAX_BATCH_WORKERS = int(os.getenv('MAX_BATCH_WORKERS', '15'))

# In production, serve the built frontend from ../dist
DIST_DIR = os.path.join(os.path.dirname(__file__), '..', 'dist')
IS_PRODUCTION = os.getenv('NODE_ENV', 'development') == 'production'

if IS_PRODUCTION and os.path.isdir(DIST_DIR):
    app = Flask(__name__, static_folder=DIST_DIR, static_url_path='')
else:
    app = Flask(__name__)

CORS(app, supports_credentials=True)

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
        max_age=max_age or (60 * 24 * 60 * 60)  # 60 days default
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
@optional_session(db)
def list_user_sessions(session_id):
    """Get all user sessions (UI sessions) for the current browser session"""
    auto_created = False
    # Auto-create session if none exists
    if not session_id:
        try:
            session_id = db.create_session()
            auto_created = True
            logger.info(f"Auto-created session for user-sessions GET: {session_id}")
        except Exception as e:
            logger.error(f"Failed to auto-create session: {e}")
            return jsonify({'error': 'Failed to create session', 'details': str(e)}), 500
    try:
        # Retrieve sessions list from state
        sessions_data = db.get_session_state(session_id, 'user_sessions')

        if sessions_data is None:
            resp = jsonify({'sessions': [], 'session_id': session_id})
        else:
            resp = jsonify({'sessions': sessions_data.get('sessions', []), 'session_id': session_id})

        # Set cookie when auto-creating so browser has it for subsequent requests
        if auto_created:
            set_secure_cookie(resp, 'session_id', session_id)

        return resp
    except Exception as e:
        logger.error(f"Error listing user sessions: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/user-sessions', methods=['POST'])
@optional_session(db)
def create_user_session(session_id):
    """Create a new user session (UI session)"""
    auto_created = False
    # Auto-create session if none exists
    if not session_id:
        try:
            session_id = db.create_session()
            auto_created = True
            logger.info(f"Auto-created session for user-sessions POST: {session_id}")
        except Exception as e:
            logger.error(f"Failed to auto-create session: {e}")
            return jsonify({'error': 'Failed to create session', 'details': str(e)}), 500
    try:
        data = request.json or {}
        user_session_name = data.get('name', 'New Session')
        user_session_author = data.get('author', '')

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
            'goalPreview': '',
            'author': user_session_author or '',
            'isBookmarked': False,
        }

        sessions.append(new_session)

        # Save updated sessions list
        db.save_session_state(session_id, 'user_sessions', {'sessions': sessions})

        resp = jsonify({'session': new_session, 'session_id': session_id})

        # Set cookie when auto-creating so browser has it for subsequent requests
        if auto_created:
            set_secure_cookie(resp, 'session_id', session_id)

        return resp
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

        # Create new session (preserve author and bookmark state from original)
        new_session_id = f"s-{int(time.time())}-{uuid.uuid4().hex[:6]}"
        new_session = {
            'id': new_session_id,
            'name': f"{original_session['name']} (copy)",
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat(),
            'goalPreview': original_session.get('goalPreview', ''),
            'author': original_session.get('author', ''),
            'isBookmarked': False,
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
            # Parse nodeCount with any key order (min/max/default)
            nc_block_m = re.search(r'nodeCount:\s*\{([^}]+)\}', block)
            nc_vals = {}
            if nc_block_m:
                nc_text = nc_block_m.group(1)
                for key in ('min', 'max', 'default'):
                    m = re.search(rf'{key}:\s*(\d+)', nc_text)
                    if m:
                        nc_vals[key] = int(m.group(1))

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
            if nc_vals:
                agent['settings']['nodeCount'] = {
                    'default': nc_vals.get('default', nc_vals.get('min', 5)),
                    'min': nc_vals.get('min', 3),
                    'max': nc_vals.get('max', 7),
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


@app.route('/api/community-sessions/count', methods=['GET'])
def community_sessions_count():
    """Lightweight endpoint returning only the community session count"""
    try:
        _, total = db.list_community_sessions(limit=0, offset=0)
        return jsonify({'total': total})
    except Exception as e:
        logger.error(f"Error getting community session count: {e}", exc_info=True)
        return jsonify({'total': 0})


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

        # Get session data — try current browser session first, then search all sessions
        session_data = db.get_session_state(session_id, f'user_session_{user_session_id}')

        if not session_data:
            # Session data may be under a different browser session (e.g. after cookie reset)
            # Search all browser sessions for this user session's data
            logger.info(f"Session data not found under current browser session {session_id}, searching all sessions...")
            db_session_obj = db.get_session()
            try:
                from database import SessionState
                all_matches = db_session_obj.query(SessionState).filter(
                    SessionState.state_key == f'user_session_{user_session_id}'
                ).all()
                if all_matches:
                    session_data = all_matches[0].state_data
                    logger.info(f"Found session data under browser session {all_matches[0].session_id}")
            except Exception as search_err:
                logger.warning(f"Failed to search for session data: {search_err}")
            finally:
                db_session_obj.close()

        if not session_data:
            return jsonify({'error': 'Session has no pipeline data to publish. Run the pipeline first.'}), 400

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

@app.route('/api/community-sessions/<community_id>', methods=['DELETE'])
@with_session(db)
def unpublish_community_session(session_id, community_id):
    """Delete a community session — only allowed by the original publisher (matching browser session)"""
    try:
        cs = db.get_community_session(community_id)
        if not cs:
            return jsonify({'error': 'Community session not found'}), 404

        # Check ownership: sourceBrowserSession must match current session
        source = cs.get('sourceBrowserSession')
        if source and source != session_id:
            return jsonify({'error': 'You can only delete sessions you published'}), 403

        db.delete_community_session(community_id)
        return jsonify({'deleted': True})
    except Exception as e:
        logger.error(f"Error unpublishing community session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ─── Remote Session Sync ──────────────────────────────────────────────────────

def _fetch_json(url, timeout=30):
    """Fetch JSON from a URL using stdlib urllib (no requests dependency)."""
    from urllib.request import urlopen, Request
    from urllib.error import URLError, HTTPError
    req = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'OmegaPoint/1.0'})
    resp = urlopen(req, timeout=timeout)
    return json.loads(resp.read().decode('utf-8'))


@app.route('/api/remote/pull', methods=['POST'])
@with_session(db)
def pull_remote_sessions(session_id):
    """Pull community sessions from a remote server and import them locally.

    Body: {"remote_url": "https://server-a.com", "session_ids": ["id1", "id2"]}
    If session_ids is omitted, pulls ALL community sessions from the remote.
    No authentication needed on the remote — community endpoints are public.
    """
    from urllib.error import URLError, HTTPError
    import uuid as _uuid
    try:
        data = request.json or {}
        remote_url = data.get('remote_url', '').rstrip('/')
        if not remote_url:
            return jsonify({'error': 'remote_url is required'}), 400

        session_ids = data.get('session_ids')  # None = pull all

        # Step 1: List or fetch specific sessions from remote
        if session_ids:
            remote_sessions = []
            for sid in session_ids:
                try:
                    remote_sessions.append(_fetch_json(f'{remote_url}/api/community-sessions/{sid}'))
                except HTTPError as e:
                    logger.warning(f"  ⚠️ Remote session {sid}: {e.code}")
        else:
            listing = _fetch_json(f'{remote_url}/api/community-sessions?limit=200')
            items = listing.get('sessions', [])
            # Fetch full data for each
            remote_sessions = []
            for item in items:
                cid = item.get('id')
                if not cid:
                    continue
                try:
                    remote_sessions.append(_fetch_json(f'{remote_url}/api/community-sessions/{cid}'))
                except HTTPError:
                    continue

        if not remote_sessions:
            return jsonify({'imported': 0, 'message': 'No sessions found on remote'})

        # Step 2: Import into local user sessions
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])
        existing_names = {s.get('name') for s in sessions}

        imported = []
        for remote in remote_sessions:
            name = remote.get('name', 'Remote Session')
            # Skip duplicates by name
            if name in existing_names:
                logger.info(f"  ⏭️ Skipping duplicate: {name}")
                continue

            new_id = f"s-{int(time.time())}-{_uuid.uuid4().hex[:6]}"
            new_session = {
                'id': new_id,
                'name': name,
                'createdAt': datetime.utcnow().isoformat(),
                'updatedAt': datetime.utcnow().isoformat(),
                'goalPreview': remote.get('goal_preview', remote.get('goalPreview', '')),
                'pulledFrom': remote_url,
                'remoteId': remote.get('id', ''),
            }
            sessions.append(new_session)
            existing_names.add(name)

            # Save session data
            session_data = remote.get('data') or remote.get('session_data')
            if session_data:
                db.save_session_state(session_id, f'user_session_{new_id}', session_data)

            imported.append(new_session)
            logger.info(f"  ✅ Imported: {name} → {new_id}")

        db.save_session_state(session_id, 'user_sessions', {'sessions': sessions})
        logger.info(f"  📥 Pulled {len(imported)} sessions from {remote_url}")

        return jsonify({
            'imported': len(imported),
            'sessions': imported,
            'skipped_duplicates': len(remote_sessions) - len(imported),
        })
    except URLError as e:
        return jsonify({'error': f'Cannot connect to {remote_url}: {e.reason}'}), 502
    except Exception as e:
        logger.error(f"Error pulling remote sessions: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/remote/list', methods=['POST'])
def list_remote_sessions():
    """List community sessions available on a remote server (no auth).

    Body: {"remote_url": "https://server-a.com"}
    """
    from urllib.error import URLError
    try:
        data = request.json or {}
        remote_url = data.get('remote_url', '').rstrip('/')
        if not remote_url:
            return jsonify({'error': 'remote_url is required'}), 400

        result = _fetch_json(f'{remote_url}/api/community-sessions?limit=200', timeout=15)
        return jsonify({
            'remote_url': remote_url,
            'sessions': result.get('sessions', []),
            'total': result.get('total', 0),
        })
    except URLError as e:
        return jsonify({'error': f'Cannot connect to {remote_url}: {e.reason}'}), 502
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── End Remote Session Sync ──────────────────────────────────────────────────

# ─── End Community Sessions ────────────────────────────────────────────────────

# ─── Session Bookmarks ────────────────────────────────────────────────────────

@app.route('/api/user-sessions/<user_session_id>/bookmark', methods=['PUT'])
@with_session(db)
def bookmark_user_session(session_id, user_session_id):
    """Toggle bookmark + set author name for a user session"""
    try:
        data = request.json or {}
        is_bookmarked = data.get('isBookmarked', False)
        author = data.get('author', '')

        # Get sessions list
        sessions_data = db.get_session_state(session_id, 'user_sessions') or {'sessions': []}
        sessions = sessions_data.get('sessions', [])

        # Update session bookmark status and author
        for sess in sessions:
            if sess['id'] == user_session_id:
                sess['isBookmarked'] = is_bookmarked
                sess['author'] = author
                sess['updatedAt'] = datetime.utcnow().isoformat()
                break

        # Save updated list
        db.save_session_state(session_id, 'user_sessions', {'sessions': sessions})

        return jsonify({'bookmarked': is_bookmarked, 'author': author})
    except Exception as e:
        logger.error(f"Error bookmarking session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/bookmarked-sessions', methods=['GET'])
def list_bookmarked_sessions():
    """List all bookmarked sessions across ALL browser sessions"""
    try:
        # Query all session_state rows with state_key='user_sessions'
        db_session = db.get_session()
        try:
            from database import SessionState
            results = db_session.query(SessionState).filter(
                SessionState.state_key == 'user_sessions'
            ).all()

            bookmarked = []
            for row in results:
                sessions = (row.state_data or {}).get('sessions', [])
                browser_session_id = str(row.session_id)
                for sess in sessions:
                    if sess.get('isBookmarked'):
                        bookmarked.append({
                            'id': sess['id'],
                            'name': sess.get('name', 'Unnamed'),
                            'author': sess.get('author', ''),
                            'goalPreview': sess.get('goalPreview', ''),
                            'createdAt': sess.get('createdAt', ''),
                            'updatedAt': sess.get('updatedAt', ''),
                            'browserSessionId': browser_session_id,
                        })

            # Sort by updatedAt descending
            bookmarked.sort(key=lambda x: x.get('updatedAt', ''), reverse=True)
            return jsonify({'sessions': bookmarked})
        finally:
            db_session.close()
    except Exception as e:
        logger.error(f"Error listing bookmarked sessions: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/bookmarked-sessions/<user_session_id>/load', methods=['GET'])
def load_bookmarked_session(user_session_id):
    """Load a bookmarked session's full data from any browser session"""
    try:
        browser_session_id = request.args.get('browserSessionId')
        if not browser_session_id:
            return jsonify({'error': 'browserSessionId query param required'}), 400

        session_data = db.get_session_state(browser_session_id, f'user_session_{user_session_id}')

        if session_data is None:
            # Fallback: search all browser sessions for this data
            logger.info(f"Bookmarked session data not found under {browser_session_id}, searching all...")
            db_session_obj = db.get_session()
            try:
                from database import SessionState
                match = db_session_obj.query(SessionState).filter(
                    SessionState.state_key == f'user_session_{user_session_id}'
                ).first()
                if match:
                    session_data = match.state_data
            except Exception as search_err:
                logger.warning(f"Failed to search for bookmarked session data: {search_err}")
            finally:
                db_session_obj.close()

        if session_data is None:
            return jsonify({'error': 'Session data not found'}), 404

        return jsonify({'data': session_data})
    except Exception as e:
        logger.error(f"Error loading bookmarked session: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ─── End Session Bookmarks ────────────────────────────────────────────────────

# ─── Node Feedback ────────────────────────────────────────────────────────────

@app.route('/api/feedback', methods=['POST'])
@with_session(db)
def submit_feedback(session_id):
    """Submit feedback for a graph node"""
    try:
        data = request.json or {}
        node_id = data.get('node_id')
        node_type = data.get('node_type')
        user_session_id = data.get('user_session_id', '')

        if not node_id or not node_type:
            return jsonify({'error': 'node_id and node_type are required'}), 400

        # Look up user_id bound to this browser session
        feedback_user_id = None
        try:
            from database import Session as SessionModel
            db_session = db.get_session()
            row = db_session.query(SessionModel.user_id).filter(
                SessionModel.session_id == uuid.UUID(session_id)
            ).first()
            if row and row.user_id:
                feedback_user_id = str(row.user_id)
            db_session.close()
        except Exception:
            pass

        feedback = db.create_node_feedback(
            session_id=session_id,
            user_session_id=user_session_id,
            node_id=node_id,
            node_type=node_type,
            rating=data.get('rating'),
            comment=data.get('comment'),
            category=data.get('category'),
            author=data.get('author'),
            node_label=data.get('node_label'),
            user_id=feedback_user_id,
        )

        return jsonify({'feedback': feedback})
    except Exception as e:
        logger.error(f"Error submitting feedback: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/feedback', methods=['GET'])
@with_session(db)
def get_feedback(session_id):
    """Get feedback for a specific node"""
    try:
        node_id = request.args.get('node_id')
        user_session_id = request.args.get('user_session_id')

        if not node_id:
            return jsonify({'error': 'node_id query param required'}), 400

        feedback_list = db.get_node_feedback(
            node_id=node_id,
            session_id=session_id,
            user_session_id=user_session_id,
        )

        return jsonify({'feedback': feedback_list})
    except Exception as e:
        logger.error(f"Error getting feedback: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/feedback/session/<user_session_id>', methods=['GET'])
@with_session(db)
def get_session_feedback(session_id, user_session_id):
    """Get all feedback for a specific user session"""
    try:
        feedback_list = db.get_session_feedback(user_session_id)
        return jsonify({'feedback': feedback_list})
    except Exception as e:
        logger.error(f"Error getting session feedback: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/feedback/all', methods=['GET'])
@with_session(db)
def get_all_feedback(session_id):
    """Get all feedback across all sessions (requires valid session)"""
    try:
        feedback_list = db.get_all_feedback()
        return jsonify({'feedback': feedback_list})
    except Exception as e:
        logger.error(f"Error getting all feedback: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/feedback/<feedback_id>', methods=['PUT'])
@with_session(db)
def update_feedback(session_id, feedback_id):
    """Update an existing feedback entry"""
    try:
        data = request.json or {}
        updated = db.update_node_feedback(
            feedback_id=feedback_id,
            rating=data.get('rating'),
            comment=data.get('comment'),
            category=data.get('category'),
            author=data.get('author'),
        )
        if not updated:
            return jsonify({'error': 'Feedback not found'}), 404
        return jsonify({'feedback': updated})
    except Exception as e:
        logger.error(f"Error updating feedback: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/feedback/<feedback_id>', methods=['DELETE'])
@with_session(db)
def delete_feedback(session_id, feedback_id):
    """Delete a feedback entry"""
    try:
        deleted = db.delete_node_feedback(feedback_id)
        if not deleted:
            return jsonify({'error': 'Feedback not found'}), 404
        return jsonify({'deleted': True})
    except Exception as e:
        logger.error(f"Error deleting feedback: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# ─── End Node Feedback ────────────────────────────────────────────────────────

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
        max_retries=5,
    )
    logger.info(f"🔌 Provider: OpenRouter ({openrouter_base})")
else:
    client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'), max_retries=5)
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

    # Step-specific timeout settings (max 8 min for heavy steps)
    # Steps with many nodes need more time and token capacity
    if step_id == 4:
        timeout_seconds = 180  # 3 min for Step 4 (4a mapping ~30s, 4b scans can be slower)
        max_tokens = 16000  # Optimized: typical usage ~5000-8000 tokens (was 32000)
        logger.info(f"  Timeout: {timeout_seconds}s")
        logger.info(f"  Max tokens: {max_tokens}")
    elif step_id == 9:
        timeout_seconds = 480  # 8 min for Step 9 (full experimental protocols with L5+L6)
        max_tokens = 16000  # Increased: complex L4s with full L5+L6 SIMT specs need headroom
    elif step_id == 10:
        timeout_seconds = 600  # 10 minutes for Step 10 (convergence analysis across many L6 tasks)
        max_tokens = 28000
    elif step_id in [6, 7, 8]:  # L3, IH, L4 steps
        timeout_seconds = 480  # 8 min — these generate complex structured output
        max_tokens = 28000
    else:
        timeout_seconds = 360  # 6 minutes for other steps (1, 2, 3)
        max_tokens = 24000

    if step_id == 4:
        logger.info(f"  ⏳ Sending request to OpenAI...")
    else:
        logger.info(f"[Step {step_id}] Calling OpenAI API with model: {agent_config['model']} (timeout: {timeout_seconds}s)")
    
    # ── LLM call with up to 3 retries on JSON parse failure ──────────
    model = resolve_model(agent_config['model'])
    MAX_JSON_RETRIES = 3
    last_raw_response = None
    last_parse_error = None

    for _attempt in range(MAX_JSON_RETRIES):
        api_start = time.time()

        # On retry: add correction message and lower temperature
        if _attempt == 0:
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
            temperature = agent_config['temperature']
        else:
            logger.warning(f"[Step {step_id}] JSON retry {_attempt + 1}/{MAX_JSON_RETRIES} (previous response was invalid JSON)")
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
                {"role": "assistant", "content": last_raw_response[:800] if last_raw_response else ""},
                {"role": "user", "content": (
                    "STOP. Your previous response was NOT valid JSON and could not be parsed. "
                    "You MUST return ONLY a single valid JSON object. Rules:\n"
                    "- No markdown code fences (no ```)\n"
                    "- No text before or after the JSON\n"
                    "- No trailing commas\n"
                    "- All strings must be properly escaped (use \\n for newlines, \\\" for quotes inside strings)\n"
                    "- Ensure all brackets and braces are balanced\n"
                    "Return the complete, valid JSON now."
                )},
            ]
            temperature = max(0.1, agent_config['temperature'] - 0.2 * _attempt)

        api_kwargs = dict(
            model=model,
            messages=messages,
            temperature=temperature,
            response_format={"type": "json_object"},
            max_tokens=max_tokens,
            timeout=timeout_seconds,
        )

        # OpenRouter supports extra headers for tracking + provider routing
        if API_PROVIDER == 'openrouter':
            api_kwargs['extra_headers'] = {
                'HTTP-Referer': 'https://omega-point.local',
                'X-Title': 'Omega Point Pipeline',
            }
            api_kwargs['extra_body'] = {
                'provider': {
                    'sort': 'throughput',
                },
            }
            # Prompt caching for Anthropic models
            if 'anthropic' in model.lower() or 'claude' in model.lower():
                api_kwargs['messages'] = [
                    {
                        "role": "system",
                        "content": [
                            {"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}
                        ]
                    },
                ] + messages[1:]  # Keep user/assistant messages as-is

        try:
            completion = client.chat.completions.create(**api_kwargs)
        except Exception as api_error:
            err_str = str(api_error)
            is_rate_limit = '429' in err_str or 'rate' in err_str.lower() or 'too many' in err_str.lower()
            logger.error(f"[Step {step_id}] API call failed (attempt {_attempt + 1}){' [RATE LIMIT]' if is_rate_limit else ''}: {api_error}")
            last_parse_error = err_str
            if _attempt < MAX_JSON_RETRIES - 1:
                if is_rate_limit:
                    backoff = 2 ** (_attempt + 1) + random.uniform(0, 1)
                    logger.info(f"[Step {step_id}] Rate limit hit, backing off {backoff:.1f}s before retry...")
                    time.sleep(backoff)
                continue
            raise

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

        # ── Parse JSON response with automatic repair ──
        def _postprocess_result(result):
            """Apply step-specific post-processing to a parsed result."""
            if step_id == 4 and 'target_domain' in input_data:
                forced_domain_id = input_data['target_domain'].get('domain_id', '')
                if forced_domain_id:
                    for pillar in result.get('scientific_pillars', []):
                        pillar['domain_id'] = forced_domain_id
            if step_id == 4 and 'target_domain' not in input_data:
                for domain in result.get('research_domains', []):
                    if not domain.get('relevance_to_goal'):
                        domain['relevance_to_goal'] = 'MED'
            return result

        def _log_success(result):
            """Log successful parse results."""
            total_duration = time.time() - start_time
            if step_id == 4:
                if 'target_domain' in input_data:
                    pillars = result.get('scientific_pillars', [])
                    logger.info(f"  📦 Generated {len(pillars)} scientific pillars")
                    if pillars:
                        logger.info(f"  📋 Sample interventions:")
                        for i, pillar in enumerate(pillars[:3]):
                            logger.info(f"     {i+1}. {pillar.get('id', 'N/A')}: {pillar.get('title', 'N/A')[:60]}...")
                        if len(pillars) > 3:
                            logger.info(f"     ... and {len(pillars) - 3} more")
                    logger.info(f"  ⏱️  Total execution time: {total_duration:.2f}s")
                    logger.info(f"{'='*60}\n")
                else:
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

        # Try direct parse
        try:
            result = json.loads(response_text)
            _log_success(result)
            return _postprocess_result(result)
        except json.JSONDecodeError as parse_error:
            if step_id == 4:
                logger.warning(f"  ⚠️  JSON parse error, attempting repair: {parse_error}")
            else:
                logger.warning(f'[Step {step_id}] JSON parse error, attempting repair: {parse_error}')

        # Attempt automatic repair
        repaired_text = response_text

        # Fix 1: Remove markdown code blocks if present
        if '```json' in repaired_text:
            repaired_text = repaired_text.split('```json')[1].split('```')[0].strip()
        elif '```' in repaired_text:
            repaired_text = repaired_text.split('```')[1].split('```')[0].strip()

        # Fix 2: Remove trailing commas before ] or }
        repaired_text = re.sub(r',(\s*[}\]])', r'\1', repaired_text)

        # Fix 3: Remove stray quotes after numeric values (e.g., 0.7" → 0.7)
        repaired_text = re.sub(r'(\d+\.?\d*)\s*"(\s*[,}\]])', r'\1\2', repaired_text)
        repaired_text = re.sub(r'(\d+\.?\d*)\s*\\"(\s*[,}\]])', r'\1\2', repaired_text)

        # Fix 3b: Fix double-double quotes
        repaired_text = repaired_text.replace('""', '"')

        # Fix 3c: Fix unescaped control characters inside string values
        repaired_text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', repaired_text)

        # Fix 4: Add missing closing brackets if truncated
        open_braces = repaired_text.count('{') - repaired_text.count('}')
        open_brackets = repaired_text.count('[') - repaired_text.count(']')
        if open_braces > 0:
            repaired_text += '}' * open_braces
        if open_brackets > 0:
            repaired_text += ']' * open_brackets

        # Try parsing repaired JSON
        try:
            result = json.loads(repaired_text)
            if step_id == 4:
                logger.info(f"  ✅ JSON repaired successfully")
            else:
                logger.info(f'[Step {step_id}] JSON repaired successfully')
            _log_success(result)
            return _postprocess_result(result)
        except json.JSONDecodeError as repair_error:
            # Repair failed — store for potential retry
            last_raw_response = response_text
            last_parse_error = str(repair_error)
            if step_id == 4:
                logger.error(f"  ❌ JSON repair failed: {repair_error}")
                logger.info(f"  📄 Response preview: {response_text[:200]}...")
                logger.info(f"{'='*60}\n")
            elif step_id == 3:
                goal_id = input_data.get('goal_pillar', {}).get('id', 'unknown') if isinstance(input_data, dict) else 'unknown'
                logger.error(f'[Step 3] JSON repair failed for goal {goal_id}: {repair_error}')
            else:
                logger.error(f'[Step {step_id}] JSON repair failed: {repair_error}')
            # Continue to next retry attempt (if any remain)

    # All retry attempts exhausted
    logger.error(f'[Step {step_id}] All {MAX_JSON_RETRIES} JSON attempts failed')
    return {'raw_response': last_raw_response, 'parse_error': last_parse_error, 'repair_attempted': True}

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
    Runs in background to avoid Cloudflare 524 timeout.
    Client polls /api/batch-result for the final result.
    """
    try:
        data = request.json
        step_id = data.get('stepId')
        agent_config = data.get('agentConfig')
        items = data.get('items', [])
        phase_info = data.get('phase_info', {})
        global_lens = data.get('globalLens')

        logger.info(f'\n{"#"*70}')
        logger.info(f'### BATCH EXECUTION: Step {step_id} - {agent_config.get("name")} (Session: {session_id[:8]}...)')
        logger.info(f'### Running in BACKGROUND (async) to avoid proxy timeouts')
        logger.info(f'{"#"*70}')
        logger.info(f'📦 Total items to process: {len(items)}')

        _clear_progress(session_id, step_id)

        # Clear any stale result from a previous run
        result_key = f"batch_result:{session_id}:{step_id}"
        try:
            if redis_client.client:
                redis_client.client.delete(result_key)
        except Exception:
            pass

        # Start batch execution in background thread
        thread = threading.Thread(
            target=_run_batch_background,
            args=(session_id, step_id, agent_config, items, phase_info, global_lens),
            daemon=True,
        )
        thread.start()

        return jsonify({
            'started': True,
            'total_items': len(items),
            'message': f'Batch execution started in background. Poll /api/batch-result?step_id={step_id} for results.',
        })

    except Exception as error:
        logger.error(f'Error starting batch execution: {error}', exc_info=True)
        return jsonify({'error': str(error), 'details': 'Batch execution failed to start'}), 500


def _run_batch_background(session_id, step_id, agent_config, items, phase_info, global_lens):
    """
    Background worker for batch execution.
    Stores the final result in Redis when done.
    """
    result_key = f"batch_result:{session_id}:{step_id}"

    try:
        max_workers = min(len(items), MAX_BATCH_WORKERS)
        logger.info(f'⚡ Processing {len(items)} items in PARALLEL with {max_workers} workers (MAX_BATCH_WORKERS={MAX_BATCH_WORKERS})...')

        results = [None] * len(items)  # Pre-allocate results list
        
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
            
            for future in as_completed(future_to_idx, timeout=600):
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
                    result = future.result(timeout=600)  # Wait for completion (10 min max)
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

        # Store result in Redis for the client to pick up
        result_data = json.dumps(batch_summary)
        try:
            if redis_client.client:
                redis_client.client.setex(result_key, 3600, result_data)
                logger.info(f"  📦 Batch result stored in Redis ({len(result_data)} bytes)")
        except Exception as e:
            logger.error(f"  ❌ Failed to store batch result in Redis: {e}")

        _clear_progress(session_id, step_id)

    except Exception as error:
        logger.error(f'Error in batch execution: {error}', exc_info=True)
        # Store error in Redis so the client can pick it up
        try:
            if redis_client.client:
                redis_client.client.setex(result_key, 3600, json.dumps({
                    'error': str(error),
                    'details': 'Batch execution failed'
                }))
        except Exception:
            pass
        try:
            _clear_progress(session_id, step_id)
        except Exception:
            pass


@app.route('/api/batch-result', methods=['GET'])
@with_session(db)
def get_batch_result(session_id):
    """
    Poll for batch execution result. Returns the result if ready,
    or {pending: true} if still running.
    """
    step_id = request.args.get('step_id', type=int)
    if not step_id:
        return jsonify({'error': 'Missing step_id parameter'}), 400

    result_key = f"batch_result:{session_id}:{step_id}"
    try:
        if redis_client.client:
            data = redis_client.client.get(result_key)
            if data:
                # Result is ready — delete from Redis and return it
                redis_client.client.delete(result_key)
                return Response(data, mimetype='application/json')
    except Exception as e:
        logger.warning(f"Error fetching batch result from Redis: {e}")

    return jsonify({'pending': True}), 202

@app.route('/api/execute-step4-pipeline', methods=['POST'])
@with_session(db)
def execute_step4_pipeline(session_id):
    """
    Pipelined Step 4 execution: starts the pipeline in a background thread
    and returns immediately (avoids Cloudflare 524 timeout).

    The client polls /api/step4-result for the final result.
    Real-time progress is delivered via SSE at /api/progress/4.
    """
    try:
        data = request.json
        goal_items = data.get('goal_items', [])
        domain_mapper_agent = data.get('domain_mapper_agent')
        domain_specialist_agent = data.get('domain_specialist_agent')
        global_lens = data.get('globalLens')

        num_goals = len(goal_items)
        logger.info(f"\n{'#'*70}")
        logger.info(f"### PIPELINED Step 4: {num_goals} goal(s) (Session: {session_id[:8]}...)")
        logger.info(f"### Running in BACKGROUND (async) to avoid proxy timeouts")
        logger.info(f"{'#'*70}")

        _clear_progress(session_id, 4)

        # Clear any stale result from a previous run
        _step4_result_key = f"step4_result:{session_id}"
        try:
            if redis_client.client:
                redis_client.client.delete(_step4_result_key)
        except Exception:
            pass

        # Start pipeline in background thread
        thread = threading.Thread(
            target=_run_step4_pipeline_background,
            args=(session_id, goal_items, domain_mapper_agent,
                  domain_specialist_agent, global_lens),
            daemon=True,
        )
        thread.start()

        return jsonify({
            'started': True,
            'total_goals': num_goals,
            'message': 'Pipeline started in background. Poll /api/step4-result for results.',
        })

    except Exception as e:
        logger.error(f"Step 4 Pipeline start error: {e}", exc_info=True)
        return jsonify({'error': str(e), 'details': 'Step 4 pipeline failed to start'}), 500


# ─── Step 4 Domain Deduplication & Caching Helpers ────────────────────────────

# Stop words removed from domain names when computing similarity
_DOMAIN_STOP_WORDS = {
    'and', 'or', 'the', 'of', 'in', 'for', 'to', 'a', 'an', 'with', 'by',
    'on', 'at', 'from', 'as', 'its', 'their', 'this', 'that', 'via', 'based',
    'related', 'associated', 'specific', 'general', 'overall', 'various',
    'multiple', 'role', 'roles', 'impact', 'effects', 'approaches',
    'strategies', 'mechanisms', 'processes', 'systems', 'functions',
    # Generic modifiers that cause false merges between distinct domains
    'human', 'engineering', 'synthetic', 'optimization', 'modulation',
    'regulation', 'management', 'enhancement', 'maintenance',
}

# Step 4 scan cache TTL (seconds), configurable via env
STEP4_CACHE_TTL = int(os.getenv('STEP4_CACHE_TTL', '86400'))  # default 24h


def _domain_keywords(domain_name):
    """Extract meaningful scientific keywords from a domain name."""
    words = set(domain_name.lower().replace('-', ' ').replace('/', ' ').split())
    return words - _DOMAIN_STOP_WORDS


def _deduplicate_domains(all_goal_domains):
    """
    Merge scientifically similar domains across goals using keyword-based
    Jaccard similarity.

    Input:  { goal_idx: [domain_objects] }
    Output: [ canonical_domain_object_with_'_goal_indices' list ]

    The merge is greedy: for each pair with Jaccard > 0.4 the shorter-named
    domain is absorbed into the longer (more descriptive) one.  When domains
    are merged their goal indices are unioned, and the keyword set grows so
    later comparisons benefit from transitivity.
    """
    # Flatten all domains with goal tracking
    flat = []
    for goal_idx, domains in all_goal_domains.items():
        for domain in domains:
            kw = _domain_keywords(domain.get('domain_name', ''))
            flat.append({
                'domain': domain,
                'goal_indices': {goal_idx},
                'keywords': kw,
                'merged': False,
            })

    # Greedy merge by scientific similarity.
    # Two domains are considered duplicates if:
    #   a) Jaccard on keywords >= 0.35  (near-duplicate names), OR
    #   b) They share a long scientific root term (8+ chars, e.g. "mitochondrial",
    #      "senescence", "autophagy") AND Jaccard >= 0.15
    # This captures same-organelle / same-pathway domains that use different modifiers.
    JACCARD_STRICT = 0.35
    JACCARD_WITH_ROOT = 0.30  # was 0.12 — too permissive, merged distinct domains sharing one root word
    MIN_ROOT_LEN = 10  # was 8 — short roots like "cellular"(8) or "membrane"(8) are too generic

    for i in range(len(flat)):
        if flat[i]['merged']:
            continue
        for j in range(i + 1, len(flat)):
            if flat[j]['merged']:
                continue
            intersection = flat[i]['keywords'] & flat[j]['keywords']
            union = flat[i]['keywords'] | flat[j]['keywords']
            if len(union) == 0:
                continue
            jaccard = len(intersection) / len(union)

            # Check for shared scientific root terms (long keywords)
            shared_roots = {w for w in intersection if len(w) >= MIN_ROOT_LEN}

            should_merge = (
                jaccard >= JACCARD_STRICT or
                (shared_roots and jaccard >= JACCARD_WITH_ROOT)
            )

            if should_merge:
                # Merge j into i — keep the longer (more descriptive) name
                flat[i]['goal_indices'].update(flat[j]['goal_indices'])
                if len(flat[j]['domain'].get('domain_name', '')) > len(flat[i]['domain'].get('domain_name', '')):
                    flat[i]['domain'] = flat[j]['domain']
                flat[i]['keywords'] |= flat[j]['keywords']
                flat[j]['merged'] = True

    canonical = [
        {**item['domain'], '_goal_indices': sorted(item['goal_indices'])}
        for item in flat if not item['merged']
    ]
    return canonical


def _deduplicate_pillars(pillars):
    """
    Merge near-identical scientific pillars across domains.
    Uses hybrid approach: title keyword similarity + SPV capability overlap.
    Returns deduplicated pillar list, keeping the more detailed pillar on merge.
    """
    if not pillars:
        return pillars

    _PILLAR_STOP_WORDS = _DOMAIN_STOP_WORDS | {'via', 'using', 'based', 'approach', 'strategy', 'novel'}

    def _pillar_keywords(title_and_summary):
        words = set(title_and_summary.lower().split()) - _PILLAR_STOP_WORDS
        # Also split on hyphens/slashes
        expanded = set()
        for w in words:
            expanded.update(w.replace('-', ' ').replace('/', ' ').split())
        return expanded - _PILLAR_STOP_WORDS

    def _spv_signature(pillar):
        """Extract SPV+direction pairs as a frozenset for overlap comparison."""
        caps = pillar.get('capabilities', [])
        if not isinstance(caps, list):
            return frozenset()
        return frozenset(
            (c.get('spv_id', ''), c.get('effect_direction', ''))
            for c in caps if isinstance(c, dict) and c.get('spv_id')
        )

    items = []
    for p in pillars:
        # Use title keywords for primary matching
        title_kw = _pillar_keywords(p.get('title', ''))
        # Also extract mechanism keywords for secondary matching
        mech_kw = _pillar_keywords(p.get('mechanism', ''))
        items.append({
            'pillar': p,
            'keywords': title_kw,
            'mech_keywords': mech_kw,
            'spv_sig': _spv_signature(p),
            'merged': False,
        })

    JACCARD_PILLAR = 0.40       # title keyword overlap alone
    JACCARD_ROOT_PILLAR = 0.25  # with shared root term (8+ chars) — raised to prevent over-merging
    MIN_ROOT_LEN = 8
    # SPV-based dedup: if two pillars affect mostly the same SPVs in the same
    # directions AND share at least 1 keyword, they're likely covering the
    # same ground even if titles use different terminology
    SPV_OVERLAP_HIGH = 0.80     # high SPV overlap → merge regardless of title
    SPV_OVERLAP_MED = 0.60      # medium SPV overlap → merge if any keyword overlap

    for i in range(len(items)):
        if items[i]['merged']:
            continue
        for j in range(i + 1, len(items)):
            if items[j]['merged']:
                continue
            kw_i, kw_j = items[i]['keywords'], items[j]['keywords']
            intersection = kw_i & kw_j
            union = kw_i | kw_j
            if not union:
                continue
            jaccard = len(intersection) / len(union)
            shared_roots = {w for w in intersection if len(w) >= MIN_ROOT_LEN}

            # Also check mechanism keyword overlap for semantic similarity
            mk_i, mk_j = items[i]['mech_keywords'], items[j]['mech_keywords']
            mech_inter = mk_i & mk_j
            mech_union = mk_i | mk_j
            mech_shared_roots = {w for w in mech_inter if len(w) >= MIN_ROOT_LEN}

            # Check SPV overlap
            spv_i, spv_j = items[i]['spv_sig'], items[j]['spv_sig']
            spv_overlap = 0.0
            if spv_i and spv_j:
                spv_common = spv_i & spv_j
                spv_total = spv_i | spv_j
                spv_overlap = len(spv_common) / len(spv_total) if spv_total else 0.0

            # Anti-merge: if two pillars have opposing effect_direction on
            # the same SPV, they represent genuinely different mechanisms
            opposing_spvs = False
            if spv_i and spv_j:
                spv_ids_i = {s[0] for s in spv_i}
                spv_ids_j = {s[0] for s in spv_j}
                shared_spv_ids = spv_ids_i & spv_ids_j
                for sid in shared_spv_ids:
                    dirs_i = {s[1] for s in spv_i if s[0] == sid}
                    dirs_j = {s[1] for s in spv_j if s[0] == sid}
                    if dirs_i != dirs_j and dirs_i and dirs_j:
                        opposing_spvs = True
                        break

            # Merge criteria (any of):
            # 1. High title keyword Jaccard (direct near-duplicate)
            # 2. Shared title root + moderate title Jaccard
            # 3. High SPV overlap + shared mechanism roots (≥3) — same topic, different wording
            should_merge = (
                not opposing_spvs and (
                    jaccard >= JACCARD_PILLAR or
                    (shared_roots and jaccard >= JACCARD_ROOT_PILLAR) or
                    (spv_overlap >= SPV_OVERLAP_MED and len(mech_shared_roots) >= 4)
                )
            )
            if should_merge:
                # Keep the pillar with more capabilities/detail
                p_i = items[i]['pillar']
                p_j = items[j]['pillar']
                caps_i = len(p_i.get('capabilities', []))
                caps_j = len(p_j.get('capabilities', []))
                mech_i = len(p_i.get('mechanism', ''))
                mech_j = len(p_j.get('mechanism', ''))
                # Keep the one with more capabilities, or longer mechanism text
                if caps_j > caps_i or (caps_j == caps_i and mech_j > mech_i):
                    items[i]['pillar'] = p_j
                # Merge domain_ids: note in merged pillar
                di = p_i.get('domain_id', '')
                dj = p_j.get('domain_id', '')
                if di and dj and di != dj:
                    items[i]['pillar'].setdefault('also_relevant_to_domains', [])
                    existing = items[i]['pillar']['also_relevant_to_domains']
                    for d in [di, dj]:
                        if d not in existing and d != items[i]['pillar'].get('domain_id', ''):
                            existing.append(d)
                items[i]['keywords'] |= items[j]['keywords']
                items[j]['merged'] = True
                logger.info(f"  🔗 Pillar dedup: merged '{p_j.get('title', '')[:50]}' into '{p_i.get('title', '')[:50]}'")

    result = [item['pillar'] for item in items if not item['merged']]
    merged_count = len(pillars) - len(result)
    if merged_count > 0:
        logger.info(f"  📉 Pillar dedup: {len(pillars)} → {len(result)} (merged {merged_count} near-duplicates)")
    return result


def _genius_verify_l6_batch(l6_tasks, q0_text, agents_config):
    """
    Step 9.5 — Genius Verification Layer.
    Takes raw L6 experiments and sends them to an LLM critic that:
    1. Scores each L6 on novelty/specificity/discrimination
    2. REWRITES all SIMT fields to remove hedging (e.g., vagueness)
    3. REJECTS trivial experiments (returns fewer, better ones)
    4. Merges permutation variants into factorial designs

    This is the key architectural change that breaks the quality plateau.
    """
    if not l6_tasks:
        return l6_tasks

    logger.info(f"\n  {'='*50}")
    logger.info(f"  🧪 GENIUS VERIFICATION LAYER (Step 9.5)")
    logger.info(f"  {'='*50}")
    logger.info(f"  Input: {len(l6_tasks)} raw L6 experiments")

    # Group L6 tasks by parent_l4_id for batch verification
    l4_groups = {}
    for task in l6_tasks:
        l4_id = task.get('parent_l4_id', 'unknown')
        l4_groups.setdefault(l4_id, []).append(task)

    verified_tasks = []
    model = resolve_model('google/gemini-2.5-flash')

    critic_system_prompt = """You are the Genius Experiment Critic — the harshest, most specific peer reviewer in science. You receive a batch of L6 experiment specifications and your job is to IMPROVE them.

## YOUR TASKS (in order):

### 1. REWRITE TITLES (MANDATORY)
Every L6 title MUST follow this structure: "[Scientific question/hypothesis being tested] — [key method] in [system]"
Rules:
- First 40 characters must convey the scientific question (graph nodes truncate titles)
- Use active voice: "Does X cause Y", "Can X restore Y", "Which X maximizes Y", "Is X sufficient for Y"
- After the dash, name the key technique and system
- NEVER start with a technique name (CRISPR, AFM, RNA-seq, Factorial, Multi-omics, etc.)
- Max 120 characters total
BAD: "Factorial CRISPR/Cas9 knockdown of key pericellular proteoglycans with inflammatory challenge on Drosophila"
GOOD: "Does pericellular proteoglycan loss drive inflammation-induced elastin collapse — CRISPR factorial in Drosophila"

### 2. ELIMINATE HEDGING
Scan every S-I-M-T field. Replace ALL instances of vague language:
- "e.g.," followed by a specific thing → KEEP only the specific thing, remove "e.g.,"
- "such as" → pick the best option and commit
- "appropriate/suitable/relevant" → name the specific item
- Parenthetical alternatives "(or X)" → pick one, remove alternatives
- "e.g." must NOT appear anywhere in the output SIMT fields

### 3. REJECT MEDIOCRE EXPERIMENTS
Remove any L6 that:
- A trained postdoc could design after reading one review article
- Tests only 1 variable at 1 timepoint (no factorial, no time-course)
- Is a pure computational model (ABM, parameter sweep) — keep at most 1 per batch
- Is pure omics (RNA-seq, proteomics) without a creative perturbation design

### 4. MERGE PERMUTATIONS
If 2+ experiments differ only in which compound/knockdown they test but ask the same mechanistic question, merge them into ONE factorial experiment with multiple arms.

### 5. ENHANCE SPECIFICITY
For each surviving experiment:
- System: ensure species, strain, source, sample size are all present
- Intervention: ensure compound name, catalog number or source, dose, schedule, controls are all present
- Meter: ensure instrument/assay name, manufacturer, protocol details are present
- Threshold: ensure quantitative threshold, statistical test, sample size, timepoints are present
- If a catalog number is unknown, write "source: [vendor name]" — do NOT invent fake catalog numbers (no "#XYZ" or placeholder numbers)

### 6. CALIBRATE FEASIBILITY
Score honestly across the FULL 1-10 range:
- 9-10: Standard techniques, 1-3 months, single researcher
- 7-8: Specialized equipment, 6-12 months, single lab
- 5-6: Custom approaches, 1-2 years, multi-lab
- 3-4: Institutional commitment, 2-5 years, rare facilities
- 1-2: Technology doesn't exist yet

### 7. PRESERVE AND ENHANCE if_null (MANDATORY)
Every experiment MUST have a non-empty "if_null" field. This is CRITICAL — it tells us what we learn if the experiment fails. Rules:
- If the original has if_null, preserve it or improve it
- If the original is missing if_null, GENERATE one
- "Inconclusive", "uninformative", "the hypothesis is wrong" are NOT acceptable if_null values
- Good if_null: "Null result would indicate that [mechanism X] is not the rate-limiting step, redirecting investigation to [mechanism Y] as predicted by IH_02"

### 8. GENIUS SCORING (be HARSH — use the full 1-10 range, target average >= 7.5)
- 1-3: REJECT IMMEDIATELY. Baseline characterization, standard drug-dose-response, single-variable knockout+phenotype. Any postdoc could design this. These should not exist in the output.
- 4-5: Conventional. Hypothesis-testing but uses only established techniques in a well-known system. Single-domain thinking. Acceptable ONLY for TOOL_DEV or VALIDATION_DRILL type L5 branches. Flag for redesign if attached to MECHANISM_DRILL.
- 6-7: Multi-variable factorial design that requires pipeline context. Tests interactions between mechanisms. Non-obvious system choice. BUT: stays within one discipline's comfort zone. This is the MINIMUM acceptable for mechanism-testing experiments.
- 8-9: BRILLIANT — THIS IS YOUR TARGET. Crosses domains (borrows techniques from unrelated fields), tests genuinely novel interactions nobody has combined before, creative methodology that would make a review panel say "why didn't I think of that." Orthogonal readouts where different IHs predict qualitatively different patterns. Uses unexpected model organisms or perturbation combinations.
- 10: Paradigm-shifting. Nobody has proposed this approach. The experiment design itself is a conceptual advance.

Experiments scoring genius < 5 should be flagged for rejection or complete redesign.
If the average genius score across all experiments is below 7.0, you are being too conservative — redesign the weakest experiments with more cross-domain creativity.

## OUTPUT FORMAT
Return JSON:
{
  "verified_l6_tasks": [
    {
      ...all original fields preserved...,
      "simt_parameters": { "system": "...", "intervention": "...", "meter": "...", "threshold_time": "..." },
      "feasibility_score": <integer 1-10>,
      "if_null": "MANDATORY — what we learn if result is null. Must be non-empty and informative.",
      "genius_score": <integer 1-10, your assessment using the HARSH scale above>,
      "verification_note": "3+ sentences: (a) what was wrong, (b) what was changed, (c) what could be further improved"
    }
  ],
  "rejected": [{"id": "...", "reason": "..."}],
  "merged": [{"original_ids": ["...", "..."], "into": "..."}]
}

CRITICAL: Every experiment in verified_l6_tasks MUST have a non-empty "if_null" field.

Return ONLY valid JSON. No markdown."""

    def _summarize_tasks(tasks):
        """Extract key fields from L6 tasks for the critic prompt.
        Omits rationale/expected_impact — critic focuses on SIMT rewriting + scoring."""
        summaries = []
        for t in tasks:
            summaries.append({
                'id': t.get('id', ''),
                'title': t.get('title', ''),
                'simt_parameters': t.get('simt_parameters', {}),
                'if_null': t.get('if_null', ''),
                'feasibility_score': t.get('feasibility_score'),
                'discovery_component': t.get('discovery_component', False),
                'parent_l5_id': t.get('parent_l5_id', ''),
                'parent_l4_id': t.get('parent_l4_id', ''),
            })
        return summaries

    def _backfill_verified(verified_list, original_tasks, default_l4_id):
        """Backfill parent IDs and missing fields from originals."""
        backfill_count = 0
        unmatched_count = 0
        for vt in verified_list:
            orig = next((t for t in original_tasks if t.get('id') == vt.get('id')), None)
            if not orig:
                orig = next((t for t in original_tasks if t.get('title', '').lower() == vt.get('title', '').lower()), None)
                if not orig:
                    unmatched_count += 1
            if not vt.get('parent_l4_id'):
                vt['parent_l4_id'] = default_l4_id
            if not vt.get('parent_l5_id') and orig:
                vt['parent_l5_id'] = orig.get('parent_l5_id', '')
            if not vt.get('if_null') and orig and orig.get('if_null'):
                vt['if_null'] = orig['if_null']
                backfill_count += 1
            if not vt.get('spv_link') and orig:
                vt['spv_link'] = orig.get('spv_link', '')
            if not vt.get('expected_impact') and orig:
                vt['expected_impact'] = orig.get('expected_impact', '')
        return verified_list, backfill_count, unmatched_count

    def _parse_llm_json(response_text, fallback_label='batch'):
        """Parse JSON from LLM response with repair fallbacks."""
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            pass
        cleaned = response_text.strip()
        if cleaned.startswith('```'):
            cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
            cleaned = re.sub(r'\s*```\s*$', '', cleaned)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass
        json_match = re.search(r'\{[\s\S]*\}', cleaned)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass
        logger.warning(f"    ⚠️  {fallback_label}: JSON repair failed")
        return None

    def verify_multi_batch(l4_batch):
        """Verify multiple L4 groups in a single LLM call.
        l4_batch: list of (l4_id, tasks) tuples
        Returns: dict of l4_id -> verified_tasks
        """
        # Build multi-branch prompt
        all_original_tasks = {}
        branch_sections = []
        total_tasks = 0
        for l4_id, tasks in l4_batch:
            all_original_tasks[l4_id] = tasks
            summaries = _summarize_tasks(tasks)
            total_tasks += len(tasks)
            branch_sections.append(
                f"### L4 Branch: {l4_id}\n{json.dumps(summaries, indent=2)}"
            )

        l4_ids = [l4_id for l4_id, _ in l4_batch]
        user_prompt = f"""Master Question (Q0): {q0_text}

You are verifying {total_tasks} L6 experiments across {len(l4_batch)} L4 branches.
Process EACH branch independently — merging should only happen within the same branch.

{chr(10).join(branch_sections)}

Verify, improve specificity, remove hedging (especially "e.g."), reject mediocre experiments, merge permutations, and calibrate feasibility scores.

Return results organized by L4 branch ID."""

        try:
            # Increase max_tokens proportionally to batch size
            batch_max_tokens = min(16000 * len(l4_batch), 65000)
            api_kwargs = dict(
                model=model,
                messages=[
                    {"role": "system", "content": critic_system_prompt + f"""

## MULTI-BRANCH OUTPUT FORMAT
You are processing {len(l4_batch)} L4 branches. Return JSON with results keyed by branch:
{{
  "branches": {{
    "{l4_ids[0]}": {{
      "verified_l6_tasks": [...],
      "rejected": [...],
      "merged": [...]
    }},
    ...one entry per L4 branch ID...
  }}
}}"""},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.3,
                response_format={"type": "json_object"},
                max_tokens=batch_max_tokens,
                timeout=480,
            )
            if API_PROVIDER == 'openrouter':
                api_kwargs['extra_headers'] = {
                    'HTTP-Referer': 'https://omega-point.local',
                    'X-Title': 'Omega Point Pipeline - Genius Verify',
                }
                api_kwargs['extra_body'] = {'provider': {'sort': 'throughput'}}

            # Retry with backoff for rate-limit errors
            completion = None
            for _retry in range(3):
                try:
                    completion = client.chat.completions.create(**api_kwargs)
                    break
                except Exception as retry_err:
                    err_str = str(retry_err)
                    is_rate_limit = '429' in err_str or 'rate' in err_str.lower() or 'too many' in err_str.lower()
                    if is_rate_limit and _retry < 2:
                        backoff = 2 ** (_retry + 1) + random.uniform(0, 1)
                        logger.warning(f"    ⚠️  Genius verify rate limit, backing off {backoff:.1f}s (attempt {_retry + 1}/3)")
                        time.sleep(backoff)
                        continue
                    raise
            if completion is None:
                return {l4_id: tasks for l4_id, tasks in l4_batch}
            response_text = completion.choices[0].message.content
            result = _parse_llm_json(response_text, f'multi-batch({",".join(l4_ids)})')

            if not result:
                # Fallback: return originals for all branches
                return {l4_id: tasks for l4_id, tasks in l4_batch}

            usage = completion.usage
            logger.info(f"    ✅ Multi-batch [{','.join(l4_ids)}]: "
                       f"[tokens: {usage.prompt_tokens}+{usage.completion_tokens}]")

            # Parse multi-branch response
            branches = result.get('branches', {})
            output = {}

            for l4_id, orig_tasks in l4_batch:
                if l4_id in branches:
                    branch_result = branches[l4_id]
                    verified = branch_result.get('verified_l6_tasks', [])
                    verified, bf, um = _backfill_verified(verified, orig_tasks, l4_id)
                    rejected_count = len(branch_result.get('rejected', []))
                    merged_count = len(branch_result.get('merged', []))
                    logger.info(f"      {l4_id}: {len(orig_tasks)} → {len(verified)} "
                               f"(rejected: {rejected_count}, merged: {merged_count})")
                    if bf > 0 or um > 0:
                        logger.info(f"      📋 {l4_id}: Backfill: {bf} if_null recovered, {um} unmatched IDs")
                    output[l4_id] = verified
                else:
                    # Branch missing from response — try flat fallback
                    flat_verified = result.get('verified_l6_tasks', [])
                    if flat_verified and len(l4_batch) == 1:
                        verified, bf, um = _backfill_verified(flat_verified, orig_tasks, l4_id)
                        output[l4_id] = verified
                    else:
                        logger.warning(f"      ⚠️  {l4_id}: Missing from multi-batch response, keeping originals")
                        output[l4_id] = orig_tasks

            return output

        except Exception as e:
            logger.warning(f"    ⚠️  Multi-batch verification failed ({e}), keeping originals")
            return {l4_id: tasks for l4_id, tasks in l4_batch}

    # Batch L4 groups into super-batches of 5 for fewer LLM calls
    GENIUS_BATCH_SIZE = 5
    verify_start = time.time()
    l4_items = list(l4_groups.items())
    super_batches = [l4_items[i:i + GENIUS_BATCH_SIZE] for i in range(0, len(l4_items), GENIUS_BATCH_SIZE)]
    logger.info(f"  📦 Batching {len(l4_groups)} L4 groups into {len(super_batches)} verification calls")

    with ThreadPoolExecutor(max_workers=min(len(super_batches), MAX_BATCH_WORKERS)) as executor:
        futures = {}
        for batch in super_batches:
            batch_ids = tuple(l4_id for l4_id, _ in batch)
            futures[executor.submit(verify_multi_batch, batch)] = batch_ids

        try:
            for future in as_completed(futures, timeout=480):
                batch_ids = futures[future]
                try:
                    batch_result = future.result(timeout=480)
                    for l4_id, verified in batch_result.items():
                        verified_tasks.extend(verified)
                except Exception as e:
                    logger.warning(f"    ⚠️  Batch {batch_ids}: Verification error ({e}), keeping originals")
                    for l4_id in batch_ids:
                        if l4_id in l4_groups:
                            verified_tasks.extend(l4_groups[l4_id])
        except TimeoutError:
            # as_completed overall timeout — keep originals for any incomplete batches
            timed_out = [bids for f, bids in futures.items() if not f.done()]
            logger.warning(f"    ⏰ Genius verification TIMEOUT — {len(timed_out)} batches skipped, keeping originals")
            for f, bids in futures.items():
                if not f.done():
                    f.cancel()
                    for l4_id in bids:
                        if l4_id in l4_groups:
                            verified_tasks.extend(l4_groups[l4_id])

    verify_duration = round(time.time() - verify_start, 1)
    logger.info(f"  📊 Verification: {len(l6_tasks)} → {len(verified_tasks)} experiments ({verify_duration}s)")
    logger.info(f"  {'='*50}")

    return verified_tasks


def _normalize_l6_tasks(l6_tasks):
    """
    Normalize L6 task schema:
    1. Hoist expected_impact, spv_link, feasibility_score from simt_parameters to top-level.
    2. Normalize SIMT key names to canonical: system, intervention, meter, threshold_time.
    3. Scrub "e.g." hedging from SIMT fields (replace parenthetical e.g. with committed choice).
    4. Flag quality issues for logging.
    """
    HOIST_FIELDS = ['expected_impact', 'spv_link', 'feasibility_score']
    SIMT_KEY_MAP = {
        'measurement': 'meter',
        'measure': 'meter',
        'metrics': 'meter',
        'target': 'threshold_time',
        'threshold': 'threshold_time',
        'time': 'threshold_time',
        'success_criteria': 'threshold_time',
    }
    CANONICAL_SIMT_KEYS = {'system', 'intervention', 'meter', 'threshold_time'}
    eg_scrubbed_count = 0
    computational_count = 0
    for task in l6_tasks:
        simt = task.get('simt_parameters', {})
        if not isinstance(simt, dict):
            continue
        # Hoist non-SIMT fields to top-level
        for field in HOIST_FIELDS:
            if field in simt and field not in task:
                task[field] = simt.pop(field)
        # Normalize alternate SIMT key names to canonical
        for alt_key, canonical_key in SIMT_KEY_MAP.items():
            if alt_key in simt and canonical_key not in simt:
                simt[canonical_key] = simt.pop(alt_key)
            elif alt_key in simt and canonical_key in simt:
                simt.pop(alt_key)  # Canonical already exists, drop the alt
        # --- QUALITY ENFORCEMENT: Scrub "e.g." from SIMT fields ---
        for simt_key in CANONICAL_SIMT_KEYS:
            val = simt.get(simt_key, '')
            if not isinstance(val, str):
                continue
            if 'e.g.' in val or 'e.g.,' in val:
                eg_scrubbed_count += 1
                # Strategy: convert "X (e.g., Y)" → "Y" and "X, e.g., Y" → "Y"
                # Keep the specific example, drop the hedging wrapper
                # Pattern 1: "something (e.g., specific thing)" → "specific thing"
                val = re.sub(r'[^(]*\(e\.g\.,?\s*([^)]+)\)', r'\1', val)
                # Pattern 2: "something, e.g., specific thing" → "specific thing"
                val = re.sub(r'[^,]*,\s*e\.g\.,?\s*', '', val)
                # Pattern 3: remaining "e.g." → just remove it
                val = val.replace('e.g.,', '').replace('e.g.', '')
                # Clean up double spaces and leading/trailing
                val = re.sub(r'\s{2,}', ' ', val).strip()
                simt[simt_key] = val
        # --- Split threshold_time into separate threshold and time fields ---
        tt = simt.get('threshold_time', '')
        if tt and isinstance(tt, str) and len(tt) > 5:
            # Extract timepoint info (patterns: "Timepoint:", "timepoints:", "N weeks", "N months", etc.)
            time_patterns = [
                r'[Tt]imepoints?:\s*([^.]+\.)',
                r'(\d+\s*(?:hours?|days?|weeks?|months?|years?)\s*(?:post-[^.,]+)?)',
                r'[Dd]uration:\s*([^.]+\.)',
            ]
            time_parts = []
            for pat in time_patterns:
                matches = re.findall(pat, tt)
                time_parts.extend(matches)
            if time_parts:
                task['time'] = '; '.join(time_parts[:3]).strip()
            # The threshold is the full text (contains both criteria and timepoints)
            task['threshold'] = tt
        # --- Flag computational experiments ---
        title = (task.get('title', '') or '').lower()
        sys_val = (simt.get('system', '') or '').lower()
        if any(kw in title or kw in sys_val for kw in [
            'computational', 'in silico', 'agent-based', 'abm ', 'netlogo',
            'comsol', 'parameter sweep', 'sensitivity analysis', 'mathematical model',
            'ode model', 'simulation'
        ]):
            task['_is_computational'] = True
            computational_count += 1

    if eg_scrubbed_count > 0:
        logger.info(f"  🧹 Scrubbed 'e.g.' from {eg_scrubbed_count} SIMT fields")
    if computational_count > 0:
        logger.info(f"  💻 Flagged {computational_count} computational L6 tasks")

    return l6_tasks


def _try_recover_result(result):
    """
    If a step result contains raw_response (JSON parse failed during execution),
    attempt to recover by re-parsing the raw response text.
    Returns the recovered dict if successful, or the original result unchanged.
    """
    raw = result.get('raw_response')
    if not raw or not isinstance(raw, str) or len(raw.strip()) == 0:
        return result

    logger.info(f"  Attempting recovery from raw_response ({len(raw)} chars)")
    recovered_text = raw.strip()

    # Strip markdown code blocks
    if '```json' in recovered_text:
        try:
            recovered_text = recovered_text.split('```json')[1].split('```')[0].strip()
        except IndexError:
            pass
    elif '```' in recovered_text:
        try:
            recovered_text = recovered_text.split('```')[1].split('```')[0].strip()
        except IndexError:
            pass

    # Remove trailing commas before ] or }
    recovered_text = re.sub(r',(\s*[}\]])', r'\1', recovered_text)

    # Fix truncated JSON (missing closing brackets)
    open_braces = recovered_text.count('{') - recovered_text.count('}')
    open_brackets = recovered_text.count('[') - recovered_text.count(']')
    if open_braces > 0:
        recovered_text += '}' * open_braces
    if open_brackets > 0:
        recovered_text += ']' * open_brackets

    try:
        recovered = json.loads(recovered_text)
        logger.info(f"  Recovery successful: keys={list(recovered.keys())}")
        return recovered
    except json.JSONDecodeError as e:
        logger.warning(f"  Recovery from raw_response failed: {e}")
        return result


def _get_cached_scan(q0_text, domain_name):
    """Check Redis for a cached Step 4b domain scan result."""
    if not redis_client.client:
        return None
    cache_key = f"step4_scan:{hashlib.md5((q0_text + '||' + domain_name).encode()).hexdigest()}"
    try:
        data = redis_client.client.get(cache_key)
        return json.loads(data) if data else None
    except Exception:
        return None


def _cache_scan_result(q0_text, domain_name, result, ttl=None):
    """Cache a Step 4b domain scan result in Redis."""
    if not redis_client.client:
        return
    if ttl is None:
        ttl = STEP4_CACHE_TTL
    cache_key = f"step4_scan:{hashlib.md5((q0_text + '||' + domain_name).encode()).hexdigest()}"
    try:
        redis_client.client.setex(cache_key, ttl, json.dumps(result))
    except Exception:
        pass


def _run_step4_pipeline_background(session_id, goal_items, domain_mapper_agent,
                                    domain_specialist_agent, global_lens):
    """
    Background worker for the Step 4 pipeline.
    Stores the final result in Redis when done.

    Architecture:
      Phase 4a:      Per-goal domain mapping (parallel)
      Phase 4a-post: Cross-goal domain deduplication (server-side, no LLM)
      Phase 4b:      Scan canonical domains (parallel, with Redis caching)
      Phase 4b-post: Distribute pillars back to goals
    """
    result_key = f"step4_result:{session_id}"

    try:
        num_goals = len(goal_items)
        max_workers = min(num_goals * 8, MAX_BATCH_WORKERS)
        logger.info(f"⚡ Pipeline workers: {max_workers} (MAX_BATCH_WORKERS={MAX_BATCH_WORKERS})")

        # --- Progress tracking (thread-safe) ---
        progress_lock = threading.Lock()
        PHASE_4A_WEIGHT = 1
        PHASE_4B_WEIGHT = 3
        total_units = num_goals * PHASE_4A_WEIGHT  # grows as domains are discovered
        completed_units = 0
        successful_count = 0
        failed_count = 0
        batch_start = time.time()

        def _emit_progress():
            """Push current progress to SSE store (must hold progress_lock)."""
            elapsed = time.time() - batch_start
            pct = (completed_units / max(total_units, 1)) * 100
            avg = elapsed / max(completed_units, 1)
            remaining = total_units - completed_units
            eta = avg * remaining
            _update_progress(session_id, 4, completed_units, total_units,
                             successful_count, failed_count, elapsed, eta)

        # --- Results storage ---
        goal_results = {}   # goal_idx -> { 'mapping': ..., 'scans': { domain_id: ... } }
        all_goal_domains = {}  # goal_idx -> [domain_objects]  (for dedup)

        # Extract Q0 text from first goal_item for cache key
        q0_text = goal_items[0].get('Q0_reference', '') if goal_items else ''

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            # ══════════════════════════════════════════════════════════════
            # Phase 4a: Per-goal domain mapping (parallel, unchanged)
            # ══════════════════════════════════════════════════════════════
            phase4a_futures = {}
            for idx, item in enumerate(goal_items):
                future = executor.submit(
                    execute_single_item, 4, domain_mapper_agent, item, global_lens
                )
                phase4a_futures[future] = idx

            for future in as_completed(phase4a_futures, timeout=480):
                goal_idx = phase4a_futures[future]

                try:
                    mapping_result = future.result(timeout=180)
                    goal_results[goal_idx] = {'mapping': mapping_result, 'scans': {}}

                    domains = mapping_result.get('research_domains', [])
                    for domain in domains:
                        if not domain.get('relevance_to_goal'):
                            domain['relevance_to_goal'] = 'MED'

                    all_goal_domains[goal_idx] = domains
                    logger.info(
                        f"  ✅ Goal {goal_idx+1}/{num_goals}: 4a done → "
                        f"{len(domains)} domains"
                    )

                    with progress_lock:
                        completed_units += PHASE_4A_WEIGHT
                        successful_count += 1
                        _emit_progress()

                except Exception as e:
                    logger.error(f"  ❌ Goal {goal_idx+1}/{num_goals}: 4a FAILED — {e}")
                    goal_results[goal_idx] = {'mapping_error': str(e), 'scans': {}}
                    all_goal_domains[goal_idx] = []
                    with progress_lock:
                        completed_units += PHASE_4A_WEIGHT
                        failed_count += 1
                        _emit_progress()

            # Phase 4a retry: retry goals with 0 domains (parse failure)
            failed_goals = [idx for idx, domains in all_goal_domains.items() if not domains]
            if failed_goals:
                logger.warning(f"  ⚠️ 4a: {len(failed_goals)} goals got 0 domains — retrying")
                retry_futures = {}
                for idx in failed_goals:
                    item = goal_items[idx] if idx < len(goal_items) else goal_items[0]
                    future = executor.submit(
                        execute_single_item, 4, domain_mapper_agent, item, global_lens
                    )
                    retry_futures[future] = idx
                for future in as_completed(retry_futures, timeout=480):
                    goal_idx = retry_futures[future]
                    try:
                        mapping_result = future.result(timeout=180)
                        if mapping_result.get('raw_response') and not mapping_result.get('research_domains'):
                            mapping_result = _try_recover_result(mapping_result)
                        domains = mapping_result.get('research_domains', [])
                        for d in domains:
                            if not d.get('relevance_to_goal'):
                                d['relevance_to_goal'] = 'MED'
                        all_goal_domains[goal_idx] = domains
                        logger.info(f"  ✅ RETRY Goal {goal_idx+1}/{num_goals}: 4a → {len(domains)} domains")
                        with progress_lock:
                            successful_count += 1
                            _emit_progress()
                    except Exception as e:
                        logger.error(f"  ❌ RETRY Goal {goal_idx+1}/{num_goals}: 4a still FAILED — {e}")

            # ══════════════════════════════════════════════════════════════
            # Phase 4a-post: Cross-goal domain deduplication
            # ══════════════════════════════════════════════════════════════
            total_raw = sum(len(d) for d in all_goal_domains.values())
            canonical_domains = _deduplicate_domains(all_goal_domains)
            logger.info(f"\n{'─'*60}")
            logger.info(f"  🔀 DOMAIN DEDUP: {total_raw} raw → {len(canonical_domains)} canonical domains")
            for cd in canonical_domains:
                goals_served = cd.get('_goal_indices', [])
                logger.info(f"     • {cd.get('domain_name', '?')}  (goals: {goals_served})")
            logger.info(f"{'─'*60}\n")

            # Update total_units now that we know the canonical domain count
            with progress_lock:
                total_units += len(canonical_domains) * PHASE_4B_WEIGHT
                _emit_progress()

            # ══════════════════════════════════════════════════════════════
            # Phase 4b: Scan canonical domains (parallel, with cache)
            # ══════════════════════════════════════════════════════════════
            phase4b_futures = {}
            cache_hits = 0

            for canonical_domain in canonical_domains:
                domain_name = canonical_domain.get('domain_name', '')
                domain_id = canonical_domain.get('domain_id', f'unknown_{id(canonical_domain)}')
                served_goals = canonical_domain.get('_goal_indices', [])

                # Check Redis cache first
                cached = _get_cached_scan(q0_text, domain_name)
                if cached:
                    cache_hits += 1
                    # Force domain_id on cached pillars
                    for pillar in cached.get('scientific_pillars', []):
                        pillar['domain_id'] = domain_id
                    # Distribute cached result to all served goals
                    for goal_idx in served_goals:
                        if goal_idx in goal_results:
                            goal_results[goal_idx]['scans'][domain_id] = cached
                    with progress_lock:
                        completed_units += PHASE_4B_WEIGHT
                        successful_count += 1
                        _emit_progress()
                    logger.info(f"  ⚡ CACHE HIT: domain '{domain_id}' — skipping LLM call")
                    continue

                # Cache miss → submit LLM scan
                # Build scan_item with context from the first served goal
                # (all served goals share this domain, so context is representative)
                primary_goal_idx = served_goals[0] if served_goals else 0
                base_item = goal_items[primary_goal_idx] if primary_goal_idx < len(goal_items) else goal_items[0]

                # Strip internal _goal_indices before sending to LLM
                domain_for_llm = {k: v for k, v in canonical_domain.items() if k != '_goal_indices'}
                scan_item = {**base_item, 'target_domain': domain_for_llm}

                scan_future = executor.submit(
                    execute_single_item, 4, domain_specialist_agent,
                    scan_item, global_lens
                )
                phase4b_futures[scan_future] = (canonical_domain, served_goals)

            if cache_hits:
                logger.info(f"  📦 Cache hits: {cache_hits}/{len(canonical_domains)} domains")

            # ── Collect Phase 4b results & distribute to goals ──
            try:
                for future in as_completed(phase4b_futures, timeout=480):
                    canonical_domain, served_goals = phase4b_futures[future]
                    domain_id = canonical_domain.get('domain_id', f'unknown_{id(canonical_domain)}')
                    domain_name = canonical_domain.get('domain_name', '')

                    try:
                        scan_result = future.result(timeout=180)
                        # Force-set domain_id on every pillar
                        for pillar in scan_result.get('scientific_pillars', []):
                            pillar['domain_id'] = domain_id
                        # Cache the result for future runs
                        _cache_scan_result(q0_text, domain_name, scan_result)
                        # Distribute to ALL served goals
                        for goal_idx in served_goals:
                            if goal_idx in goal_results:
                                goal_results[goal_idx]['scans'][domain_id] = scan_result
                        with progress_lock:
                            completed_units += PHASE_4B_WEIGHT
                            successful_count += 1
                            _emit_progress()
                        logger.info(f"  ✅ Domain '{domain_id}': 4b scan done → distributed to goals {served_goals}")
                    except TimeoutError:
                        for goal_idx in served_goals:
                            if goal_idx in goal_results:
                                goal_results[goal_idx]['scans'][domain_id] = {'error': 'timeout (180s)'}
                        with progress_lock:
                            completed_units += PHASE_4B_WEIGHT
                            failed_count += 1
                            _emit_progress()
                        logger.warning(f"  ⏰ Domain '{domain_id}': 4b TIMEOUT — skipping (>120s)")
                        future.cancel()
                    except Exception as e:
                        for goal_idx in served_goals:
                            if goal_idx in goal_results:
                                goal_results[goal_idx]['scans'][domain_id] = {'error': str(e)}
                        with progress_lock:
                            completed_units += PHASE_4B_WEIGHT
                            failed_count += 1
                            _emit_progress()
                        logger.error(f"  ❌ Domain '{domain_id}': 4b FAILED — {e}")
            except TimeoutError:
                # Overall 480s deadline reached — cancel remaining and continue
                timed_out = [cd.get('domain_id', '?') for f, (cd, _) in phase4b_futures.items() if not f.done()]
                logger.warning(f"  ⏰ 4b overall TIMEOUT (480s) — {len(timed_out)} domains skipped: {timed_out}")
                for f in phase4b_futures:
                    if not f.done():
                        f.cancel()
                with progress_lock:
                    completed_units += PHASE_4B_WEIGHT * len(timed_out)
                    failed_count += len(timed_out)
                    _emit_progress()

        # Post-processing: recover pillars from raw_response & deduplicate
        for goal_idx, gr in goal_results.items():
            for domain_id, scan in list(gr.get('scans', {}).items()):
                if scan and scan.get('raw_response') and not scan.get('scientific_pillars'):
                    # Attempt recovery from raw_response
                    try:
                        raw_text = scan['raw_response']
                        cleaned = raw_text
                        if '```json' in cleaned:
                            cleaned = cleaned.split('```json')[1].split('```')[0].strip()
                        elif '```' in cleaned:
                            cleaned = cleaned.split('```')[1].split('```')[0].strip()
                        cleaned = re.sub(r',(\s*[}\]])', r'\1', cleaned)
                        cleaned = re.sub(r'(\d+\.?\d*)\s*"(\s*[,}\]])', r'\1\2', cleaned)
                        cleaned = re.sub(r'(\d+\.?\d*)\s*\\"(\s*[,}\]])', r'\1\2', cleaned)
                        ob = cleaned.count('{') - cleaned.count('}')
                        ok = cleaned.count('[') - cleaned.count(']')
                        if ob > 0:
                            cleaned += '}' * ob
                        if ok > 0:
                            cleaned += ']' * ok
                        recovered = json.loads(cleaned)
                        pillars = recovered.get('scientific_pillars', [])
                        if pillars:
                            for p in pillars:
                                p['domain_id'] = domain_id
                            scan['scientific_pillars'] = pillars
                            logger.info(f"  🔧 Recovered {len(pillars)} pillars from raw_response for {domain_id}")
                    except Exception:
                        logger.warning(f"  ⚠️ Could not recover pillars from raw_response for {domain_id}")

            # Deduplicate pillars across all domains for this goal
            all_pillars = []
            for scan in gr.get('scans', {}).values():
                if scan and not scan.get('error'):
                    all_pillars.extend(scan.get('scientific_pillars', []))
            if all_pillars:
                deduped = _deduplicate_pillars(all_pillars)
                gr['_deduped_pillar_count'] = len(deduped)
                gr['_raw_pillar_count'] = len(all_pillars)

        elapsed = time.time() - batch_start
        logger.info(f"\n{'#'*70}")
        logger.info(f"### PIPELINE COMPLETE: Step 4")
        logger.info(f"  ✅ Successful: {successful_count}")
        logger.info(f"  ❌ Failed: {failed_count}")
        logger.info(f"  🔀 Domains: {total_raw} raw → {len(canonical_domains)} canonical ({cache_hits} cache hits)")
        logger.info(f"  ⏱️  Total: {elapsed/60:.1f} min")
        logger.info(f"{'#'*70}\n")

        # Store result in Redis for the client to pick up
        result_data = json.dumps({
            'success': True,
            'goal_results': {str(k): v for k, v in goal_results.items()},
            'total_goals': num_goals,
            'elapsed_seconds': elapsed,
            'successful': successful_count,
            'failed': failed_count,
            'dedup_stats': {
                'raw_domains': total_raw,
                'canonical_domains': len(canonical_domains),
                'cache_hits': cache_hits,
            },
        })
        try:
            if redis_client.client:
                redis_client.client.setex(result_key, 3600, result_data)
                logger.info(f"  📦 Result stored in Redis ({len(result_data)} bytes)")
        except Exception as e:
            logger.error(f"  ❌ Failed to store result in Redis: {e}")

        _clear_progress(session_id, 4)

    except Exception as e:
        logger.error(f"Step 4 Pipeline background error: {e}", exc_info=True)
        try:
            if redis_client.client:
                redis_client.client.setex(result_key, 3600, json.dumps({
                    'success': False,
                    'error': str(e),
                    'details': 'Step 4 pipeline failed',
                }))
        except Exception:
            pass
        try:
            _clear_progress(session_id, 4)
        except Exception:
            pass


@app.route('/api/step4-result', methods=['GET'])
@with_session(db)
def get_step4_result(session_id):
    """
    Poll for Step 4 pipeline result. Returns the result if ready,
    or {pending: true} if still running.
    """
    result_key = f"step4_result:{session_id}"
    try:
        if redis_client.client:
            data = redis_client.client.get(result_key)
            if data:
                # Result is ready — delete from Redis and return it
                redis_client.client.delete(result_key)
                return Response(data, mimetype='application/json')
    except Exception as e:
        logger.warning(f"Error fetching step4 result from Redis: {e}")

    return jsonify({'pending': True}), 202


@app.route('/api/clear-step4-cache', methods=['POST'])
@with_session(db)
def clear_step4_cache(session_id):
    """Clear the Step 4 domain scan cache in Redis."""
    try:
        if not redis_client.client:
            return jsonify({'error': 'Redis not available'}), 503
        # Delete all keys matching the step4_scan: pattern
        cursor = 0
        deleted = 0
        while True:
            cursor, keys = redis_client.client.scan(cursor, match='step4_scan:*', count=100)
            if keys:
                redis_client.client.delete(*keys)
                deleted += len(keys)
            if cursor == 0:
                break
        logger.info(f"  🗑️ Cleared {deleted} Step 4 scan cache entries")
        return jsonify({'cleared': deleted})
    except Exception as e:
        logger.error(f"Error clearing step4 cache: {e}")
        return jsonify({'error': str(e)}), 500


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
        
        original_goal = input_data.get('goal', '') if isinstance(input_data, dict) else ''
        bridge_lexicon = input_data.get('step2', {}).get('bridge_lexicon', {}) if isinstance(input_data, dict) else {}
        logger.info(f"\nStep 3 Debug: Processing goal {goal.get('id', 'unknown')}")

        return f"""Original User Objective: {original_goal}

Q0: {q0_text}

Goal Pillar:
{json.dumps(goal, indent=2)}

Bridge Lexicon (System Property Variables):
{json.dumps(bridge_lexicon, indent=2) if bridge_lexicon else 'Not available'}

Generate Requirement Atoms for this specific goal pillar.

DOMAIN SPECIFICITY REMINDER: All Requirement Atoms must be specific to the domain/system described in the original user objective ("{original_goal}"). Use domain-specific perturbation classes, state variables, and failure shapes. Solution agnosticism means not naming specific drugs/interventions — it does NOT mean being vague about the target system.

NON-TRIVIAL REQUIREMENT: Do not produce formulaic or generic RAs. Each atom must address a SPECIFIC failure mode with unique perturbation classes. Include at least 1 RA addressing cross-subsystem interactions and 1 addressing dynamic/recovery requirements."""
    
    # STEP 4: INPUT: Q0, target_goal (G), requirement_atoms (RAs), bridge_lexicon (SPVs) | OUTPUT: JSON with S-Nodes for this specific Goal
    elif step_id == 4:
        # NEW: Direct properties in batch mode
        q0_reference = input_data.get('Q0_reference', '')
        target_goal = input_data.get('target_goal', {})
        requirement_atoms = input_data.get('requirement_atoms', [])
        bridge_lexicon = input_data.get('bridge_lexicon', {})
        target_domain = input_data.get('target_domain', None)
        
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
        if target_domain:
            logger.info(f"  Target Domain: {target_domain.get('domain_id', 'N/A')} — {target_domain.get('domain_name', 'N/A')}")
        
        original_goal = input_data.get('goal', '')

        # Phase 4b: domain-specific deep scan (target_domain present)
        if target_domain:
            return f"""Original User Objective: {original_goal}

Q0 Reference: {q0_reference}

Target Goal (G):
{json.dumps(target_goal, separators=(',', ':'))}

Requirement Atoms (RAs) for this Goal:
{json.dumps(requirement_atoms, separators=(',', ':'))}

Bridge Lexicon (System Property Variables):
{json.dumps(bridge_lexicon, separators=(',', ':'))}

Target Research Domain to scan:
{json.dumps(target_domain, separators=(',', ':'))}

Generate Scientific Pillars (S-Nodes) for 2026 from THIS SPECIFIC RESEARCH DOMAIN that are relevant to the goal and can affect the required system properties. Focus your analysis on the domain specified above.

DOMAIN SPECIFICITY REMINDER: All scientific pillars must be specific to the domain/system described in the original user objective ("{original_goal}"). Describe how each mechanism specifically affects THIS target system — not how it works in general biology. Each pillar title should clearly indicate its relevance to the target system.

NON-TRIVIAL REQUIREMENT: Do not produce a generic textbook summary. Include frontier research from the last 5 years, surface contradictions between established mechanisms, and identify at least 1 cross-domain mechanism from an adjacent field. Pillar titles must be mechanism-descriptive (not compound-specific)."""

        # Phase 4a: domain mapping (no target_domain)
        return f"""Original User Objective: {original_goal}

Q0 Reference: {q0_reference}

Target Goal (G):
{json.dumps(target_goal, separators=(',', ':'))}

Requirement Atoms (RAs) for this Goal:
{json.dumps(requirement_atoms, separators=(',', ':'))}

Bridge Lexicon (System Property Variables):
{json.dumps(bridge_lexicon, separators=(',', ':'))}

Identify research domains that are specifically relevant to THIS GOAL and the target system described in Q0.

DOMAIN SPECIFICITY REMINDER: All research domains must be specific to the domain/system described in the original user objective ("{original_goal}"). Do NOT identify generic research domains (e.g., "Molecular Mechanisms", "Cellular Biology"). Instead identify domain-specific research areas of the target system described in Q0."""
    
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
    
    # STEP 6: INPUT: goal pillar, bridge lexicon, step4 S-nodes | OUTPUT: L3 seed questions
    elif step_id == 6:
        # Get the specific goal pillar for this batch item
        goal = input_data.get('goal_pillar', {})

        if not goal:
            # Fallback to old behavior
            step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
            goals = step2_data.get('goals', [])
            goal = goals[0] if goals else {}

        goal_id = goal.get('id', '')
        # Read bridge_lexicon directly (new path), fallback to old step2.bridge_lexicon path
        bridge_lexicon = input_data.get('bridge_lexicon', {})
        if not bridge_lexicon:
            step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
            bridge_lexicon = step2_data.get('bridge_lexicon', {})

        # Use pre-built relationship_summary if available, else build from step4
        relationship_summary = input_data.get('relationship_summary', [])
        if not relationship_summary:
            step4_data = input_data.get('step4', {}) if isinstance(input_data, dict) else {}
            scientific_pillars = []
            if goal_id in step4_data:
                goal_data = step4_data.get(goal_id, {})
                scientific_pillars = goal_data.get('scientific_pillars', [])
            else:
                scientific_pillars = step4_data.get('scientific_pillars', [])
            for pillar in scientific_pillars[:20]:
                if isinstance(pillar, dict):
                    relationship_summary.append({
                        'pillar_id': pillar.get('id', 'N/A'),
                        'title': pillar.get('title', 'N/A'),
                        'mechanism': pillar.get('mechanism', '')[:150],
                        'readiness_level': pillar.get('readiness_level', ''),
                        'relationship': pillar.get('relationship_to_goal', 'unknown'),
                        'confidence': pillar.get('relationship_confidence', 0.0),
                        'gap': pillar.get('gap_analysis', '')
                    })

        logger.info(f"\nStep 6 Debug: Processing Goal {goal_id}")
        logger.info(f"  - Relationship summary: {len(relationship_summary)} samples")

        q0_ref = input_data.get('Q0_reference', '')

        # Extract RAs for this goal
        step3_data = input_data.get('step3', []) if isinstance(input_data, dict) else []
        ras = step3_data if isinstance(step3_data, list) else []

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

Requirement Atoms (what must be achieved for this goal):
{json.dumps(ras[:8], indent=2)}

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
1. Which Requirement Atoms have NO S-node addressing them (VOID gaps)
2. Which S-nodes are fragile or low-readiness for their target RAs (FRAGILITY gaps)
3. Which S-nodes measure proxies instead of underlying SPVs (PROXY gaps)
4. Where S-nodes make contradictory predictions for the same RA (CLASH gaps)

Remember: Use {goal_id} in ALL L3 question IDs!"""
    
    # STEP 7: INPUT: 1 L3 question + context | OUTPUT: Instantiation Hypotheses
    elif step_id == 7:
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
            step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
            goals = step2_data.get('goals', [])
            goal = goals[0] if goals else {}
        # Read bridge_lexicon directly (new path), fallback to old step2.bridge_lexicon path
        bridge_lexicon = input_data.get('bridge_lexicon', {})
        if not bridge_lexicon:
            step2_data = input_data.get('step2', {}) if isinstance(input_data, dict) else {}
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
        
        # Extract scientific context for Step 8
        sci_pillars = input_data.get('scientific_pillars', [])
        step8_bridge = input_data.get('bridge_lexicon', {})

        prompt_parts_8 = [f"""Master Project Question (Q0):
{q0_ref}"""]

        prompt_parts_8.append(f"""L3 Seed Question:
{json.dumps(l3_question, indent=2)}""")

        prompt_parts_8.append(f"""Parent Goal Context:
{json.dumps(goal, indent=2)}""")

        prompt_parts_8.append(f"""Requirement Atoms (for this Goal):
{json.dumps(ras[:4], indent=2)}""")

        prompt_parts_8.append(f"""Instantiation Hypotheses (for this L3):
{json.dumps(ihs, indent=2)}""")

        # Include competition matrix if available
        cm = step7_data.get('competition_matrix', []) if isinstance(step7_data, dict) else []
        if cm:
            prompt_parts_8.append(f"""Competition Matrix (IH pairs with distinguishing predictions — use these to design DISCRIMINATOR L4 questions):
{json.dumps(cm, indent=2)}""")

        if sci_pillars:
            prompt_parts_8.append(f"""Scientific Context (established S-nodes for this goal — use to ground L4 questions in available measurement tech and experimental systems):
{json.dumps(sci_pillars, indent=2)}""")

        if step8_bridge and step8_bridge.get('system_properties'):
            prompt_parts_8.append(f"""System Property Variables (SPV definitions — reference in L4 questions):
{json.dumps(step8_bridge['system_properties'], indent=2)}""")

        prompt_parts_8.append("Generate L4 Tactical Questions that discriminate between these hypotheses for this specific L3 question. All tactical questions must serve the Master Project Question (Q0) above. Use the Scientific Context to ground questions in real experimental systems and measurement technologies.")

        return '\n\n'.join(prompt_parts_8)
    
    # STEP 9: INPUT: 1 L4 question + IHs + parent L3 + parent goal + science context | OUTPUT: L5/L6 tasks for that L4
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

        # New enrichment fields (expanded in genius upgrade)
        parent_l3 = input_data.get('parent_l3_question') or {}
        ihs = input_data.get('instantiation_hypotheses', [])
        parent_goal_title = input_data.get('parent_goal_title', '')
        sci_context = input_data.get('scientific_context', [])
        step9_bridge = input_data.get('bridge_lexicon', {})

        # Debug: Log raw input data structure
        logger.info(f"\n{'='*60}")
        logger.info(f"[Step 9 Debug] L4 question: {l4_question.get('id', 'unknown')}")
        logger.info(f"[Step 9 Debug] L4 parent_l3_id: {l4_question.get('parent_l3_id', 'N/A')}")
        logger.info(f"[Step 9 Debug] L4 parent_goal_id: {l4_question.get('parent_goal_id', 'N/A')}")
        logger.info(f"[Step 9 Debug] input_data keys: {list(input_data.keys()) if isinstance(input_data, dict) else 'N/A'}")
        logger.info(f"[Step 9 Debug] parent_l3: {parent_l3.get('id', 'N/A') if parent_l3 else 'None'}")
        logger.info(f"[Step 9 Debug] IHs: {len(ihs)}, parent_goal_title: {parent_goal_title[:50] if parent_goal_title else 'N/A'}")
        logger.info(f"[Step 9 Debug] sci_context: {len(sci_context)} S-nodes, bridge_lexicon: {bool(step9_bridge)}")
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
        logger.info(f"  RAs: {len(ras)}, IHs: {len(ihs)}")

        # Build prompt with enriched context (genius upgrade: structured S-nodes, full L3, more IH fields, SPVs)
        prompt_parts = [f"""Master Project Question (Q0):
{q0_ref}"""]

        if parent_goal_title:
            prompt_parts.append(f"Parent Goal: {parent_goal_title}")

        if parent_l3 and parent_l3.get('id'):
            prompt_parts.append(f"""Parent L3 Question:
{json.dumps(parent_l3, indent=2)}""")

        prompt_parts.append(f"""L4 Tactical Question:
{json.dumps(l4_question, indent=2)}""")

        prompt_parts.append(f"""Requirement Atoms (for parent Goal):
{json.dumps(ras[:3], indent=2)}""")

        if ihs:
            prompt_parts.append(f"""Instantiation Hypotheses (for this L4's parent L3):
{json.dumps(ihs, indent=2)}""")

        if sci_context:
            prompt_parts.append(f"""Scientific Context (established S-nodes — use mechanisms and readiness to ground experiment design):
{json.dumps(sci_context, indent=2)}""")

        if step9_bridge and step9_bridge.get('system_properties'):
            prompt_parts.append(f"""System Property Variables (SPV definitions — link experiments to these measurables):
{json.dumps(step9_bridge['system_properties'], indent=2)}""")

        prompt_parts.append("""Generate L5 mechanistic sub-questions and L6 experiment-ready tasks (with S-I-M-T parameters) for this specific L4 question. Design experiments that discriminate between the hypotheses above. Reference specific S-node mechanisms and SPVs. For each L6, include an 'if_null' field stating what you learn if the experiment produces NO significant result.

CRITICAL REMINDERS:
- The literal string "e.g." is FORBIDDEN in all S-I-M-T fields. Commit to specific choices. If you write "e.g." anywhere in system, intervention, meter, or threshold_time, the output fails review.
- Every L6 MUST have a numeric feasibility_score (1-10) and a non-empty if_null field.
- Maximum 1 computational/in-silico L6 per L4. Convert extras to wet-lab experiments.""")

        return '\n\n'.join(prompt_parts)
    
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
                api_kwargs['extra_body'] = {
                    'provider': {
                        'sort': 'throughput',
                    },
                }
                # Prompt caching for Anthropic models
                if 'anthropic' in resolved.lower() or 'claude' in resolved.lower():
                    api_kwargs['messages'] = [
                        {
                            "role": "system",
                            "content": [
                                {"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}
                            ]
                        },
                        {"role": "user", "content": user_prompt}
                    ]

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
    model = data.get('model', 'google/gemini-2.5-flash')
    graph_summary = data.get('graphSummary', '')
    l6_analysis_summary = data.get('l6AnalysisSummary', '')

    # Build system prompt with full pipeline context
    graph_section = f"""
───────────────────────────────────────
PIPELINE HIERARCHY (compressed tree — Goal → L3 → IH → L4 → L5 → L6):
{graph_summary}
───────────────────────────────────────""" if graph_summary else ""

    l6_section = f"""
TOP EXPERIMENTS (AI-ranked best L6):
{l6_analysis_summary}""" if l6_analysis_summary else ""

    if selected_nodes:
        nodes_section = f"""
USER-FOCUSED NODES ({len(selected_nodes)} selected — answer primarily about these):
{json.dumps(selected_nodes, indent=2)}"""
    else:
        nodes_section = """
No specific nodes are focused. The user is asking about the FULL pipeline.
Use the hierarchy tree and top experiments above to answer comprehensively."""

    system_prompt = f"""You are an expert scientific research advisor embedded in the **Omega Point** system — a multi-agent pipeline that decomposes ambitious scientific goals into extraordinary yet realistic, executable lab experiments.

=== OMEGA POINT ARCHITECTURE ===

The system is built on a core philosophy: systematically arrive at experiments so ingenious that nobody has done them before, yet so well-grounded they could run in a real lab tomorrow. Each level exists because the previous one is too abstract to act on, and the next one is too concrete to plan without it.

**The Decomposition Hierarchy (why each level exists):**

1. **Q0 (Master Question)** — The root. A single, dense, solution-neutral question that frames the entire research program. It must be ambitious enough to demand novel science (paradigm-level, not incremental). Everything downstream is derived from Q0.

2. **Goal Pillars (G-nodes)** — MECE decomposition of Q0 into required end-states via Inverse Failure Analysis: "what biological failure modes must be prevented?" inverted into positive targets. Each pillar targets a FUNCTIONAL requirement, not an anatomical compartment. They also produce a **Bridge Lexicon** (SPVs = System Property Variables, FCCs = Failure Channel Codes) — the shared measurement language for the whole pipeline.

3. **Requirement Atoms (RAs)** — Each Goal Pillar is atomized into 5-9 testable, solution-agnostic requirements. Each RA binds a state variable to a perturbation class, timescale, failure shape, and meter class. They include non-obvious inter-subsystem cascade requirements and mandatory "unknown-unknown" atoms. RAs define WHAT must be true without saying HOW.

4. **Domains + Scientific Pillars (S-nodes)** — The system maps each goal to 8-12 specific research domains (not generic fields — targeted, non-obvious domains). Within each domain, it identifies 15-25 established, evidence-based Scientific Pillars backed by real literature (PubMed, Semantic Scholar, OpenAlex). This is where the pipeline connects to EXISTING science — what humanity already knows.

   **The key transition**: Steps 1-3 define WHAT we need (goal-side). Step 4 maps WHAT EXISTS (science-side). The GAP between them drives everything below.

5. **(Merged into Step 4)** — Strategic matching of goals to science, identifying magnitude/execution/timescale/knowledge gaps.

6. **L3 Frontier Questions** — These target the strategic gap between Goal and Scientific Reality. They must be UNANSWERABLE by literature search — genuine epistemic gaps requiring NEW experiments. Four strategies: Genesis Probes (complete void), Contextual Decoupling (fragility traps), Causal Pivot (proxy mirages), Arbitration Logic (cluster clashes). L3s challenge assumptions, connect across scales, and include adversarial falsification attempts.

7. **Instantiation Hypotheses (IHs)** — Each L3 question spawns competing hypotheses across diverse domain categories (interface integrity, information/control, structural, resource/energetic, environmental). Must include HERETICAL hypotheses and cross-domain transfer hypotheses. The best IHs are those where confirming OR refuting them changes how we think about the problem.

8. **L4 Tactical Questions** — Decompose L3+IH pairs into concrete, discriminating questions. >=50% must be DISCRIMINATOR questions that pit IHs against each other. Trivial "does X affect Y" questions are forbidden — each L4 must require the full hierarchical context (G+RA+S+L3+IH) to even conceive. Includes mandatory unknown-exploration nodes.

9. **L5 Mechanistic Sub-questions + L6 Experimental Protocols** — L5s break L4s into testable mechanistic sub-questions. L6s are the leaf nodes: fully specified experiments with concrete **S-I-M-T parameters**:
   - **System**: specific model organism/cell line with source and conditions
   - **Intervention**: named compounds with catalog numbers, doses, schedules, controls
   - **Meter**: specific assays/instruments with protocols
   - **Threshold/Time**: quantitative success criteria with statistical power
   Every L6 must be both AMBITIOUS and FEASIBLE — no textbook experiments allowed.

10. **Common Experiment Synthesis** — Evaluates whether multiple L6 tasks within an L4 branch can be unified into a single experiment greater than the sum of its parts. Brutally honest: rejects vague umbrella experiments that test nothing well.

**Reading the hierarchy**: Any path from Q0 → G → L3 → IH → L4 → L5 → L6 tells a complete scientific story: "We need X (goal), science knows Y (pillars), the gap is Z (L3), we hypothesize A (IH), we can discriminate by asking B (L4), specifically testing C (L5) via experiment D (L6)."

=== CURRENT SESSION DATA ===

MASTER QUESTION (Q0):
{q0}

GOAL PILLARS:
{goal if goal else 'Not yet generated'}

EPISTEMIC LENS: {lens if lens else 'None specified'}
{graph_section}
{l6_section}
{nodes_section}

=== RESPONSE GUIDELINES ===
- Use **markdown** formatting: headers, bold, bullet lists, tables where helpful.
- Reference specific **node IDs** (e.g., L6_G1_..., L3-G1-2) so the user can locate them in the graph.
- Be scientifically rigorous. Use domain-appropriate terminology.
- When discussing experiments, reference their S-I-M-T parameters (System, Intervention, Meter, Threshold/Time).
- When comparing experiments, use structured formats (tables or ranked lists with rationale).
- If the user asks about gaps or weaknesses, be specific about what's missing and suggest concrete next steps.
- If no nodes are focused, reason about the full pipeline — identify patterns, gaps, and the strongest/weakest branches.
- When asked about "why" a level exists or how the pipeline works, use the architecture knowledge above to explain the decomposition logic.
- Always connect your answers back to the hierarchical context: how does this node/question/experiment relate to its parent goal, the L3 gap it addresses, and the IH it tests?"""

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
                max_tokens=8192,
                stream=True,
            )
            if API_PROVIDER == 'openrouter':
                api_kwargs['extra_headers'] = {
                    'HTTP-Referer': 'https://omega-point.local',
                    'X-Title': 'Omega Point Node Chat',
                }
                api_kwargs['extra_body'] = {
                    'provider': {
                        'sort': 'throughput',
                    },
                }
                # Prompt caching for Anthropic models: cache the system message
                if 'anthropic' in resolved.lower() or 'claude' in resolved.lower():
                    # Tag the first (system) message with cache_control
                    if api_messages and api_messages[0].get('role') == 'system':
                        api_messages[0] = {
                            "role": "system",
                            "content": [
                                {"type": "text", "text": api_messages[0]['content'], "cache_control": {"type": "ephemeral"}}
                            ]
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

# ─── Chat History Persistence ────────────────────────────────────────────────

def _ensure_chat_history_table():
    """Create chat_history table if it doesn't exist (idempotent)."""
    try:
        with db.engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS chat_history (
                    id SERIAL PRIMARY KEY,
                    session_id UUID NOT NULL,
                    conversation_id UUID NOT NULL DEFAULT uuid_generate_v4(),
                    messages JSONB NOT NULL DEFAULT '[]',
                    selected_node_ids JSONB DEFAULT '[]',
                    is_archived BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_chat_history_conversation ON chat_history(conversation_id)"))
            conn.commit()
    except Exception as e:
        logger.debug(f"[Chat History] Table check: {e}")

# Ensure table exists on import
try:
    _ensure_chat_history_table()
except Exception:
    pass


@app.route('/api/chat-history/save', methods=['POST'])
@with_session(db)
def save_chat_history(session_id):
    """Save or update a chat conversation. Keeps archived copies."""
    data = request.json
    conversation_id = data.get('conversationId')
    messages = data.get('messages', [])
    selected_node_ids = data.get('selectedNodeIds', [])

    if not messages:
        return jsonify({'ok': True, 'skipped': True})

    try:
        session_uuid = uuid.UUID(session_id)
        with db.engine.connect() as conn:
            if conversation_id:
                # Update existing conversation
                conv_uuid = uuid.UUID(conversation_id)
                result = conn.execute(
                    text("""
                        UPDATE chat_history
                        SET messages = :messages, selected_node_ids = :node_ids, updated_at = NOW()
                        WHERE conversation_id = :conv_id AND session_id = :session_id AND is_archived = FALSE
                        RETURNING id
                    """),
                    {'messages': json.dumps(messages), 'node_ids': json.dumps(selected_node_ids),
                     'conv_id': str(conv_uuid), 'session_id': str(session_uuid)}
                )
                if result.rowcount == 0:
                    # Conversation was archived or doesn't exist — create new
                    new_conv = uuid.uuid4()
                    conn.execute(
                        text("""
                            INSERT INTO chat_history (session_id, conversation_id, messages, selected_node_ids)
                            VALUES (:session_id, :conv_id, :messages, :node_ids)
                        """),
                        {'session_id': str(session_uuid), 'conv_id': str(new_conv),
                         'messages': json.dumps(messages), 'node_ids': json.dumps(selected_node_ids)}
                    )
                    conversation_id = str(new_conv)
            else:
                # Create new conversation
                new_conv = uuid.uuid4()
                conn.execute(
                    text("""
                        INSERT INTO chat_history (session_id, conversation_id, messages, selected_node_ids)
                        VALUES (:session_id, :conv_id, :messages, :node_ids)
                    """),
                    {'session_id': str(session_uuid), 'conv_id': str(new_conv),
                     'messages': json.dumps(messages), 'node_ids': json.dumps(selected_node_ids)}
                )
                conversation_id = str(new_conv)
            conn.commit()

        return jsonify({'ok': True, 'conversationId': conversation_id})
    except Exception as e:
        logger.warning(f"[Chat History] Save error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/chat-history/archive', methods=['POST'])
@with_session(db)
def archive_chat_history(session_id):
    """Archive a conversation (user cleared chat). Data is kept but hidden from UI."""
    data = request.json
    conversation_id = data.get('conversationId')

    if not conversation_id:
        return jsonify({'ok': True})

    try:
        session_uuid = uuid.UUID(session_id)
        conv_uuid = uuid.UUID(conversation_id)
        with db.engine.connect() as conn:
            conn.execute(
                text("""
                    UPDATE chat_history SET is_archived = TRUE, updated_at = NOW()
                    WHERE conversation_id = :conv_id AND session_id = :session_id
                """),
                {'conv_id': str(conv_uuid), 'session_id': str(session_uuid)}
            )
            conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        logger.warning(f"[Chat History] Archive error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/chat-history/load', methods=['GET'])
@with_session(db)
def load_chat_history(session_id):
    """Load the active (non-archived) conversation for this session."""
    try:
        session_uuid = uuid.UUID(session_id)
        with db.engine.connect() as conn:
            result = conn.execute(
                text("""
                    SELECT conversation_id, messages, selected_node_ids, created_at, updated_at
                    FROM chat_history
                    WHERE session_id = :session_id AND is_archived = FALSE
                    ORDER BY updated_at DESC
                    LIMIT 1
                """),
                {'session_id': str(session_uuid)}
            )
            row = result.mappings().first()
            if row:
                return jsonify({
                    'conversationId': str(row['conversation_id']),
                    'messages': row['messages'] if isinstance(row['messages'], list) else json.loads(row['messages']) if row['messages'] else [],
                    'selectedNodeIds': row['selected_node_ids'] if isinstance(row['selected_node_ids'], list) else json.loads(row['selected_node_ids']) if row['selected_node_ids'] else [],
                    'createdAt': row['created_at'].isoformat() if row['created_at'] else None,
                    'updatedAt': row['updated_at'].isoformat() if row['updated_at'] else None,
                })
            return jsonify({'conversationId': None, 'messages': [], 'selectedNodeIds': []})
    except Exception as e:
        logger.warning(f"[Chat History] Load error: {e}")
        return jsonify({'conversationId': None, 'messages': [], 'selectedNodeIds': []})


# ─── L6 Perspective Analysis ──────────────────────────────────────────────────

# --- Helper: serialize a list of L6 experiments into prompt text ---
def _serialize_l6_for_prompt(experiments, start_idx=0):
    """Serialize L6 experiments into text for LLM prompts. Returns string."""
    l6_summary = []
    for idx, exp in enumerate(experiments):
        simt = exp.get('simt_parameters', {})
        parts = [
            f"{start_idx + idx + 1}. **{exp.get('id', '')}**: {exp.get('title', '')}",
            f"   - System: {simt.get('system', '')}",
            f"   - Intervention: {simt.get('intervention', '')}",
            f"   - Meter: {simt.get('meter', '')}",
            f"   - Threshold/Time: {simt.get('threshold_time', '')}",
            f"   - Expected Impact: {exp.get('expected_impact', '')}",
        ]
        if exp.get('rationale'):
            parts.append(f"   - Rationale: {exp['rationale']}")
        if exp.get('if_null'):
            parts.append(f"   - If Null: {exp['if_null']}")
        if exp.get('feasibility_score') is not None:
            parts.append(f"   - Feasibility Score: {exp['feasibility_score']}/10")
        if exp.get('genius_score') is not None:
            parts.append(f"   - Genius Score: {exp['genius_score']}/10")
        if exp.get('discovery_component'):
            parts.append(f"   - Discovery Component: Yes")
        if exp.get('verification_note'):
            parts.append(f"   - Verification: {exp['verification_note']}")
        if exp.get('spv_link'):
            parts.append(f"   - SPV Link: {exp['spv_link']}")
        l6_summary.append("\n".join(parts))
    return "\n".join(l6_summary)


# --- Helper: build system prompt for L6 selection ---
def _build_l6_selection_system_prompt(q0, goals_summary, select_n, is_final_round=False):
    """Build the system prompt for L6 selection. Shared between batch and final rounds."""
    round_note = ""
    if is_final_round:
        round_note = """
NOTE: This is the FINAL SELECTION ROUND. These experiments are the winners from preliminary batches.
Apply the STRICTEST standards — only the absolute best survive. Pay extra attention to strategic
diversity: the final portfolio should cover different goal pillars, model systems, and mechanisms."""

    return f"""You are a scientific research strategist analyzing experimental proposals for a research initiative.

**Master Question (Q₀):**
{q0}

**Goal Pillars:**
{goals_summary}
{round_note}
Your task is to analyze the following L6 experimental proposals and select the TOP {select_n} MOST PROMISING experiments. Each experiment has been through a genius verification layer — use the genius_score and feasibility_score as initial signals but apply your OWN independent judgment.

**Selection Criteria (in priority order):**

1. **Non-Triviality (HIGHEST)**: Could this experiment be conceived by reading a review article, or does it REQUIRE the full pipeline hierarchy (G→RA→S→L3→IH→L4) to conceive? Strongly prefer experiments that test INTERACTIONS between mechanisms identified by different IHs.

2. **Discrimination Power**: Does this experiment produce qualitatively different outcomes under competing hypotheses? Prefer experiments where both positive AND null results are informative (check the "if_null" field).

3. **Specificity**: Are S-I-M-T parameters fully specified with real reagents, catalog numbers, doses, and statistical thresholds? Reject experiments with vague or placeholder specifications.

4. **System Cleverness**: Does the experiment use a creative model system choice? Non-mammalian models (C. elegans, Drosophila, yeast) that exploit genetic tractability, or in vitro systems that strip to the minimal sufficient model, score higher than default mouse experiments.

5. **Factorial/Multi-variable Design**: Does it test 2+ variables simultaneously with interaction analysis? Single-variable, single-endpoint experiments score lower.

6. **Strategic Coverage**: Collectively, do the selected experiments cover diverse mechanisms, model systems, and goal pillars? Avoid selecting 5 experiments that all use the same system.

7. **Feasibility-Ambition Balance**: Very high feasibility (9-10) with low genius is boring. Very high genius (9-10) with low feasibility is impractical. The sweet spot is genius 7-9 with feasibility 5-8.

**Reject from selection:**
- Pure computational/in-silico experiments (unless exceptionally creative)
- Baseline characterization without hypothesis testing
- Omics fishing expeditions (RNA-seq, proteomics without targeted perturbation)
- Experiments with empty or uninformative "if_null"

Return your analysis as a JSON object with this structure:
{{
  "selected_experiments": [
    {{
      "l6_id": "L6-XXX",
      "rank": 1,
      "strategic_value": "Why this experiment is strategically critical for Q₀",
      "impact_potential": "What paradigm-level insight this could reveal",
      "key_insight": "The specific scientific question only this experiment answers",
      "discrimination_power": "Which IHs does this distinguish and how",
      "score": 95
    }},
    ...
  ],
  "overall_assessment": "How the selected experiments form a coherent research strategy — what each one contributes that the others don't",
  "coverage_gaps": "What important areas are NOT covered by the selection"
}}

Return ONLY valid JSON, no markdown formatting."""


# --- Helper: run one L6 selection call against the LLM ---
def _run_l6_selection_call(experiments, system_prompt, resolved_model, temperature, batch_label=""):
    """Run a single LLM call to select top experiments from a list. Returns parsed JSON or None.
    Includes retry with exponential backoff for rate-limit (429) errors."""
    l6_text = _serialize_l6_for_prompt(experiments)
    user_prompt = f"""Here are the {len(experiments)} L6 experimental proposals to analyze:

{l6_text}

Analyze these experiments and select the most promising ones. Return your analysis as JSON."""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    MAX_RETRIES = 3
    for attempt in range(MAX_RETRIES):
        try:
            logger.info(f"[L6 Analysis] {batch_label} Calling LLM for {len(experiments)} experiments...{f' (retry {attempt})' if attempt > 0 else ''}")
            response = client.chat.completions.create(
                model=resolved_model,
                messages=messages,
                temperature=temperature,
                response_format={"type": "json_object"},
                timeout=480
            )
            raw_response = response.choices[0].message.content
            logger.info(f"[L6 Analysis] {batch_label} Received response ({len(raw_response)} chars)")

            try:
                return json.loads(raw_response)
            except json.JSONDecodeError as e:
                logger.error(f"[L6 Analysis] {batch_label} JSON parse error: {e}")
                json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw_response, re.DOTALL)
                if json_match:
                    return json.loads(json_match.group(1))
                return None
        except Exception as e:
            err_str = str(e)
            is_rate_limit = '429' in err_str or 'rate' in err_str.lower() or 'too many' in err_str.lower()
            if is_rate_limit and attempt < MAX_RETRIES - 1:
                backoff = 2 ** (attempt + 1) + random.uniform(0, 1)
                logger.warning(f"[L6 Analysis] {batch_label} Rate limit hit, backing off {backoff:.1f}s (attempt {attempt + 1}/{MAX_RETRIES})")
                time.sleep(backoff)
                continue
            logger.error(f"[L6 Analysis] {batch_label} LLM call failed: {e}")
            return None


@app.route('/api/analyze-l6-perspective', methods=['POST'])
@with_session(db)
def analyze_l6_perspective(session_id):
    """
    Analyze all L6 experiments and select the most promising ones based on Q0 and goals.
    Supports large experiment sets (1000+) via batched multi-stage selection:
      - Stage 1: Split into batches of BATCH_SIZE, select top-N per batch (parallel)
      - Stage 2: Combine batch winners, run final selection to pick overall top-N
    For small sets (<=BATCH_SIZE), runs a single-pass selection.
    """
    BATCH_SIZE = 50  # Max experiments per LLM call
    WINNERS_PER_BATCH = 10  # How many survive each batch round

    try:
        data = request.json
        q0 = data.get('q0', '')
        goals = data.get('goals', [])
        l6_experiments = data.get('l6_experiments', [])
        agent_config = data.get('agentConfig', {})
        top_n = data.get('top_n', 10)

        if not l6_experiments:
            return jsonify({'error': 'No L6 experiments provided'}), 400

        total_count = len(l6_experiments)
        logger.info(f"[L6 Analysis] Analyzing {total_count} experiments, selecting top {top_n}")

        # Build goals summary (shared across all calls)
        goals_summary = "\n".join([
            f"- {g.get('id', '')}: {g.get('title', '')}\n  {g.get('state_definition', '')[:200]}"
            for g in goals[:5]
        ])

        # Get LLM configuration
        model = agent_config.get('model', 'gpt-4o')
        temperature = agent_config.get('temperature', 0.3)
        resolved_model = resolve_model(model)
        logger.info(f"[L6 Analysis] Using model: {model} → {resolved_model}")

        # Build an index for fast lookup by L6 ID
        l6_by_id = {exp.get('id', f'L6-idx-{i}'): exp for i, exp in enumerate(l6_experiments)}

        # ── SINGLE-PASS: small experiment sets ─────────────────────────
        if total_count <= BATCH_SIZE:
            system_prompt = _build_l6_selection_system_prompt(q0, goals_summary, top_n)
            analysis = _run_l6_selection_call(
                l6_experiments, system_prompt, resolved_model, temperature, batch_label="[Single]"
            )
            if not analysis:
                return jsonify({'error': 'Failed to get LLM response'}), 500

            logger.info(f"[L6 Analysis] Single-pass selected {len(analysis.get('selected_experiments', []))} experiments")
            return jsonify({
                'success': True,
                'analysis': analysis,
                'total_analyzed': total_count,
                'selected_count': len(analysis.get('selected_experiments', [])),
                'method': 'single_pass'
            })

        # ── MULTI-STAGE: large experiment sets ─────────────────────────
        # Calculate batch parameters
        num_batches = math.ceil(total_count / BATCH_SIZE)
        # Scale winners per batch: ensure we have enough for a meaningful final round
        # but cap to avoid the final round also blowing up
        winners_per_batch = max(WINNERS_PER_BATCH, math.ceil(top_n * 2.5 / num_batches))
        # Cap: final round shouldn't exceed BATCH_SIZE either
        max_winners_total = BATCH_SIZE
        if winners_per_batch * num_batches > max_winners_total:
            winners_per_batch = max(5, max_winners_total // num_batches)

        logger.info(f"[L6 Analysis] Multi-stage: {num_batches} batches of ~{BATCH_SIZE}, "
                     f"{winners_per_batch} winners/batch, final round picks top {top_n}")

        # Split into batches
        batches = []
        for i in range(0, total_count, BATCH_SIZE):
            batches.append(l6_experiments[i:i + BATCH_SIZE])

        # Stage 1: Run all batch selections in parallel
        batch_system_prompt = _build_l6_selection_system_prompt(
            q0, goals_summary, winners_per_batch, is_final_round=False
        )

        stage1_winners = []
        stage1_stats = {'batches_succeeded': 0, 'batches_failed': 0}

        with ThreadPoolExecutor(max_workers=min(num_batches, MAX_BATCH_WORKERS)) as executor:
            future_to_batch = {}
            for batch_idx, batch in enumerate(batches):
                label = f"[Batch {batch_idx + 1}/{num_batches}]"
                future = executor.submit(
                    _run_l6_selection_call,
                    batch, batch_system_prompt, resolved_model, temperature, label
                )
                future_to_batch[future] = (batch_idx, batch)

            for future in as_completed(future_to_batch, timeout=480):
                batch_idx, batch = future_to_batch[future]
                try:
                    result = future.result(timeout=480)
                    if result and 'selected_experiments' in result:
                        selected_ids = [s.get('l6_id', '') for s in result['selected_experiments']]
                        # Recover full experiment objects for the winners
                        for sel in result['selected_experiments']:
                            l6_id = sel.get('l6_id', '')
                            full_exp = l6_by_id.get(l6_id)
                            if full_exp:
                                # Attach batch selection metadata
                                winner = dict(full_exp)
                                winner['_batch_rank'] = sel.get('rank', 99)
                                winner['_batch_score'] = sel.get('score', 0)
                                winner['_batch_strategic_value'] = sel.get('strategic_value', '')
                                stage1_winners.append(winner)
                            else:
                                logger.warning(f"[L6 Analysis] Batch {batch_idx}: selected ID '{l6_id}' not found in index")
                        stage1_stats['batches_succeeded'] += 1
                        logger.info(f"[L6 Analysis] Batch {batch_idx + 1}: selected {len(selected_ids)} winners")
                    else:
                        # Batch failed — promote top experiments by genius_score as fallback
                        logger.warning(f"[L6 Analysis] Batch {batch_idx + 1} failed, using fallback selection")
                        sorted_batch = sorted(batch, key=lambda x: x.get('genius_score', 0), reverse=True)
                        stage1_winners.extend(sorted_batch[:winners_per_batch])
                        stage1_stats['batches_failed'] += 1
                except Exception as e:
                    logger.error(f"[L6 Analysis] Batch {batch_idx + 1} exception: {e}")
                    stage1_stats['batches_failed'] += 1
                    # Fallback: take top by genius_score
                    sorted_batch = sorted(batch, key=lambda x: x.get('genius_score', 0), reverse=True)
                    stage1_winners.extend(sorted_batch[:winners_per_batch])

        logger.info(f"[L6 Analysis] Stage 1 complete: {len(stage1_winners)} winners from "
                     f"{stage1_stats['batches_succeeded']} succeeded / {stage1_stats['batches_failed']} failed batches")

        # Deduplicate winners (same L6 ID might appear if batches overlapped somehow)
        seen_ids = set()
        unique_winners = []
        for w in stage1_winners:
            wid = w.get('id', '')
            if wid not in seen_ids:
                seen_ids.add(wid)
                unique_winners.append(w)
        stage1_winners = unique_winners

        # ── Stage 2: If winners still exceed BATCH_SIZE, do another round ──
        # This handles extreme cases (e.g., 5000 L6 → 100 batches → 500+ winners)
        while len(stage1_winners) > BATCH_SIZE:
            logger.info(f"[L6 Analysis] Intermediate round needed: {len(stage1_winners)} winners > {BATCH_SIZE}")
            intermediate_batches = []
            for i in range(0, len(stage1_winners), BATCH_SIZE):
                intermediate_batches.append(stage1_winners[i:i + BATCH_SIZE])

            inter_winners_per_batch = max(5, BATCH_SIZE // len(intermediate_batches))
            inter_system_prompt = _build_l6_selection_system_prompt(
                q0, goals_summary, inter_winners_per_batch, is_final_round=False
            )

            next_round = []
            with ThreadPoolExecutor(max_workers=min(len(intermediate_batches), MAX_BATCH_WORKERS)) as executor:
                futures = []
                for ib_idx, ib in enumerate(intermediate_batches):
                    label = f"[Intermediate {ib_idx + 1}/{len(intermediate_batches)}]"
                    futures.append(executor.submit(
                        _run_l6_selection_call,
                        ib, inter_system_prompt, resolved_model, temperature, label
                    ))

                for f_idx, future in enumerate(futures):
                    try:
                        result = future.result(timeout=480)
                        if result and 'selected_experiments' in result:
                            for sel in result['selected_experiments']:
                                l6_id = sel.get('l6_id', '')
                                full_exp = l6_by_id.get(l6_id)
                                if full_exp:
                                    next_round.append(full_exp)
                        else:
                            # Fallback
                            sorted_ib = sorted(intermediate_batches[f_idx],
                                               key=lambda x: x.get('genius_score', 0), reverse=True)
                            next_round.extend(sorted_ib[:inter_winners_per_batch])
                    except Exception as e:
                        logger.error(f"[L6 Analysis] Intermediate batch {f_idx} error: {e}")
                        sorted_ib = sorted(intermediate_batches[f_idx],
                                           key=lambda x: x.get('genius_score', 0), reverse=True)
                        next_round.extend(sorted_ib[:inter_winners_per_batch])

            # Deduplicate
            seen_ids = set()
            unique_next = []
            for w in next_round:
                wid = w.get('id', '')
                if wid not in seen_ids:
                    seen_ids.add(wid)
                    unique_next.append(w)
            stage1_winners = unique_next
            logger.info(f"[L6 Analysis] Intermediate round reduced to {len(stage1_winners)} winners")

        # ── Stage Final: Select top-N from all batch winners ───────────
        final_system_prompt = _build_l6_selection_system_prompt(
            q0, goals_summary, top_n, is_final_round=True
        )

        logger.info(f"[L6 Analysis] Final round: selecting top {top_n} from {len(stage1_winners)} batch winners")
        analysis = _run_l6_selection_call(
            stage1_winners, final_system_prompt, resolved_model, temperature, batch_label="[Final]"
        )

        if not analysis:
            # Last resort: sort by genius_score and return top_n
            available_count = len(stage1_winners)
            actual_top_n = min(top_n, available_count)
            logger.error(f"[L6 Analysis] Final round failed, using genius_score fallback "
                         f"(selecting {actual_top_n} from {available_count} winners)")
            sorted_all = sorted(stage1_winners, key=lambda x: x.get('genius_score', 0), reverse=True)
            analysis = {
                'selected_experiments': [
                    {
                        'l6_id': exp.get('id', ''),
                        'rank': i + 1,
                        'strategic_value': f"Fallback selection by genius_score ({exp.get('genius_score', 'N/A')})",
                        'impact_potential': exp.get('expected_impact', ''),
                        'key_insight': exp.get('title', ''),
                        'discrimination_power': 'N/A — fallback selection',
                        'score': exp.get('genius_score', 0) * 10
                    }
                    for i, exp in enumerate(sorted_all[:actual_top_n])
                ],
                'overall_assessment': f'Fallback selection based on genius_score — LLM final round failed. '
                                      f'Selected {actual_top_n} from {available_count} batch winners.',
                'coverage_gaps': 'Unable to assess — LLM analysis failed. Manual review recommended.'
            }

        selected_count = len(analysis.get('selected_experiments', []))
        logger.info(f"[L6 Analysis] Multi-stage complete: {selected_count} experiments selected "
                     f"from {total_count} total ({num_batches} batches)")

        return jsonify({
            'success': True,
            'analysis': analysis,
            'total_analyzed': total_count,
            'selected_count': selected_count,
            'method': 'multi_stage',
            'stage_info': {
                'num_batches': num_batches,
                'batch_size': BATCH_SIZE,
                'winners_per_batch': winners_per_batch,
                'stage1_winners': len(stage1_winners),
                'batches_succeeded': stage1_stats['batches_succeeded'],
                'batches_failed': stage1_stats['batches_failed']
            }
        })

    except Exception as e:
        logger.error(f"[L6 Analysis] Error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


# ═══════════════════════════════════════════════════════════════════════════════
# STEP 4 OPTIMIZED - Research API Integration with Scientific Citations
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/api/execute-step4-optimized', methods=['POST'])
@with_session(db)
def execute_step4_optimized(session_id):
    """
    Execute optimized Step 4 with research API integration

    Features:
    - Real scientific citations from PubMed, Semantic Scholar, OpenAlex
    - Intelligent caching with 70-85% hit rate after warm-up
    - Semantic deduplication removes duplicates
    - 50% faster execution (30-60s first run, 2-5s cached)
    - 64-71% cheaper per run

    Request body:
    {
        "goal": {"text": "...", "id": "G_1"},
        "ras": [{"text": "...", "id": "RA_1"}, ...],
        "spvs": [{"text": "...", "id": "SPV_1"}, ...]
    }
    """
    if not STEP4_OPTIMIZED_AVAILABLE:
        return jsonify({
            'error': 'Step 4 Optimized not available',
            'message': 'Required modules not installed. See STEP4_DEPLOYMENT_CHECKLIST.md'
        }), 503

    try:
        data = request.json

        goal = data.get('goal')
        ras = data.get('ras', [])
        spvs = data.get('spvs', [])

        if not goal:
            return jsonify({'error': 'Goal is required'}), 400

        logger.info(f"[Step4 Optimized] Starting for session {session_id}")
        logger.info(f"[Step4 Optimized] Goal: {goal.get('text', '')[:60]}...")
        logger.info(f"[Step4 Optimized] RAs: {len(ras)}, SPVs: {len(spvs)}")

        # Progress callback for real-time updates
        def progress_callback(phase: str, status: str, progress: float):
            try:
                _update_progress(
                    session_id=session_id,
                    step_id='step4_optimized',
                    completed=int(progress * 100),
                    total=100,
                    successful=0,
                    failed=0,
                    elapsed=0,
                    eta=0,
                    latest_item=f"[{phase}] {status}"
                )
            except Exception as e:
                logger.warning(f"[Step4 Optimized] Progress update failed: {e}")

        # Execute optimized pipeline
        start_time = time.time()
        result = execute_step4_for_flask(
            goal=goal,
            ras=ras,
            spvs=spvs,
            progress_callback=progress_callback,
            session_id=session_id
        )
        execution_time = time.time() - start_time

        logger.info(f"[Step4 Optimized] Complete: {len(result.get('scientific_pillars', []))} pillars "
                   f"in {execution_time:.1f}s (cache: {result.get('from_cache', False)})")

        return jsonify({
            'success': True,
            'scientific_pillars': result.get('scientific_pillars', []),
            'domain_mapping': result.get('domain_mapping', {}),
            'raw_domain_scans': result.get('raw_domain_scans', {}),
            'from_cache': result.get('from_cache', False),
            'cache_hit_rate': result.get('cache_hit_rate', 0),
            'execution_time': result.get('execution_time', execution_time),
            'cost_estimate': result.get('cost_estimate', {}),
            'timestamp': result.get('timestamp', datetime.now().isoformat()),
            'phase_timings': result.get('phase_timings', {}),
            'statistics': {
                'total_pillars': len(result.get('scientific_pillars', [])),
                'pillars_from_cache': result.get('cached_count', 0),
                'pillars_new': result.get('new_count', 0),
                'duplicates_removed': result.get('duplicates_removed', 0)
            }
        })

    except Exception as e:
        logger.error(f"[Step4 Optimized] Execution failed: {e}", exc_info=True)
        return jsonify({
            'error': str(e),
            'type': type(e).__name__,
            'message': 'Step 4 optimized execution failed. Check server logs for details.'
        }), 500


@app.route('/api/step4-cache-stats', methods=['GET'])
def get_step4_cache_stats():
    """
    Get Step 4 knowledge cache statistics

    Returns:
    {
        "success": true,
        "statistics": {
            "total_pillars": 1234,
            "avg_quality": 0.78,
            "total_citations": 45678,
            "latest_addition": "2024-02-24T10:30:00",
            "avg_usage": 2.3
        }
    }
    """
    if not STEP4_OPTIMIZED_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Step 4 Optimized not available',
            'statistics': {}
        }), 503

    try:
        stats = get_cache_statistics_for_flask()

        logger.info(f"[Step4 Cache] Stats retrieved: {stats.get('total_pillars', 0)} pillars, "
                   f"avg quality {stats.get('avg_quality', 0):.2f}")

        return jsonify({
            'success': True,
            'statistics': stats,
            'timestamp': datetime.now().isoformat()
        })

    except Exception as e:
        logger.error(f"[Step4 Cache] Failed to get statistics: {e}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e),
            'statistics': {}
        }), 500


@app.route('/api/step4-health', methods=['GET'])
def step4_health_check():
    """
    Health check for Step 4 optimized pipeline

    Returns status of all components:
    - Database connection
    - pgvector extension
    - Embedding model
    - Research APIs
    - Cache statistics
    """
    health = {
        'step4_optimized_available': STEP4_OPTIMIZED_AVAILABLE,
        'components': {},
        'timestamp': datetime.now().isoformat()
    }

    if not STEP4_OPTIMIZED_AVAILABLE:
        health['status'] = 'unavailable'
        health['message'] = 'Step 4 Optimized modules not loaded'
        return jsonify(health), 503

    try:
        from step4_integration import get_step4_integration

        # Try to get integration instance
        try:
            integration = get_step4_integration()
            health['components']['integration'] = 'initialized' if integration.initialized else 'not_initialized'
        except Exception as e:
            health['components']['integration'] = f'error: {str(e)}'

        # Check database
        try:
            import psycopg2
            database_url = os.getenv('DATABASE_URL')
            conn = psycopg2.connect(database_url)
            cursor = conn.cursor()

            # Check pgvector
            cursor.execute("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector')")
            has_vector = cursor.fetchone()[0]
            health['components']['pgvector'] = 'installed' if has_vector else 'missing'

            # Check scientific_pillars table
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name = 'scientific_pillars'
                )
            """)
            has_table = cursor.fetchone()[0]
            health['components']['scientific_pillars_table'] = 'exists' if has_table else 'missing'

            if has_table:
                cursor.execute("SELECT COUNT(*) FROM scientific_pillars")
                count = cursor.fetchone()[0]
                health['components']['cached_pillars'] = count

            cursor.close()
            conn.close()
            health['components']['database'] = 'connected'

        except Exception as e:
            health['components']['database'] = f'error: {str(e)}'

        # Check cache stats
        try:
            stats = get_cache_statistics_for_flask()
            health['cache_statistics'] = stats
        except Exception as e:
            health['cache_statistics'] = f'error: {str(e)}'

        # Overall status
        all_ok = (
            health['components'].get('integration') == 'initialized' and
            health['components'].get('database') == 'connected' and
            health['components'].get('pgvector') == 'installed' and
            health['components'].get('scientific_pillars_table') == 'exists'
        )

        health['status'] = 'healthy' if all_ok else 'degraded'
        status_code = 200 if all_ok else 503

        return jsonify(health), status_code

    except Exception as e:
        logger.error(f"[Step4 Health] Check failed: {e}", exc_info=True)
        health['status'] = 'error'
        health['error'] = str(e)
        return jsonify(health), 500


# ═══════════════════════════════════════════════════════════════════════════════
# END STEP 4 OPTIMIZED
# ═══════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# FULL PIPELINE — Server-side orchestration of Steps 1→2→3→4→6→7→8→9
# ═══════════════════════════════════════════════════════════════════════════════

def _load_default_agents():
    """Parse agent configs from agents.ts, returning dict keyed by agent id."""
    agents_path = next(
        (p for p in ['src/config/agents.ts', '/app/src/config/agents.ts'] if os.path.exists(p)),
        None
    )
    if not agents_path:
        raise FileNotFoundError('agents.ts not found')

    with open(agents_path) as f:
        content = f.read()

    id_positions = [m.start() for m in re.finditer(r"id:\s*'agent-", content)]
    if not id_positions:
        raise ValueError("No agent blocks found in agents.ts")

    agents = {}
    for i, pos in enumerate(id_positions):
        end = id_positions[i + 1] if i + 1 < len(id_positions) else len(content)
        block = content[pos:end]

        id_m = re.search(r"id:\s*'([^']+)'", block)
        name_m = re.search(r"name:\s*'([^']+)'", block)
        if not (id_m and name_m):
            continue

        model_m = re.search(r"model:\s*'([^']+)'", block)
        temp_m = re.search(r"temperature:\s*([\d.]+)", block)
        prompt_m = re.search(r'systemPrompt:\s*`(.*?)`', block, re.DOTALL)
        # Parse nodeCount with any key order (min/max/default)
        nc_block_m = re.search(r'nodeCount:\s*\{([^}]+)\}', block)
        nc_vals = {}
        if nc_block_m:
            nc_text = nc_block_m.group(1)
            for key in ('min', 'max', 'default'):
                m = re.search(rf'{key}:\s*(\d+)', nc_text)
                if m:
                    nc_vals[key] = int(m.group(1))

        agent = {
            'id': id_m.group(1),
            'name': name_m.group(1),
            'model': model_m.group(1) if model_m else 'gpt-4.1',
            'temperature': float(temp_m.group(1)) if temp_m else 0.4,
            'systemPrompt': prompt_m.group(1) if prompt_m else '',
            'settings': {},
        }
        if nc_vals:
            agent['settings']['nodeCount'] = {
                'default': nc_vals.get('default', nc_vals.get('min', 5)),
                'min': nc_vals.get('min', 3),
                'max': nc_vals.get('max', 7),
            }
        agents[agent['id']] = agent

    return agents


def _minimal_goal(goal):
    """Create a minimal goal object for API payloads (reduces token usage)."""
    return {
        'id': goal.get('id'),
        'title': goal.get('title'),
        'catastrophe_primary': goal.get('catastrophe_primary'),
        'bridge_tags': goal.get('bridge_tags'),
    }


def _minimal_ras(ras):
    """Create minimal RA objects for API payloads."""
    return [
        {
            'ra_id': ra.get('ra_id'),
            'atom_title': ra.get('atom_title'),
            'requirement_statement': ra.get('requirement_statement'),
        }
        for ra in ras
    ]


def _filter_spvs_for_goal(goal, all_spvs):
    """Return ALL SPVs with the goal's primary ones marked as priority.

    Previous behavior filtered to only 3 SPVs, causing 70% of the bridge
    lexicon to be invisible to Step 4b. Now passes all SPVs so S-nodes
    can reference any relevant variable, with priority markers to guide focus.
    """
    priority_ids = set(
        sp.get('spv_id')
        for sp in (goal.get('bridge_tags', {}).get('system_properties_required') or [])
    )
    enriched = []
    for spv in all_spvs:
        spv_id = spv.get('id') or spv.get('ID', '')
        entry = dict(spv)
        entry['priority_for_goal'] = 'HIGH' if spv_id in priority_ids else 'SECONDARY'
        enriched.append(entry)
    return {
        'system_properties': enriched
    }


def _enrich_goal_with_spvs(goal, all_spvs):
    """Enrich a goal pillar with full SPV definitions from the bridge lexicon."""
    enriched = dict(goal)
    if enriched.get('bridge_tags', {}).get('system_properties_required'):
        enriched['bridge_tags'] = dict(enriched['bridge_tags'])
        enriched['bridge_tags']['system_properties_required'] = [
            {
                **sp,
                'name': next((s.get('name') for s in all_spvs if (s.get('id') or s.get('ID')) == sp.get('spv_id')), None),
                'definition': next((s.get('definition') for s in all_spvs if (s.get('id') or s.get('ID')) == sp.get('spv_id')), None),
            }
            for sp in enriched['bridge_tags']['system_properties_required']
        ]
    return enriched


def _slim_ras_for_context(ras, limit):
    """Slim Requirement Atoms to essential fields for downstream context.

    Keeps: ra_id, atom_title, state_variable, perturbation_classes, timescale,
           requirement_statement, meter_classes.
    Drops: done_criteria, meter_status, multiple_realizability_check, failure_shape
           (verbose, less useful for hypothesis/experiment generation).
    """
    return [
        {
            'ra_id': ra.get('ra_id', ra.get('id', '')),
            'atom_title': ra.get('atom_title', ''),
            'state_variable': ra.get('state_variable', ''),
            'perturbation_classes': ra.get('perturbation_classes', []),
            'timescale': ra.get('timescale', ''),
            'requirement_statement': ra.get('requirement_statement', ''),
            'meter_classes': ra.get('meter_classes', []),
        }
        for ra in ras[:limit]
    ]


def _slim_goal_for_context(goal):
    """Slim a goal pillar to essential fields for downstream context.

    Keeps: id, title, catastrophe_primary, state_definition, bridge_tags (IDs only).
    Drops: failure_mode_simulation, done_criteria, evidence_of_state, triz_contradiction
           (verbose and duplicated by bridge_lexicon / RAs).
    """
    if not goal:
        return {}
    slim = {
        'id': goal.get('id', ''),
        'title': goal.get('title', ''),
        'is_cross_cutting': goal.get('is_cross_cutting', False),
        'catastrophe_primary': goal.get('catastrophe_primary', ''),
        'state_definition': goal.get('state_definition', ''),
        'bridge_tags': goal.get('bridge_tags', {}),
    }
    # Strip enriched SPV definitions from bridge_tags (already in bridge_lexicon)
    if slim['bridge_tags'].get('system_properties_required'):
        slim['bridge_tags'] = dict(slim['bridge_tags'])
        slim['bridge_tags']['system_properties_required'] = [
            {'spv_id': sp.get('spv_id'), 'importance': sp.get('importance', '')}
            for sp in slim['bridge_tags']['system_properties_required']
        ]
    return slim


@app.route('/api/run-full-pipeline', methods=['POST'])
@optional_session(db)
def run_full_pipeline(session_id):
    """
    Start a full pipeline run (Steps 1→2→3→4→6→7→8→9) in the background.

    Request body:
    {
        "goal": "skin rejuvenation",
        "globalLens": "optional epistemic lens text",
        "agents": { "agent-initiator": { ... }, ... }   // optional overrides
    }

    Response:
    { "started": true, "run_id": "...", "message": "..." }

    Poll /api/full-pipeline-result?run_id=<run_id> for the final result.
    """
    try:
        if not session_id:
            try:
                session_id = db.create_session()
            except Exception:
                return jsonify({'error': 'Unable to create session. Database may be unavailable.'}), 503

        data = request.json or {}
        goal = data.get('goal', '')
        if not goal:
            return jsonify({'error': 'goal is required'}), 400

        global_lens = data.get('globalLens', '')
        agent_overrides = data.get('agents', {})
        test_mode = data.get('test_mode', False)

        import uuid as _uuid
        run_id = f"pipeline-{_uuid.uuid4().hex[:12]}"

        # Store session ownership so result endpoint can validate
        if redis_client.client:
            redis_client.client.setex(f"full_pipeline_owner:{run_id}", 86400, session_id)

        thread = threading.Thread(
            target=_run_full_pipeline_background,
            args=(run_id, session_id, goal, global_lens, agent_overrides, test_mode),
            daemon=True,
        )
        thread.start()

        return jsonify({
            'started': True,
            'run_id': run_id,
            'message': f'Full pipeline started. Poll /api/full-pipeline-result?run_id={run_id}',
        })

    except Exception as e:
        logger.error(f"[FullPipeline] start error: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/full-pipeline-result', methods=['GET'])
@optional_session(db)
def get_full_pipeline_result(session_id):
    """
    Poll for full pipeline result.
    Query params: run_id (required)
    Returns the result if ready, or { pending: true, step: N } if still running.
    """
    run_id = request.args.get('run_id')
    if not run_id:
        return jsonify({'error': 'run_id is required'}), 400

    # Verify the requesting session owns this pipeline run
    if redis_client.client and session_id:
        owner = redis_client.client.get(f"full_pipeline_owner:{run_id}")
        if owner and owner.decode('utf-8') != session_id:
            return jsonify({'error': 'Not authorized to access this pipeline run'}), 403

    result_key = f"full_pipeline:{run_id}"
    progress_key = f"full_pipeline_progress:{run_id}"
    outputs_key = f"full_pipeline_outputs:{run_id}"

    try:
        if redis_client.client:
            # Check if result is ready
            data = redis_client.client.get(result_key)
            if data:
                redis_client.client.delete(result_key)
                redis_client.client.delete(progress_key)
                redis_client.client.delete(outputs_key)
                return Response(data, mimetype='application/json')

            # Check progress
            progress = redis_client.client.get(progress_key)
            if progress:
                progress_dict = json.loads(progress)
                # Merge in completed step outputs for incremental rendering
                outputs_data = redis_client.client.get(outputs_key)
                if outputs_data:
                    step_outputs = json.loads(outputs_data)
                    progress_dict['step_outputs'] = step_outputs
                    progress_dict['completed_steps'] = list(step_outputs.keys())
                return Response(json.dumps(progress_dict), mimetype='application/json', status=202)
    except Exception as e:
        logger.warning(f"[FullPipeline] Error fetching result: {e}")

    return jsonify({'pending': True}), 202


def _run_full_pipeline_background(run_id, session_id, goal, global_lens, agent_overrides, test_mode=False):
    """
    Background worker: orchestrates Steps 1→2→3→4→6→7→8→9.
    Stores intermediate progress and final result in Redis.

    test_mode: If True, let LLM produce full-quality output but only decompose
    1 goal and 1 L3 through the pipeline to save tokens.
    """
    result_key = f"full_pipeline:{run_id}"
    progress_key = f"full_pipeline_progress:{run_id}"
    pipeline_start = time.time()

    # Collected outputs — mirrors frontend steps[] array (0-indexed by step-1)
    step_outputs = {}  # step_number -> output
    step_timings = {}

    def _set_progress(step_num, step_name, status='running', detail=''):
        """Update progress in Redis."""
        try:
            if redis_client.client:
                redis_client.client.setex(progress_key, 3600, json.dumps({
                    'pending': True,
                    'step': step_num,
                    'step_name': step_name,
                    'status': status,
                    'detail': detail,
                    'elapsed': round(time.time() - pipeline_start, 1),
                }))
        except Exception:
            pass

    def _store_result(result_data):
        """Store final result in Redis."""
        try:
            if redis_client.client:
                redis_client.client.setex(result_key, 7200, json.dumps(result_data))
        except Exception as e:
            logger.error(f"[FullPipeline] Failed to store result: {e}")

    outputs_key = f"full_pipeline_outputs:{run_id}"

    def _store_incremental_outputs():
        """Persist completed step outputs to Redis so the poll endpoint can serve them."""
        try:
            if redis_client.client:
                incremental = {f'step{k}': v for k, v in step_outputs.items()}
                redis_client.client.setex(outputs_key, 3600, json.dumps(incremental))
        except Exception:
            pass

    try:
        # ── Load agent configs ──
        agents = _load_default_agents()
        # Apply overrides
        for agent_id, overrides in agent_overrides.items():
            if agent_id in agents:
                agents[agent_id].update(overrides)

        logger.info(f"\n{'#'*70}")
        logger.info(f"### FULL PIPELINE START: run_id={run_id}")
        logger.info(f"### Goal: {goal[:100]}")
        logger.info(f"### Lens: {global_lens[:80] if global_lens else 'None'}")
        logger.info(f"{'#'*70}\n")

        # ════════════════════════════════════════════════════════════════
        # STEP 1: Goal Formalization → Q0
        # ════════════════════════════════════════════════════════════════
        _set_progress(1, 'Goal Formalization')
        step_start = time.time()
        logger.info("[FullPipeline] Step 1: Goal Formalization")

        agent = agents['agent-initiator']
        agent_with_lens = dict(agent)
        step1_result = execute_single_item(1, agent_with_lens, goal, global_lens)

        q0_text = step1_result.get('Q0', '')
        if not q0_text:
            raise ValueError("Step 1 produced no Q0")
        step_outputs[1] = step1_result
        step_timings[1] = round(time.time() - step_start, 1)
        logger.info(f"  ✅ Q0: {q0_text[:120]}...")
        logger.info(f"  ⏱️  {step_timings[1]}s")
        _store_incremental_outputs()

        # ════════════════════════════════════════════════════════════════
        # STEP 2: Goal Pillars + Bridge Lexicon
        # ════════════════════════════════════════════════════════════════
        _set_progress(2, 'Goal Pillars Synthesis')
        step_start = time.time()
        logger.info("[FullPipeline] Step 2: Goal Pillars Synthesis")

        agent = agents['agent-immortalist']
        step2_input = {'step1': step1_result, 'goal': goal}
        step2_result = execute_single_item(2, agent, step2_input, global_lens)

        goals_list = step2_result.get('goals', [])
        bridge_lexicon = step2_result.get('bridge_lexicon', {})
        all_spvs = bridge_lexicon.get('system_properties', [])
        if not goals_list:
            raise ValueError("Step 2 produced no goals")
        step_outputs[2] = step2_result
        step_timings[2] = round(time.time() - step_start, 1)
        logger.info(f"  ✅ {len(goals_list)} goals, {len(all_spvs)} SPVs, {len(bridge_lexicon.get('failure_channels', []))} FCCs")
        logger.info(f"  ⏱️  {step_timings[2]}s")
        _store_incremental_outputs()

        # test_mode: keep full Step 2 output but only decompose 1 goal downstream
        if test_mode and len(goals_list) > 1:
            logger.info(f"  🧪 TEST MODE: truncating from {len(goals_list)} goals to 1 for downstream processing")
            goals_list = goals_list[:1]

        # ════════════════════════════════════════════════════════════════
        # STEP 3: Requirement Atomization (batch, per goal)
        # ════════════════════════════════════════════════════════════════
        _set_progress(3, 'Requirement Atomization', detail=f'{len(goals_list)} goals')
        step_start = time.time()
        logger.info(f"[FullPipeline] Step 3: Requirement Atomization ({len(goals_list)} goals)")

        agent = agents['agent-requirement-engineer']
        ras_by_goal = {}
        max_workers = min(len(goals_list), MAX_BATCH_WORKERS)

        # Pre-extract Q0 text once (avoid sending full step1_result per goal)
        q0_for_step3 = step1_result.get('Q0') or step1_result.get('q0') or step1_result.get('text') or goal

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {}
            for g in goals_list:
                item = {
                    'goal_pillar': g,
                    'step1': {'Q0': q0_for_step3},
                    'step2': {'bridge_lexicon': _filter_spvs_for_goal(g, all_spvs)},
                    'goal': goal,
                }
                futures[executor.submit(execute_single_item, 3, agent, item, global_lens)] = g['id']

            try:
              for future in as_completed(futures, timeout=480):
                goal_id = futures[future]
                try:
                    result = future.result(timeout=480)
                    # Recover from raw_response if JSON parse failed
                    if result.get('raw_response') and not result.get('requirement_atoms'):
                        result = _try_recover_result(result)
                    ras = result.get('requirement_atoms', result.get('RAs', []))
                    ras_by_goal[goal_id] = ras if isinstance(ras, list) else [ras]
                    logger.info(f"  ✅ {goal_id}: {len(ras_by_goal[goal_id])} RAs")
                except TimeoutError:
                    logger.warning(f"  ⏰ {goal_id}: TIMEOUT — skipping")
                    ras_by_goal[goal_id] = []
                except Exception as e:
                    logger.error(f"  ❌ {goal_id}: {e}")
                    ras_by_goal[goal_id] = []
            except TimeoutError:
              timed_out = [gid for f, gid in futures.items() if not f.done()]
              logger.warning(f"  ⏰ Step 3 overall TIMEOUT (480s) — {len(timed_out)} goals skipped")
              for f in futures:
                  if not f.done(): f.cancel()

        step_outputs[3] = ras_by_goal
        step_timings[3] = round(time.time() - step_start, 1)
        total_ras = sum(len(v) for v in ras_by_goal.values())
        logger.info(f"  ⏱️  {step_timings[3]}s — {total_ras} total RAs")

        # Circuit-breaker: retry Step 3 if 0 RAs produced
        if total_ras == 0:
            logger.warning("Circuit-breaker: Step 3 produced 0 RAs — retrying all goals")
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = {}
                for g in goals_list:
                    item = {
                        'goal_pillar': g,
                        'step1': {'Q0': q0_for_step3},
                        'step2': {'bridge_lexicon': _filter_spvs_for_goal(g, all_spvs)},
                        'goal': goal,
                    }
                    futures[executor.submit(execute_single_item, 3, agent, item, global_lens)] = g['id']
                for future in as_completed(futures, timeout=480):
                    goal_id = futures[future]
                    try:
                        result = future.result(timeout=480)
                        if result.get('raw_response') and not result.get('requirement_atoms'):
                            result = _try_recover_result(result)
                        ras = result.get('requirement_atoms', result.get('RAs', []))
                        ras_by_goal[goal_id] = ras if isinstance(ras, list) else [ras]
                        logger.info(f"  ✅ RETRY {goal_id}: {len(ras_by_goal[goal_id])} RAs")
                    except Exception as e:
                        logger.error(f"  ❌ RETRY {goal_id}: {e}")
                        ras_by_goal[goal_id] = []
            step_outputs[3] = ras_by_goal
            total_ras = sum(len(v) for v in ras_by_goal.values())
            if total_ras == 0:
                logger.error("Circuit-breaker: Step 3 retry also produced 0 RAs — continuing with degraded pipeline")
            else:
                logger.info(f"  Circuit-breaker: Step 3 retry recovered {total_ras} RAs")
        _store_incremental_outputs()

        # ════════════════════════════════════════════════════════════════
        # STEP 4: Reality Mapping (pipelined: 4a → dedup → 4b)
        # ════════════════════════════════════════════════════════════════
        _set_progress(4, 'Reality Mapping (Domain Scan)', detail=f'{len(goals_list)} goals')
        step_start = time.time()
        logger.info(f"[FullPipeline] Step 4: Reality Mapping ({len(goals_list)} goals)")

        domain_mapper_agent = agents['agent-domain-mapper']
        domain_specialist_agent = agents['agent-biologist']

        # Build goal items the same way the frontend does
        filtered_bridge = {'system_properties': all_spvs}
        goal_items = []
        for g in goals_list:
            ras = ras_by_goal.get(g['id'], [])
            goal_items.append({
                'Q0_reference': q0_text,
                'target_goal': _minimal_goal(g),
                'requirement_atoms': _minimal_ras(ras),
                'bridge_lexicon': _filter_spvs_for_goal(g, filtered_bridge['system_properties']),
                'goal': goal,
            })

        # Use the existing pipelined Step 4 function (runs 4a→dedup→4b internally)
        # We run it synchronously here since we're already in a background thread
        _run_step4_pipeline_sync(
            session_id, goal_items, domain_mapper_agent,
            domain_specialist_agent, global_lens, step_outputs, goals_list
        )

        step_timings[4] = round(time.time() - step_start, 1)
        step4_data = step_outputs.get(4, {})
        total_pillars = sum(
            len(v.get('scientific_pillars', []))
            for v in step4_data.values() if isinstance(v, dict)
        )
        logger.info(f"  ⏱️  {step_timings[4]}s — {total_pillars} total S-nodes")
        _store_incremental_outputs()

        # Pre-compress pillars per goal for reuse across Steps 6→7→8→9
        # Each downstream step needs different counts/fields, but we build the
        # superset (20 pillars, all fields) and let each step slice from it.
        pillars_cache = {}
        for gid, gdata in step4_data.items():
            if isinstance(gdata, dict):
                raw_pillars = gdata.get('scientific_pillars', [])
                pillars_cache[gid] = [
                    {
                        'id': s.get('id'), 'title': s.get('title'),
                        'mechanism': s.get('mechanism', ''),
                        'readiness_level': s.get('readiness_level', ''),
                        'relationship_to_goal': s.get('relationship_to_goal', ''),
                        'relationship_confidence': s.get('relationship_confidence', 0.0),
                        'gap_analysis': s.get('gap_analysis', ''),
                        'fragility_score': s.get('fragility_score', ''),
                    }
                    for s in raw_pillars[:20]
                ]

        # ════════════════════════════════════════════════════════════════
        # STEP 6: L3 Frontier Question Generation (batch, per goal)
        # ════════════════════════════════════════════════════════════════
        # Filter to goals that have S-nodes
        goals_with_snodes = [
            g for g in goals_list
            if step4_data.get(g['id'], {}).get('scientific_pillars')
        ]
        _set_progress(6, 'L3 Question Generation', detail=f'{len(goals_with_snodes)} goals')
        step_start = time.time()
        logger.info(f"[FullPipeline] Step 6: L3 Question Generation ({len(goals_with_snodes)} goals)")

        agent = agents['agent-l3-explorer']
        all_l3_questions = []
        goal_analyses = {}

        if goals_with_snodes:
            with ThreadPoolExecutor(max_workers=min(len(goals_with_snodes), MAX_BATCH_WORKERS)) as executor:
                futures = {}
                for g in goals_with_snodes:
                    slim_goal_6 = _slim_goal_for_context(g)
                    # Use cached pillars — build relationship_summary with prompt-aligned fields
                    cached = pillars_cache.get(g['id'], [])
                    relationship_summary = [
                        {'pillar_id': s.get('id', 'N/A'), 'title': s.get('title', 'N/A'),
                         'mechanism': s.get('mechanism', '')[:150],
                         'readiness_level': s.get('readiness_level', ''),
                         'relationship': s.get('relationship_to_goal', 'unknown'),
                         'confidence': s.get('relationship_confidence', 0.0),
                         'gap': s.get('gap_analysis', '')}
                        for s in cached[:20]
                    ]
                    item = {
                        'Q0_reference': q0_text,
                        'goal_pillar': slim_goal_6,
                        'bridge_lexicon': _filter_spvs_for_goal(g, all_spvs),
                        'relationship_summary': relationship_summary,
                        'step3': ras_by_goal.get(g['id'], [])[:8],
                    }
                    futures[executor.submit(execute_single_item, 6, agent, item, global_lens)] = g['id']

                try:
                  for future in as_completed(futures, timeout=480):
                    goal_id = futures[future]
                    try:
                        result = future.result(timeout=480)
                        # Recover from raw_response if JSON parse failed
                        if result.get('raw_response') and not result.get('l3_questions') and not result.get('seed_questions'):
                            result = _try_recover_result(result)
                        l3s = result.get('l3_questions', result.get('seed_questions', []))
                        # Build set of valid S-node IDs for this goal from step4 data
                        goal_step4 = step4_data.get(goal_id, {})
                        all_goal_snodes = goal_step4.get('scientific_pillars', [])
                        if not all_goal_snodes:
                            raw_scans = goal_step4.get('raw_domain_scans', {}).get('domains', {})
                            for dom_data in raw_scans.values():
                                all_goal_snodes.extend(dom_data.get('scientific_pillars', []))
                        valid_snode_ids = {s.get('id') for s in all_goal_snodes if s.get('id')}
                        valid_ra_ids = {ra.get('ra_id') for ra in ras_by_goal.get(goal_id, []) if ra.get('ra_id')}
                        for l3 in l3s:
                            if not l3.get('target_goal_id'):
                                l3['target_goal_id'] = result.get('target_goal_id', goal_id)
                            # Ensure s_node_ids is populated — extract from rationale if LLM didn't provide
                            if not l3.get('s_node_ids'):
                                rationale = l3.get('rationale', '') + ' ' + l3.get('text', '')
                                l3['s_node_ids'] = [sid for sid in valid_snode_ids if sid and sid in rationale]
                            # Ensure ra_ids is populated — extract from rationale if LLM didn't provide
                            if not l3.get('ra_ids'):
                                rationale = l3.get('rationale', '') + ' ' + l3.get('text', '')
                                l3['ra_ids'] = [rid for rid in valid_ra_ids if rid and rid in rationale]
                        all_l3_questions.extend(l3s)
                        if result.get('target_goal_id'):
                            goal_analyses[result['target_goal_id']] = {
                                'target_goal_title': result.get('target_goal_title'),
                                'cluster_status': result.get('cluster_status'),
                                'strategic_assessment': result.get('strategic_assessment'),
                                'bridge_alignment': result.get('bridge_alignment'),
                            }
                        logger.info(f"  ✅ {goal_id}: {len(l3s)} L3 questions")
                    except TimeoutError:
                        logger.warning(f"  ⏰ {goal_id}: TIMEOUT — skipping")
                    except Exception as e:
                        logger.error(f"  ❌ {goal_id}: {e}")
                except TimeoutError:
                  timed_out = [gid for f, gid in futures.items() if not f.done()]
                  logger.warning(f"  ⏰ Step 6 overall TIMEOUT (480s) — {len(timed_out)} goals skipped")
                  for f in futures:
                      if not f.done(): f.cancel()

        step_outputs[6] = {
            'l3_questions': all_l3_questions,
            'goal_analyses': goal_analyses,
        }
        step_timings[6] = round(time.time() - step_start, 1)
        logger.info(f"  ⏱️  {step_timings[6]}s — {len(all_l3_questions)} total L3 questions")

        _store_incremental_outputs()

        # Circuit-breaker: Step 6 must produce L3 questions or pipeline cannot continue
        if not all_l3_questions:
            raise ValueError("Circuit-breaker: Step 6 produced 0 L3 questions — pipeline cannot continue")

        # test_mode: keep full Step 6 output but only decompose 1 L3 downstream
        if test_mode and len(all_l3_questions) > 1:
            logger.info(f"  🧪 TEST MODE: truncating from {len(all_l3_questions)} L3s to 1 for downstream processing")
            all_l3_questions = all_l3_questions[:1]

        # ════════════════════════════════════════════════════════════════
        # STEP 7: Divergent Hypothesis Instantiation (batch, per L3)
        # ════════════════════════════════════════════════════════════════
        _set_progress(7, 'Hypothesis Instantiation', detail=f'{len(all_l3_questions)} L3s')
        step_start = time.time()
        logger.info(f"[FullPipeline] Step 7: Hypothesis Instantiation ({len(all_l3_questions)} L3s)")

        agent = agents['agent-instantiator']
        all_ihs = []
        # O(1) goal lookup (reused through Steps 7→8→9)
        goals_by_id = {g['id']: g for g in goals_list}

        if all_l3_questions:
            with ThreadPoolExecutor(max_workers=min(len(all_l3_questions), MAX_BATCH_WORKERS)) as executor:
                futures = {}
                for l3q in all_l3_questions:
                    parent_goal_id = l3q.get('parent_goal_id') or l3q.get('target_goal_id', '')
                    parent_goal = goals_by_id.get(parent_goal_id)
                    slim_parent = _slim_goal_for_context(parent_goal)
                    # Use cached pillars: top-10, fields aligned with prompt's re-projection
                    cached_pillars = pillars_cache.get(parent_goal_id, [])
                    compressed_s_nodes_7 = [
                        {'id': s.get('id'), 'title': s.get('title'),
                         'mechanism': s.get('mechanism', '')[:150],
                         'relationship_to_goal': s.get('relationship_to_goal', '')[:100]}
                        for s in cached_pillars[:10]
                    ]
                    item = {
                        'Q0_reference': q0_text,
                        'l3_question': l3q,
                        'parent_goal': slim_parent,
                        'step3': ras_by_goal.get(parent_goal_id, [])[:5],
                        'bridge_lexicon': _filter_spvs_for_goal(parent_goal, all_spvs) if parent_goal else {},
                        'step5': {parent_goal_id: {'scientific_pillars': compressed_s_nodes_7}} if parent_goal_id else {},
                    }
                    futures[executor.submit(execute_single_item, 7, agent, item, global_lens)] = l3q.get('id', '')

                try:
                  for future in as_completed(futures, timeout=480):
                    l3_id = futures[future]
                    try:
                        result = future.result(timeout=480)
                        # Recover from raw_response if JSON parse failed
                        if result.get('raw_response') and not result.get('instantiation_hypotheses') and not result.get('IHs'):
                            result = _try_recover_result(result)
                        ihs = result.get('instantiation_hypotheses', result.get('IHs', []))
                        if not isinstance(ihs, list):
                            ihs = [ihs]
                        # Tag each IH with its parent L3
                        for ih in ihs:
                            if not ih.get('parent_l3_id'):
                                ih['parent_l3_id'] = l3_id
                        all_ihs.extend(ihs)
                        logger.info(f"  ✅ {l3_id}: {len(ihs)} IHs")
                    except TimeoutError:
                        logger.warning(f"  ⏰ {l3_id}: TIMEOUT — skipping")
                    except Exception as e:
                        logger.error(f"  ❌ {l3_id}: {e}")
                except TimeoutError:
                  timed_out = [lid for f, lid in futures.items() if not f.done()]
                  logger.warning(f"  ⏰ Step 7 overall TIMEOUT (480s) — {len(timed_out)} L3s skipped")
                  for f in futures:
                      if not f.done(): f.cancel()

        # ── Build competition matrix (post-processing, zero LLM cost) ──
        # Pair IHs within each L3 and extract distinguishing observables
        # from their existing discriminating_prediction fields.
        from itertools import combinations as _ih_combos
        _ihs_by_l3_cm = {}
        for ih in all_ihs:
            _l3_key = ih.get('parent_l3_id', '')
            if _l3_key:
                _ihs_by_l3_cm.setdefault(_l3_key, []).append(ih)
        competition_matrix = []
        for _l3_key, _l3_group in _ihs_by_l3_cm.items():
            if len(_l3_group) < 2:
                continue
            for ih_a, ih_b in _ih_combos(_l3_group, 2):
                id_a = ih_a.get('ih_id', '?')
                id_b = ih_b.get('ih_id', '?')
                # Use discriminating_prediction (most specific) or fall back to domain_category contrast
                pred_a = (ih_a.get('discriminating_prediction') or ih_a.get('process_hypothesis', ''))[:200]
                pred_b = (ih_b.get('discriminating_prediction') or ih_b.get('process_hypothesis', ''))[:200]
                cat_a = ih_a.get('domain_category', 'unknown').replace('_', ' ')
                cat_b = ih_b.get('domain_category', 'unknown').replace('_', ' ')
                if cat_a != cat_b:
                    observable = f"{id_a} ({cat_a}) predicts: {pred_a}; {id_b} ({cat_b}) predicts: {pred_b}"
                else:
                    observable = f"{id_a} predicts: {pred_a}; {id_b} predicts: {pred_b}"
                competition_matrix.append({
                    'ih_pair': [id_a, id_b],
                    'parent_l3_id': _l3_key,
                    'distinguishing_observable': observable[:500],
                })
        logger.info(f"  🏁 Built competition matrix: {len(competition_matrix)} pairs from {len(_ihs_by_l3_cm)} L3s")

        step_outputs[7] = {'instantiation_hypotheses': all_ihs, 'competition_matrix': competition_matrix}
        step_timings[7] = round(time.time() - step_start, 1)
        logger.info(f"  ⏱️  {step_timings[7]}s — {len(all_ihs)} total IHs")

        # Circuit-breaker: retry Step 7 once if 0 IHs produced
        if not all_ihs:
            logger.warning("Circuit-breaker: Step 7 produced 0 IHs — retrying all L3s")
            agent = agents['agent-instantiator']
            with ThreadPoolExecutor(max_workers=min(len(all_l3_questions), MAX_BATCH_WORKERS)) as executor:
                futures = {}
                for l3q in all_l3_questions:
                    parent_goal_id = l3q.get('parent_goal_id') or l3q.get('target_goal_id', '')
                    parent_goal = goals_by_id.get(parent_goal_id)
                    slim_parent = _slim_goal_for_context(parent_goal)
                    # Use cached pillars: top-10, fields aligned with prompt's re-projection
                    cached_pillars = pillars_cache.get(parent_goal_id, [])
                    compressed_s_nodes_7r = [
                        {'id': s.get('id'), 'title': s.get('title'),
                         'mechanism': s.get('mechanism', '')[:150],
                         'relationship_to_goal': s.get('relationship_to_goal', '')[:100]}
                        for s in cached_pillars[:10]
                    ]
                    item = {
                        'Q0_reference': q0_text,
                        'l3_question': l3q,
                        'parent_goal': slim_parent,
                        'step3': ras_by_goal.get(parent_goal_id, [])[:5],
                        'bridge_lexicon': _filter_spvs_for_goal(parent_goal, all_spvs) if parent_goal else {},
                        'step5': {parent_goal_id: {'scientific_pillars': compressed_s_nodes_7r}} if parent_goal_id else {},
                    }
                    futures[executor.submit(execute_single_item, 7, agent, item, global_lens)] = l3q.get('id', '')
                for future in as_completed(futures, timeout=480):
                    l3_id = futures[future]
                    try:
                        result = future.result(timeout=480)
                        if result.get('raw_response') and not result.get('instantiation_hypotheses') and not result.get('IHs'):
                            result = _try_recover_result(result)
                        ihs = result.get('instantiation_hypotheses', result.get('IHs', []))
                        if not isinstance(ihs, list):
                            ihs = [ihs]
                        for ih in ihs:
                            if not ih.get('parent_l3_id'):
                                ih['parent_l3_id'] = l3_id
                        all_ihs.extend(ihs)
                        logger.info(f"  ✅ RETRY {l3_id}: {len(ihs)} IHs")
                    except Exception as e:
                        logger.error(f"  ❌ RETRY {l3_id}: {e}")
            # Rebuild competition matrix after retry
            _ihs_by_l3_cm = {}
            for ih in all_ihs:
                _l3_key = ih.get('parent_l3_id', '')
                if _l3_key:
                    _ihs_by_l3_cm.setdefault(_l3_key, []).append(ih)
            competition_matrix = []
            for _l3_key, _l3_group in _ihs_by_l3_cm.items():
                if len(_l3_group) < 2:
                    continue
                for ih_a, ih_b in _ih_combos(_l3_group, 2):
                    id_a = ih_a.get('ih_id', '?')
                    id_b = ih_b.get('ih_id', '?')
                    pred_a = (ih_a.get('discriminating_prediction') or ih_a.get('process_hypothesis', ''))[:200]
                    pred_b = (ih_b.get('discriminating_prediction') or ih_b.get('process_hypothesis', ''))[:200]
                    cat_a = ih_a.get('domain_category', 'unknown').replace('_', ' ')
                    cat_b = ih_b.get('domain_category', 'unknown').replace('_', ' ')
                    if cat_a != cat_b:
                        observable = f"{id_a} ({cat_a}) predicts: {pred_a}; {id_b} ({cat_b}) predicts: {pred_b}"
                    else:
                        observable = f"{id_a} predicts: {pred_a}; {id_b} predicts: {pred_b}"
                    competition_matrix.append({
                        'ih_pair': [id_a, id_b],
                        'parent_l3_id': _l3_key,
                        'distinguishing_observable': observable[:500],
                    })
            logger.info(f"  🏁 Rebuilt competition matrix: {len(competition_matrix)} pairs")
            step_outputs[7] = {'instantiation_hypotheses': all_ihs, 'competition_matrix': competition_matrix}
            if not all_ihs:
                logger.warning("Circuit-breaker: Step 7 retry also produced 0 IHs — continuing (Step 8 can generate L4s from L3s alone)")
            else:
                logger.info(f"  Circuit-breaker: Step 7 retry recovered {len(all_ihs)} IHs")
        _store_incremental_outputs()

        # ════════════════════════════════════════════════════════════════
        # STEP 8: Tactical Decomposition (batch, per L3)
        # ════════════════════════════════════════════════════════════════
        _set_progress(8, 'Tactical Decomposition', detail=f'{len(all_l3_questions)} L3s')
        step_start = time.time()
        logger.info(f"[FullPipeline] Step 8: Tactical Decomposition ({len(all_l3_questions)} L3s)")

        agent = agents['agent-explorer']
        all_l4_questions = []

        # Build O(1) index for IH lookup (avoids O(N) scans per L3/L4)
        ihs_by_l3 = {}
        for ih in all_ihs:
            for key in [ih.get('parent_l3_id'), ih.get('l3_question_id')]:
                if key:
                    ihs_by_l3.setdefault(key, []).append(ih)

        if all_l3_questions:
            with ThreadPoolExecutor(max_workers=min(len(all_l3_questions), MAX_BATCH_WORKERS)) as executor:
                futures = {}
                for l3q in all_l3_questions:
                    parent_goal_id = l3q.get('parent_goal_id') or l3q.get('target_goal_id', '')
                    parent_goal = goals_by_id.get(parent_goal_id)
                    slim_parent = _slim_goal_for_context(parent_goal)
                    l3_id = l3q.get('id', '')
                    # Filter IHs to this L3, compress to 4 key fields (O(1) lookup)
                    l3_ihs = [
                        {
                            'ih_id': ih.get('ih_id'),
                            'process_hypothesis': ih.get('process_hypothesis'),
                            'discriminating_prediction': ih.get('discriminating_prediction'),
                            'target_spv': ih.get('target_spv'),
                        }
                        for ih in ihs_by_l3.get(l3_id, [])
                    ]
                    cached_pillars_8 = pillars_cache.get(parent_goal_id, [])
                    # Filter competition matrix entries relevant to this L3
                    l3_competition = [cm for cm in competition_matrix if cm.get('parent_l3_id') == l3_id]
                    item = {
                        'Q0_reference': q0_text,
                        'l3_question': l3q,
                        'parent_goal': slim_parent,
                        'step3': _slim_ras_for_context(ras_by_goal.get(parent_goal_id, []), 4),
                        'step7': {'instantiation_hypotheses': l3_ihs, 'competition_matrix': l3_competition},
                        'scientific_pillars': [
                            {'id': s.get('id'), 'title': s.get('title'), 'mechanism': s.get('mechanism', '')[:150],
                             'readiness_level': s.get('readiness_level', '')}
                            for s in cached_pillars_8[:8]
                        ],
                        'bridge_lexicon': _filter_spvs_for_goal(parent_goal, all_spvs) if parent_goal else {},
                    }
                    futures[executor.submit(execute_single_item, 8, agent, item, global_lens)] = (l3_id, parent_goal_id)

                try:
                  for future in as_completed(futures, timeout=480):
                    l3_id, parent_goal_id = futures[future]
                    try:
                        result = future.result(timeout=480)
                        # Recover from raw_response if JSON parse failed
                        if result.get('raw_response') and not result.get('l4_questions') and not result.get('child_nodes_L4'):
                            result = _try_recover_result(result)
                        l4s = result.get('l4_questions', result.get('child_nodes_L4', []))
                        for l4 in l4s:
                            l4['parent_l3_id'] = l3_id
                            l4['parent_goal_id'] = parent_goal_id
                        all_l4_questions.extend(l4s)
                        logger.info(f"  ✅ {l3_id}: {len(l4s)} L4 questions")
                    except TimeoutError:
                        logger.warning(f"  ⏰ {l3_id}: TIMEOUT — skipping")
                    except Exception as e:
                        logger.error(f"  ❌ {l3_id}: {e}")
                except TimeoutError:
                  timed_out = [lid for f, lid in futures.items() if not f.done()]
                  logger.warning(f"  ⏰ Step 8 overall TIMEOUT (480s) — {len(timed_out)} L3s skipped")
                  for f in futures:
                      if not f.done(): f.cancel()

        step_outputs[8] = {'l4_questions': all_l4_questions}
        step_timings[8] = round(time.time() - step_start, 1)
        logger.info(f"  ⏱️  {step_timings[8]}s — {len(all_l4_questions)} total L4 questions")

        _store_incremental_outputs()

        # Circuit-breaker: Step 8 must produce L4 questions or pipeline cannot continue
        if not all_l4_questions:
            raise ValueError("Circuit-breaker: Step 8 produced 0 L4 questions — pipeline cannot continue")

        # ── L4 Quality Funnel: select top L4s per L3 for Step 9 ──────
        # Step 8 generates broadly for exploration; Step 9 is expensive
        # (each L4 → 3 L5 → ~5 L6). Select top 5 per L3 by discrimination power.
        MAX_L4_PER_L3 = 5
        l4s_per_l3 = {}
        for l4 in all_l4_questions:
            l3_id = l4.get('parent_l3_id', 'unknown')
            l4s_per_l3.setdefault(l3_id, []).append(l4)

        selected_l4s = []
        for l3_id, l4s in l4s_per_l3.items():
            if len(l4s) <= MAX_L4_PER_L3:
                selected_l4s.extend(l4s)
            else:
                # Score by: (a) number of IHs distinguished, (b) type priority
                type_score = {
                    'DISCRIMINATOR_Q': 3, 'MULTI_DISCRIMINATOR': 4,
                    'UNKNOWN_EXPLORATION': 2, 'VALIDATION_Q': 1,
                    'MODEL_REQ': 1, 'TOOL_REQ': 0,
                }
                def _l4_score(l4):
                    ih_count = len(l4.get('distinguishes_ih_ids', []))
                    t_score = type_score.get(l4.get('type', ''), 1)
                    return ih_count * 2 + t_score

                ranked = sorted(l4s, key=_l4_score, reverse=True)
                # Always keep UNKNOWN_EXPLORATION if present
                unknowns = [l4 for l4 in ranked if l4.get('type') == 'UNKNOWN_EXPLORATION']
                others = [l4 for l4 in ranked if l4.get('type') != 'UNKNOWN_EXPLORATION']
                kept = unknowns[:1] + others[:MAX_L4_PER_L3 - len(unknowns[:1])]
                selected_l4s.extend(kept)
                dropped = len(l4s) - len(kept)
                logger.info(f"  🔍 L4 funnel {l3_id}: {len(l4s)} → {len(kept)} (dropped {dropped} lowest-discrimination L4s)")

        if len(selected_l4s) < len(all_l4_questions):
            logger.info(f"  🔍 L4 Quality Funnel: {len(all_l4_questions)} → {len(selected_l4s)} L4s selected for Step 9")
        all_l4_for_step9 = selected_l4s

        # ════════════════════════════════════════════════════════════════
        # STEP 9: Execution Drilldown (multi-batch, grouped by L3)
        # ════════════════════════════════════════════════════════════════
        _set_progress(9, 'Execution Drilldown', detail=f'{len(all_l4_for_step9)} L4s')
        step_start = time.time()
        logger.info(f"[FullPipeline] Step 9: Execution Drilldown ({len(all_l4_for_step9)} L4s)")

        agent = agents['agent-tactical-engineer']
        all_l5_nodes = []
        all_l6_tasks = []

        # Build O(1) index for L3 lookup (reuse ihs_by_l3 and goals_by_id from Step 8)
        l3_by_id = {l3.get('id'): l3 for l3 in all_l3_questions}

        def _build_step9_item(l4q):
            """Build context item for a single L4 question."""
            l4_id = l4q.get('id', '?')
            parent_l3_id = l4q.get('parent_l3_id', '')
            parent_l3 = l3_by_id.get(parent_l3_id)
            parent_goal_id = (parent_l3 or {}).get('parent_goal_id') or (parent_l3 or {}).get('target_goal_id') or l4q.get('parent_goal_id', '')
            parent_goal = goals_by_id.get(parent_goal_id)

            if not parent_l3:
                logger.warning(f"    ⚠️  L4 {l4_id}: parent L3 '{parent_l3_id}' not found — context will be incomplete")
            if not parent_goal:
                logger.warning(f"    ⚠️  L4 {l4_id}: parent goal '{parent_goal_id}' not found — context will be incomplete")

            # Smart IH selection: only IHs this L4 actually distinguishes
            target_ih_ids = l4q.get('distinguishes_ih_ids', [])
            l3_all_ihs = ihs_by_l3.get(parent_l3_id, [])
            if target_ih_ids and l4q.get('type', l4q.get('question_type', '')) != 'UNKNOWN_EXPLORATION':
                selected_ihs = [ih for ih in l3_all_ihs if ih.get('ih_id') in target_ih_ids]
                if not selected_ihs:
                    selected_ihs = l3_all_ihs
            else:
                selected_ihs = l3_all_ihs
            compressed_ihs = [
                {'ih_id': ih.get('ih_id'), 'process_hypothesis': ih.get('process_hypothesis'),
                 'discriminating_prediction': ih.get('discriminating_prediction')}
                for ih in selected_ihs
            ]
            cached_pillars_9 = pillars_cache.get(parent_goal_id, [])
            sci_context = [
                {'id': s.get('id'), 'title': s.get('title'),
                 'mechanism': s.get('mechanism', '')[:120], 'readiness_level': s.get('readiness_level', '')}
                for s in cached_pillars_9[:8]
            ]
            l4_slim = {k: v for k, v in l4q.items() if k not in ('rationale', 'feasibility_note')}
            l3_slim = {'id': parent_l3.get('id'), 'text': parent_l3.get('text', parent_l3.get('question', ''))} if parent_l3 else None

            return {
                'Q0_reference': q0_text,
                'l4_question': l4_slim,
                'parent_l3_question': l3_slim,
                'instantiation_hypotheses': compressed_ihs,
                'parent_goal_title': parent_goal.get('title', '') if parent_goal else '',
                'scientific_context': sci_context,
                'bridge_lexicon': _filter_spvs_for_goal(parent_goal, all_spvs) if parent_goal else {},
                'step3': _slim_ras_for_context(ras_by_goal.get(parent_goal_id, []), 3),
            }

        def _parse_step9_result(result, l4_id):
            """Parse L5/L6 from a Step 9 LLM result for one L4."""
            l5_out, l6_out = [], []
            if result.get('raw_response') and not result.get('drill_branches'):
                result = _try_recover_result(result)
            if result.get('drill_branches') and isinstance(result['drill_branches'], list):
                for branch in result['drill_branches']:
                    l5_out.append({
                        'id': branch.get('id'), 'type': branch.get('type'),
                        'text': branch.get('text'), 'rationale': branch.get('rationale'),
                        'parent_l4_id': result.get('l4_reference_id', l4_id),
                    })
                    for task in (branch.get('leaf_specs') or []):
                        l6_out.append({**task, 'parent_l5_id': branch.get('id'),
                                       'parent_l4_id': result.get('l4_reference_id', l4_id)})
            elif result.get('l6_tasks'):
                l6_out.extend(result['l6_tasks'] if isinstance(result['l6_tasks'], list) else [])
            return l5_out, l6_out

        def _execute_step9_multi(l4_batch):
            """Execute Step 9 for a batch of 1-3 L4s in a single LLM call.
            Returns list of (l4_id, l5_nodes, l6_tasks) tuples."""
            results = []
            if len(l4_batch) == 1:
                # Single L4 — use standard execute_single_item
                l4q = l4_batch[0]
                l4_id = l4q.get('id', '')
                item = _build_step9_item(l4q)
                result = execute_single_item(9, agent, item, global_lens)
                l5s, l6s = _parse_step9_result(result, l4_id)
                results.append((l4_id, l5s, l6s))
                return results

            # Multi-L4 batch: build combined prompt
            system_prompt = interpolate_prompt(agent, global_lens)
            if "JSON" not in system_prompt and "json" not in system_prompt:
                system_prompt += "\n\nIMPORTANT: You must respond with valid JSON only."

            # Build per-L4 sections
            l4_sections = []
            l4_ids = []
            for l4q in l4_batch:
                l4_id = l4q.get('id', '')
                l4_ids.append(l4_id)
                item = _build_step9_item(l4q)
                # Build a compact per-L4 section
                section_parts = [f"### L4: {l4_id}"]
                section_parts.append(f"Question: {item['l4_question'].get('text', item['l4_question'].get('question', ''))}")
                if item.get('parent_l3_question'):
                    section_parts.append(f"Parent L3: {item['parent_l3_question'].get('text', '')}")
                if item.get('instantiation_hypotheses'):
                    section_parts.append(f"IHs: {json.dumps(item['instantiation_hypotheses'])}")
                l4_sections.append("\n".join(section_parts))

            # Use shared context from first L4 (all share same L3 parent → same goal, S-nodes, RAs)
            first_item = _build_step9_item(l4_batch[0])
            user_prompt = f"""Master Project Question (Q0):
{first_item['Q0_reference']}

Parent Goal: {first_item.get('parent_goal_title', '')}

Scientific Context:
{json.dumps(first_item.get('scientific_context', []), indent=1)}

Requirement Atoms:
{json.dumps(first_item.get('step3', []), indent=1)}

System Properties:
{json.dumps(first_item.get('bridge_lexicon', {}).get('system_properties', []), indent=1) if first_item.get('bridge_lexicon') else '[]'}

---
You are processing {len(l4_batch)} L4 questions. Generate L5/L6 for EACH L4 independently.

{chr(10).join(l4_sections)}

---
Generate L5 sub-questions and L6 experiments (with S-I-M-T) for EACH L4. Return JSON:
{{
  "branches": {{
    "{l4_ids[0]}": {{ "drill_branches": [...] }},
    "{l4_ids[1]}": {{ "drill_branches": [...] }}
  }}
}}

CRITICAL: "e.g." is FORBIDDEN in S-I-M-T fields. Every L6 needs feasibility_score and if_null. Max 1 computational L6 per L4."""

            model = resolve_model(agent['model'])
            batch_max_tokens = min(16000 * len(l4_batch), 40000)
            api_kwargs = dict(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=agent['temperature'],
                response_format={"type": "json_object"},
                max_tokens=batch_max_tokens,
                timeout=480,
            )
            if API_PROVIDER == 'openrouter':
                api_kwargs['extra_headers'] = {
                    'HTTP-Referer': 'https://omega-point.local',
                    'X-Title': 'Omega Point Pipeline',
                }
                api_kwargs['extra_body'] = {'provider': {'sort': 'throughput'}}

            try:
                completion = client.chat.completions.create(**api_kwargs)
                response_text = completion.choices[0].message.content
                usage = completion.usage
                logger.info(f"    ✅ Multi-L4 [{','.join(l4_ids)}]: "
                           f"[tokens: {usage.prompt_tokens}+{usage.completion_tokens}]")

                # Parse JSON
                parsed = None
                try:
                    parsed = json.loads(response_text)
                except json.JSONDecodeError:
                    # Try to extract JSON from markdown
                    import re as _re
                    json_match = _re.search(r'\{[\s\S]*\}', response_text)
                    if json_match:
                        try:
                            parsed = json.loads(json_match.group(0))
                        except json.JSONDecodeError:
                            pass

                if parsed and parsed.get('branches') and isinstance(parsed['branches'], dict):
                    branches = parsed['branches']
                    for l4_id in l4_ids:
                        if l4_id in branches and isinstance(branches[l4_id], dict):
                            branch_data = branches[l4_id]
                            # Wrap as a standard result
                            branch_data['l4_reference_id'] = l4_id
                            l5s, l6s = _parse_step9_result(branch_data, l4_id)
                            results.append((l4_id, l5s, l6s))
                        else:
                            # Missing from multi-L4 response — retry individually
                            logger.warning(f"      ⚠️  {l4_id}: Missing in multi-L4 response, retrying individually")
                            l4q_retry = next((q for q in l4_batch if q.get('id') == l4_id), None)
                            if l4q_retry:
                                try:
                                    item = _build_step9_item(l4q_retry)
                                    retry_result = execute_single_item(9, agent, item, global_lens)
                                    l5s, l6s = _parse_step9_result(retry_result, l4_id)
                                    results.append((l4_id, l5s, l6s))
                                    logger.info(f"      ✅ {l4_id}: Individual retry succeeded ({len(l5s)} L5, {len(l6s)} L6)")
                                except Exception as e_retry:
                                    logger.error(f"      ❌ {l4_id}: Individual retry failed — {e_retry}")
                                    results.append((l4_id, [], []))
                            else:
                                results.append((l4_id, [], []))
                elif parsed and parsed.get('drill_branches') and len(l4_batch) == 1:
                    # Single L4 response without branches wrapper
                    l4_id = l4_ids[0]
                    parsed['l4_reference_id'] = l4_id
                    l5s, l6s = _parse_step9_result(parsed, l4_id)
                    results.append((l4_id, l5s, l6s))
                else:
                    logger.warning(f"    ⚠️  Multi-L4 [{','.join(l4_ids)}]: Bad response format, retrying individually")
                    # Fallback: process individually
                    for l4q in l4_batch:
                        l4_id = l4q.get('id', '')
                        try:
                            item = _build_step9_item(l4q)
                            result = execute_single_item(9, agent, item, global_lens)
                            l5s, l6s = _parse_step9_result(result, l4_id)
                            results.append((l4_id, l5s, l6s))
                        except Exception as e2:
                            logger.error(f"      ❌ {l4_id} individual fallback: {e2}")
                            results.append((l4_id, [], []))
            except Exception as e:
                logger.warning(f"    ⚠️  Multi-L4 [{','.join(l4_ids)}]: Error ({e}), retrying individually")
                for l4q in l4_batch:
                    l4_id = l4q.get('id', '')
                    try:
                        item = _build_step9_item(l4q)
                        result = execute_single_item(9, agent, item, global_lens)
                        l5s, l6s = _parse_step9_result(result, l4_id)
                        results.append((l4_id, l5s, l6s))
                    except Exception as e2:
                        logger.error(f"      ❌ {l4_id} individual fallback: {e2}")
                        results.append((l4_id, [], []))
            return results

        if all_l4_for_step9:
            # Group L4s by parent L3 for efficient multi-batching (shared context)
            STEP9_BATCH_SIZE = 2  # Reduced from 3: allows LLM more room to generate 2-4 L6 per L5
            l4s_by_l3 = {}
            for l4q in all_l4_for_step9:
                l3_id = l4q.get('parent_l3_id', 'unknown')
                l4s_by_l3.setdefault(l3_id, []).append(l4q)

            # Create batches: group L4s from the same L3 (up to STEP9_BATCH_SIZE)
            step9_batches = []
            for l3_id, l4_group in l4s_by_l3.items():
                for i in range(0, len(l4_group), STEP9_BATCH_SIZE):
                    step9_batches.append(l4_group[i:i + STEP9_BATCH_SIZE])

            logger.info(f"  📦 {len(all_l4_for_step9)} L4s → {len(step9_batches)} multi-batches (max {STEP9_BATCH_SIZE}/batch)")

            with ThreadPoolExecutor(max_workers=min(len(step9_batches), MAX_BATCH_WORKERS)) as executor:
                futures = {}
                for batch in step9_batches:
                    batch_ids = tuple(l4q.get('id', '') for l4q in batch)
                    futures[executor.submit(_execute_step9_multi, batch)] = batch_ids

                step9_timeout = max(480, 480 + (len(step9_batches) - 25) * 6)
                try:
                  for future in as_completed(futures, timeout=step9_timeout):
                    batch_ids = futures[future]
                    try:
                        batch_results = future.result(timeout=480)
                        for l4_id, l5s, l6s in batch_results:
                            all_l5_nodes.extend(l5s)
                            all_l6_tasks.extend(l6s)
                            if l5s or l6s:
                                logger.info(f"  ✅ {l4_id}: {len(l5s)} L5, {len(l6s)} L6")
                            else:
                                logger.warning(f"  ⚠️  {l4_id}: No L5/L6 generated")
                    except TimeoutError:
                        logger.warning(f"  ⏰ Batch {batch_ids}: TIMEOUT — skipping")
                    except Exception as e:
                        logger.error(f"  ❌ Batch {batch_ids}: {e}")
                except TimeoutError:
                  timed_out_batches = [bids for f, bids in futures.items() if not f.done()]
                  logger.warning(f"  ⏰ Step 9 overall TIMEOUT ({step9_timeout}s) — {len(timed_out_batches)} batches skipped")
                  for f in futures:
                      if not f.done():
                          f.cancel()

        # Post-processing: check for L5 nodes with 0 L6 (parsing failure) and retry individually
        l6_by_l5 = {}
        for l6 in all_l6_tasks:
            pid = l6.get('parent_l5_id', '')
            l6_by_l5.setdefault(pid, []).append(l6)
        empty_l5_l4s = set()
        for l5 in all_l5_nodes:
            l5_id = l5.get('id', '')
            if l5_id not in l6_by_l5:
                l4_id = l5.get('parent_l4_id', '')
                empty_l5_l4s.add(l4_id)
                logger.warning(f"  ⚠️  {l5_id} (under {l4_id}) has 0 L6 — will retry L4 individually")
        if empty_l5_l4s:
            for l4_id in empty_l5_l4s:
                l4q = next((q for q in all_l4_for_step9 if q.get('id') == l4_id), None)
                if l4q:
                    try:
                        retry_results = _execute_step9_multi([l4q])
                        for _, retry_l5s, retry_l6s in retry_results:
                            if retry_l6s:
                                # Remove old L5/L6 for this L4 and replace with retry results
                                all_l5_nodes = [l5 for l5 in all_l5_nodes if l5.get('parent_l4_id') != l4_id]
                                all_l6_tasks = [l6 for l6 in all_l6_tasks if l6.get('parent_l4_id') != l4_id]
                                all_l5_nodes.extend(retry_l5s)
                                all_l6_tasks.extend(retry_l6s)
                                logger.info(f"  🔄 Retry {l4_id}: {len(retry_l5s)} L5, {len(retry_l6s)} L6")
                    except Exception as e:
                        logger.warning(f"  ⚠️  Retry failed for {l4_id}: {e}")

        # Normalize L6 task schema (hoist nested fields from simt_parameters)
        all_l6_tasks = _normalize_l6_tasks(all_l6_tasks)

        # ── Enforce discovery_component: ≥1 per L5 branch ──────────────
        l6_by_l5 = {}
        for l6 in all_l6_tasks:
            l5_id = l6.get('parent_l5_id', 'NONE')
            l6_by_l5.setdefault(l5_id, []).append(l6)
        discovery_enforced = 0
        for l5_id, l6_group in l6_by_l5.items():
            has_discovery = any(l6.get('discovery_component') for l6 in l6_group)
            if not has_discovery and l6_group:
                # Mark the L6 with highest feasibility as discovery — it's most likely to
                # benefit from an unbiased discovery layer on top of its hypothesis test
                best = max(l6_group, key=lambda x: x.get('feasibility_score', 0))
                best['discovery_component'] = True
                discovery_enforced += 1
        if discovery_enforced > 0:
            logger.info(f"  🔬 Enforced discovery_component on {discovery_enforced} L6 tasks (≥1 per L5)")

        # ── Step 9.5: Genius Verification Layer ──────────────────────────
        # Send L6 tasks through LLM critic to: remove hedging, reject mediocre,
        # merge permutations, enhance specificity, calibrate feasibility
        # NON-FATAL: if verification crashes, keep raw L6 tasks
        try:
            all_l6_tasks = _genius_verify_l6_batch(all_l6_tasks, q0_text, agents)
            # Re-normalize after verification (critic may restructure simt_parameters)
            all_l6_tasks = _normalize_l6_tasks(all_l6_tasks)
        except Exception as genius_err:
            logger.warning(f"  ⚠️  Genius Verification failed (non-fatal), keeping raw L6 tasks: {genius_err}")
            # Keep the already-normalized raw L6 tasks

        step_outputs[9] = {
            'l5_nodes': all_l5_nodes,
            'l6_tasks': all_l6_tasks,
        }
        step_timings[9] = round(time.time() - step_start, 1)
        logger.info(f"  ⏱️  {step_timings[9]}s — {len(all_l5_nodes)} L5 nodes, {len(all_l6_tasks)} L6 tasks")
        _store_incremental_outputs()

        # ════════════════════════════════════════════════════════════════
        # L6 PERSPECTIVE ANALYSIS: Best experiment selection
        # ════════════════════════════════════════════════════════════════
        l6_analysis_result = None
        if all_l6_tasks:
            _set_progress(9, 'L6 Perspective Analysis', detail=f'{len(all_l6_tasks)} L6s')
            l6_start = time.time()
            logger.info(f"[FullPipeline] L6 Perspective Analysis ({len(all_l6_tasks)} experiments)")

            try:
                TOP_N = 15
                goals_summary = "\n".join([
                    f"- {g.get('id', '')}: {g.get('title', '')}\n  {g.get('state_definition', '')[:200]}"
                    for g in goals_list[:5]
                ])
                # Use the tactical engineer agent config for model selection
                l6_agent = agents.get('agent-tactical-engineer', {})
                l6_model = resolve_model(l6_agent.get('model', 'google/gemini-2.5-flash'))
                l6_temperature = l6_agent.get('temperature', 0.3)
                l6_by_id = {exp.get('id', f'L6-idx-{i}'): exp for i, exp in enumerate(all_l6_tasks)}

                BATCH_SIZE = 50
                WINNERS_PER_BATCH = 10

                if len(all_l6_tasks) <= BATCH_SIZE:
                    # Single-pass
                    system_prompt = _build_l6_selection_system_prompt(q0_text, goals_summary, TOP_N)
                    l6_analysis_result = _run_l6_selection_call(
                        all_l6_tasks, system_prompt, l6_model, l6_temperature, batch_label="[Pipeline-Single]"
                    )
                    logger.info(f"  L6 Analysis single-pass: {len((l6_analysis_result or {}).get('selected_experiments', []))} selected")
                else:
                    # Multi-stage batching (same logic as the endpoint)
                    num_batches = math.ceil(len(all_l6_tasks) / BATCH_SIZE)
                    winners_per_batch = max(WINNERS_PER_BATCH, math.ceil(TOP_N * 2.5 / num_batches))
                    max_winners_total = BATCH_SIZE
                    if winners_per_batch * num_batches > max_winners_total:
                        winners_per_batch = max(5, max_winners_total // num_batches)

                    logger.info(f"  L6 Analysis multi-stage: {num_batches} batches, {winners_per_batch} winners/batch")

                    batches = [all_l6_tasks[i:i + BATCH_SIZE] for i in range(0, len(all_l6_tasks), BATCH_SIZE)]
                    batch_system_prompt = _build_l6_selection_system_prompt(q0_text, goals_summary, winners_per_batch)

                    stage1_winners = []
                    with ThreadPoolExecutor(max_workers=min(num_batches, MAX_BATCH_WORKERS)) as executor:
                        future_to_batch = {}
                        for batch_idx, batch in enumerate(batches):
                            label = f"[Pipeline-Batch {batch_idx + 1}/{num_batches}]"
                            future = executor.submit(
                                _run_l6_selection_call,
                                batch, batch_system_prompt, l6_model, l6_temperature, label
                            )
                            future_to_batch[future] = (batch_idx, batch)

                        for future in as_completed(future_to_batch, timeout=480):
                            batch_idx, batch = future_to_batch[future]
                            try:
                                result = future.result(timeout=480)
                                if result and 'selected_experiments' in result:
                                    for sel in result['selected_experiments']:
                                        full_exp = l6_by_id.get(sel.get('l6_id', ''))
                                        if full_exp:
                                            winner = dict(full_exp)
                                            winner['_batch_rank'] = sel.get('rank', 99)
                                            winner['_batch_score'] = sel.get('score', 0)
                                            stage1_winners.append(winner)
                                else:
                                    sorted_batch = sorted(batch, key=lambda x: x.get('genius_score', 0), reverse=True)
                                    stage1_winners.extend(sorted_batch[:winners_per_batch])
                            except Exception as e:
                                logger.warning(f"  L6 Analysis batch {batch_idx} error: {e}")
                                sorted_batch = sorted(batch, key=lambda x: x.get('genius_score', 0), reverse=True)
                                stage1_winners.extend(sorted_batch[:winners_per_batch])

                    # Deduplicate
                    seen_ids = set()
                    unique_winners = []
                    for w in stage1_winners:
                        wid = w.get('id', '')
                        if wid not in seen_ids:
                            seen_ids.add(wid)
                            unique_winners.append(w)
                    stage1_winners = unique_winners

                    # Final round
                    final_system_prompt = _build_l6_selection_system_prompt(q0_text, goals_summary, TOP_N, is_final_round=True)
                    l6_analysis_result = _run_l6_selection_call(
                        stage1_winners, final_system_prompt, l6_model, l6_temperature, batch_label="[Pipeline-Final]"
                    )
                    logger.info(f"  L6 Analysis multi-stage: {len((l6_analysis_result or {}).get('selected_experiments', []))} selected from {len(stage1_winners)} winners")

                l6_analysis_time = round(time.time() - l6_start, 1)
                step_timings['l6_analysis'] = l6_analysis_time
                logger.info(f"  ⏱️  L6 Analysis: {l6_analysis_time}s")

            except Exception as e:
                logger.warning(f"  ⚠️  L6 Perspective Analysis failed (non-fatal): {e}")
                l6_analysis_result = None

        # ════════════════════════════════════════════════════════════════
        # DONE — Assemble final result
        # ════════════════════════════════════════════════════════════════
        total_elapsed = round(time.time() - pipeline_start, 1)
        logger.info(f"\n{'#'*70}")
        logger.info(f"### FULL PIPELINE COMPLETE: {run_id}")
        logger.info(f"  Goals: {len(goals_list)}")
        logger.info(f"  RAs: {total_ras}")
        logger.info(f"  S-Nodes: {total_pillars}")
        logger.info(f"  L3 Questions: {len(all_l3_questions)}")
        logger.info(f"  IHs: {len(all_ihs)}")
        logger.info(f"  L4 Questions: {len(all_l4_questions)}")
        logger.info(f"  L5 Nodes: {len(all_l5_nodes)}")
        logger.info(f"  L6 Tasks: {len(all_l6_tasks)}")
        logger.info(f"  L6 Best: {len((l6_analysis_result or {}).get('selected_experiments', []))}")
        logger.info(f"  Total time: {total_elapsed/60:.1f} min")
        logger.info(f"{'#'*70}\n")

        final_result = {
            'success': True,
            'run_id': run_id,
            'goal': goal,
            'globalLens': global_lens,
            'step_outputs': {
                'step1': step_outputs.get(1),
                'step2': step_outputs.get(2),
                'step3': step_outputs.get(3),
                'step4': step_outputs.get(4),
                'step6': step_outputs.get(6),
                'step7': step_outputs.get(7),
                'step8': step_outputs.get(8),
                'step9': step_outputs.get(9),
            },
            'l6_analysis': l6_analysis_result,
            'summary': {
                'goals': len(goals_list),
                'total_ras': total_ras,
                'total_s_nodes': total_pillars,
                'total_l3_questions': len(all_l3_questions),
                'total_ihs': len(all_ihs),
                'total_l4_questions': len(all_l4_questions),
                'total_l5_nodes': len(all_l5_nodes),
                'total_l6_tasks': len(all_l6_tasks),
                'total_l6_best': len((l6_analysis_result or {}).get('selected_experiments', [])),
            },
            'step_timings': step_timings,
            'total_elapsed_seconds': total_elapsed,
        }

        _store_result(final_result)

    except Exception as e:
        logger.error(f"[FullPipeline] background error: {e}", exc_info=True)
        total_elapsed = round(time.time() - pipeline_start, 1)
        _store_result({
            'success': False,
            'run_id': run_id,
            'error': str(e),
            'step_outputs': {f'step{k}': v for k, v in step_outputs.items()},
            'step_timings': step_timings,
            'total_elapsed_seconds': total_elapsed,
        })


def _run_step4_pipeline_sync(session_id, goal_items, domain_mapper_agent,
                              domain_specialist_agent, global_lens, step_outputs, goals_list):
    """
    Synchronous Step 4 pipeline for use within the full-pipeline background thread.
    Runs 4a → dedup → 4b and populates step_outputs[4] keyed by goal_id.
    """
    num_goals = len(goal_items)
    max_workers = min(num_goals * 8, MAX_BATCH_WORKERS)
    q0_text = goal_items[0].get('Q0_reference', '') if goal_items else ''

    all_goal_domains = {}
    goal_mapping_results = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Phase 4a: domain mapping (parallel)
        phase4a_futures = {}
        for idx, item in enumerate(goal_items):
            future = executor.submit(
                execute_single_item, 4, domain_mapper_agent, item, global_lens
            )
            phase4a_futures[future] = idx

        for future in as_completed(phase4a_futures, timeout=480):
            goal_idx = phase4a_futures[future]
            try:
                mapping_result = future.result(timeout=180)
                # Recover from raw_response if JSON parse failed
                if mapping_result.get('raw_response') and not mapping_result.get('research_domains'):
                    mapping_result = _try_recover_result(mapping_result)
                domains = mapping_result.get('research_domains', [])
                for d in domains:
                    if not d.get('relevance_to_goal'):
                        d['relevance_to_goal'] = 'MED'
                all_goal_domains[goal_idx] = domains
                goal_mapping_results[goal_idx] = mapping_result
                logger.info(f"  ✅ Goal {goal_idx+1}/{num_goals}: 4a → {len(domains)} domains")
            except Exception as e:
                logger.error(f"  ❌ Goal {goal_idx+1}/{num_goals}: 4a FAILED — {e}")
                all_goal_domains[goal_idx] = []
                goal_mapping_results[goal_idx] = {'error': str(e)}

        # Phase 4a retry: retry goals with 0 domains (parse failure)
        failed_goals = [idx for idx, domains in all_goal_domains.items() if not domains]
        if failed_goals:
            logger.warning(f"  ⚠️ 4a: {len(failed_goals)} goals got 0 domains — retrying")
            retry_futures = {}
            for idx in failed_goals:
                item = goal_items[idx] if idx < len(goal_items) else goal_items[0]
                future = executor.submit(
                    execute_single_item, 4, domain_mapper_agent, item, global_lens
                )
                retry_futures[future] = idx
            for future in as_completed(retry_futures, timeout=480):
                goal_idx = retry_futures[future]
                try:
                    mapping_result = future.result(timeout=180)
                    if mapping_result.get('raw_response') and not mapping_result.get('research_domains'):
                        mapping_result = _try_recover_result(mapping_result)
                    domains = mapping_result.get('research_domains', [])
                    for d in domains:
                        if not d.get('relevance_to_goal'):
                            d['relevance_to_goal'] = 'MED'
                    all_goal_domains[goal_idx] = domains
                    goal_mapping_results[goal_idx] = mapping_result
                    logger.info(f"  ✅ RETRY Goal {goal_idx+1}/{num_goals}: 4a → {len(domains)} domains")
                except Exception as e:
                    logger.error(f"  ❌ RETRY Goal {goal_idx+1}/{num_goals}: 4a still FAILED — {e}")

        # Phase 4a-post: dedup
        total_raw = sum(len(d) for d in all_goal_domains.values())
        canonical_domains = _deduplicate_domains(all_goal_domains)
        logger.info(f"  🔀 DEDUP: {total_raw} raw → {len(canonical_domains)} canonical")

        # Phase 4b: scan canonical domains (parallel, with cache)
        scan_results_by_domain = {}  # domain_id → scan_result
        phase4b_futures = {}
        cache_hits = 0

        for cd in canonical_domains:
            domain_name = cd.get('domain_name', '')
            domain_id = cd.get('domain_id', '')

            cached = _get_cached_scan(q0_text, domain_name)
            if cached:
                cache_hits += 1
                for pillar in cached.get('scientific_pillars', []):
                    pillar['domain_id'] = domain_id
                scan_results_by_domain[domain_id] = cached
                logger.info(f"  ⚡ CACHE HIT: {domain_id}")
                continue

            primary_idx = cd.get('_goal_indices', [0])[0]
            base_item = goal_items[primary_idx] if primary_idx < len(goal_items) else goal_items[0]
            domain_for_llm = {k: v for k, v in cd.items() if k != '_goal_indices'}
            scan_item = {**base_item, 'target_domain': domain_for_llm}

            future = executor.submit(
                execute_single_item, 4, domain_specialist_agent, scan_item, global_lens
            )
            phase4b_futures[future] = cd

        try:
            for future in as_completed(phase4b_futures, timeout=480):
                cd = phase4b_futures[future]
                domain_id = cd.get('domain_id', '')
                domain_name = cd.get('domain_name', '')
                try:
                    scan_result = future.result(timeout=180)
                    for pillar in scan_result.get('scientific_pillars', []):
                        pillar['domain_id'] = domain_id
                    _cache_scan_result(q0_text, domain_name, scan_result)
                    scan_results_by_domain[domain_id] = scan_result
                    logger.info(f"  ✅ {domain_id}: 4b scan done")
                except TimeoutError:
                    scan_results_by_domain[domain_id] = {'error': 'timeout (180s)'}
                    logger.warning(f"  ⏰ {domain_id}: 4b TIMEOUT — skipping (>180s)")
                    future.cancel()
                except Exception as e:
                    scan_results_by_domain[domain_id] = {'error': str(e)}
                    logger.error(f"  ❌ {domain_id}: 4b FAILED — {e}")
        except TimeoutError:
            # Overall 480s deadline reached — cancel remaining and continue
            timed_out = [cd.get('domain_id', '?') for f, cd in phase4b_futures.items() if not f.done()]
            logger.warning(f"  ⏰ 4b overall TIMEOUT (480s) — {len(timed_out)} domains skipped: {timed_out}")
            for f in phase4b_futures:
                if not f.done():
                    cd = phase4b_futures[f]
                    domain_id = cd.get('domain_id', '')
                    scan_results_by_domain[domain_id] = {'error': 'overall timeout (480s)'}
                    f.cancel()

    # Distribute results to goals
    step4_output = {}
    for idx, g in enumerate(goals_list):
        goal_id = g['id']
        mapping = goal_mapping_results.get(idx, {})
        # Find which canonical domains serve this goal
        goal_domains = all_goal_domains.get(idx, [])
        goal_domain_ids = {d.get('domain_id') for d in goal_domains}
        # Also include canonical domains that merged from this goal
        for cd in canonical_domains:
            if idx in cd.get('_goal_indices', []):
                goal_domain_ids.add(cd.get('domain_id'))

        scans = {}
        all_pillars = []
        for did in goal_domain_ids:
            scan = scan_results_by_domain.get(did)
            if scan and not scan.get('error'):
                scans[did] = scan
                all_pillars.extend(scan.get('scientific_pillars', []))
            elif scan and scan.get('raw_response'):
                # Attempt to extract pillars from raw response (repair failed)
                try:
                    raw_text = scan['raw_response']
                    # Try re-parsing with more aggressive repair
                    cleaned = raw_text
                    if '```json' in cleaned:
                        cleaned = cleaned.split('```json')[1].split('```')[0].strip()
                    elif '```' in cleaned:
                        cleaned = cleaned.split('```')[1].split('```')[0].strip()
                    cleaned = re.sub(r',(\s*[}\]])', r'\1', cleaned)
                    cleaned = re.sub(r'(\d+\.?\d*)\s*"(\s*[,}\]])', r'\1\2', cleaned)
                    cleaned = re.sub(r'(\d+\.?\d*)\s*\\"(\s*[,}\]])', r'\1\2', cleaned)
                    open_b = cleaned.count('{') - cleaned.count('}')
                    open_k = cleaned.count('[') - cleaned.count(']')
                    if open_b > 0:
                        cleaned += '}' * open_b
                    if open_k > 0:
                        cleaned += ']' * open_k
                    recovered = json.loads(cleaned)
                    recovered_pillars = recovered.get('scientific_pillars', [])
                    if recovered_pillars:
                        for p in recovered_pillars:
                            p['domain_id'] = did
                        all_pillars.extend(recovered_pillars)
                        scans[did] = recovered
                        logger.info(f"  🔧 Recovered {len(recovered_pillars)} pillars from raw_response for {did}")
                except Exception:
                    logger.warning(f"  ⚠️ Could not recover pillars from raw_response for {did}")

        # Sanitize capabilities: ensure all are dicts (LLM sometimes returns strings)
        for p in all_pillars:
            caps = p.get('capabilities', [])
            if isinstance(caps, list):
                p['capabilities'] = [c for c in caps if isinstance(c, dict)]

        # Deduplicate near-identical pillars across domains
        all_pillars = _deduplicate_pillars(all_pillars)

        # Enrich SPV coverage: detect underrepresented SPVs and add secondary capabilities
        goal_item = goal_items[idx] if idx < len(goal_items) else goal_items[0]
        goal_spvs = goal_item.get('bridge_lexicon', {}).get('system_properties', [])
        if goal_spvs and all_pillars:
            all_spv_ids = {spv.get('id') for spv in goal_spvs if spv.get('id')}
            spv_keywords = {}  # spv_id → set of matching keywords from name+definition
            for spv in goal_spvs:
                sid = spv.get('id', '')
                text = (spv.get('name', '') + ' ' + spv.get('definition', '')).lower()
                # Extract meaningful words (>3 chars, skip common words)
                stop = {'that', 'this', 'with', 'from', 'have', 'been', 'such', 'which', 'their', 'more', 'than', 'into', 'also'}
                words = {w for w in text.split() if len(w) > 3 and w not in stop}
                spv_keywords[sid] = words

            # Count current SPV usage
            spv_usage = {sid: 0 for sid in all_spv_ids}
            for p in all_pillars:
                for cap in p.get('capabilities', []):
                    if not isinstance(cap, dict):
                        continue
                    ref = cap.get('spv_id', '')
                    if ref in spv_usage:
                        spv_usage[ref] += 1

            underused = {sid for sid, cnt in spv_usage.items() if cnt == 0}
            if underused:
                enriched_count = 0
                for p in all_pillars:
                    mech_text = (p.get('mechanism', '') + ' ' + p.get('title', '') + ' ' + p.get('verified_effect', '')).lower()
                    existing_spvs = {cap.get('spv_id') for cap in p.get('capabilities', []) if isinstance(cap, dict)}
                    for sid in underused:
                        if sid in existing_spvs:
                            continue
                        kw = spv_keywords.get(sid, set())
                        overlap = sum(1 for w in kw if w in mech_text)
                        if overlap >= 3:  # Require ≥3 keyword matches for a genuine link
                            p.setdefault('capabilities', []).append({
                                'spv_id': sid,
                                'effect_direction': 'MODULATE',
                                'rationale': f'Secondary SPV link: mechanism keywords overlap with {sid} definition',
                                '_auto_enriched': True,
                            })
                            enriched_count += 1
                if enriched_count > 0:
                    # Recount after enrichment
                    spv_usage_after = {sid: 0 for sid in all_spv_ids}
                    for p in all_pillars:
                        for cap in p.get('capabilities', []):
                            if not isinstance(cap, dict):
                                continue
                            ref = cap.get('spv_id', '')
                            if ref in spv_usage_after:
                                spv_usage_after[ref] += 1
                    still_zero = sum(1 for cnt in spv_usage_after.values() if cnt == 0)
                    logger.info(f"  📊 Goal {goal_id}: SPV enrichment added {enriched_count} secondary links, {still_zero} SPVs still uncovered")

        # Normalize SPV references: fix "SPV not in lexicon" and RA-as-SPV refs
        if goal_spvs:
            valid_spv_ids = {spv.get('id') for spv in goal_spvs if spv.get('id')}
            spv_names = {spv.get('id'): spv.get('name', '') for spv in goal_spvs}
            fixed_count = 0
            for pillar in all_pillars:
                for cap in pillar.get('capabilities', []):
                    if not isinstance(cap, dict):
                        continue
                    spv_ref = cap.get('spv_id', '')
                    if not spv_ref or spv_ref in valid_spv_ids:
                        continue  # Already valid
                    # Invalid ref — try to map to closest valid SPV
                    rationale = (cap.get('rationale', '') + ' ' + pillar.get('mechanism', '')).lower()
                    best_spv = None
                    best_score = 0
                    for sid, sname in spv_names.items():
                        # Score by keyword overlap between SPV name and pillar context
                        name_words = set(sname.lower().split())
                        score = sum(1 for w in name_words if len(w) > 3 and w in rationale)
                        if score > best_score:
                            best_score = score
                            best_spv = sid
                    if best_spv:
                        cap['spv_id_original'] = spv_ref  # Keep original for debugging
                        cap['spv_id'] = best_spv
                        fixed_count += 1
                    elif valid_spv_ids:
                        # Last resort: assign first SPV to avoid "not in lexicon"
                        cap['spv_id_original'] = spv_ref
                        cap['spv_id'] = next(iter(valid_spv_ids))
                        fixed_count += 1
            if fixed_count > 0:
                logger.info(f"  🔗 Goal {goal_id}: Fixed {fixed_count} invalid SPV references")

        # Also normalize SPV refs in raw domain scans
        for did, scan in scans.items():
            for pillar in scan.get('scientific_pillars', []):
                for cap in pillar.get('capabilities', []):
                    if not isinstance(cap, dict):
                        continue
                    spv_ref = cap.get('spv_id', '')
                    if not spv_ref or not goal_spvs:
                        continue
                    if spv_ref not in valid_spv_ids:
                        rationale = (cap.get('rationale', '') + ' ' + pillar.get('mechanism', '')).lower()
                        best_spv = None
                        best_score = 0
                        for sid, sname in spv_names.items():
                            name_words = set(sname.lower().split())
                            score = sum(1 for w in name_words if len(w) > 3 and w in rationale)
                            if score > best_score:
                                best_score = score
                                best_spv = sid
                        if best_spv:
                            cap['spv_id_original'] = spv_ref
                            cap['spv_id'] = best_spv
                        elif valid_spv_ids:
                            cap['spv_id_original'] = spv_ref
                            cap['spv_id'] = next(iter(valid_spv_ids))

        step4_output[goal_id] = {
            'domain_mapping': mapping,
            'raw_domain_scans': {'domains': scans},
            'scientific_pillars': all_pillars,
        }

    step_outputs[4] = step4_output
    logger.info(f"  📦 Cache hits: {cache_hits}/{len(canonical_domains)}")


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

# ═══════════════════════════════════════════════════════════════════════════════
# Telegram Auth
# ═══════════════════════════════════════════════════════════════════════════════

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_BOT_USERNAME = os.getenv('TELEGRAM_BOT_USERNAME', '')

def verify_telegram_login(data: dict) -> bool:
    """Verify that login data actually came from Telegram."""
    if not TELEGRAM_BOT_TOKEN:
        return False
    check_hash = data.get('hash', '')
    # Build check string from all fields except hash
    filtered = {k: v for k, v in data.items() if k != 'hash'}
    check_string = '\n'.join(f'{k}={v}' for k, v in sorted(filtered.items()))
    secret_key = hashlib.sha256(TELEGRAM_BOT_TOKEN.encode()).digest()
    computed = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
    # Verify hash matches and auth_date is recent (< 1 day)
    if time.time() - int(data.get('auth_date', 0)) > 86400:
        return False
    return computed == check_hash

@app.route('/api/auth/telegram', methods=['POST'])
def telegram_auth():
    """Verify Telegram Login Widget callback data and persist user"""
    data = request.json or {}
    if not data.get('id') or not data.get('hash'):
        return jsonify({'error': 'Missing required Telegram auth fields'}), 400
    if not verify_telegram_login(data):
        return jsonify({'error': 'Invalid Telegram authentication'}), 401

    # Persist user in DB
    user_id = None
    try:
        db_user = db.upsert_telegram_user(
            telegram_id=int(data['id']),
            first_name=data.get('first_name', ''),
            last_name=data.get('last_name', ''),
            username=data.get('username', ''),
            photo_url=data.get('photo_url'),
        )
        user_id = db_user['user_id']

        # Bind browser session to this user
        browser_session_id = get_session_id()
        if browser_session_id:
            db.bind_user_to_session(browser_session_id, user_id)
    except Exception as e:
        logger.warning(f"Telegram user persistence failed (auth still OK): {e}")

    return jsonify({
        'ok': True,
        'user': {
            'id': data.get('id'),
            'first_name': data.get('first_name', ''),
            'last_name': data.get('last_name', ''),
            'username': data.get('username', ''),
            'photo_url': data.get('photo_url', ''),
        },
        'user_id': user_id,
    })

@app.route('/api/config/telegram', methods=['GET'])
def telegram_config():
    """Return public Telegram bot config for the frontend widget"""
    return jsonify({
        'botUsername': TELEGRAM_BOT_USERNAME,
        'enabled': bool(TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME),
    })

# ═══════════════════════════════════════════════════════════════════════════════
# Share to Telegram
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/api/share/telegram', methods=['POST'])
def share_to_telegram():
    """Send a concise summary message + full session JSON file to user's Telegram."""
    if not TELEGRAM_BOT_TOKEN:
        return jsonify({'error': 'Telegram bot not configured'}), 500

    data = request.json or {}
    chat_id = data.get('chat_id')
    if not chat_id:
        return jsonify({'error': 'chat_id is required'}), 400

    summary_text = data.get('summary', '')
    session_json = data.get('session_json')
    filename = data.get('filename', f'omega_point_{int(time.time())}.json')

    if not summary_text and not session_json:
        return jsonify({'error': 'Nothing to share'}), 400

    try:
        # 1. Send concise text summary
        if summary_text:
            _tg_send_message(chat_id, summary_text)

        # 2. Always send full JSON as a document
        if session_json:
            json_str = json.dumps(session_json, indent=2, ensure_ascii=False)
            _tg_send_document(chat_id, json_str, filename, 'application/json')

        return jsonify({'ok': True})

    except Exception as e:
        err_str = str(e)
        logger.error(f"Telegram share error: {err_str}")
        if '403' in err_str or 'Forbidden' in err_str:
            return jsonify({'error': 'Bot cannot message you yet. Please open @' + TELEGRAM_BOT_USERNAME + ' in Telegram and press Start first.'}), 400
        if '400' in err_str and 'chat not found' in err_str.lower():
            return jsonify({'error': 'Bot cannot message you yet. Please open @' + TELEGRAM_BOT_USERNAME + ' in Telegram and press Start first.'}), 400
        return jsonify({'error': f'Failed to send to Telegram: {err_str}'}), 500


def _tg_escape(text: str) -> str:
    """Escape special chars for Telegram Markdown parse mode."""
    for ch in ['*', '_', '`', '[']:
        text = text.replace(ch, '\\' + ch)
    return text


def _tg_send_message(chat_id, text):
    """Send a text message via Telegram Bot API."""
    import urllib.request
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = json.dumps({
        'chat_id': chat_id,
        'text': text,
        'parse_mode': 'Markdown',
        'disable_web_page_preview': True,
    }).encode('utf-8')
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
    resp = urllib.request.urlopen(req, timeout=15)
    result = json.loads(resp.read())
    if not result.get('ok'):
        raise Exception(f"Telegram API error: {result}")
    return result


def _tg_send_document(chat_id, file_content: str, filename: str, mime_type: str = 'text/plain'):
    """Send a file as a document via Telegram Bot API multipart upload."""
    import urllib.request
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendDocument"

    boundary = f"----FormBoundary{int(time.time() * 1000)}"
    parts = []

    # chat_id field
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n{chat_id}')

    # document field
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="document"; filename="{filename}"\r\nContent-Type: {mime_type}\r\n\r\n{file_content}')

    parts.append(f'--{boundary}--')

    body = '\r\n'.join(parts).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={
        'Content-Type': f'multipart/form-data; boundary={boundary}',
    })
    resp = urllib.request.urlopen(req, timeout=60)
    result = json.loads(resp.read())
    if not result.get('ok'):
        raise Exception(f"Telegram API error: {result}")
    return result


# ═══════════════════════════════════════════════════════════════════════════════
# Cleanup handlers
# ═══════════════════════════════════════════════════════════════════════════════

# Register Step 4 cleanup on application shutdown
if STEP4_OPTIMIZED_AVAILABLE:
    import atexit
    atexit.register(cleanup_step4)
    logger.info("✓ Step 4 cleanup handler registered")

# ═══════════════════════════════════════════════════════════════════════════════

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

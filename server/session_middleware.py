"""
Session middleware for Omega Point multi-session support
Handles session extraction, validation, and decorator utilities
"""

import logging
from functools import wraps
from flask import request, jsonify
from typing import Optional

logger = logging.getLogger(__name__)


def get_session_id() -> Optional[str]:
    """
    Extract session ID from request
    Checks in order: X-Session-ID header, session_id query param, Cookie
    Returns: session_id string or None
    """
    # Check X-Session-ID header (preferred method)
    session_id = request.headers.get('X-Session-ID')
    if session_id:
        return session_id

    # Check query parameter (for SSE endpoints that can't set headers)
    session_id = request.args.get('session_id')
    if session_id:
        return session_id

    # Check cookie (fallback for browser requests)
    session_id = request.cookies.get('session_id')
    if session_id:
        return session_id

    return None


def require_session(db):
    """
    Validate session and return session_id or error response
    Returns: (session_id, None) if valid, (None, error_response) if invalid

    Usage in route:
        session_id, error = require_session(db)
        if error:
            return error
    """
    session_id = get_session_id()

    if not session_id:
        return None, (jsonify({
            'error': 'Missing session',
            'message': 'No session ID provided in request'
        }), 401)

    # Validate session exists and is not expired
    if not db.is_valid_session(session_id):
        return None, (jsonify({
            'error': 'Invalid session',
            'message': 'Session is invalid or expired'
        }), 401)

    # Update last accessed timestamp
    try:
        db.update_session_access(session_id)
    except Exception as e:
        logger.warning(f"Failed to update session access time: {e}")

    return session_id, None


def with_session(db):
    """
    Decorator to inject session_id into route handlers
    Automatically validates session and returns 401 if invalid

    Usage:
        @app.route('/api/endpoint')
        @with_session(db)
        def endpoint(session_id):
            # session_id is automatically injected
            return jsonify({'session_id': session_id})
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            session_id, error = require_session(db)
            if error:
                return error

            # Inject session_id as first argument
            return f(session_id, *args, **kwargs)
        return wrapper
    return decorator


def optional_session(db):
    """
    Decorator to optionally inject session_id into route handlers
    Does not return 401 if session is missing or invalid
    Injects None if no valid session

    Usage:
        @app.route('/api/endpoint')
        @optional_session(db)
        def endpoint(session_id):
            if session_id:
                # Use session-specific logic
            else:
                # Use fallback logic
            return jsonify({'has_session': session_id is not None})
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            session_id = get_session_id()

            if session_id and db.is_valid_session(session_id):
                try:
                    db.update_session_access(session_id)
                except Exception as e:
                    print(f"Warning: Failed to update session access time: {e}")
            else:
                session_id = None

            # Inject session_id as first argument (may be None)
            return f(session_id, *args, **kwargs)
        return wrapper
    return decorator

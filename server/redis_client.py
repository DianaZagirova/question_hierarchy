"""
Redis client for Omega Point multi-session support
Handles real-time progress tracking shared across Gunicorn workers
"""

import os
import json
from typing import Dict, Any, Optional, List
import redis


class RedisClient:
    """Redis client wrapper for session-scoped progress tracking"""

    def __init__(self):
        self.client = None

    def initialize(self, redis_url: str = None):
        """Initialize Redis connection"""
        if redis_url is None:
            redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379/0')

        self.client = redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True
        )

        # Test connection
        try:
            self.client.ping()
        except redis.ConnectionError as e:
            raise Exception(f"Failed to connect to Redis: {e}")

    def _get_progress_key(self, session_id: str, step_id: int) -> str:
        """Generate Redis key for progress tracking"""
        return f"progress:{session_id}:{step_id}"

    def _get_session_meta_key(self, session_id: str) -> str:
        """Generate Redis key for session metadata cache"""
        return f"session:meta:{session_id}"

    def get_progress(self, session_id: str, step_id: int) -> Optional[Dict[str, Any]]:
        """
        Retrieve progress data for a specific session and step
        Returns: progress dict or None if not found
        """
        if not self.client:
            return None

        key = self._get_progress_key(session_id, step_id)
        try:
            data = self.client.hgetall(key)
            if not data:
                return None

            # Convert string values back to appropriate types
            return {
                'completed': int(data.get('completed', 0)),
                'total': int(data.get('total', 0)),
                'successful': int(data.get('successful', 0)),
                'failed': int(data.get('failed', 0)),
                'elapsed': float(data.get('elapsed', 0.0)),
                'eta': float(data.get('eta', 0.0)),
                'percent': float(data.get('percent', 0.0)),
                'items': json.loads(data.get('items', '[]'))
            }
        except (redis.RedisError, ValueError, json.JSONDecodeError) as e:
            print(f"Error getting progress from Redis: {e}")
            return None

    def update_progress(
        self,
        session_id: str,
        step_id: int,
        completed: int = None,
        total: int = None,
        successful: int = None,
        failed: int = None,
        elapsed: float = None,
        eta: float = None,
        percent: float = None,
        items: List[Any] = None
    ):
        """
        Update progress data for a specific session and step
        Only updates provided fields (partial updates supported)
        """
        if not self.client:
            return

        key = self._get_progress_key(session_id, step_id)
        try:
            # Build update dict with only provided values
            updates = {}
            if completed is not None:
                updates['completed'] = completed
            if total is not None:
                updates['total'] = total
            if successful is not None:
                updates['successful'] = successful
            if failed is not None:
                updates['failed'] = failed
            if elapsed is not None:
                updates['elapsed'] = elapsed
            if eta is not None:
                updates['eta'] = eta
            if percent is not None:
                updates['percent'] = percent
            if items is not None:
                updates['items'] = json.dumps(items)

            if updates:
                self.client.hset(key, mapping=updates)
                # Set TTL of 1 hour
                self.client.expire(key, 3600)
        except redis.RedisError as e:
            print(f"Error updating progress in Redis: {e}")

    def clear_progress(self, session_id: str, step_id: int):
        """
        Clear progress data for a specific session and step
        """
        if not self.client:
            return

        key = self._get_progress_key(session_id, step_id)
        try:
            self.client.delete(key)
        except redis.RedisError as e:
            print(f"Error clearing progress from Redis: {e}")

    def set_session_meta(self, session_id: str, goal_preview: str = None, last_step: int = None):
        """
        Cache session metadata in Redis for quick access
        """
        if not self.client:
            return

        key = self._get_session_meta_key(session_id)
        try:
            updates = {}
            if goal_preview is not None:
                updates['goal_preview'] = goal_preview
            if last_step is not None:
                updates['last_step'] = str(last_step)

            if updates:
                self.client.hset(key, mapping=updates)
                # Set TTL of 7 days
                self.client.expire(key, 7 * 24 * 3600)
        except redis.RedisError as e:
            print(f"Error setting session metadata in Redis: {e}")

    def get_session_meta(self, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve cached session metadata from Redis
        Returns: metadata dict or None if not found
        """
        if not self.client:
            return None

        key = self._get_session_meta_key(session_id)
        try:
            data = self.client.hgetall(key)
            if not data:
                return None

            return {
                'goal_preview': data.get('goal_preview'),
                'last_step': int(data.get('last_step', 0)) if data.get('last_step') else None
            }
        except (redis.RedisError, ValueError) as e:
            print(f"Error getting session metadata from Redis: {e}")
            return None

    def delete_session_data(self, session_id: str):
        """
        Delete all Redis data for a session (progress + metadata)
        """
        if not self.client:
            return

        try:
            # Delete all progress keys for this session
            pattern = f"progress:{session_id}:*"
            keys = self.client.keys(pattern)
            if keys:
                self.client.delete(*keys)

            # Delete session metadata
            meta_key = self._get_session_meta_key(session_id)
            self.client.delete(meta_key)
        except redis.RedisError as e:
            print(f"Error deleting session data from Redis: {e}")

    def health_check(self) -> bool:
        """
        Check if Redis connection is healthy
        Returns: True if healthy, False otherwise
        """
        try:
            return self.client.ping() if self.client else False
        except redis.RedisError:
            return False

    def close(self):
        """Close Redis connection"""
        if self.client:
            self.client.close()


# Global Redis client instance
redis_client = RedisClient()

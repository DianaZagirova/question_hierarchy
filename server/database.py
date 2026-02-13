"""
Database layer for Omega Point multi-session support
Handles PostgreSQL connections, session management, and state persistence
"""

import os
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from sqlalchemy import create_engine, Column, String, DateTime, Boolean, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, scoped_session, relationship
from sqlalchemy.sql import func

# SQLAlchemy Base
Base = declarative_base()

# ============================================================
# SQLAlchemy Models
# ============================================================

class User(Base):
    """User accounts for session binding"""
    __tablename__ = 'users'

    user_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True)
    username = Column(String(100))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_login_at = Column(DateTime)
    user_metadata = Column(JSONB, default={})

    # Relationships
    sessions = relationship("Session", back_populates="user")

    def __repr__(self):
        return f"<User {self.user_id}:{self.email}>"


class Session(Base):
    """Session metadata and lifecycle information"""
    __tablename__ = 'sessions'

    session_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey('users.user_id', ondelete='CASCADE'))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_accessed_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    session_metadata = Column(JSONB, default={})
    is_active = Column(Boolean, default=True)

    # Relationships
    user = relationship("User", back_populates="sessions")
    states = relationship("SessionState", back_populates="session", cascade="all, delete-orphan")
    versions = relationship("SessionVersion", back_populates="session", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Session {self.session_id}>"


class SessionState(Base):
    """Pipeline state and step outputs per session"""
    __tablename__ = 'session_state'

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey('sessions.session_id', ondelete='CASCADE'), nullable=False)
    state_key = Column(String(50), nullable=False)
    state_data = Column(JSONB, nullable=False, default={})
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    session = relationship("Session", back_populates="states")

    # Constraints
    __table_args__ = (
        UniqueConstraint('session_id', 'state_key', name='uq_session_state_key'),
    )

    def __repr__(self):
        return f"<SessionState {self.session_id}:{self.state_key}>"


class CommunitySession(Base):
    """Published sessions visible to all users"""
    __tablename__ = 'community_sessions'

    id = Column(String(100), primary_key=True)  # matches user_session id format
    name = Column(String(500), nullable=False)
    author = Column(String(200), default='Anonymous')
    goal_preview = Column(String(500), default='')
    session_data = Column(JSONB, nullable=False, default={})
    published_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    source_browser_session = Column(UUID(as_uuid=True), nullable=True)  # which browser session published it
    tags = Column(JSONB, default=[])
    clone_count = Column(Integer, default=0)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'author': self.author,
            'goalPreview': self.goal_preview,
            'publishedAt': self.published_at.isoformat() if self.published_at else None,
            'tags': self.tags or [],
            'cloneCount': self.clone_count or 0,
        }

    def __repr__(self):
        return f"<CommunitySession {self.id}:{self.name}>"


class SessionVersion(Base):
    """Saved snapshots of session state"""
    __tablename__ = 'session_versions'

    version_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey('sessions.session_id', ondelete='CASCADE'), nullable=False)
    version_name = Column(String(200), nullable=False)
    snapshot_data = Column(JSONB, nullable=False, default={})
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    # Relationships
    session = relationship("Session", back_populates="versions")

    def __repr__(self):
        return f"<SessionVersion {self.version_id}:{self.version_name}>"


# ============================================================
# Database Connection Manager
# ============================================================

class DB:
    """Database connection and operations manager"""

    def __init__(self):
        self.engine = None
        self.session_factory = None
        self.Session = None

    def initialize(self, database_url: str = None):
        """Initialize database connection"""
        if database_url is None:
            database_url = os.getenv('DATABASE_URL', 'postgresql://omegapoint:changeme@localhost:5432/omegapoint')

        # Create engine with connection pooling
        self.engine = create_engine(
            database_url,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,  # Verify connections before using
            echo=False  # Set to True for SQL query logging
        )

        # Create session factory
        self.session_factory = sessionmaker(bind=self.engine)
        self.Session = scoped_session(self.session_factory)

        # Create tables if they don't exist (idempotent)
        # Note: init.sql also creates tables, so conflicts are expected
        try:
            Base.metadata.create_all(self.engine, checkfirst=True)
        except Exception as e:
            # Tables already exist from init.sql - this is expected and safe
            import logging
            logger = logging.getLogger(__name__)
            if "already exists" in str(e).lower() or "duplicate" in str(e).lower():
                logger.info("✓ Database tables already initialized (by init.sql)")
            else:
                # Unexpected error - log but continue
                logger.warning(f"Database table creation issue (continuing): {e}")

    def get_session(self):
        """Get a new database session"""
        return self.Session()

    def create_session(self, metadata: Dict[str, Any] = None) -> str:
        """
        Create a new user session
        Returns: session_id (UUID string)
        """
        session = self.get_session()
        try:
            expiry_days = int(os.getenv('SESSION_EXPIRY_DAYS', 7))
            new_session = Session(
                session_id=uuid.uuid4(),
                expires_at=datetime.utcnow() + timedelta(days=expiry_days),
                session_metadata=metadata or {}
            )
            session.add(new_session)
            session.commit()
            return str(new_session.session_id)
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def is_valid_session(self, session_id: str) -> bool:
        """
        Validate if a session exists and is not expired
        Returns: True if valid, False otherwise
        """
        session = self.get_session()
        try:
            session_uuid = uuid.UUID(session_id)
            result = session.query(Session).filter(
                Session.session_id == session_uuid,
                Session.is_active == True,
                Session.expires_at > datetime.utcnow()
            ).first()
            return result is not None
        except (ValueError, Exception):
            return False
        finally:
            session.close()

    def update_session_access(self, session_id: str):
        """
        Update last_accessed_at timestamp for a session
        Also extends expiry by SESSION_EXPIRY_DAYS from now
        """
        session = self.get_session()
        try:
            session_uuid = uuid.UUID(session_id)
            expiry_days = int(os.getenv('SESSION_EXPIRY_DAYS', 7))

            session.query(Session).filter(
                Session.session_id == session_uuid
            ).update({
                'last_accessed_at': datetime.utcnow(),
                'expires_at': datetime.utcnow() + timedelta(days=expiry_days)
            })
            session.commit()
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def get_session_state(self, session_id: str, state_key: str = None) -> Optional[Dict[str, Any]]:
        """
        Retrieve session state by key
        If state_key is None, returns all states for the session as a dict
        Returns: state_data dict or None if not found
        """
        session = self.get_session()
        try:
            session_uuid = uuid.UUID(session_id)

            if state_key:
                # Get specific state key
                result = session.query(SessionState).filter(
                    SessionState.session_id == session_uuid,
                    SessionState.state_key == state_key
                ).first()
                return result.state_data if result else None
            else:
                # Get all states
                results = session.query(SessionState).filter(
                    SessionState.session_id == session_uuid
                ).all()
                return {r.state_key: r.state_data for r in results}
        except (ValueError, Exception):
            return None
        finally:
            session.close()

    def save_session_state(self, session_id: str, state_key: str, state_data: Dict[str, Any]):
        """
        Save or update session state
        Uses upsert logic to handle existing keys
        """
        session = self.get_session()
        try:
            session_uuid = uuid.UUID(session_id)

            # Check if state exists
            existing = session.query(SessionState).filter(
                SessionState.session_id == session_uuid,
                SessionState.state_key == state_key
            ).first()

            if existing:
                # Update existing state
                existing.state_data = state_data
                existing.updated_at = datetime.utcnow()
            else:
                # Create new state
                new_state = SessionState(
                    session_id=session_uuid,
                    state_key=state_key,
                    state_data=state_data
                )
                session.add(new_state)

            session.commit()
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def delete_session(self, session_id: str):
        """Delete a session and all associated data"""
        session = self.get_session()
        try:
            session_uuid = uuid.UUID(session_id)
            session.query(Session).filter(
                Session.session_id == session_uuid
            ).delete()
            session.commit()
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def cleanup_expired_sessions(self) -> int:
        """
        Delete expired inactive sessions
        Returns: number of sessions deleted
        """
        session = self.get_session()
        try:
            deleted = session.query(Session).filter(
                Session.expires_at < datetime.utcnow(),
                Session.is_active == False
            ).delete()
            session.commit()
            return deleted
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    # ─── Community Sessions ───────────────────────────────────────────────

    def list_community_sessions(self, limit=50, offset=0):
        """Get all published community sessions, newest first"""
        session = self.get_session()
        try:
            results = session.query(CommunitySession).order_by(
                CommunitySession.published_at.desc()
            ).offset(offset).limit(limit).all()
            total = session.query(CommunitySession).count()
            return [r.to_dict() for r in results], total
        finally:
            session.close()

    def get_community_session(self, community_id: str):
        """Get full community session with data"""
        session = self.get_session()
        try:
            result = session.query(CommunitySession).filter(
                CommunitySession.id == community_id
            ).first()
            if not result:
                return None
            d = result.to_dict()
            d['data'] = result.session_data
            return d
        finally:
            session.close()

    def publish_community_session(self, community_id: str, name: str, author: str,
                                   goal_preview: str, session_data: dict,
                                   browser_session_id: str = None, tags: list = None):
        """Publish a session to community"""
        session = self.get_session()
        try:
            existing = session.query(CommunitySession).filter(
                CommunitySession.id == community_id
            ).first()
            if existing:
                existing.name = name
                existing.author = author
                existing.goal_preview = goal_preview
                existing.session_data = session_data
                existing.published_at = datetime.utcnow()
                existing.tags = tags or []
            else:
                cs = CommunitySession(
                    id=community_id,
                    name=name,
                    author=author,
                    goal_preview=goal_preview,
                    session_data=session_data,
                    source_browser_session=uuid.UUID(browser_session_id) if browser_session_id else None,
                    tags=tags or [],
                )
                session.add(cs)
            session.commit()
            return True
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def increment_community_clone_count(self, community_id: str):
        """Increment clone counter"""
        session = self.get_session()
        try:
            session.query(CommunitySession).filter(
                CommunitySession.id == community_id
            ).update({'clone_count': CommunitySession.clone_count + 1})
            session.commit()
        except Exception as e:
            session.rollback()
        finally:
            session.close()

    def delete_community_session(self, community_id: str):
        """Delete a community session"""
        session = self.get_session()
        try:
            session.query(CommunitySession).filter(
                CommunitySession.id == community_id
            ).delete()
            session.commit()
        except Exception as e:
            session.rollback()
            raise e
        finally:
            session.close()

    def close(self):
        """Close database connection"""
        if self.Session:
            self.Session.remove()
        if self.engine:
            self.engine.dispose()


# Global database instance
db = DB()

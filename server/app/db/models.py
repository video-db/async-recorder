from sqlalchemy import Column, Integer, String, Text, DateTime
from app.db.database import Base
from datetime import datetime

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    api_key = Column(String) # The secure VideoDB API Key
    access_token = Column(String, unique=True, index=True) # The secure UUID token

class Recording(Base):
    __tablename__ = "recordings"

    id = Column(Integer, primary_key=True, index=True)
    video_id = Column(String)
    stream_url = Column(String)
    player_url = Column(String)
    session_id = Column(String, index=True)  # For cross-referencing webhook events
    duration = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)
    # Insight fields
    insights = Column(Text, nullable=True)  # JSON string of insight bullets
    insights_status = Column(String, default="pending")  # pending, processing, ready, failed


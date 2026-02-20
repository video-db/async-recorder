from fastapi import APIRouter, HTTPException, Request, Depends, Header, BackgroundTasks
from sqlalchemy.orm import Session
from app.services.videodb import videodb_service
from app.services.insights import index_video
from app.core.config import settings
from app.db.database import get_db
from app.db.models import User, Recording
import json
import logging

router = APIRouter()
logger = logging.getLogger(__name__)

def get_current_user(x_access_token: str = Header(None), db: Session = Depends(get_db)):
    """
    Dependency to validate access_token and return the User.
    This replaces the previous simple API Key check.
    """
    if not x_access_token:
        raise HTTPException(status_code=401, detail="Missing Access Token")
    
    user = db.query(User).filter(User.access_token == x_access_token).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid Access Token")
    
    return user

@router.get("/config")
def get_server_config(user: User = Depends(get_current_user)):
    """
    Get the server's dynamic configuration.
    Secured by Access Token (UUID).
    """
    config = {
        "webhook_url": settings.WEBHOOK_URL,
        "api_port": settings.API_PORT,
    }
    if settings.VIDEODB_API_URL:
        config["backend_base_url"] = settings.VIDEODB_API_URL
    return config

@router.get("/")
def read_root():
    return {"status": "ok", "message": "Async Recorder Server Running"}

@router.post("/token")
async def generate_token(request: Request, user: User = Depends(get_current_user)):
    """
    Generate a session token for the current user.
    """
    try:
        # Use the securely stored API Key from the database
        user_api_key = user.api_key
        
        user_id = f"user-{user.id}" 
        # Ideally, read from request body if available
        try:
            body = await request.json()
            if "user_id" in body:
                user_id = body["user_id"]
        except:
            pass

        # Call service with the User's specific API Key
        token_data = videodb_service.create_session_token_with_metadata(
            user_id, 
            override_api_key=user_api_key
        )
        
        if not token_data:
            raise HTTPException(status_code=500, detail="Failed to generate session token via Recorder API")
            
        return token_data

    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Error in token endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def process_indexing_background(recording_id: int, video_id: str, api_key: str):
    """
    Background task to index a recording for search.
    Insights remain 'processing' until full insight generation is implemented.
    """
    from app.db.database import SessionLocal
    
    db = SessionLocal()
    try:
        recording = db.query(Recording).filter(Recording.id == recording_id).first()
        if not recording:
            logger.error(f"[Index BG] Recording {recording_id} not found")
            return
        
        # Update status to processing
        recording.insights_status = "processing"
        db.commit()
        logger.info(f"[Index BG] Starting indexing for recording {recording_id}")
        
        # Index the video (for searchability)
        result = index_video(video_id, api_key)
        
        if result:
            # Set to "ready" so UI knows indexing is done
            # Frontend will handle showing "Indexed & Searchable" without bullets
            recording.insights_status = "ready"
            
            transcript = result.get("transcript")
            subtitle_url = result.get("subtitle_url")

            if transcript:
                recording.insights = json.dumps({"transcript": transcript})
            
            # Update URLs with subtitled version
            if subtitle_url:
                # 1. Replace stream_url directly
                recording.stream_url = subtitle_url
                
                # 2. Update player_url by replacing the 'url=' parameter
                if recording.player_url and "url=" in recording.player_url:
                    import re
                    # Replace everything after url= up to the next & or end of string
                    updated_player_url = re.sub(r'url=[^&]+', f'url={subtitle_url}', recording.player_url)
                    recording.player_url = updated_player_url
                else:
                    # Fallback if player_url doesn't follow expected pattern
                    recording.player_url = subtitle_url

            logger.info(f"[Index BG] ✅ Indexed video {video_id} successfully")
        else:
            recording.insights_status = "failed"
            logger.warning(f"[Index BG] ❌ Failed to index video {video_id}")
        
        db.commit()
        
    except Exception as e:
        logger.exception(f"[Index BG] Error processing: {e}")
        try:
            recording = db.query(Recording).filter(Recording.id == recording_id).first()
            if recording:
                recording.insights_status = "failed"
                db.commit()
        except:
            pass
    finally:
        db.close()


@router.post("/webhook")
async def handle_webhook(request: Request, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Handle incoming webhook events from VideoDB.
    Key event: capture_session.exported - video is ready for playback.
    """
    try:
        try:
            body = await request.json()
        except Exception:
            # Handle health checks or empty requests gracefully
            return {"status": "ok", "received": True}

        event_type = body.get('event', 'unknown')
        logger.info(f"[Webhook] Event: {event_type}")

        data = body.get("data", {})
        capture_session_id = body.get("capture_session_id")

        # Handle capture_session.exported - final video is ready
        if event_type == "capture_session.exported":
            video_id = data.get("exported_video_id")
            stream_url = data.get("stream_url")
            player_url = data.get("player_url")
            session_id = capture_session_id

            if video_id:
                # Try to find existing recording by session_id
                recording = db.query(Recording).filter(Recording.session_id == session_id).first()

                if recording:
                    # Update existing recording
                    recording.video_id = video_id
                    recording.stream_url = stream_url
                    recording.player_url = player_url
                    recording.insights_status = "pending"
                    db.commit()
                    logger.info(f"[Webhook] Updated recording: {recording.video_id}")
                else:
                    # Check if already exists by video_id to avoid dupes
                    existing = db.query(Recording).filter(Recording.video_id == video_id).first()
                    if existing:
                        logger.info(f"[Webhook] Recording already exists: {existing.video_id}")
                        return {"status": "ok", "received": True}

                    # Create new recording
                    recording = Recording(
                        video_id=video_id,
                        stream_url=stream_url,
                        player_url=player_url,
                        session_id=session_id,
                        insights_status="pending"
                    )
                    db.add(recording)
                    db.commit()
                    db.refresh(recording)
                    logger.info(f"[Webhook] Created recording: {recording.video_id}")

                # Trigger video indexing in background
                # Use most recent user (handles re-registration with new API key)
                user = db.query(User).order_by(User.id.desc()).first()
                if user and user.api_key and recording.video_id:
                    background_tasks.add_task(
                        process_indexing_background,
                        recording.id,
                        recording.video_id,
                        user.api_key
                    )
                    logger.info(f"[Webhook] Scheduled indexing for recording: {recording.id}")
            else:
                logger.warning(f"[Webhook] No video_id in exported event")

        # Log other capture session events for debugging
        elif event_type.startswith("capture_session."):
            logger.debug(f"[Webhook] Capture session event: {event_type}")

        return {"status": "ok", "received": True}
    except Exception as e:
        logger.exception(f"[Webhook] Error processing: {e}")
        raise HTTPException(status_code=500, detail="Error processing webhook")

@router.get("/recordings")
def get_recordings(
    limit: int = 20,
    db: Session = Depends(get_db)
):
    """
    Get all recordings for the current user (if authed) or just all from local DB.
    Ordered by created_at desc.
    """
    recordings = db.query(Recording).order_by(Recording.created_at.desc()).limit(limit).all()
    # Serialize manually or use Pydantic model response
    return [
        {
            "id": r.id,
            "session_id": r.session_id,
            "stream_url": r.stream_url,
            "player_url": r.player_url,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "duration": r.duration,
            "insights_status": r.insights_status,
            "insights": r.insights, # Return raw insights (JSON string) for frontend to parse
        }
        for r in recordings
    ]

@router.get("/recordings/{recording_id}")
async def get_recording(recording_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Fetch a single recording with its insights.
    """
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    return {
        "id": recording.id,
        "video_id": recording.video_id,
        "stream_url": recording.stream_url,
        "player_url": recording.player_url,
        "session_id": recording.session_id,
        "duration": recording.duration,
        "insights": json.loads(recording.insights) if recording.insights else None,
        "insights_status": recording.insights_status or "pending"
    }


@router.post("/capture-session")
async def create_capture_session(request: Request, user: User = Depends(get_current_user)):
    """
    Create a new capture session on VideoDB.
    This must be called before starting a recording with the CaptureClient.

    Returns the session_id (cap-xxx) that should be passed to startCaptureSession().
    """
    try:
        user_api_key = user.api_key

        # Get optional parameters from request body
        callback_url = None
        metadata = None
        try:
            body = await request.json()
            callback_url = body.get("callback_url")
            metadata = body.get("metadata")
        except:
            pass

        # Use webhook URL from settings if not provided
        if not callback_url:
            callback_url = settings.WEBHOOK_URL

        end_user_id = f"user-{user.id}"

        logger.info(f"Creating capture session for user {end_user_id} with callback: {callback_url}")

        session_data = videodb_service.create_capture_session(
            end_user_id=end_user_id,
            callback_url=callback_url,
            metadata=metadata,
            override_api_key=user_api_key
        )

        if not session_data:
            raise HTTPException(status_code=500, detail="Failed to create capture session")

        logger.info(f"Created capture session: {session_data.get('session_id')}")
        return session_data

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Error creating capture session: {e}")
        raise HTTPException(status_code=500, detail=str(e))


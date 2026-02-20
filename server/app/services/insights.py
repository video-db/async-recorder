"""
Video Indexing Service

This service is responsible for:
1. Indexing videos in VideoDB for searchability
2. Future: Generate insights once VideoDB adds native summarization
"""
import logging
import videodb
from app.core.config import settings

logger = logging.getLogger(__name__)


def index_video(video_id: str, api_key: str) -> bool:
    """
    Index a video in VideoDB for spoken word search.
    
    Args:
        video_id: The VideoDB video ID (e.g., "m-xxx")
        api_key: The user's VideoDB API key
        
    Returns:
        True if indexing succeeded, False otherwise
    """
    try:
        logger.info(f"[Index] Starting indexing for video: {video_id}")

        # Connect to VideoDB
        connect_kwargs = {"api_key": api_key}
        if settings.VIDEODB_API_URL:
            connect_kwargs["base_url"] = settings.VIDEODB_API_URL
        conn = videodb.connect(**connect_kwargs)
        
        # Get the video
        coll = conn.get_collection()
        video = coll.get_video(video_id)
        
        if not video:
            logger.error(f"[Index] Video not found: {video_id}")
            return None
        
        # Index spoken words (enables transcript-based search)
        logger.info(f"[Index] Indexing spoken words for video: {video_id}")
        video.index_spoken_words()

        # Fetch transcript
        logger.info(f"[Index] Fetching transcript for video: {video_id}")
        try:
            transcript = video.get_transcript_text()
        except Exception as e:
            logger.warning(f"[Index] Failed to get transcript: {e}")
            transcript = None

        # Generate Subtitles
        subtitle_url = None
        try:
            from app.core.subtitle_config import LOOM_SUBTITLE_STYLE
            logger.info(f"[Index] Generating subtitles for video: {video_id}")
            # add_subtitle returns the new stream URL with burned/attached subtitles
            subtitle_url = video.add_subtitle(style=LOOM_SUBTITLE_STYLE) 
            logger.info(f"[Index] ✅ Generated subtitles: {subtitle_url}")
        except Exception as e:
            logger.warning(f"[Index] Failed to generate subtitles: {e}")

        return {
            "transcript": transcript,
            "subtitle_url": subtitle_url
        }
        
    except Exception as e:
        logger.exception(f"[Index] Failed to index video {video_id}: {e}")
        return None


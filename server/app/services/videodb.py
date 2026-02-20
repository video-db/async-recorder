import logging
from typing import Optional, Dict
from app.core.config import settings
import videodb
from videodb import AuthenticationError

logger = logging.getLogger(__name__)

class VideoDBService:
    def __init__(self):
        self.config = settings
        self._connections: Dict[str, videodb.Connection] = {}

    def _get_connection(self, api_key: str = None) -> videodb.Connection:
        """Get or create a VideoDB connection for the given API key."""
        key = api_key or self.config.API_KEY
        if not key:
            raise ValueError("No API key available")

        if key not in self._connections:
            connect_kwargs = {"api_key": key}
            if self.config.VIDEODB_API_URL:
                connect_kwargs["base_url"] = self.config.VIDEODB_API_URL
            self._connections[key] = videodb.connect(**connect_kwargs)
        return self._connections[key]

    def verify_api_key(self, api_key: str) -> bool:
        """Verify API Key validity using the VideoDB SDK."""
        try:
            connect_kwargs = {"api_key": api_key}
            if self.config.VIDEODB_API_URL:
                connect_kwargs["base_url"] = self.config.VIDEODB_API_URL
            conn = videodb.connect(**connect_kwargs)
            conn.get_collection()
            # Cache this connection for later use
            self._connections[api_key] = conn
            return True
        except AuthenticationError:
            logger.warning("SDK Authentication failed for provided key")
            return False
        except Exception as e:
            logger.error(f"SDK Verification Error: {e}")
            return False

    def create_session_token_with_metadata(
        self,
        user_id: str,
        expires_in: int = None,
        override_api_key: str = None
    ) -> Optional[Dict]:
        """
        Create a session token with full metadata using the SDK.

        Args:
            user_id: The authenticated user ID
            expires_in: Token expiry in seconds (default: 86400 = 1 day)
            override_api_key: Optional API key to use instead of the configured one.

        Returns:
            {
                "session_token": "st-xxx",
                "expires_in": 86400,
                "expires_at": 1765267937
            }
        """
        try:
            api_key = override_api_key or self.config.API_KEY
            if not api_key:
                logger.error("No API key available for token generation")
                return None

            conn = self._get_connection(api_key)

            # Use SDK method to generate client token
            token_expires_in = expires_in or 86400  # Default 24 hours

            logger.info(f"Generating client token for user: {user_id} (expires_in: {token_expires_in}s)")

            session_token = conn.generate_client_token(expires_in=token_expires_in)

            if session_token:
                import time
                expires_at = int(time.time()) + token_expires_in

                return {
                    "session_token": session_token,
                    "expires_in": token_expires_in,
                    "expires_at": expires_at
                }

            logger.error("SDK returned empty token")
            return None

        except Exception as e:
            logger.exception(f"Failed to create session token for user {user_id}: {e}")
            return None

    def create_capture_session(
        self,
        end_user_id: str,
        callback_url: str = None,
        metadata: dict = None,
        override_api_key: str = None
    ) -> Optional[Dict]:
        """
        Create a capture session using the SDK.

        Args:
            end_user_id: The end user ID
            callback_url: Optional webhook URL for callbacks
            metadata: Optional metadata dict
            override_api_key: Optional API key to use

        Returns:
            {
                "session_id": "cap-xxx",
                "status": "created",
                ...
            }
        """
        try:
            api_key = override_api_key or self.config.API_KEY
            if not api_key:
                logger.error("No API key available for capture session creation")
                return None

            conn = self._get_connection(api_key)
            coll = conn.get_collection()

            logger.info(f"Creating capture session for user: {end_user_id}")

            session = coll.create_capture_session(
                end_user_id=end_user_id,
                callback_url=callback_url,
                metadata=metadata
            )

            if session:
                return {
                    "session_id": session.id,
                    "collection_id": session.collection_id,
                    "end_user_id": session.end_user_id,
                    "status": session.status,
                    "callback_url": getattr(session, 'callback_url', callback_url),
                }

            return None

        except Exception as e:
            logger.exception(f"Failed to create capture session for user {end_user_id}: {e}")
            return None

videodb_service = VideoDBService()

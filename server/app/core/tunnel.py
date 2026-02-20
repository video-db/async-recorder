"""
Cloudflare Quick Tunnel Manager - Zero Configuration Required

Uses `pycloudflared` package which auto-downloads the cloudflared binary.
No manual installation required - just `pip install pycloudflared`.
"""

import logging
import time
import json
from pathlib import Path
from app.core.config import settings

logger = logging.getLogger(__name__)


class TunnelManager:
    """Manages Cloudflare Quick Tunnel lifecycle - zero configuration required."""

    _tunnel = None
    _public_url: str = None

    @classmethod
    def start(cls, port: int = None) -> str:
        """
        Starts Cloudflare Quick Tunnel. Returns webhook URL or None.

        Quick tunnels require NO authentication - just works out of the box.
        The cloudflared binary is auto-downloaded by pycloudflared on first use.
        """
        # If WEBHOOK_URL is already set (e.g., via ENV for production), skip tunnel
        if settings.WEBHOOK_URL:
            logger.info(f"Webhook URL configured via ENV: {settings.WEBHOOK_URL}")
            cls.write_runtime_config()
            return settings.WEBHOOK_URL

        port = port or settings.API_PORT

        try:
            from pycloudflared import try_cloudflare

            logger.info(f"Starting Cloudflare tunnel for port {port}...")

            # Start tunnel - pycloudflared handles binary download and process management
            cls._tunnel = try_cloudflare(port=port)
            cls._public_url = cls._tunnel.tunnel

            if cls._public_url:
                settings.WEBHOOK_URL = f"{cls._public_url}/api/webhook"
                logger.info(f"Cloudflare Tunnel: {cls._public_url} -> localhost:{port}")
                cls.write_runtime_config()
                return settings.WEBHOOK_URL
            else:
                logger.error("Failed to get tunnel URL")
                cls.write_runtime_config()
                return None

        except ImportError:
            logger.error("pycloudflared package not installed. Run: pip install pycloudflared")
            cls.write_runtime_config()
            return None
        except Exception as e:
            logger.error(f"Tunnel failed: {e}")
            cls.write_runtime_config()
            return None

    @classmethod
    def stop(cls):
        """Stops the current tunnel."""
        if cls._tunnel:
            try:
                # pycloudflared tunnel objects have a terminate method
                if hasattr(cls._tunnel, 'terminate'):
                    cls._tunnel.terminate()
                elif hasattr(cls._tunnel, 'kill'):
                    cls._tunnel.kill()
            except Exception as e:
                logger.debug(f"Error stopping tunnel: {e}")
            finally:
                cls._tunnel = None
        cls._public_url = None

    @classmethod
    def is_running(cls) -> bool:
        """Check if tunnel is running."""
        return cls._tunnel is not None and cls._public_url is not None

    @classmethod
    def get_url(cls) -> str:
        """Get current tunnel URL."""
        return cls._public_url

    @classmethod
    def write_runtime_config(cls):
        """Writes runtime.json for Electron discovery."""
        try:
            project_root = Path(__file__).parent.parent.parent.parent
            runtime_file = project_root / "runtime.json"

            runtime_config = {
                "api_url": f"http://localhost:{settings.API_PORT}",
                "webhook_url": settings.WEBHOOK_URL,
                "tunnel_provider": "cloudflare",
                "updated_at": int(time.time() * 1000)
            }

            with open(runtime_file, "w") as f:
                json.dump(runtime_config, f, indent=2)
            logger.info(f"Runtime config written: {runtime_file}")

        except Exception as e:
            logger.error(f"Runtime config write failed: {e}")

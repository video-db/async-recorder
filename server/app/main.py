from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router as api_router
from app.api.endpoints.auth import router as auth_router
from app.core.config import settings
from app.db.database import Base, engine
from app.db.models import User, Recording
import logging
from app.core.tunnel import TunnelManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s:     %(name)s - %(message)s'
)
logging.getLogger("app").setLevel(logging.INFO)

# Create Tables
Base.metadata.create_all(bind=engine)

def create_app() -> FastAPI:
    app = FastAPI(title="Async Recorder Server")

    # Enable CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Lifecycle Events
    @app.on_event("startup")
    async def startup_event():
        # Tunnel starts automatically - no user config needed
        result = TunnelManager.start()
        if result:
            logging.info(f"Tunnel ready: {result}")
        else:
            logging.warning("Tunnel failed to start. Webhooks may not work.")

    @app.on_event("shutdown")
    async def shutdown_event():
        TunnelManager.stop()

    # Include Routes
    app.include_router(api_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")

    # Simplified tunnel status endpoint
    @app.get("/api/tunnel/status")
    def get_tunnel_status():
        """Returns current tunnel status."""
        return {
            "active": TunnelManager.is_running(),
            "webhook_url": settings.WEBHOOK_URL,
            "provider": "cloudflare"
        }

    return app

app = create_app()

import uvicorn
from app.core.config import settings
import os
import sys
from app.core.config import settings

if __name__ == "__main__":
    # Tunnel initialization is handled by TunnelManager in app/main.py (startup event)
    
    print(f"🚀 Starting Server on port {settings.API_PORT}")

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.API_PORT, reload=True)

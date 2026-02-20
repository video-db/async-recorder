import os
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    API_PORT: int = int(os.getenv("API_PORT", 8000))
    # VideoDB API URL - only set for dev override, SDK uses prod by default
    VIDEODB_API_URL: Optional[str] = os.getenv("VIDEODB_API_URL")
    CLIENT_ID: str = os.getenv("CLIENT_ID", "async-recorder-client")
    WEBHOOK_URL: Optional[str] = None
    API_KEY: Optional[str] = os.getenv("API_KEY")

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
        case_sensitive=False
    )

settings = Settings()

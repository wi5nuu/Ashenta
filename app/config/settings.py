"""Application settings loaded from environment variables."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Application
    app_env: str = "development"
    app_secret_key: str = "change-this-to-a-long-random-secret-key-min-32-chars"
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    # Database
    database_url: str = "postgresql://ashenta:ashenta_pass@localhost:5432/ashenta_db"

    # Security
    jwt_secret_key: str = "change-this-jwt-secret-key-min-32-chars"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60
    jwt_refresh_token_expire_days: int = 30

    # Credential encryption
    credential_encryption_key: str = ""

    # Telegram
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # Stream
    stream_token_expire_seconds: int = 3600

    # YOLO
    yolo_model_path: str = "yolov8n.pt"

    # Logging
    log_level: str = "INFO"


@lru_cache()
def get_settings() -> Settings:
    return Settings()

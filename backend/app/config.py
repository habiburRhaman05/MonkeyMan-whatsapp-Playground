"""Application settings loaded from environment / .env file."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Evolution API
    evolution_api_url: str = "http://localhost:8080"
    evolution_api_key: str = "change-me"

    # Webhook
    webhook_secret: str = "change-me"
    webhook_base_url: str = "http://host.docker.internal:8000"

    # Database
    database_url: str = "sqlite:///./data/app.db"

    # CORS
    frontend_origin: str = "http://localhost:3001"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()

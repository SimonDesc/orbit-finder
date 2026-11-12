from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables (or a local .env file)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # LLM via OpenRouter (OpenAI-compatible API). The model is swappable without code changes.
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    llm_model: str = "mistralai/mistral-small-2603"

    # Public data sources
    stac_url: str = "https://earth-search.aws.element84.com/v1"
    stac_collection: str = "sentinel-2-l2a"
    celestrak_url: str = "https://celestrak.org/NORAD/elements/gp.php"
    celestrak_name: str = "SENTINEL-2"  # matches Sentinel-2A/2B/2C
    nominatim_url: str = "https://nominatim.openstreetmap.org/search"
    user_agent: str = "orbit-finder-demo/0.1"

    # Built frontend served by FastAPI in production (single container).
    static_dir: Path = Path(__file__).resolve().parent.parent / "static"


@lru_cache
def get_settings() -> Settings:
    return Settings()

from functools import lru_cache

from openai import AsyncOpenAI

from app.config import get_settings


@lru_cache
def get_llm_client() -> AsyncOpenAI:
    """OpenRouter exposes an OpenAI-compatible API, so the official OpenAI SDK works as-is."""
    s = get_settings()
    return AsyncOpenAI(
        api_key=s.openrouter_api_key,
        base_url=s.openrouter_base_url,
        default_headers={"X-Title": "Orbit Finder"},
    )

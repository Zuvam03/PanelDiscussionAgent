"""Provider selection is config (env), not code — PRD §5."""

from __future__ import annotations

from ..config import env
from .base import LLMProvider
from .http_llm import AnthropicProvider, GeminiProvider, GroqProvider
from .mock_llm import MockLLMProvider


def _build(choice: str) -> LLMProvider:
    anthropic_key = env("ANTHROPIC_API_KEY")
    groq_key = env("GROQ_API_KEY")
    gemini_key = env("GEMINI_API_KEY")

    if choice == "anthropic" or (choice == "auto" and anthropic_key):
        if not anthropic_key:
            raise RuntimeError("PANELPREP_LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set")
        return AnthropicProvider(anthropic_key, env("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"))
    if choice == "gemini" or (choice == "auto" and gemini_key):
        if not gemini_key:
            raise RuntimeError("PANELPREP_LLM_PROVIDER=gemini but GEMINI_API_KEY is not set")
        return GeminiProvider(gemini_key, env("GEMINI_MODEL", "gemini-3.5-flash"))
    if choice == "groq" or (choice == "auto" and groq_key):
        if not groq_key:
            raise RuntimeError("PANELPREP_LLM_PROVIDER=groq but GROQ_API_KEY is not set")
        return GroqProvider(groq_key, env("GROQ_MODEL", "llama-3.3-70b-versatile"))
    return MockLLMProvider()


def get_live_provider() -> LLMProvider:
    return _build(env("PANELPREP_LLM_PROVIDER", "auto") or "auto")


def get_analysis_provider() -> LLMProvider:
    choice = env("PANELPREP_ANALYSIS_PROVIDER", "auto") or "auto"
    if choice == "gemini" or (choice == "auto" and env("GEMINI_API_KEY")):
        key = env("GEMINI_API_KEY")
        if not key:
            raise RuntimeError("PANELPREP_ANALYSIS_PROVIDER=gemini but GEMINI_API_KEY is not set")
        model = env("GEMINI_ANALYSIS_MODEL", env("GEMINI_MODEL", "gemini-3.5-flash"))
        return GeminiProvider(key, model)
    return _build(choice)

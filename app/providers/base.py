"""Provider interfaces. Every external model sits behind one of these so a
free→paid swap is a config change, not a rewrite (PRD §5).

Phase 0 only exercises LLMProvider; the voice/emotion interfaces are declared
now so Phases 1-3 slot in without touching the orchestrator."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional

from pydantic import BaseModel


class AgentReply(BaseModel):
    """Structured turn from an agent LLM call."""
    move: str = "new_point"
    text: str
    target: Optional[str] = None


class LLMProvider(ABC):
    name: str = "base"

    @abstractmethod
    async def agent_turn(
        self,
        system_prompt: str,
        conversation: str,
        instruction: str,
    ) -> AgentReply:
        """Generate one agent turn. Implementations must return structured
        {move, text, target} — parsing/fallback is the implementation's job."""

    @abstractmethod
    async def complete(self, system_prompt: str, user_prompt: str, max_tokens: int = 2000) -> str:
        """Plain completion, used for analysis/report generation."""


# ---- Declared for later phases (Phase 1+); intentionally unimplemented. ----

class STTProvider(ABC):
    @abstractmethod
    async def stream_transcribe(self, audio_chunks: AsyncIterator[bytes]) -> AsyncIterator[str]: ...


class TTSProvider(ABC):
    @abstractmethod
    async def stream_speak(self, text_chunks: AsyncIterator[str], voice: str) -> AsyncIterator[bytes]: ...


class EmotionProvider(ABC):
    @abstractmethod
    async def analyze(self, audio_path: str) -> list[dict]: ...

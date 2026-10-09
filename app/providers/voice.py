"""Voice providers — pluggable STT and TTS backends.

The browser-side Web Speech API is the zero-config default, but quality
is inconsistent. These server-side providers offer better quality at the
cost of API keys.

Supported STT: OpenAI Whisper API, Deepgram Nova-2, Groq Whisper
Supported TTS: OpenAI TTS-1, Deepgram Aura
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Optional

from pydantic import BaseModel

log = logging.getLogger(__name__)


class TranscriptionResult(BaseModel):
    text: str
    language: str = "en"
    confidence: float = 1.0


class SynthesisResult(BaseModel):
    audio: bytes
    content_type: str = "audio/mp3"


class STTProvider(ABC):
    name: str = "base_stt"

    @abstractmethod
    async def transcribe(self, audio_data: bytes, content_type: str = "audio/webm") -> TranscriptionResult:
        """Transcribe audio bytes to text."""


class TTSProvider(ABC):
    name: str = "base_tts"

    @abstractmethod
    async def synthesize(self, text: str, voice: str = "default") -> SynthesisResult:
        """Synthesize text to audio bytes."""


# ---- Implementations ----

class WhisperSTT(STTProvider):
    """OpenAI Whisper API for speech-to-text."""
    name = "whisper"

    def __init__(self, api_key: str, model: str = "whisper-1"):
        self.api_key = api_key
        self.model = model

    async def transcribe(self, audio_data: bytes, content_type: str = "audio/webm") -> TranscriptionResult:
        import httpx
        ext = "webm" if "webm" in content_type else "wav" if "wav" in content_type else "mp3"
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                files={"file": (f"audio.{ext}", audio_data, content_type)},
                data={"model": self.model, "response_format": "json"},
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            return TranscriptionResult(text=data["text"])


class GroqWhisperSTT(STTProvider):
    """Groq-hosted Whisper Large v3 for fast speech-to-text."""
    name = "groq_whisper"

    def __init__(self, api_key: str, model: str = "whisper-large-v3"):
        self.api_key = api_key
        self.model = model

    async def transcribe(self, audio_data: bytes, content_type: str = "audio/webm") -> TranscriptionResult:
        import httpx
        ext = "webm" if "webm" in content_type else "wav" if "wav" in content_type else "mp3"
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                files={"file": (f"audio.{ext}", audio_data, content_type)},
                data={"model": self.model, "response_format": "json"},
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            return TranscriptionResult(text=data["text"])


class DeepgramSTT(STTProvider):
    """Deepgram Nova-2 for speech-to-text. Has a generous free tier."""
    name = "deepgram"

    def __init__(self, api_key: str, model: str = "nova-2"):
        self.api_key = api_key
        self.model = model

    async def transcribe(self, audio_data: bytes, content_type: str = "audio/webm") -> TranscriptionResult:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://api.deepgram.com/v1/listen?model={self.model}&language=en",
                headers={
                    "Authorization": f"Token {self.api_key}",
                    "Content-Type": content_type,
                },
                content=audio_data,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            alt = data["results"]["channels"][0]["alternatives"][0]
            return TranscriptionResult(
                text=alt["transcript"],
                confidence=alt.get("confidence", 1.0),
            )


class OpenAITTS(TTSProvider):
    """OpenAI TTS-1 for text-to-speech."""
    name = "openai_tts"

    VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]

    def __init__(self, api_key: str, model: str = "tts-1"):
        self.api_key = api_key
        self.model = model

    async def synthesize(self, text: str, voice: str = "alloy") -> SynthesisResult:
        import httpx
        if voice not in self.VOICES:
            voice = "alloy"
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.openai.com/v1/audio/speech",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": self.model, "input": text, "voice": voice},
                timeout=30,
            )
            resp.raise_for_status()
            return SynthesisResult(audio=resp.content, content_type="audio/mp3")


class DeepgramTTS(TTSProvider):
    """Deepgram Aura for text-to-speech."""
    name = "deepgram_tts"

    VOICES = [
        "aura-asteria-en", "aura-luna-en", "aura-stella-en",
        "aura-athena-en", "aura-hera-en", "aura-orion-en",
        "aura-arcas-en", "aura-perseus-en", "aura-angus-en",
        "aura-orpheus-en", "aura-helios-en", "aura-zeus-en",
    ]

    def __init__(self, api_key: str):
        self.api_key = api_key

    async def synthesize(self, text: str, voice: str = "aura-asteria-en") -> SynthesisResult:
        import httpx
        if voice not in self.VOICES:
            voice = "aura-asteria-en"
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"https://api.deepgram.com/v1/speak?model={voice}",
                headers={
                    "Authorization": f"Token {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={"text": text},
                timeout=30,
            )
            resp.raise_for_status()
            return SynthesisResult(audio=resp.content, content_type="audio/mp3")


# ---- Factory ----

def get_stt_provider() -> Optional[STTProvider]:
    """Get configured STT provider, or None for browser-side fallback."""
    from ..config import env
    provider = env("STT_PROVIDER", "browser")
    if provider == "browser":
        return None

    if provider == "whisper":
        key = env("OPENAI_API_KEY")
        return WhisperSTT(key) if key else None
    if provider == "groq_whisper":
        key = env("GROQ_API_KEY")
        return GroqWhisperSTT(key) if key else None
    if provider == "deepgram":
        key = env("DEEPGRAM_API_KEY")
        return DeepgramSTT(key) if key else None
    return None


def get_tts_provider() -> Optional[TTSProvider]:
    """Get configured TTS provider, or None for browser-side fallback."""
    from ..config import env
    provider = env("TTS_PROVIDER", "browser")
    if provider == "browser":
        return None

    if provider == "openai_tts":
        key = env("OPENAI_API_KEY")
        return OpenAITTS(key) if key else None
    if provider == "deepgram_tts":
        key = env("DEEPGRAM_API_KEY")
        return DeepgramTTS(key) if key else None
    return None

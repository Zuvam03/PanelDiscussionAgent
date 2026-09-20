"""Real LLM providers over plain HTTP (no vendor SDKs to keep deps thin).

AnthropicProvider — Claude, used for quality (analysis, or live if chosen).
GroqProvider      — OpenAI-compatible fast inference for low-latency live turns.
GeminiProvider    — Google Gemini, free tier available including Flash models.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re

import httpx

from .base import AgentReply, LLMProvider

log = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(30.0, connect=10.0)


def _parse_agent_json(raw: str) -> AgentReply:
    """Extract {move, text, target} from a model response, tolerating fences
    and stray prose. Falls back to treating the whole response as text."""
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group(0))
            text = str(data.get("text", "")).strip()
            if text:
                return AgentReply(
                    move=str(data.get("move", "new_point")),
                    text=text,
                    target=(str(data["target"]) if data.get("target") else None),
                )
        except (json.JSONDecodeError, TypeError):
            pass
    return AgentReply(move="new_point", text=raw.strip())


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, api_key: str, model: str = "claude-haiku-4-5-20251001"):
        self.api_key = api_key
        self.model = model

    async def _call(self, system_prompt: str, user_content: str, max_tokens: int) -> str:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": self.model,
                    "max_tokens": max_tokens,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user_content}],
                },
            )
            resp.raise_for_status()
            data = resp.json()
        return "".join(b.get("text", "") for b in data.get("content", []))

    async def agent_turn(self, system_prompt: str, conversation: str, instruction: str) -> AgentReply:
        raw = await self._call(system_prompt, f"{conversation}\n\n{instruction}", 400)
        return _parse_agent_json(raw)

    async def complete(self, system_prompt: str, user_prompt: str, max_tokens: int = 2000) -> str:
        return await self._call(system_prompt, user_prompt, max_tokens)


class GroqProvider(LLMProvider):
    name = "groq"

    def __init__(self, api_key: str, model: str = "llama-3.3-70b-versatile"):
        self.api_key = api_key
        self.model = model

    async def _call(self, system_prompt: str, user_content: str, max_tokens: int) -> str:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "max_tokens": max_tokens,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                },
            )
            resp.raise_for_status()
            data = resp.json()
        return data["choices"][0]["message"]["content"] or ""

    async def agent_turn(self, system_prompt: str, conversation: str, instruction: str) -> AgentReply:
        raw = await self._call(system_prompt, f"{conversation}\n\n{instruction}", 400)
        return _parse_agent_json(raw)

    async def complete(self, system_prompt: str, user_prompt: str, max_tokens: int = 2000) -> str:
        return await self._call(system_prompt, user_prompt, max_tokens)


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self, api_key: str, model: str = "gemini-3.5-flash"):
        self.api_key = api_key
        self.model = model

    async def _call(self, system_prompt: str, user_content: str, max_tokens: int) -> str:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/"
            f"models/{self.model}:generateContent"
        )
        budget = max_tokens * 3
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": user_content}]}],
            "generationConfig": {"maxOutputTokens": budget},
        }
        headers = {"x-goog-api-key": self.api_key, "content-type": "application/json"}

        models_to_try = [self.model]
        if self.model != "gemini-3.5-flash-lite" and "-lite" not in self.model:
            models_to_try.append(self.model + "-lite" if not self.model.endswith("-lite") else self.model)
            if "gemini-3.5-flash-lite" not in models_to_try:
                models_to_try.append("gemini-3.5-flash-lite")

        for model in models_to_try:
            model_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            last_err = None
            for attempt in range(3):
                if attempt > 0:
                    wait = 5 * (2 ** (attempt - 1))
                    log.info("Gemini 429 on %s — retrying in %ds (attempt %d/3)", model, wait, attempt + 1)
                    await asyncio.sleep(wait)
                async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                    resp = await client.post(model_url, headers=headers, json=payload)
                    if resp.status_code == 429:
                        last_err = resp
                        continue
                    resp.raise_for_status()
                    data = resp.json()
                candidates = data.get("candidates", [])
                if not candidates:
                    return ""
                parts = candidates[0].get("content", {}).get("parts", [])
                if model != self.model:
                    log.info("Gemini fallback: used %s instead of %s", model, self.model)
                return "".join(p.get("text", "") for p in parts)
            log.warning("Gemini %s exhausted retries, trying next model", model)

        last_err.raise_for_status()

    async def agent_turn(self, system_prompt: str, conversation: str, instruction: str) -> AgentReply:
        raw = await self._call(system_prompt, f"{conversation}\n\n{instruction}", 400)
        return _parse_agent_json(raw)

    async def complete(self, system_prompt: str, user_prompt: str, max_tokens: int = 2000) -> str:
        return await self._call(system_prompt, user_prompt, max_tokens)

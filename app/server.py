"""FastAPI server — the single entry point for the Phase 0 web app.

Endpoints:
  GET  /api/config          → mode config, topic list, persona list
  POST /api/sessions        → create a new session
  POST /api/sessions/{id}/start → move to LIVE
  POST /api/sessions/{id}/message → student sends a message
  POST /api/sessions/{id}/tick    → silence-tick (frontend polls)
  POST /api/sessions/{id}/end    → force-end the session
  GET  /api/sessions/{id}        → full session state
  GET  /api/sessions/{id}/report → post-session report
  GET  /api/sessions              → session history list
  DELETE /api/sessions/{id}      → delete session & data
"""

from __future__ import annotations

import random
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .analysis.report import generate_report
from .config import load_mode, load_personas
from .models import Session, SessionStatus
from .orchestrator.engine import Orchestrator
from .providers.factory import get_analysis_provider, get_live_provider
from .storage.db import SessionRepository

app = FastAPI(title="PanelPrep", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

repo = SessionRepository()

_live: dict[str, tuple[Session, Orchestrator]] = {}


def _get_live(session_id: str) -> tuple[Session, Orchestrator]:
    if session_id in _live:
        return _live[session_id]
    session = repo.get(session_id)
    if session is None:
        raise HTTPException(404, "session not found")
    mode = load_mode(session.mode)
    provider = get_live_provider()
    orch = Orchestrator(mode, provider)
    _live[session_id] = (session, orch)
    return session, orch


# ----------------------------------------------------------------- schemas

class CreateSessionRequest(BaseModel):
    mode: str = "gd"
    topic: Optional[str] = None
    persona_names: Optional[list[str]] = None
    duration_minutes: Optional[float] = None
    num_agents: Optional[int] = None

class MessageRequest(BaseModel):
    text: str

# -------------------------------------------------------------------- routes

@app.get("/api/config")
def get_config():
    mode = load_mode("gd")
    personas = load_personas()
    return {
        "mode": mode.model_dump(),
        "personas": {k: v.model_dump() for k, v in personas.items()},
    }


@app.post("/api/sessions")
def create_session(req: CreateSessionRequest):
    mode = load_mode(req.mode)
    personas = load_personas()
    names = list(personas.keys())

    chosen = req.persona_names
    if not chosen:
        n = req.num_agents or mode.defaults.num_agents
        chosen = random.sample(names, min(n, len(names)))

    topic = req.topic or random.choice(mode.topics)
    duration = req.duration_minutes or mode.defaults.duration_minutes

    provider = get_live_provider()
    session = Session(
        mode=req.mode,
        topic=topic,
        persona_names=chosen,
        duration_minutes=duration,
        thinking_seconds=mode.defaults.thinking_seconds,
        llm_provider=provider.name,
    )
    repo.save(session)
    return session.model_dump()


@app.post("/api/sessions/{session_id}/start")
async def start_session(session_id: str):
    session, orch = _get_live(session_id)
    if session.status != SessionStatus.CREATED:
        raise HTTPException(400, f"session is {session.status.value}, cannot start")
    orch.start(session)
    repo.save(session)
    return {"status": session.status.value}


@app.post("/api/sessions/{session_id}/message")
async def post_message(session_id: str, req: MessageRequest):
    session, orch = _get_live(session_id)
    if session.status not in (SessionStatus.LIVE, SessionStatus.WRAPPING):
        raise HTTPException(400, f"session is {session.status.value}, cannot accept messages")
    new_turns = await orch.on_student_message(session, req.text)
    repo.save(session)
    return {
        "new_turns": [t.model_dump() for t in new_turns],
        "status": session.status.value,
    }


@app.post("/api/sessions/{session_id}/tick")
async def tick(session_id: str):
    session, orch = _get_live(session_id)
    if session.status not in (SessionStatus.LIVE, SessionStatus.WRAPPING):
        return {"new_turns": [], "status": session.status.value}
    new_turns = await orch.on_tick(session)
    repo.save(session)
    return {
        "new_turns": [t.model_dump() for t in new_turns],
        "status": session.status.value,
    }


@app.post("/api/sessions/{session_id}/end")
async def end_session(session_id: str):
    session, orch = _get_live(session_id)
    orch.end(session)
    repo.save(session)
    _live.pop(session_id, None)
    return {"status": session.status.value}


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    session = repo.get(session_id)
    if session is None:
        raise HTTPException(404, "session not found")
    return session.model_dump()


@app.get("/api/sessions/{session_id}/report")
async def get_report(session_id: str, regenerate: bool = False):
    if not regenerate:
        existing = repo.get_report(session_id)
        if existing and existing.coaching is not None:
            return existing.model_dump()
    session = repo.get(session_id)
    if session is None:
        raise HTTPException(404, "session not found")
    if session.status != SessionStatus.ENDED:
        raise HTTPException(400, "session has not ended yet")
    personas = {k: v.model_dump() for k, v in load_personas().items()}
    analysis_provider = get_analysis_provider()
    report = await generate_report(session, analysis_provider, personas)
    repo.save_report(session_id, report)
    return report.model_dump()


@app.get("/api/sessions")
def list_sessions():
    return repo.list_summaries()


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    _live.pop(session_id, None)
    if not repo.delete(session_id):
        raise HTTPException(404, "session not found")
    return {"deleted": True}


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if FRONTEND_DIR.is_dir():
    @app.get("/")
    async def serve_index():
        return FileResponse(FRONTEND_DIR / "index.html")

    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

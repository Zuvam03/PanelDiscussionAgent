"""FastAPI server — the single entry point for the web app.

Endpoints:
  GET  /api/config          → mode config, topic list, persona list
  GET  /api/modes           → all available modes with full config
  POST /api/sessions        → create a new session (supports all modes)
  POST /api/sessions/{id}/start → move to LIVE
  POST /api/sessions/{id}/message → student sends a message
  POST /api/sessions/{id}/tick    → silence-tick (frontend polls)
  POST /api/sessions/{id}/end    → force-end the session
  GET  /api/sessions/{id}        → full session state
  GET  /api/sessions/{id}/report → post-session report
  POST /api/sessions/{id}/judge  → submit human judge scores
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
from .config import load_mode, load_all_modes, load_personas
from .models import (
    JudgeScore,
    NationAssignment,
    RoleAssignment,
    Session,
    SessionStatus,
    VoteState,
)
from .orchestrator.engine import Orchestrator
from .providers.factory import get_analysis_provider, get_live_provider
from .storage.db import SessionRepository

app = FastAPI(title="PanelPrep", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

repo = SessionRepository()

_live: dict[str, tuple[Session, Orchestrator]] = {}


def _quota_info(session: Session) -> dict:
    used: dict[str, int] = {}
    for t in session.turns:
        used[t.speaker] = used.get(t.speaker, 0) + len(t.text.split())
    return {"limit": session.word_quota, "used": used}


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
    student_nation: Optional[str] = None
    student_role: Optional[str] = None
    student_side: Optional[str] = None

class MessageRequest(BaseModel):
    text: str

class JudgeScoreRequest(BaseModel):
    judge_id: str
    speaker: str
    category: str
    score: float
    comment: str = ""

class JudgeSubmitRequest(BaseModel):
    judge_id: str
    scores: list[JudgeScoreRequest]

# -------------------------------------------------------------------- routes

@app.get("/api/modes")
def get_modes():
    modes = load_all_modes()
    return {name: m.model_dump() for name, m in modes.items()}


@app.get("/api/config")
def get_config(mode: str = "gd"):
    m = load_mode(mode)
    personas = load_personas()
    return {
        "mode": m.model_dump(),
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
        word_quota=mode.defaults.word_quota,
    )

    if req.mode == "mun" and mode.nations:
        available_nations = list(mode.nations)
        rng = random.Random()
        rng.shuffle(available_nations)
        if req.student_nation:
            session.student_nation = req.student_nation
            available_nations = [n for n in available_nations if n.name != req.student_nation]
        for i, agent_name in enumerate(chosen):
            if i < len(available_nations):
                nc = available_nations[i]
                session.nation_assignments.append(NationAssignment(
                    speaker=agent_name, nation=nc.name, code=nc.code, interests=nc.interests,
                ))

    elif req.mode == "parliamentary" and mode.roles:
        sides = list(mode.roles.keys())
        if req.student_side and req.student_role:
            session.student_side = req.student_side
            session.student_role = req.student_role
        all_roles = []
        for side_name, role_list in mode.roles.items():
            for rc in role_list:
                all_roles.append((side_name, rc))
        random.shuffle(all_roles)
        assigned = 0
        for agent_name in chosen:
            if assigned < len(all_roles):
                side_name, rc = all_roles[assigned]
                session.role_assignments.append(RoleAssignment(
                    speaker=agent_name, side=side_name, title=rc.title, code=rc.code,
                ))
                assigned += 1

    if mode.vote_mechanics and mode.vote_mechanics.influence_tracking:
        vm = mode.vote_mechanics
        all_speakers = list(chosen) + ["student"]
        split = vm.starting_split
        if split is None:
            per_speaker = vm.audience_size / len(all_speakers)
            scores = {s: round(per_speaker, 1) for s in all_speakers}
        else:
            scores = {s: float(split) for s in all_speakers}
        session.vote_state = VoteState(
            audience_size=vm.audience_size, scores=scores,
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
        "quota": _quota_info(session),
    }


@app.post("/api/sessions/{session_id}/tick")
async def tick(session_id: str):
    session, orch = _get_live(session_id)
    if session.status not in (SessionStatus.LIVE, SessionStatus.WRAPPING):
        return {"new_turns": [], "status": session.status.value, "quota": _quota_info(session)}
    new_turns = await orch.on_tick(session)
    repo.save(session)
    return {
        "new_turns": [t.model_dump() for t in new_turns],
        "status": session.status.value,
        "quota": _quota_info(session),
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
    mode = load_mode(session.mode)
    personas = {k: v.model_dump() for k, v in load_personas().items()}
    analysis_provider = get_analysis_provider()
    report = await generate_report(session, mode, analysis_provider, personas)
    repo.save_report(session_id, report)
    return report.model_dump()


@app.post("/api/sessions/{session_id}/judge")
def submit_judge_scores(session_id: str, req: JudgeSubmitRequest):
    session = repo.get(session_id)
    if session is None:
        raise HTTPException(404, "session not found")
    if session.status != SessionStatus.ENDED:
        raise HTTPException(400, "session must be ended before judging")
    for s in req.scores:
        session.judge_scores.append(JudgeScore(
            judge_id=req.judge_id,
            judge_type="human",
            speaker=s.speaker,
            category=s.category,
            score=max(0, min(s.score, 10)),
            comment=s.comment,
        ))
    repo.save(session)
    return {"accepted": len(req.scores), "total_scores": len(session.judge_scores)}


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

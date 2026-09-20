"""Domain models. The event log is a first-class structure per the PRD:
the prescriptive report is built from it, not from re-parsing transcripts."""

from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


def new_id() -> str:
    return uuid.uuid4().hex[:12]


class Move(str, Enum):
    OPEN = "open"
    NEW_POINT = "new_point"
    BUILD = "build"
    DISAGREE = "disagree"
    QUESTION = "question"
    SUMMARY = "summary"
    REDIRECT = "redirect"
    INTERRUPT = "interrupt"


class EventType(str, Enum):
    SESSION_START = "session_start"
    SELF_INTRO = "self_intro"
    NEW_POINT = "new_point"
    BUILD_ON = "build_on"
    DISAGREEMENT = "disagreement"
    QUESTION = "question"
    SUMMARY = "summary"
    TOPIC_REDIRECT = "topic_redirect"
    INTERRUPTION = "interruption"
    FLOOR_GRAB = "floor_grab"
    STUDENT_SILENCE = "student_silence"
    WRAP_UP = "wrap_up"
    SESSION_END = "session_end"


class Persona(BaseModel):
    name: str
    archetype: str
    display: str
    stance_bias: str
    assertiveness: float
    verbosity: float
    interruption_propensity: float
    agreeableness: float
    style: str


class Turn(BaseModel):
    id: str = Field(default_factory=new_id)
    seq: int
    speaker: str                      # "student" or persona name
    text: str
    move: Optional[Move] = None
    target: Optional[str] = None      # who this turn addresses, if anyone
    at: float = Field(default_factory=time.time)  # unix ts


class Event(BaseModel):
    id: str = Field(default_factory=new_id)
    type: EventType
    actor: str
    target: Optional[str] = None
    detail: str = ""
    turn_id: Optional[str] = None
    at: float = Field(default_factory=time.time)


class SessionStatus(str, Enum):
    CREATED = "created"
    THINKING = "thinking"
    LIVE = "live"
    WRAPPING = "wrapping"
    ENDED = "ended"


class Session(BaseModel):
    id: str = Field(default_factory=new_id)
    mode: str = "gd"
    topic: str
    persona_names: list[str]
    duration_minutes: float
    thinking_seconds: int
    status: SessionStatus = SessionStatus.CREATED
    created_at: float = Field(default_factory=time.time)
    started_at: Optional[float] = None
    ended_at: Optional[float] = None
    turns: list[Turn] = Field(default_factory=list)
    events: list[Event] = Field(default_factory=list)
    silence_ticks: int = 0            # consecutive ticks without student input
    llm_provider: str = "mock"
    word_quota: int = 250             # max words per speaker

    def elapsed(self) -> float:
        if self.started_at is None:
            return 0.0
        end = self.ended_at or time.time()
        return end - self.started_at

    def next_seq(self) -> int:
        return len(self.turns)


class SpeakerMetrics(BaseModel):
    speaker: str
    turns: int = 0
    words: int = 0
    word_share: float = 0.0
    questions: int = 0
    disagreements: int = 0
    builds: int = 0
    interruptions_given: int = 0
    interruptions_received: int = 0


class PointEvaluation(BaseModel):
    turn_seq: int
    speaker: str
    excerpt: str
    strength: str                     # "strong", "moderate", "weak"
    what_worked: str
    what_didnt: str
    comparison: str                   # how it stacked up against the group


class MissedOpportunity(BaseModel):
    after_turn_seq: int
    context: str
    what_student_could_have_said: str
    why_it_matters: str


class KeyMoment(BaseModel):
    turn_seq: int
    label: str                        # e.g. "Comeback", "Dominated", "Lost the floor"
    commentary: str


class CoachingAnalysis(BaseModel):
    overall_narrative: str
    point_evaluations: list[PointEvaluation] = Field(default_factory=list)
    missed_opportunities: list[MissedOpportunity] = Field(default_factory=list)
    key_moments: list[KeyMoment] = Field(default_factory=list)
    judge_verdict: str                # one-paragraph final verdict


class Report(BaseModel):
    session_id: str
    generated_at: float = Field(default_factory=time.time)
    generated_by: str = "rules"       # "rules" or provider name
    metrics: list[SpeakerMetrics]
    structural_markers: dict[str, bool]
    event_counts: dict[str, int]
    longest_student_silence_s: float = 0.0
    swot: dict[str, list[str]]        # strengths/weaknesses/opportunities/threats
    next_actions: list[str]
    coaching: Optional[CoachingAnalysis] = None

"""Loads mode and persona configs from YAML. Modes are pure config so a new
mode (debate, MUN, impromptu) is a new file, not a code change."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel

from .models import Persona

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"

load_dotenv(ROOT / ".env")


class TurnTakingConfig(BaseModel):
    max_agent_turns_per_burst: int = 2
    floor_threshold: float = 0.35
    silence_tick_seconds: int = 8
    silence_event_after_ticks: int = 3
    chime_in_chance: float = 0.45


class ModeDefaults(BaseModel):
    num_agents: int = 4
    duration_minutes: float = 8
    thinking_seconds: int = 45
    wrap_up_fraction: float = 0.85
    word_quota: int = 250


class ScoringCategory(BaseModel):
    name: str
    weight: float
    description: str = ""


class ScoringConfig(BaseModel):
    categories: list[ScoringCategory] = []


class NationConfig(BaseModel):
    name: str
    code: str
    bloc: str = ""
    interests: str = ""


class RoleConfig(BaseModel):
    title: str
    code: str
    duty: str = ""


class VoteMechanics(BaseModel):
    influence_tracking: bool = False
    audience_size: int = 100
    starting_split: Optional[float] = 50
    swing_per_strong_point: float = 5
    swing_per_weak_point: float = -3
    live_poll_intervals: int = 0


class ModeConfig(BaseModel):
    name: str
    display_name: str
    description: str = ""
    defaults: ModeDefaults = ModeDefaults()
    turn_taking: TurnTakingConfig = TurnTakingConfig()
    moves: list[str] = []
    topics: list[str] = []
    nations: list[NationConfig] = []
    roles: Optional[dict[str, list[RoleConfig]]] = None
    scoring: Optional[ScoringConfig] = None
    vote_mechanics: Optional[VoteMechanics] = None


@lru_cache
def load_mode(name: str = "gd") -> ModeConfig:
    path = CONFIG_DIR / "modes" / f"{name}.yaml"
    with open(path, encoding="utf-8") as f:
        return ModeConfig(**yaml.safe_load(f))


def load_all_modes() -> dict[str, ModeConfig]:
    modes_dir = CONFIG_DIR / "modes"
    result = {}
    for p in sorted(modes_dir.glob("*.yaml")):
        name = p.stem
        result[name] = load_mode(name)
    return result


@lru_cache
def load_personas() -> dict[str, Persona]:
    path = CONFIG_DIR / "personas.yaml"
    with open(path, encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    personas = [Persona(**p) for p in raw["personas"]]
    return {p.name: p for p in personas}


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()

"""Loads mode and persona configs from YAML. Modes are pure config so a new
mode (debate, MUN, impromptu) is a new file, not a code change."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

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


class ModeConfig(BaseModel):
    name: str
    display_name: str
    description: str = ""
    defaults: ModeDefaults = ModeDefaults()
    turn_taking: TurnTakingConfig = TurnTakingConfig()
    moves: list[str] = []
    topics: list[str] = []


@lru_cache
def load_mode(name: str = "gd") -> ModeConfig:
    path = CONFIG_DIR / "modes" / f"{name}.yaml"
    with open(path, encoding="utf-8") as f:
        return ModeConfig(**yaml.safe_load(f))


@lru_cache
def load_personas() -> dict[str, Persona]:
    path = CONFIG_DIR / "personas.yaml"
    with open(path, encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    personas = [Persona(**p) for p in raw["personas"]]
    return {p.name: p for p in personas}


def env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()

"""Competition judging — AI judges score participants across configured
categories. Human judges can also submit scores via the API. The final
scoreboard aggregates all judge scores with configurable weighting."""

from __future__ import annotations

import json
import logging
import re

from ..config import ModeConfig, ScoringConfig
from ..models import (
    CompetitionScoreboard,
    JudgeScore,
    Session,
    VoteState,
    new_id,
)
from ..providers.base import LLMProvider

log = logging.getLogger(__name__)


def _build_judge_prompt(session: Session, mode: ModeConfig) -> tuple[str, str]:
    scoring = mode.scoring
    cats = scoring.categories if scoring else []
    cat_desc = "\n".join(
        f"- {c.name} (weight {c.weight:.0%}): {c.description}" for c in cats
    )

    mode_context = ""
    if session.mode == "mun":
        assignments = {a.speaker: f"{a.nation} ({a.code})" for a in session.nation_assignments}
        if session.student_nation:
            assignments["student"] = session.student_nation
        mode_context = (
            "This is a Model United Nations simulation. Each delegate represents a nation.\n"
            "Nation assignments:\n"
            + "\n".join(f"  {k}: {v}" for k, v in assignments.items())
        )
    elif session.mode == "parliamentary":
        roles = {a.speaker: f"{a.title} ({a.side})" for a in session.role_assignments}
        if session.student_role:
            roles["student"] = f"{session.student_role} ({session.student_side})"
        mode_context = (
            "This is a British Parliamentary debate.\n"
            "Role assignments:\n"
            + "\n".join(f"  {k}: {v}" for k, v in roles.items())
        )
    elif session.mode == "tv_debate":
        mode_context = (
            "This is a TV-style panel debate. The goal is audience persuasion.\n"
            "Evaluate how effectively each speaker would sway a live audience."
        )

    system = (
        "You are a panel of expert judges evaluating a competitive debate/discussion.\n"
        f"Format: {mode.display_name}\n"
        f"{mode_context}\n\n"
        f"Scoring categories:\n{cat_desc}\n\n"
        "For EACH participant (including 'student'), score every category from 0 to 10.\n"
        "Output ONLY valid JSON:\n"
        '{"scores": [{"speaker": "<name>", "category": "<cat name>", '
        '"score": <0-10>, "comment": "<brief justification>"},...],\n'
        '"vote_shifts": [{"speaker": "<name>", "shift": <integer>, '
        '"reason": "<why audience moved>"},...],\n'
        '"summary": "<overall judge summary paragraph>"}'
    )

    transcript_lines = []
    for t in session.turns:
        move_tag = f" [{t.move.value}]" if t.move else ""
        transcript_lines.append(f"[{t.seq}] {t.speaker}{move_tag}: {t.text}")

    user = (
        f'Topic: "{session.topic}"\n'
        f"Duration: {session.duration_minutes} minutes\n\n"
        "=== TRANSCRIPT ===\n"
        + "\n".join(transcript_lines)
        + "\n=== END ===\n\n"
        "Score every participant on every category. JSON only."
    )
    return system, user


async def run_ai_judge(
    session: Session,
    mode: ModeConfig,
    provider: LLMProvider,
    judge_id: str | None = None,
) -> list[JudgeScore]:
    if provider.name == "mock" or not mode.scoring:
        return _mock_judge_scores(session, mode, judge_id or "ai_judge_1")

    judge_id = judge_id or f"ai_judge_{new_id()[:6]}"
    system, user = _build_judge_prompt(session, mode)

    try:
        raw = await provider.complete(system, user, max_tokens=3000)
    except Exception:
        log.exception("AI judge LLM call failed")
        return _mock_judge_scores(session, mode, judge_id)

    return _parse_judge_response(raw, judge_id, mode)


def _parse_judge_response(raw: str, judge_id: str, mode: ModeConfig) -> list[JudgeScore]:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```\w*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []

    scores = []
    for s in data.get("scores", []):
        scores.append(JudgeScore(
            judge_id=judge_id,
            judge_type="ai",
            speaker=s.get("speaker", ""),
            category=s.get("category", ""),
            score=float(s.get("score", 5)),
            comment=s.get("comment", ""),
        ))
    return scores


def _mock_judge_scores(session: Session, mode: ModeConfig, judge_id: str) -> list[JudgeScore]:
    import random
    rng = random.Random(hash(session.id))
    cats = mode.scoring.categories if mode.scoring else []

    speakers = list({t.speaker for t in session.turns})
    scores = []
    for speaker in speakers:
        word_count = sum(len(t.text.split()) for t in session.turns if t.speaker == speaker)
        base = min(word_count / 50, 7.0) + rng.uniform(1, 3)
        for cat in cats:
            scores.append(JudgeScore(
                judge_id=judge_id,
                judge_type="ai",
                speaker=speaker,
                category=cat.name,
                score=round(min(max(base + rng.uniform(-1.5, 1.5), 1), 10), 1),
                comment=f"{'Solid' if base > 5 else 'Needs work on'} {cat.name.lower()}",
            ))
    return scores


def compute_scoreboard(
    session: Session,
    mode: ModeConfig,
) -> CompetitionScoreboard:
    cats = mode.scoring.categories if mode.scoring else []
    cat_weights = {c.name: c.weight for c in cats}

    speaker_cats: dict[str, dict[str, list[float]]] = {}
    for js in session.judge_scores:
        speaker_cats.setdefault(js.speaker, {}).setdefault(js.category, []).append(js.score)

    category_breakdown: dict[str, dict[str, float]] = {}
    speaker_totals: dict[str, float] = {}

    for speaker, cats_map in speaker_cats.items():
        breakdown: dict[str, float] = {}
        weighted_total = 0.0
        total_weight = 0.0
        for cat_name, score_list in cats_map.items():
            avg = sum(score_list) / len(score_list)
            breakdown[cat_name] = round(avg, 1)
            w = cat_weights.get(cat_name, 1.0 / max(len(cats_map), 1))
            weighted_total += avg * w
            total_weight += w
        category_breakdown[speaker] = breakdown
        speaker_totals[speaker] = round(
            weighted_total / total_weight * 10 if total_weight else 0, 1
        )

    ranked = sorted(speaker_totals.items(), key=lambda x: x[1], reverse=True)
    rankings = [
        {"rank": i + 1, "speaker": sp, "score": sc}
        for i, (sp, sc) in enumerate(ranked)
    ]

    vote_final = None
    if session.vote_state:
        vote_final = dict(session.vote_state.scores)

    return CompetitionScoreboard(
        speaker_totals=speaker_totals,
        category_breakdown=category_breakdown,
        rankings=rankings,
        vote_final=vote_final,
    )


def compute_vote_shift(
    session: Session,
    mode: ModeConfig,
    turn_speaker: str,
    turn_strength: str,
) -> None:
    vm = mode.vote_mechanics
    if not vm or not vm.influence_tracking or not session.vote_state:
        return

    if turn_strength == "strong":
        shift = vm.swing_per_strong_point
    elif turn_strength == "weak":
        shift = vm.swing_per_weak_point
    else:
        shift = 0
    if shift == 0:
        return

    vs = session.vote_state
    current = vs.scores.get(turn_speaker, 0)
    vs.scores[turn_speaker] = current + shift
    vs.history.append({
        "speaker": turn_speaker,
        "shift": shift,
        "strength": turn_strength,
        "total": vs.scores[turn_speaker],
    })

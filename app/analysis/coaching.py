"""LLM-powered coaching analysis — acts as an experienced GD judge who
evaluates argument quality, identifies missed opportunities, and gives
point-by-point feedback on every student turn."""

from __future__ import annotations

import json
import logging
import re

from ..models import (
    CoachingAnalysis,
    KeyMoment,
    MissedOpportunity,
    PointEvaluation,
    Session,
    SpeakerMetrics,
)
from ..providers.base import LLMProvider

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are an elite Group Discussion judge and coach with 20+ years of experience \
evaluating MBA admission GDs, corporate assessment centres, and debate panels.

Your job: analyse the transcript of a practice GD session and produce \
brutally honest, specific coaching. The user being coached is labelled "student" \
in the transcript; all other speakers are AI agents. You must evaluate EVERY \
participant — the student AND every agent — so the student can compare their \
performance and learn from the best (and worst) contributions.

Evaluation criteria you care about:
1. ARGUMENT QUALITY — Is the point substantive, backed by data/logic, or is it hot air?
2. RELEVANCE — Does it advance the topic or is it a tangent?
3. STRATEGIC TIMING — Did they speak at the right moments?
4. RESPONSE QUALITY — When challenged, did they fold or fight back well?
5. LEADERSHIP SIGNALS — Did they drive the discussion or just react?
6. LISTENING — Did they build on others or repeat themselves?

You must output ONLY valid JSON (no markdown fences, no commentary outside the JSON). \
The JSON schema:

{
  "overall_narrative": "2-3 paragraph coaching narrative in second person — direct, frank, \
like a coach speaking to the student. Reference how the student compared to other panellists.",
  "point_evaluations": [
    {
      "turn_seq": <integer — the seq number of the turn>,
      "speaker": "<speaker name — 'student' or the agent's name>",
      "excerpt": "<exact or close quote — max 30 words>",
      "strength": "strong" | "moderate" | "weak",
      "what_worked": "<what was good about this point — or 'Nothing notable' if weak>",
      "what_didnt": "<what was wrong or missing — or 'Solid delivery' if strong>",
      "comparison": "<how it stacked up against what others said around that moment>"
    }
  ],
  "missed_opportunities": [
    {
      "after_turn_seq": <integer — seq of the turn AFTER which the student should have spoken>,
      "context": "<what was happening in the discussion at that point — 1-2 sentences>",
      "what_student_could_have_said": "<a concrete example of what the student could have said>",
      "why_it_matters": "<why this was a missed chance — in coaching terms>"
    }
  ],
  "key_moments": [
    {
      "turn_seq": <integer>,
      "label": "<short label like 'Strong Comeback', 'Lost the Floor', 'Best Point of the GD'>",
      "commentary": "<1-2 sentence coaching commentary on this moment>"
    }
  ],
  "judge_verdict": "One paragraph final verdict — would this student pass a real GD? \
What is the single most important thing they need to fix?"
}

Rules:
- Evaluate EVERY turn by EVERY speaker (student AND agents) in point_evaluations.
- Include 2-5 missed opportunities specifically for the student.
- Include 3-6 key moments (the most notable exchanges — good or bad, involving any speaker).
- Be specific: reference what was actually said, don't be generic.
- If the student barely spoke, say so bluntly in the narrative.
- Directly compare: who made the best points and why. Name names.
- For agent turns, evaluate them the same way — the student learns by seeing \
which agents had strong/weak contributions and why.
"""


def _build_transcript_block(session: Session) -> str:
    lines = [f'Topic: "{session.topic}"', f"Duration: {session.duration_minutes} minutes", ""]
    lines.append("=== TRANSCRIPT ===")
    for t in session.turns:
        move_tag = f" [{t.move.value}]" if t.move else ""
        target_tag = f" (→{t.target})" if t.target else ""
        lines.append(f"[seq={t.seq}] {t.speaker}{move_tag}{target_tag}: {t.text}")
    lines.append("=== END TRANSCRIPT ===")
    return "\n".join(lines)


def _build_event_summary(session: Session) -> str:
    lines = ["=== KEY EVENTS ==="]
    for ev in session.events:
        target_str = f" → {ev.target}" if ev.target else ""
        lines.append(f"{ev.type.value}: {ev.actor}{target_str} — {ev.detail}")
    lines.append("=== END EVENTS ===")
    return "\n".join(lines)


def _build_persona_block(session: Session, personas: dict) -> str:
    lines = ["=== PARTICIPANTS ==="]
    lines.append("student — the person being coached")
    for name in session.persona_names:
        p = personas.get(name)
        if p:
            lines.append(f"{name} — {p.get('archetype', 'unknown')} (assertiveness={p.get('assertiveness', '?')}, style: {p.get('style', '?')})")
    lines.append("=== END PARTICIPANTS ===")
    return "\n".join(lines)


def _parse_coaching_json(raw: str) -> dict | None:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```\w*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


async def generate_coaching(
    session: Session,
    provider: LLMProvider,
    personas: dict,
) -> CoachingAnalysis | None:
    if provider.name == "mock":
        return None

    transcript = _build_transcript_block(session)
    events = _build_event_summary(session)
    participants = _build_persona_block(session, personas)

    user_prompt = f"{participants}\n\n{transcript}\n\n{events}\n\nAnalyse this GD session and produce the coaching JSON."

    try:
        raw = await provider.complete(SYSTEM_PROMPT, user_prompt, max_tokens=4000)
    except Exception:
        log.exception("Coaching LLM call failed")
        return None

    data = _parse_coaching_json(raw)
    if not data:
        log.warning("Could not parse coaching JSON from LLM response")
        return None

    try:
        return CoachingAnalysis(
            overall_narrative=data.get("overall_narrative", ""),
            point_evaluations=[
                PointEvaluation(**pe) for pe in data.get("point_evaluations", [])
            ],
            missed_opportunities=[
                MissedOpportunity(**mo) for mo in data.get("missed_opportunities", [])
            ],
            key_moments=[
                KeyMoment(**km) for km in data.get("key_moments", [])
            ],
            judge_verdict=data.get("judge_verdict", ""),
        )
    except Exception:
        log.exception("Failed to construct CoachingAnalysis from parsed JSON")
        return None

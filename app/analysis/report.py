"""Report generator. The quantitative layer (metrics, structural markers,
SWOT, next-actions) is always rule-based and runs with zero API keys.

When an analysis LLM provider is available (not mock), coaching analysis
is generated on top — point-by-point evaluations, missed opportunities,
key moments, and a judge verdict."""

from __future__ import annotations

import logging
from collections import Counter, defaultdict

from ..models import (
    Event,
    EventType,
    Report,
    Session,
    SpeakerMetrics,
    Turn,
)
from ..providers.base import LLMProvider
from .coaching import generate_coaching

log = logging.getLogger(__name__)

STUDENT = "student"


async def generate_report(
    session: Session,
    analysis_provider: LLMProvider | None = None,
    personas: dict | None = None,
) -> Report:
    speakers = _unique_speakers(session)
    metrics = _compute_metrics(session, speakers)
    student = next((m for m in metrics if m.speaker == STUDENT), None)
    structural = _structural_markers(session)
    event_counts = _event_counts(session)
    silence = _longest_student_silence(session)

    swot = _build_swot(student, metrics, structural, event_counts, silence)
    actions = _build_actions(student, metrics, structural, event_counts, silence)

    coaching = None
    if analysis_provider and analysis_provider.name != "mock":
        coaching = await generate_coaching(
            session, analysis_provider, personas or {},
        )

    return Report(
        session_id=session.id,
        generated_by=analysis_provider.name if (coaching and analysis_provider) else "rules",
        metrics=metrics,
        structural_markers=structural,
        event_counts=event_counts,
        longest_student_silence_s=silence,
        swot=swot,
        next_actions=actions,
        coaching=coaching,
    )


def _unique_speakers(session: Session) -> list[str]:
    seen: dict[str, None] = {}
    for t in session.turns:
        seen.setdefault(t.speaker, None)
    return list(seen)


def _compute_metrics(session: Session, speakers: list[str]) -> list[SpeakerMetrics]:
    total_words = 0
    by_speaker: dict[str, SpeakerMetrics] = {}
    for sp in speakers:
        by_speaker[sp] = SpeakerMetrics(speaker=sp)

    for t in session.turns:
        m = by_speaker.get(t.speaker)
        if m is None:
            continue
        wc = len(t.text.split())
        m.turns += 1
        m.words += wc
        total_words += wc
        if t.move:
            if t.move.value == "question":
                m.questions += 1
            elif t.move.value == "disagree":
                m.disagreements += 1
            elif t.move.value == "build":
                m.builds += 1

    for ev in session.events:
        if ev.type == EventType.INTERRUPTION:
            actor_m = by_speaker.get(ev.actor)
            target_m = by_speaker.get(ev.target) if ev.target else None
            if actor_m:
                actor_m.interruptions_given += 1
            if target_m:
                target_m.interruptions_received += 1
        if ev.type == EventType.DISAGREEMENT and ev.actor == STUDENT:
            sm = by_speaker.get(STUDENT)
            if sm and sm.disagreements == 0:
                sm.disagreements += 1
        if ev.type == EventType.QUESTION and ev.actor == STUDENT:
            sm = by_speaker.get(STUDENT)
            if sm and sm.questions == 0:
                sm.questions += 1

    for m in by_speaker.values():
        m.word_share = round(m.words / total_words, 3) if total_words else 0.0

    return list(by_speaker.values())


def _structural_markers(session: Session) -> dict[str, bool]:
    student_events = {ev.type for ev in session.events if ev.actor == STUDENT}
    opened = session.turns[0].speaker == STUDENT if session.turns else False
    return {
        "opened_discussion": opened,
        "self_introduction": EventType.SELF_INTRO in student_events,
        "attempted_summary": EventType.SUMMARY in student_events,
        "asked_question": EventType.QUESTION in student_events,
        "expressed_disagreement": EventType.DISAGREEMENT in student_events,
        "redirected_topic": EventType.TOPIC_REDIRECT in student_events,
    }


def _event_counts(session: Session) -> dict[str, int]:
    c: Counter[str] = Counter()
    for ev in session.events:
        c[ev.type.value] += 1
    return dict(c)


def _longest_student_silence(session: Session) -> float:
    silence_events = [
        ev for ev in session.events
        if ev.type == EventType.STUDENT_SILENCE
    ]
    if not silence_events:
        return 0.0
    longest = 0.0
    for ev in silence_events:
        for tok in ev.detail.split():
            if tok.endswith("s") and tok[:-1].replace("~", "").isdigit():
                val = float(tok[:-1].replace("~", ""))
                longest = max(longest, val)
    return longest


def _build_swot(
    student: SpeakerMetrics | None,
    all_metrics: list[SpeakerMetrics],
    structural: dict[str, bool],
    events: dict[str, int],
    silence: float,
) -> dict[str, list[str]]:
    s: list[str] = []
    w: list[str] = []
    o: list[str] = []
    t: list[str] = []

    if student is None:
        return {"strengths": s, "weaknesses": w, "opportunities": o, "threats": t}

    total_turns = sum(m.turns for m in all_metrics)
    avg_turns = total_turns / max(len(all_metrics), 1)

    if structural["opened_discussion"]:
        s.append("Took initiative by opening the discussion.")
    if structural["self_introduction"]:
        s.append("Introduced yourself — a simple but effective credibility marker.")
    if structural["attempted_summary"]:
        s.append("Attempted to summarize — this signals leadership and listening.")
    if student.word_share >= 0.20:
        s.append(f"Good speaking presence ({student.word_share:.0%} of total words).")
    if student.builds >= 2:
        s.append(f"Built on others' points {student.builds} times — shows active listening.")
    if student.disagreements >= 1:
        s.append("Expressed disagreement — willingness to push back is valued.")

    if student.word_share < 0.10 and total_turns > 4:
        w.append(f"Low speaking share ({student.word_share:.0%}). You need to speak more to be evaluated.")
    if student.turns < avg_turns * 0.5 and total_turns > 4:
        w.append(f"Only {student.turns} turns vs. group average of {avg_turns:.0f} — you're being drowned out.")
    if silence >= 24:
        w.append(f"Longest silence was ~{silence:.0f}s. Gaps over 20 seconds hurt your presence.")
    if not structural["opened_discussion"] and not structural["attempted_summary"]:
        w.append("Neither opened nor attempted to summarize — missed two key leadership signals.")
    if student.interruptions_received > student.interruptions_given and student.interruptions_received >= 2:
        w.append(
            f"Interrupted {student.interruptions_received} times but only interrupted others "
            f"{student.interruptions_given} times — consider being more assertive when cut off."
        )

    if not structural["asked_question"]:
        o.append("Try asking a probing question — it shows critical thinking and engages the group.")
    if student.builds < 1:
        o.append("Build on others' points more — it demonstrates listening, which evaluators watch for.")
    if not structural["attempted_summary"]:
        o.append("Attempt a mid-discussion summary to position yourself as the organizer.")
    if student.word_share > 0.35:
        o.append("You're talking a lot — leave room and try drawing quieter participants in. Evaluators value facilitation.")

    t.append("Aggressive personas will try to talk over you. Practice re-entering after being interrupted.")
    if events.get("interruption", 0) >= 3:
        t.append("The group had multiple interruptions — learn to hold your ground without raising your voice.")
    if student.disagreements == 0:
        t.append("You never disagreed. In a competitive GD, not pushing back can read as passive.")

    return {"strengths": s, "weaknesses": w, "opportunities": o, "threats": t}


def _build_actions(
    student: SpeakerMetrics | None,
    all_metrics: list[SpeakerMetrics],
    structural: dict[str, bool],
    events: dict[str, int],
    silence: float,
) -> list[str]:
    actions: list[str] = []
    if student is None:
        return actions

    if silence >= 24:
        actions.append(
            f"You went silent for ~{silence:.0f}s. Drill: practice a 'bridge phrase' "
            "('Going back to what was said earlier…') to re-enter after being quiet."
        )
    if student.word_share < 0.12:
        actions.append(
            "Your word share is low. Next session: aim for at least 3 contributions "
            "in the first half of the discussion."
        )
    if not structural["opened_discussion"]:
        actions.append(
            "You didn't open. Next session: try being the first speaker — even a brief "
            "'Let me start us off…' signals initiative."
        )
    if not structural["attempted_summary"]:
        actions.append(
            "Practice the closing summary. Prepare a mental template: 'So we discussed X, "
            "some said Y, others said Z, and the key takeaway is…'"
        )
    if student.interruptions_received >= 2:
        actions.append(
            "You were interrupted often. Drill: after being cut off, wait 2 seconds, "
            "then firmly say 'Let me finish my point' and continue."
        )
    if not actions:
        actions.append(
            "Solid session. Try increasing the difficulty: add a more aggressive persona "
            "mix or shorten the timer to build pressure tolerance."
        )

    return actions[:5]

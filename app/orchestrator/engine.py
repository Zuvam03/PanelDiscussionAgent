"""Phase 0 turn-taking engine — the riskiest piece per the PRD, validated
here in text before any audio exists.

Not a round-robin queue: after each student message (and on silence ticks)
every agent gets a desire-to-speak score from its persona traits + context
(recency, being addressed, disagreement pressure, jitter). The top scorer
takes the floor only if it clears a threshold — agents genuinely stay silent
when they have nothing to add. A second agent may chime in (build/disagree/
interrupt), which is how text-mode "talking over each other" manifests."""

from __future__ import annotations

import random
import re
import time

from ..config import ModeConfig, load_personas
from ..models import Event, EventType, Move, Persona, Session, SessionStatus, Turn
from ..providers.base import AgentReply, LLMProvider

STUDENT = "student"

_MOVE_EVENT = {
    Move.NEW_POINT: EventType.NEW_POINT,
    Move.BUILD: EventType.BUILD_ON,
    Move.DISAGREE: EventType.DISAGREEMENT,
    Move.QUESTION: EventType.QUESTION,
    Move.SUMMARY: EventType.SUMMARY,
    Move.REDIRECT: EventType.TOPIC_REDIRECT,
    Move.INTERRUPT: EventType.INTERRUPTION,
    Move.OPEN: EventType.NEW_POINT,
}

_INTRO_RE = re.compile(r"\b(my name is|i am \w+ and|i'm \w+ and|myself \w+)\b", re.I)
_SUMMARY_RE = re.compile(r"\b(to summari[sz]e|in conclusion|to conclude|to sum up|wrapping up)\b", re.I)
_DISAGREE_RE = re.compile(r"\b(i disagree|i don't agree|i do not agree|that's wrong|i'd push back|i would push back)\b", re.I)


class Orchestrator:
    def __init__(self, mode: ModeConfig, provider: LLMProvider, rng: random.Random | None = None):
        self.mode = mode
        self.provider = provider
        self.rng = rng or random.Random()

    # ------------------------------------------------------------- lifecycle

    def start(self, session: Session) -> None:
        session.status = SessionStatus.LIVE
        session.started_at = time.time()
        session.events.append(Event(
            type=EventType.SESSION_START, actor="system",
            detail=f"topic: {session.topic}",
        ))

    def _personas(self, session: Session) -> list[Persona]:
        all_p = load_personas()
        return [all_p[n] for n in session.persona_names if n in all_p]

    # ------------------------------------------------------- student message

    async def on_student_message(self, session: Session, text: str) -> list[Turn]:
        session.silence_ticks = 0
        turn = Turn(seq=session.next_seq(), speaker=STUDENT, text=text)
        session.turns.append(turn)
        self._log_student_events(session, turn)
        new_turns = [turn]
        new_turns += await self._agent_burst(session)
        self._check_time(session)
        return new_turns

    def _log_student_events(self, session: Session, turn: Turn) -> None:
        text = turn.text
        add = lambda t, d="": session.events.append(
            Event(type=t, actor=STUDENT, detail=d, turn_id=turn.id))

        if _INTRO_RE.search(text):
            add(EventType.SELF_INTRO)
        if _SUMMARY_RE.search(text):
            add(EventType.SUMMARY)
        if _DISAGREE_RE.search(text):
            prev_agent = next((t.speaker for t in reversed(session.turns[:-1])
                               if t.speaker != STUDENT), None)
            session.events.append(Event(
                type=EventType.DISAGREEMENT, actor=STUDENT,
                target=prev_agent, turn_id=turn.id))
        if "?" in text:
            add(EventType.QUESTION)
        # A student message arriving right on the heels of an agent turn is the
        # text-mode proxy for barge-in; real VAD-based barge-in lands in Phase 1.
        prev = session.turns[-2] if len(session.turns) >= 2 else None
        if prev and prev.speaker != STUDENT and (turn.at - prev.at) < 3.0:
            session.events.append(Event(
                type=EventType.INTERRUPTION, actor=STUDENT,
                target=prev.speaker, turn_id=turn.id,
                detail="student cut in immediately after agent turn"))
        # Opening the discussion is a classic initiative signal.
        if turn.seq == 0:
            session.events.append(Event(
                type=EventType.FLOOR_GRAB, actor=STUDENT, turn_id=turn.id,
                detail="opened the discussion"))

    # ------------------------------------------------------------ silence tick

    async def on_tick(self, session: Session) -> list[Turn]:
        if session.status not in (SessionStatus.LIVE, SessionStatus.WRAPPING):
            return []
        session.silence_ticks += 1
        tt = self.mode.turn_taking
        if session.silence_ticks == tt.silence_event_after_ticks:
            session.events.append(Event(
                type=EventType.STUDENT_SILENCE, actor=STUDENT,
                detail=f"~{session.silence_ticks * tt.silence_tick_seconds}s without speaking"))
        new_turns: list[Turn] = []
        # Agents keep the conversation alive among themselves while the
        # student is quiet — but not on every tick, to leave openings.
        if session.silence_ticks >= 2 and self.rng.random() < 0.7:
            speaker = self._pick_speaker(session, exclude_last=True)
            if speaker:
                t = await self._generate_agent_turn(session, speaker)
                new_turns.append(t)
                if session.silence_ticks >= 3:
                    session.events.append(Event(
                        type=EventType.FLOOR_GRAB, actor=speaker.name, turn_id=t.id,
                        detail="grabbed the floor after a silence"))
        self._check_time(session)
        return new_turns

    # ------------------------------------------------------------ agent burst

    async def _agent_burst(self, session: Session) -> list[Turn]:
        tt = self.mode.turn_taking
        turns: list[Turn] = []
        for i in range(tt.max_agent_turns_per_burst):
            if i > 0 and self.rng.random() > tt.chime_in_chance:
                break
            speaker = self._pick_speaker(session, exclude_last=True)
            if speaker is None:
                break
            turn = await self._generate_agent_turn(session, speaker, chiming_in=(i > 0))
            turns.append(turn)
        return turns

    def _pick_speaker(self, session: Session, exclude_last: bool) -> Persona | None:
        personas = self._personas(session)
        last_speaker = session.turns[-1].speaker if session.turns else None
        last_text = session.turns[-1].text.lower() if session.turns else ""
        scores: list[tuple[float, Persona]] = []
        for p in personas:
            if exclude_last and p.name == last_speaker:
                continue
            scores.append((self._desire(p, session, last_text), p))
        if not scores:
            return None
        scores.sort(key=lambda s: s[0], reverse=True)
        best_score, best = scores[0]
        if best_score < self.mode.turn_taking.floor_threshold:
            return None  # nobody has anything worth saying — silence is allowed
        return best

    def _desire(self, p: Persona, session: Session, last_text: str) -> float:
        score = 0.35 * p.assertiveness + 0.15 * p.verbosity
        # Hunger grows the longer an agent has been quiet.
        turns_since = self._turns_since_spoke(session, p.name)
        score += min(turns_since, 6) * 0.06
        # Being addressed by name is a strong pull to respond.
        if p.name.lower() in last_text:
            score += 0.5
        # Contrarians and dominators surge when consensus language appears.
        if p.agreeableness < 0.4 and any(w in last_text for w in ("agree", "everyone", "we all", "obviously")):
            score += 0.2
        score += self.rng.uniform(-0.12, 0.12)
        return score

    def _turns_since_spoke(self, session: Session, name: str) -> int:
        for i, t in enumerate(reversed(session.turns)):
            if t.speaker == name:
                return i
        return len(session.turns)

    # ----------------------------------------------------------- generation

    async def _generate_agent_turn(self, session: Session, p: Persona, chiming_in: bool = False) -> Turn:
        move, target = self._suggest_move(session, p, chiming_in)
        reply = await self.provider.agent_turn(
            self._system_prompt(session, p),
            self._conversation_text(session),
            self._instruction(p, move, target),
        )
        turn = Turn(
            seq=session.next_seq(), speaker=p.name, text=reply.text,
            move=_safe_move(reply.move, move), target=reply.target or target,
        )
        session.turns.append(turn)
        ev_type = _MOVE_EVENT.get(turn.move or Move.NEW_POINT)
        if ev_type:
            session.events.append(Event(
                type=ev_type, actor=p.name, target=turn.target, turn_id=turn.id))
        return turn

    def _suggest_move(self, session: Session, p: Persona, chiming_in: bool) -> tuple[Move, str | None]:
        last = session.turns[-1] if session.turns else None
        target = last.speaker if last else None
        if session.status == SessionStatus.WRAPPING:
            return Move.SUMMARY, None
        if not any(t.speaker != STUDENT for t in session.turns) and not session.turns:
            return Move.OPEN, None
        if chiming_in and self.rng.random() < p.interruption_propensity:
            return Move.INTERRUPT, target
        r = self.rng.random()
        if last and r < (1 - p.agreeableness) * 0.6:
            return Move.DISAGREE, target
        if last and r < (1 - p.agreeableness) * 0.6 + p.agreeableness * 0.35:
            return Move.BUILD, target
        if p.archetype == "consensus_builder" and len(session.turns) > 6 and r > 0.75:
            return Move.SUMMARY, None
        if r > 0.85:
            return Move.QUESTION, target
        return Move.NEW_POINT, None

    def _system_prompt(self, session: Session, p: Persona) -> str:
        return (
            f"You are {p.name}, a participant in a timed group discussion.\n"
            f"archetype: {p.archetype}\n"
            f"Personality: {p.style}\n"
            f'Topic: "{session.topic}"\n'
            "Rules: stay fully in character; speak like a real person in a live GD "
            "(2-4 sentences, spoken register, no lists or markdown); engage with what "
            "others actually said, including the other AI participants, not only the "
            "student; never break character or mention being an AI.\n"
            'Respond ONLY with JSON: {"move": "<open|new_point|build|disagree|question|'
            'summary|redirect|interrupt>", "text": "<what you say>", "target": "<name or null>"}'
        )

    def _conversation_text(self, session: Session, tail: int = 16) -> str:
        lines = [f"[{t.speaker}] {t.text}" for t in session.turns[-tail:]]
        return "Discussion so far:\n" + ("\n".join(lines) if lines else "(no one has spoken yet)")

    def _instruction(self, p: Persona, move: Move, target: str | None) -> str:
        base = f"You now have the floor. Suggested move: {move.value}"
        if target:
            base += f" target: {target}"
        return base + ". You may pick a different move if it fits the flow better. JSON only."

    # ---------------------------------------------------------------- timing

    def _check_time(self, session: Session) -> None:
        if session.status == SessionStatus.ENDED or session.started_at is None:
            return
        total = session.duration_minutes * 60
        elapsed = session.elapsed()
        if elapsed >= total:
            self.end(session)
        elif session.status == SessionStatus.LIVE and elapsed >= total * self.mode.defaults.wrap_up_fraction:
            session.status = SessionStatus.WRAPPING
            session.events.append(Event(
                type=EventType.WRAP_UP, actor="system",
                detail="wrap-up window entered; agents will start summarizing"))

    def end(self, session: Session) -> None:
        if session.status == SessionStatus.ENDED:
            return
        session.status = SessionStatus.ENDED
        session.ended_at = time.time()
        session.events.append(Event(type=EventType.SESSION_END, actor="system"))


def _safe_move(raw: str, fallback: Move) -> Move:
    try:
        return Move(raw)
    except ValueError:
        return fallback

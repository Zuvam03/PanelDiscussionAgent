"""Keyless mock provider so the Phase 0 loop is demoable with zero setup.
Produces persona-flavored template responses — good enough to validate
turn-taking, floor dynamics, and the event log end to end."""

from __future__ import annotations

import random
import re

from .base import AgentReply, LLMProvider

_TEMPLATES: dict[str, list[str]] = {
    "open": [
        "Let me kick this off: {topic_frag} — and I think the answer is clearer than people admit.",
        "Since no one has started, I will. On '{topic_frag}', my opening position is that the trade-offs are being underestimated.",
    ],
    "new_point": [
        "One angle we haven't touched: the second-order effects. {flavor}",
        "I want to bring in a different dimension here — implementation cost. {flavor}",
        "Something nobody has raised yet is the incentive problem. {flavor}",
    ],
    "build": [
        "Building on what {target} said — that logic extends further than they took it. {flavor}",
        "{target} is onto something. If you follow that thread, it also explains the adoption gap. {flavor}",
    ],
    "disagree": [
        "I have to push back on {target} there. That assumes the baseline stays fixed, and it won't. {flavor}",
        "Respectfully, {target}, that's the popular take but the evidence cuts the other way. {flavor}",
    ],
    "question": [
        "Quick question for the group: are we arguing about outcomes or about principles here? Because those diverge.",
        "{target}, what would change your mind? I want to know what evidence would actually move you.",
    ],
    "summary": [
        "Let me try to pull threads together: we broadly agree on the problem, we split on who should act first, and the open question is timing.",
        "To summarize where we are — two camps have formed, and the real disagreement is about trade-offs, not facts.",
    ],
    "redirect": [
        "We're drifting. The topic is '{topic_frag}' — can we bring it back to that?",
        "Interesting tangent, but let's get back to the actual question: {topic_frag}.",
    ],
    "interrupt": [
        "— sorry, jumping in, because this point can't wait: {flavor}",
        "— hold on, {target}, before you finish: that premise is doing all the work in your argument. {flavor}",
    ],
}

_FLAVOR = {
    "aggressive_dominator": [
        "And frankly this should be obvious to everyone in the room.",
        "I said this at the start and I'll say it again, louder.",
        "The counterarguments just don't survive contact with reality.",
    ],
    "data_driven_analyst": [
        "Roughly speaking, surveys put this in the 30-40% range, which is not noise.",
        "The base rates here matter more than the anecdotes.",
        "If we quantify it, the effect size is smaller than the rhetoric suggests.",
    ],
    "quiet_but_sharp": [
        "Notice that both sides are assuming the same thing — and it's false.",
        "The framing itself is the problem.",
        "One sentence: this argument proves too much.",
    ],
    "devils_advocate": [
        "Let me steelman the opposite: what if the exact reverse is true?",
        "Everyone nodding along is precisely why I'm suspicious.",
        "Play it forward five years and the consensus view falls apart.",
    ],
    "consensus_builder": [
        "I think there's a version of this everyone here could sign onto.",
        "Both points are compatible if we separate short-term from long-term.",
        "We're closer to agreement than the tone suggests.",
    ],
}


class MockLLMProvider(LLMProvider):
    name = "mock"

    def __init__(self, seed: int | None = None):
        self._rng = random.Random(seed)

    async def agent_turn(self, system_prompt: str, conversation: str, instruction: str) -> AgentReply:
        # Persona archetype and the requested move are embedded in the prompts
        # by the orchestrator; recover them so mock output stays in character.
        archetype = _extract(r"archetype:\s*(\w+)", system_prompt, "devils_advocate")
        move = _extract(r"move:\s*(\w+)", instruction, "new_point")
        target = _extract(r"target:\s*(\w+)", instruction, "") or None
        topic = _extract(r"Topic:\s*\"(.+?)\"", system_prompt, "the topic")

        template = self._rng.choice(_TEMPLATES.get(move, _TEMPLATES["new_point"]))
        flavor = self._rng.choice(_FLAVOR.get(archetype, _FLAVOR["devils_advocate"]))
        text = template.format(
            topic_frag=topic.rstrip(".?!"),
            target=target or "the last speaker",
            flavor=flavor,
        )
        return AgentReply(move=move, text=text, target=target)

    async def complete(self, system_prompt: str, user_prompt: str, max_tokens: int = 2000) -> str:
        return ""  # analysis falls back to the rule-based report under mock


def _extract(pattern: str, text: str, default: str) -> str:
    m = re.search(pattern, text)
    return m.group(1) if m else default

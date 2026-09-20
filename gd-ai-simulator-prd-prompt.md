# Product Prompt for Claude Code — AI-Powered Group Discussion / Debate / MUN Practice Simulator

Paste everything below into Claude Code as the initial brief. It's written so Claude Code can scaffold, plan phases, and start building without more back-and-forth, while still flagging you for the decisions only you can make.

---

## 1. Product Vision

Build **"PanelPrep"** (working name — feel free to propose alternatives): a voice-first AI practice platform where a student can simulate a live group discussion, debate, Model UN committee, or impromptu-speech round against 3-5 configurable AI participants, entirely solo, on demand. Every session is recorded, transcribed, and analyzed on both **content** (what was said) and **delivery** (how it was said — pitch, pace, pauses, emotion, interruptions), producing a descriptive report (what happened) and a prescriptive report (what to fix, with drills) — essentially a SWOT for the student's spoken performance.

**Why this matters:** GD/case-interview/MUN/debate prep is bottlenecked by needing 4-8 humans in the same room at the same time. This removes that constraint entirely.

## 2. Target Users & Modes

Single core engine, multiple "mode" configs layered on top:

- **Group Discussion (GD)** — CAT/XAT/GMAT/college placement style: 4-6 participants, topic given, ~15 min, no assigned roles, evaluated on initiative, articulation, listening, leadership, and knowledge.
- **Debate** — for-against motion, structured speaking order, rebuttals, points of information.
- **Model UN (MUN)** — committee simulation, formal procedure (motions, points of order, caucusing), delegate personas representing countries/positions.
- **Instant/Impromptu Speech** — solo mode, random topic, short prep timer, then timed speech with no peer agents — feedback is delivery-only plus structure (opening/body/close).

Build the architecture so mode-specific rules (turn structure, formality, scoring rubric) are **config, not code** — a new mode should be addable without touching the core pipeline.

## 3. Core User Journey (MVP: GD mode only)

1. Student picks mode (GD), topic (from a bank or custom), number of AI peers (default 4), and peer personas (e.g., "aggressive dominator," "data-driven analyst," "quiet-but-sharp," "devil's advocate").
2. Student clicks Start. A countdown gives 30-60s "thinking time" (mirrors real GD format).
3. Live session begins: student speaks into mic; 4 AI agents converse with the student and each other in real time via voice, using turn-taking logic that mimics real GD dynamics (interruptions, overlaps, someone trying to summarize early, etc.).
4. Session runs for a configurable duration (default 12-15 min), then auto-wraps ("30 seconds left, wrap up").
5. Full audio + transcript + event log is saved.
6. Analysis pipeline runs (can be async, target under 2 min post-session for MVP).
7. Student receives: a descriptive report (transcript with annotations, quantified metrics, timeline) and a prescriptive report (SWOT + specific next-session drills).
8. Session and report are stored in the student's history for progress tracking over time.

## 4. Functional Requirements

### 4.1 Session Orchestration (the hard part)
- Multi-agent turn-taking that feels like a real GD, not a round-robin chatbot queue: agents should be able to interrupt, talk over each other briefly, agree/disagree with each other (not just respond to the student), stay silent if they have nothing to add, and occasionally try to grab the floor.
- Each AI peer has a persistent persona (personality, stance tendencies, verbosity, interruption propensity) that stays consistent through the session.
- Latency budget: an agent's turn should start within ~1-2s of getting the floor — this needs streaming LLM output piped into streaming TTS, not "wait for full response then speak."
- Barge-in handling: if the student starts speaking while an agent is talking, the system needs to detect it (via STT VAD) and let the agent yield, just like a real conversation.

### 4.2 Voice Pipeline
- **STT** for the student's live mic input (streaming, low latency).
- **TTS** for each AI agent — each agent needs a **distinct voice** (different pitch/timbre) so the student can tell them apart by ear.
- Full session audio recorded (student track + each agent's synthesized track, ideally on separate channels for easier downstream analysis).

### 4.3 Recording & Transcript
- Full timestamped, speaker-labeled transcript (student + each named agent).
- Event log alongside the transcript, tagging moments like: interruption (who interrupted whom, was it acknowledged or ignored), self-introduction given, summary/conclusion given, topic redirect, new data point introduced, direct disagreement, floor grabbed after silence, etc. This event log is what the prescriptive report is built from — treat it as a first-class data structure, not a byproduct.

### 4.4 Delivery / Paralinguistic Analysis (on the student's audio only)
For the student's track specifically, extract per-turn and session-level:
- Pitch (F0 mean, range, variability) and whether it's monotone or expressive.
- Pace (words per minute), and pace variability (rushing vs. steady).
- Pauses and filler words ("um," "like," "so," repeated restarts).
- Volume/energy and whether it drops when interrupted (a common confidence tell).
- Voice-based emotion/affect over time (e.g., confident, nervous, hesitant, assertive) — a coarse timeline is fine for v1, doesn't need clinical precision.

### 4.5 Content Analysis
- **Factual correctness check**: claims the student makes that are checkable (stats, named facts) get cross-referenced (web search or a knowledge source) and flagged as correct / incorrect / unverifiable in the report — don't silently ignore this, it's one of the most requested checks.
- **Structural markers**: did they introduce themselves, did they attempt a summary, did they stay on topic, did they build on others' points vs. only pushing their own.
- **Relevance & depth scoring**: how substantive vs. filler their contributions were.

### 4.6 Behavioral / Leadership Analytics
- Speaking time share (student vs. each agent).
- Interruptions given and received (and whether interruptions were "earned" — e.g., cutting in with a strong point vs. just being loud).
- Initiative signals: who opened the discussion, who steered it back on track when it drifted, who closed it out.
- A single "GD leadership index" style rollup is a nice-to-have, but the underlying counts must be shown, not just a black-box score.

### 4.7 Reporting
- **Descriptive report**: annotated transcript, timeline visualization of who spoke when, quantified metrics table, moment-by-moment emotion/pace graph.
- **Prescriptive report**: SWOT (Strengths / Weaknesses / Opportunities / Threats) framed around GD performance, 3-5 concrete, specific next actions ("You went silent for 90s after being interrupted at 4:12 — practice re-entering the conversation after a cutoff"), and suggested drills or a suggested next-session config (e.g., "try a session with a more aggressive persona mix").
- Session history dashboard with trend lines across sessions (is pace variability improving, is interruption ratio improving, etc.).

### 4.8 Mode Extensibility (post-MVP, but design for it now)
- Debate mode: structured speaking order, rebuttal detection, point-of-information handling.
- MUN mode: formal procedural language (motions, points of order), country/position personas, caucus sub-sessions.
- Impromptu speech mode: solo, timed prep + timed delivery, structure-only feedback (opening/body/close), no peer agents needed — reuses the same voice/analysis pipeline.

## 5. Suggested Starting Tech Stack (free/open-source first, swap-in-paid-later)

Keep every model/vendor choice behind a thin interface (STTProvider, TTSProvider, LLMProvider, EmotionProvider) so swapping a free component for a paid one later is a config change, not a rewrite. Suggested MVP defaults, current as of Sept 2026 — validate versions/pricing/limits when you actually wire these up, since this space moves fast:

- **Real-time voice-agent orchestration**: Pipecat (open-source, self-hostable, built for exactly this kind of low-latency streaming voice-agent pipeline) or LiveKit Agents as the alternative — pick whichever has better documented support for multi-agent turn-taking/barge-in when you evaluate them.
- **LLM for agent dialogue generation**: Groq's free/fast-inference tier (Llama family models) for low-latency responses during the live session — this is the piece most sensitive to latency, so prioritize speed over quality here. Use a stronger model (Claude, via API) for the **post-session analysis and report generation**, where latency doesn't matter and quality does.
- **STT**: Whisper (open-source, self-hosted, e.g. faster-whisper) for both live transcription and post-session re-transcription/diarization.
- **TTS**: an open-source multi-voice engine (e.g., Piper or a comparable Hugging Face model) to get distinct free voices per agent for MVP; note ElevenLabs' free tier as the first upgrade path for more natural/expressive voices.
- **Prosody/acoustic feature extraction**: librosa / openSMILE for pitch, energy, pace — these run locally and free.
- **Speech emotion recognition**: an open Hugging Face speech-emotion model (wav2vec2-based or similar) for the coarse emotion timeline; note Hume AI as a paid upgrade path if precision matters more later.
- **Backend**: Python (FastAPI) for the orchestration and analysis services.
- **Frontend**: web app (React/Next.js) with WebRTC for mic capture — browser-based, no install, works for the target audience (students).
- **Storage**: Postgres for structured data (sessions, transcripts, metrics, reports) + object storage (S3-compatible) for audio files.

Flag clearly in your plan which of these you'd swap first as the product grows (my expectation: TTS quality and LLM quality are the first two worth paying for, once the core loop is validated).

## 6. Non-Functional Requirements
- Session audio/transcripts are sensitive student data — plan for per-user data isolation and a way to delete a session's recordings.
- Target end-to-end agent response latency under ~2s during live sessions; anything analysis-heavy must be async/post-session.
- Design for eventual concurrent multi-user sessions even if MVP is single-user-at-a-time.

## 7. Phased Roadmap (please propose your own breakdown, but this is my rough shape)

- **Phase 0 — Prove the core loop without voice**: text-only chat GD simulation (student types, agents respond as text) to validate turn-taking, persona consistency, and interruption logic before adding audio complexity.
- **Phase 1 — Add voice**: wire in STT/TTS, real-time barge-in, distinct agent voices, full session recording.
- **Phase 2 — Delivery analytics**: prosody/pace/emotion extraction + the descriptive report.
- **Phase 3 — Content analytics**: fact-checking, structural markers, leadership/behavioral metrics + the prescriptive report and SWOT.
- **Phase 4 — Extend modes**: Debate, MUN, Impromptu Speech, built on the same core engine.
- **Phase 5 — Stack upgrades**: swap free components for paid ones (better TTS, better emotion model) behind the existing provider interfaces, plus a session-history/progress dashboard.

## 8. What I need from you (Claude Code)

1. Review this brief and flag anything under-specified before you scaffold — especially around the multi-agent turn-taking approach, since that's the riskiest technical piece.
2. Propose the repo structure and confirm/challenge the tech stack above (you may know of better current free options — check).
3. Build Phase 0 first (text-only GD loop) so we can validate the conversation/persona logic cheaply before investing in the voice pipeline.
4. Keep provider choices (LLM/STT/TTS/emotion) behind clean interfaces from day one so free→paid swaps later are config changes.
5. After each phase, give me something runnable/demoable, not just code.


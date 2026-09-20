# ⚡ PanelPrep

AI-powered Group Discussion practice simulator. Practice GD, debate, MUN, and impromptu speech rounds against configurable AI personas — solo, on demand.

**Voice-first GD simulator:** You speak into your mic, AI agents respond with distinct synthesized voices, and you get a full descriptive + prescriptive report (SWOT, next actions, structural markers) after every session.

## Quick Start

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Install frontend dependencies & build

```bash
cd frontend
npm install
npm run build
cd ..
```

### 3. Run

```bash
python run.py
```

Open **http://localhost:8000** in **Chrome or Edge** (required for Speech Recognition API).

### Development mode (hot reload)

Terminal 1 — backend:
```bash
python run.py
```

Terminal 2 — frontend (proxies API to backend):
```bash
cd frontend
npm run dev
```

Open **http://localhost:5173**

## How It Works

1. **Pick a topic** (from the bank or custom), choose your AI peers, set the timer
2. **Countdown** gives you 45 seconds of thinking time (mirrors real GD format)
3. **Discussion goes live** — your mic activates, participant circles show who's speaking
4. **You speak** — browser Speech Recognition transcribes you in real time; agents respond with distinct voices via browser Speech Synthesis
5. **Barge-in works** — start speaking while an agent is talking and they yield, just like a real GD
6. **Agents talk among themselves** — when you're quiet, they keep the conversation alive (silence ticks)
7. **Session ends** — auto or manual. A full report with metrics, structural markers, SWOT, and concrete drills is generated

## Configuration

### LLM Provider

Copy `.env.example` to `.env` and set your keys:

| Variable | Values | Default |
|---|---|---|
| `PANELPREP_LLM_PROVIDER` | `auto`, `mock`, `anthropic`, `groq` | `auto` |
| `ANTHROPIC_API_KEY` | Your Anthropic key | — |
| `GROQ_API_KEY` | Your Groq key | — |

With no keys set, the app runs on the **mock provider** — template-based responses that are good enough to validate the full pipeline without any API costs. Add an API key for real LLM-generated dialogue.

### Modes & Personas

- **Mode config:** `config/modes/gd.yaml` — turn-taking rules, topics, timing
- **Personas:** `config/personas.yaml` — 5 built-in personas with distinct archetypes
- Adding a new mode (debate, MUN) = adding a new YAML file, not code

## Architecture

```
app/
  models.py          # Domain models: Session, Turn, Event, Report
  config.py          # YAML config loader
  server.py          # FastAPI routes
  providers/
    base.py          # LLM/STT/TTS/Emotion interfaces
    mock_llm.py      # Zero-setup mock provider
    http_llm.py      # Anthropic + Groq providers
    factory.py       # Provider selection from env
  orchestrator/
    engine.py        # Turn-taking engine (desire-to-speak scoring)
  analysis/
    report.py        # Rule-based report generator (SWOT, metrics)
  storage/
    db.py            # SQLite persistence
frontend/
  src/
    api.js           # API client
    audio/
      voiceManager.js       # Voice assignment, TTS queue, barge-in
      useSpeechRecognition.js  # Continuous speech recognition hook
    views/
      SetupView.jsx    # Topic, persona, duration selection
      SessionView.jsx  # Voice-first live GD (participant ring, mic, TTS)
      ReportView.jsx   # SWOT, metrics, next actions
      HistoryView.jsx  # Session list with delete
config/
  modes/gd.yaml     # GD mode definition
  personas.yaml     # AI peer personas
```

## Voice Pipeline

The audio layer runs entirely in the browser using Web APIs — no server-side audio processing needed:

- **STT (student mic → text):** Web Speech API `SpeechRecognition` — continuous, streaming, with interim results shown live
- **TTS (agent text → speech):** Web Speech API `speechSynthesis` — each agent gets a distinct voice from the system's available voices, with per-archetype pitch/rate variation (aggressive dominator speaks faster and deeper, quiet-but-sharp is slower and higher-pitched)
- **Barge-in:** When the student starts speaking while an agent is talking, `speechSynthesis.cancel()` cuts the agent off immediately and the student's speech is processed
- **Voice assignment:** `voiceManager.js` picks unique English voices from the browser's pool and assigns them by hashing agent names, so voices are consistent within a session

**Browser requirement:** Chrome or Edge (SpeechRecognition is not available in Firefox/Safari).

## Key Design Decisions

- **Turn-taking is not round-robin.** Each agent gets a desire-to-speak score from persona traits + context (recency, being addressed, disagreement pressure, jitter). Only the top scorer takes the floor, and only if it clears a threshold — agents genuinely stay silent when they have nothing to add.

- **Event log is first-class.** Every meaningful moment (interruption, floor grab, silence, summary attempt) is logged as a structured Event. The prescriptive report is built from this log, not from re-parsing transcripts.

- **Provider interfaces from day one.** LLM, STT, TTS, and Emotion providers all have abstract interfaces. Swapping mock → Groq → Claude → ElevenLabs is a config change.

- **Modes are config, not code.** Turn structure, formality, scoring rubrics, and topics are YAML. A new mode (debate, MUN) is a new file.

## Roadmap

- [x] **Voice-first GD** — Mic input, distinct agent voices, barge-in, participant ring UI
- [x] **Turn-taking engine** — Desire-to-speak scoring, persona-driven dynamics
- [x] **Reports** — SWOT, metrics, structural markers, next-action drills
- [ ] **Server-side TTS upgrade** — ElevenLabs/Piper for more natural voices
- [ ] **Delivery analytics** — Prosody, pace, filler-word detection, emotion extraction
- [ ] **Content analytics** — Fact-checking, depth scoring
- [ ] **Extend modes** — Debate, MUN, Impromptu Speech
- [ ] **Session recording** — Full audio capture on separate channels

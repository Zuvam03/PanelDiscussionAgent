import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useSpeechRecognition } from '../audio/useSpeechRecognition';
import {
  assignVoices,
  speak,
  cancelAllSpeech,
  VOICE_PARAMS,
} from '../audio/voiceManager';

export default function SessionView({ sessionId, onEnd, onBack }) {
  const [session, setSession] = useState(null);
  const [turns, setTurns] = useState([]);
  const [status, setStatus] = useState('created');
  const [countdown, setCountdown] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [activeSpeaker, setActiveSpeaker] = useState(null);
  const [interimText, setInterimText] = useState('');
  const [personas, setPersonas] = useState({});
  const [voiceMap, setVoiceMap] = useState({});
  const [micAllowed, setMicAllowed] = useState(false);

  const tickRef = useRef(null);
  const clockRef = useRef(null);
  const ttsQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const sendingRef = useRef(false);
  const speechQueueRef = useRef([]);
  const transcriptEnd = useRef(null);

  // ---- send a student message to the API ----
  const sendStudentMessage = useCallback(
    async (text) => {
      sendingRef.current = true;
      try {
        const res = await api.sendMessage(sessionId, text);
        setTurns((prev) => [...prev, ...res.new_turns]);
        setStatus(res.status);

        const agentTurns = res.new_turns.filter((t) => t.speaker !== 'student');
        for (const t of agentTurns) {
          ttsQueueRef.current.push(t);
        }
        processQueue();

        if (res.status === 'ended') {
          clearInterval(tickRef.current);
          clearInterval(clockRef.current);
        }
      } catch (e) {
        console.error('send error:', e);
      } finally {
        sendingRef.current = false;
        if (speechQueueRef.current.length > 0) {
          const queued = speechQueueRef.current.join(' ');
          speechQueueRef.current = [];
          sendStudentMessage(queued);
        } else {
          setActiveSpeaker(null);
        }
      }
    },
    [sessionId],
  );

  // ---- speech recognition ----
  const handleTranscript = useCallback(
    (text) => {
      if (!text) return;
      setInterimText('');

      cancelAllSpeech();
      ttsQueueRef.current = [];
      isSpeakingRef.current = false;
      setActiveSpeaker('student');

      if (sendingRef.current) {
        speechQueueRef.current.push(text);
        return;
      }

      sendStudentMessage(text);
    },
    [sendStudentMessage],
  );

  const handleInterim = useCallback((text) => {
    setInterimText(text);
    setActiveSpeaker('student');
  }, []);

  const { isListening, isSupported, start: startMic, stop: stopMic, pauseForTTS, resumeAfterTTS, forceRestart } =
    useSpeechRecognition({
      onResult: handleTranscript,
      onInterim: handleInterim,
      enabled: status === 'live' || status === 'wrapping',
    });

  // ---- TTS queue processing ----
  async function processQueue() {
    if (isSpeakingRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) {
      resumeAfterTTS();
      return;
    }

    isSpeakingRef.current = true;
    pauseForTTS();
    const voice = voiceMap[next.speaker];
    const archetype = personas[next.speaker]?.archetype;
    const params = VOICE_PARAMS[archetype] || {};

    try {
      await speak(next.text, voice, {
        rate: params.rate,
        pitch: params.pitch,
        onStart: () => setActiveSpeaker(next.speaker),
        onEnd: () => setActiveSpeaker(null),
      });
    } catch {
      // interrupted by barge-in
    }
    isSpeakingRef.current = false;
    processQueue();
  }

  // "Tap to Speak" — user manually interrupts agents
  function handleTapToSpeak() {
    cancelAllSpeech();
    ttsQueueRef.current = [];
    isSpeakingRef.current = false;
    setActiveSpeaker(null);
    forceRestart();
  }

  // ---- session init ----
  useEffect(() => {
    Promise.all([api.getSession(sessionId), api.getConfig()]).then(
      async ([s, cfg]) => {
        setSession(s);
        setTurns(s.turns || []);
        setStatus(s.status);
        setPersonas(cfg.personas);

        const voices = await assignVoices(s.persona_names);
        setVoiceMap(voices);

        if (s.status === 'created') {
          startCountdown(s);
        } else if (s.status === 'live' || s.status === 'wrapping') {
          startTicking();
          startClock(s);
        }
      },
    );
    return () => {
      clearInterval(tickRef.current);
      clearInterval(clockRef.current);
      cancelAllSpeech();
    };
  }, [sessionId]);

  // auto-scroll transcript
  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  // ---- countdown → go live ----
  const startingRef = useRef(false);

  function startCountdown(sess) {
    let remaining = sess.thinking_seconds;
    setCountdown(remaining);
    const interval = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        setCountdown(null);
        if (startingRef.current) return;
        startingRef.current = true;
        api.startSession(sessionId).then(() => {
          setStatus('live');
          startTicking();
          startClock(sess);
          requestMic();
        }).catch(() => {
          setStatus('live');
          startTicking();
          startClock(sess);
          requestMic();
        });
      }
    }, 1000);
  }

  async function requestMic() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicAllowed(true);
      startMic();
    } catch {
      setMicAllowed(false);
    }
  }

  function startClock(sess) {
    const start = sess.started_at || Date.now() / 1000;
    clockRef.current = setInterval(() => {
      setElapsed(Date.now() / 1000 - start);
    }, 1000);
  }

  // ---- silence ticks (agents talk among themselves) ----
  function startTicking() {
    tickRef.current = setInterval(async () => {
      try {
        const res = await api.tick(sessionId);
        if (res.new_turns?.length) {
          setTurns((prev) => [...prev, ...res.new_turns]);
          for (const t of res.new_turns) {
            ttsQueueRef.current.push(t);
          }
          processQueue();
        }
        setStatus(res.status);
        if (res.status === 'ended') {
          clearInterval(tickRef.current);
          clearInterval(clockRef.current);
          stopMic();
          cancelAllSpeech();
        }
      } catch {
        // ignore
      }
    }, 8000);
  }

  async function handleEnd() {
    clearInterval(tickRef.current);
    clearInterval(clockRef.current);
    stopMic();
    cancelAllSpeech();
    await api.endSession(sessionId);
    setStatus('ended');
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  // ---- agent colors ----
  const AGENT_COLORS = [
    '#6c63ff', '#34d399', '#fb923c', '#f87171', '#60a5fa',
  ];
  function agentColor(name) {
    if (!session) return AGENT_COLORS[0];
    const idx = session.persona_names.indexOf(name);
    return AGENT_COLORS[idx % AGENT_COLORS.length];
  }

  // ---- render ----

  if (!session) return <div className="card">Loading session…</div>;

  if (countdown !== null) {
    return (
      <div className="countdown-overlay">
        <p style={{ color: 'var(--text-dim)', marginBottom: 8 }}>
          Topic:{' '}
          <strong style={{ color: 'var(--text)' }}>{session.topic}</strong>
        </p>
        <div className="countdown-number">{countdown}</div>
        <div className="countdown-label">
          Thinking time — gather your thoughts
        </div>
        {!isSupported && (
          <p style={{ color: 'var(--orange)', marginTop: 16, fontSize: '0.85rem' }}>
            Your browser doesn't support speech recognition. Use Chrome or Edge for voice mode.
          </p>
        )}
      </div>
    );
  }

  const isLive = status === 'live' || status === 'wrapping';
  const totalSec = session.duration_minutes * 60;
  const agentSpeaking = activeSpeaker && activeSpeaker !== 'student';

  return (
    <div className="voice-session">
      {/* status bar */}
      <div className="status-bar">
        <div className="status-label">
          <span
            className={`status-dot ${status === 'wrapping' ? 'wrapping' : ''} ${status === 'ended' ? 'ended' : ''}`}
          />
          <span>
            {status === 'live' && 'Live'}
            {status === 'wrapping' && 'Wrap up!'}
            {status === 'ended' && 'Ended'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>
            {formatTime(elapsed)} / {formatTime(totalSec)}
          </span>
          {isLive && (
            <button
              className="btn btn-danger"
              onClick={handleEnd}
              style={{ padding: '4px 12px', fontSize: '0.75rem' }}
            >
              End
            </button>
          )}
          {status === 'ended' && (
            <button
              className="btn btn-primary"
              onClick={() => onEnd(sessionId)}
              style={{ padding: '4px 12px', fontSize: '0.75rem' }}
            >
              View Report
            </button>
          )}
        </div>
      </div>

      {/* topic */}
      <div className="voice-topic">{session.topic}</div>

      {/* participant ring */}
      <div className="participant-ring">
        {/* student circle */}
        <div
          className={`participant you ${activeSpeaker === 'student' ? 'speaking' : ''} ${isListening ? 'listening' : ''}`}
        >
          <div className="participant-avatar" style={{ borderColor: 'var(--accent)' }}>
            🎤
          </div>
          <div className="participant-name">You</div>
          {isListening && !activeSpeaker && (
            <div className="mic-indicator">mic on</div>
          )}
        </div>

        {/* agent circles */}
        {session.persona_names.map((name) => {
          const p = personas[name];
          const color = agentColor(name);
          const isSpeaking = activeSpeaker === name;
          return (
            <div
              key={name}
              className={`participant ${isSpeaking ? 'speaking' : ''}`}
            >
              <div
                className="participant-avatar"
                style={{ borderColor: color }}
              >
                {name[0]}
              </div>
              <div className="participant-name">{name}</div>
              {p && (
                <div className="participant-archetype">
                  {p.archetype.replace(/_/g, ' ')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* live interim display */}
      {interimText && (
        <div className="interim-text">
          <span className="interim-label">You:</span> {interimText}
        </div>
      )}

      {/* Tap to Speak button — visible when agents are talking */}
      {isLive && micAllowed && agentSpeaking && (
        <button className="tap-to-speak-btn" onClick={handleTapToSpeak}>
          Tap to Speak (interrupts agent)
        </button>
      )}

      {/* mic status */}
      {isLive && micAllowed && !agentSpeaking && (
        <div className={`mic-status ${isListening ? 'active' : 'inactive'}`}>
          {isListening ? 'Listening...' : 'Mic restarting...'}
        </div>
      )}

      {/* mic not allowed warning */}
      {isLive && !micAllowed && !isListening && (
        <div className="mic-warning">
          <p>Mic access required for voice mode</p>
          <button className="btn btn-primary" onClick={requestMic}>
            Allow Microphone
          </button>
        </div>
      )}

      {/* scrollable transcript */}
      <div className="voice-transcript">
        <div className="transcript-header">Live Transcript</div>
        <div className="transcript-scroll">
          {turns.map((t) => (
            <div
              key={t.id}
              className={`transcript-line ${t.speaker === 'student' ? 'is-student' : ''}`}
            >
              <span
                className="transcript-speaker"
                style={{
                  color:
                    t.speaker === 'student'
                      ? 'var(--accent)'
                      : agentColor(t.speaker),
                }}
              >
                {t.speaker === 'student' ? 'You' : t.speaker}
              </span>
              {t.move && t.speaker !== 'student' && (
                <span className="move-tag">{t.move}</span>
              )}
              <span className="transcript-text">{t.text}</span>
            </div>
          ))}
          {status === 'wrapping' && (
            <div className="transcript-line system">
              Time is almost up — wrap up your points!
            </div>
          )}
          {status === 'ended' && (
            <div className="transcript-line system">Discussion ended.</div>
          )}
          <div ref={transcriptEnd} />
        </div>
      </div>

      {/* post-session actions */}
      {status === 'ended' && (
        <div style={{ paddingTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => onEnd(sessionId)}>
            View Report
          </button>
          <button className="btn btn-secondary" onClick={onBack}>
            New Session
          </button>
        </div>
      )}
    </div>
  );
}

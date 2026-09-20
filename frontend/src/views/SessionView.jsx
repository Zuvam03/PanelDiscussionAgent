import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useSpeechRecognition } from '../audio/useSpeechRecognition';
import {
  assignVoices,
  speak,
  cancelAllSpeech,
  VOICE_PARAMS,
} from '../audio/voiceManager';

function QuotaBar({ used, limit, color }) {
  const pct = Math.min((used / limit) * 100, 100);
  const remaining = Math.max(limit - used, 0);
  const exhausted = remaining <= 0;
  return (
    <div className="quota-bar-wrap">
      <div className="quota-bar-track">
        <div className="quota-bar-fill" style={{
          width: `${pct}%`,
          background: exhausted ? 'var(--red)' : color,
        }} />
      </div>
      <span className={`quota-label ${exhausted ? 'exhausted' : ''}`}>
        {exhausted ? 'Done' : `${remaining}w left`}
      </span>
    </div>
  );
}

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
  const [agentsTalking, setAgentsTalking] = useState(false);
  const [quota, setQuota] = useState(null);

  const tickRef = useRef(null);
  const clockRef = useRef(null);
  const ttsQueueRef = useRef([]);
  const isSpeakingRef = useRef(false);
  const sendingRef = useRef(false);
  const speechQueueRef = useRef([]);
  const transcriptEnd = useRef(null);
  const voiceMapRef = useRef({});
  const personasRef = useRef({});
  const micStreamRef = useRef(null);
  const micRestartTimer = useRef(null);
  const userSpeakingRef = useRef(false);
  const userSpeakingTimeout = useRef(null);
  const wasAgentsTalking = useRef(false);

  // Keep refs in sync with state so processQueue always has fresh values
  voiceMapRef.current = voiceMap;
  personasRef.current = personas;

  const { isListening, isSupported, start: startMic, stop: stopMic } =
    useSpeechRecognition({
      onResult: handleTranscript,
      onInterim: handleInterim,
    });

  // ---- mic control ----
  function micOn() {
    if (!micAllowed) return;
    clearTimeout(micRestartTimer.current);
    startMic();
    console.log('[mic] ON — listening');
  }

  function micOnDelayed(ms = 600) {
    if (!micAllowed) return;
    clearTimeout(micRestartTimer.current);
    micRestartTimer.current = setTimeout(() => {
      startMic();
      console.log('[mic] ON (delayed) — listening');
    }, ms);
  }

  function micOff() {
    clearTimeout(micRestartTimer.current);
    stopMic();
    console.log('[mic] OFF');
  }

  // ---- speech handlers ----
  function handleTranscript(text) {
    if (!text) return;
    console.log('[mic] GOT TRANSCRIPT:', text);
    setInterimText('');
    clearTimeout(userSpeakingTimeout.current);

    // Barge-in: cancel any agent TTS
    cancelAllSpeech();
    ttsQueueRef.current = [];
    isSpeakingRef.current = false;
    setAgentsTalking(false);
    setActiveSpeaker('student');

    userSpeakingRef.current = false;

    if (sendingRef.current) {
      speechQueueRef.current.push(text);
      return;
    }
    sendStudentMessage(text);
  }

  function handleInterim(text) {
    setInterimText(text);
    setActiveSpeaker('student');
    userSpeakingRef.current = true;
    // Safety timer: if no final result arrives within 4s of the last
    // interim, assume recognition silently died and reset the flag.
    // Without this, userSpeakingRef stays true forever and blocks
    // all agent TTS from playing.
    clearTimeout(userSpeakingTimeout.current);
    userSpeakingTimeout.current = setTimeout(() => {
      if (userSpeakingRef.current) {
        console.log('[mic] userSpeaking safety reset — no final result received');
        userSpeakingRef.current = false;
        setInterimText('');
        flushQueuedTurns();
      }
    }, 4000);
  }

  function flushQueuedTurns() {
    if (ttsQueueRef.current.length > 0 && !isSpeakingRef.current && !sendingRef.current) {
      console.log('[mic] Flushing', ttsQueueRef.current.length, 'queued agent turns');
      micOff();
      setAgentsTalking(true);
      processQueue();
    }
  }

  // ---- send student message ----
  async function sendStudentMessage(text) {
    sendingRef.current = true;
    // DON'T stop mic here — let it keep listening for more input while we wait
    // for the API. The mic will be stopped when TTS starts playing.
    try {
      const res = await api.sendMessage(sessionId, text);
      setTurns((prev) => [...prev, ...res.new_turns]);
      setStatus(res.status);
      if (res.quota) setQuota(res.quota);

      const agentTurns = res.new_turns.filter((t) => t.speaker !== 'student');
      for (const t of agentTurns) {
        ttsQueueRef.current.push(t);
      }
      // If there are any queued turns (from this response OR from earlier
      // ticks that were deferred while user was speaking), start playing them
      if (ttsQueueRef.current.length > 0) {
        micOff();
        setAgentsTalking(true);
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
      }
    }
  }

  // ---- TTS queue ----
  async function processQueue() {
    if (isSpeakingRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) {
      setActiveSpeaker(null);
      // Only restart mic if agents were talking (TTS was active).
      // If no agents spoke, mic is already running — don't touch it.
      if (wasAgentsTalking.current) {
        setAgentsTalking(false);
        wasAgentsTalking.current = false;
        micOnDelayed(700);
      }
      return;
    }

    wasAgentsTalking.current = true;
    isSpeakingRef.current = true;
    micOff();
    const voice = voiceMapRef.current[next.speaker];
    const archetype = personasRef.current[next.speaker]?.archetype;
    const params = VOICE_PARAMS[archetype] || {};

    try {
      await speak(next.text, voice, {
        rate: params.rate,
        pitch: params.pitch,
        onStart: () => setActiveSpeaker(next.speaker),
        onEnd: () => setActiveSpeaker(null),
      });
    } catch {
      // barge-in cancelled it
    }
    isSpeakingRef.current = false;
    processQueue();
  }

  // User presses the interrupt button
  function handleInterrupt() {
    cancelAllSpeech();
    ttsQueueRef.current = [];
    isSpeakingRef.current = false;
    wasAgentsTalking.current = false;
    setAgentsTalking(false);
    setActiveSpeaker(null);
    // Try starting mic immediately — it may work if Chrome releases
    // audio fast enough. Schedule a fallback restart in case it doesn't.
    micOn();
    micRestartTimer.current = setTimeout(() => {
      console.log('[mic] Interrupt fallback restart');
      startMic();
    }, 600);
  }

  // Spacebar shortcut for interrupt
  useEffect(() => {
    function onKey(e) {
      if (e.code === 'Space' && agentsTalking && status !== 'ended') {
        e.preventDefault();
        handleInterrupt();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agentsTalking, status]);

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
      clearTimeout(micRestartTimer.current);
      clearTimeout(userSpeakingTimeout.current);
      cancelAllSpeech();
      // Release mic stream
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, [sessionId]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  // ---- countdown ----
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Release the stream immediately — we only needed the permission.
      // Holding the stream open competes with SpeechRecognition for the mic.
      stream.getTracks().forEach(t => t.stop());
      setMicAllowed(true);
      console.log('[mic] Permission granted, starting recognition');
      startMic();
    } catch (err) {
      console.warn('[mic] Permission denied:', err);
      setMicAllowed(false);
    }
  }

  function startClock(sess) {
    const start = sess.started_at || Date.now() / 1000;
    clockRef.current = setInterval(() => {
      setElapsed(Date.now() / 1000 - start);
    }, 1000);
  }

  // ---- ticks ----
  function startTicking() {
    tickRef.current = setInterval(async () => {
      try {
        const res = await api.tick(sessionId);
        if (res.quota) setQuota(res.quota);
        if (res.new_turns?.length) {
          setTurns((prev) => [...prev, ...res.new_turns]);
          for (const t of res.new_turns) {
            ttsQueueRef.current.push(t);
          }
          // Only kill mic and start TTS if user is NOT actively speaking.
          // If user has interim text or is mid-send, queue the turns
          // but don't interrupt — they'll play after user finishes.
          if (!userSpeakingRef.current && !sendingRef.current) {
            micOff();
            setAgentsTalking(true);
            processQueue();
          }
        }
        setStatus(res.status);
        if (res.status === 'ended') {
          clearInterval(tickRef.current);
          clearInterval(clockRef.current);
          micOff();
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
    micOff();
    cancelAllSpeech();
    await api.endSession(sessionId);
    setStatus('ended');
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  const AGENT_COLORS = ['#6c63ff', '#34d399', '#fb923c', '#f87171', '#60a5fa'];
  function agentColor(name) {
    if (!session) return AGENT_COLORS[0];
    const idx = session.persona_names.indexOf(name);
    return AGENT_COLORS[idx % AGENT_COLORS.length];
  }

  // ---- render ----
  if (!session) return <div className="card">Loading session...</div>;

  if (countdown !== null) {
    return (
      <div className="countdown-overlay">
        <p style={{ color: 'var(--text-dim)', marginBottom: 8 }}>
          Topic: <strong style={{ color: 'var(--text)' }}>{session.topic}</strong>
        </p>
        <div className="countdown-number">{countdown}</div>
        <div className="countdown-label">Thinking time — gather your thoughts</div>
        {!isSupported && (
          <p style={{ color: 'var(--orange)', marginTop: 16, fontSize: '0.85rem' }}>
            Your browser doesn't support speech recognition. Use Chrome or Edge.
          </p>
        )}
      </div>
    );
  }

  const isLive = status === 'live' || status === 'wrapping';
  const totalSec = session.duration_minutes * 60;

  return (
    <div className="voice-session">
      {/* status bar */}
      <div className="status-bar">
        <div className="status-label">
          <span className={`status-dot ${status === 'wrapping' ? 'wrapping' : ''} ${status === 'ended' ? 'ended' : ''}`} />
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
            <button className="btn btn-danger" onClick={handleEnd}
              style={{ padding: '4px 12px', fontSize: '0.75rem' }}>
              End
            </button>
          )}
          {status === 'ended' && (
            <button className="btn btn-primary" onClick={() => onEnd(sessionId)}
              style={{ padding: '4px 12px', fontSize: '0.75rem' }}>
              View Report
            </button>
          )}
        </div>
      </div>

      {/* topic */}
      <div className="voice-topic">{session.topic}</div>

      {/* participant ring */}
      <div className="participant-ring">
        <div className={`participant you ${activeSpeaker === 'student' ? 'speaking' : ''} ${isListening ? 'listening' : ''}`}>
          <div className="participant-avatar" style={{ borderColor: 'var(--accent)' }}>You</div>
          <div className="participant-name">You</div>
          {quota && (
            <QuotaBar used={quota.used.student || 0} limit={quota.limit} color="var(--accent)" />
          )}
        </div>
        {session.persona_names.map((name) => {
          const p = personas[name];
          const color = agentColor(name);
          return (
            <div key={name} className={`participant ${activeSpeaker === name ? 'speaking' : ''}`}>
              <div className="participant-avatar" style={{ borderColor: color }}>{name[0]}</div>
              <div className="participant-name">{name}</div>
              {p && <div className="participant-archetype">{p.archetype.replace(/_/g, ' ')}</div>}
              {quota && (
                <QuotaBar used={quota.used[name] || 0} limit={quota.limit} color={color} />
              )}
            </div>
          );
        })}
      </div>

      {/* Mic control area */}
      {isLive && micAllowed && (() => {
        const studentUsed = quota?.used?.student || 0;
        const studentLeft = quota ? quota.limit - studentUsed : 999;
        const studentExhausted = studentLeft <= 0;
        return (
          <div className="mic-control">
            {studentExhausted ? (
              <div className="mic-exhausted">
                Your word quota is used up — listen and observe
              </div>
            ) : agentsTalking ? (
              <button className="interrupt-btn" onClick={handleInterrupt}>
                <span className="interrupt-icon">&#9995;</span>
                <span>Tap to Interrupt & Speak</span>
                <span className="interrupt-hint">or press Space</span>
              </button>
            ) : isListening ? (
              <div className="mic-live">
                <span className="mic-live-dot" />
                <span>Listening — speak now</span>
                {studentLeft < 60 && <span className="quota-warn">{studentLeft}w left</span>}
              </div>
            ) : (
              <div className="mic-starting">Mic starting...</div>
            )}
          </div>
        );
      })()}

      {isLive && !micAllowed && (
        <div className="mic-warning">
          <p>Mic access required for voice mode</p>
          <button className="btn btn-primary" onClick={requestMic}>Allow Microphone</button>
        </div>
      )}

      {/* interim text */}
      {interimText && (
        <div className="interim-text">
          <span className="interim-label">You:</span> {interimText}
        </div>
      )}

      {/* transcript */}
      <div className="voice-transcript">
        <div className="transcript-header">Live Transcript</div>
        <div className="transcript-scroll">
          {turns.map((t) => (
            <div key={t.id} className={`transcript-line ${t.speaker === 'student' ? 'is-student' : ''}`}>
              <span className="transcript-speaker" style={{
                color: t.speaker === 'student' ? 'var(--accent)' : agentColor(t.speaker),
              }}>
                {t.speaker === 'student' ? 'You' : t.speaker}
              </span>
              {t.move && t.speaker !== 'student' && <span className="move-tag">{t.move}</span>}
              <span className="transcript-text">{t.text}</span>
            </div>
          ))}
          {status === 'wrapping' && <div className="transcript-line system">Time is almost up!</div>}
          {status === 'ended' && <div className="transcript-line system">Discussion ended.</div>}
          <div ref={transcriptEnd} />
        </div>
      </div>

      {status === 'ended' && (
        <div style={{ paddingTop: 12, display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => onEnd(sessionId)}>View Report</button>
          <button className="btn btn-secondary" onClick={onBack}>New Session</button>
        </div>
      )}
    </div>
  );
}

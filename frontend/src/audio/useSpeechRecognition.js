import { useCallback, useEffect, useRef, useState } from 'react';

const SpeechRecognition =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export function useSpeechRecognition({ onResult, onInterim }) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported] = useState(!!SpeechRecognition);

  const recognitionRef = useRef(null);
  const wantRef = useRef(false);
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);
  const restartRef = useRef(null);

  onResultRef.current = onResult;
  onInterimRef.current = onInterim;

  const startRecognition = useCallback(() => {
    if (!SpeechRecognition || !wantRef.current) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.maxAlternatives = 1;

    rec.onstart = () => setIsListening(true);

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          if (text) onResultRef.current?.(text);
        } else {
          interim += r[0].transcript;
        }
      }
      if (interim) onInterimRef.current?.(interim);
    };

    rec.onerror = (e) => {
      if (e.error !== 'aborted' && e.error !== 'no-speech') {
        console.warn('[mic] error:', e.error);
      }
    };

    rec.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      if (wantRef.current) {
        clearTimeout(restartRef.current);
        restartRef.current = setTimeout(() => {
          if (wantRef.current) startRecognition();
        }, 400);
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      recognitionRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    wantRef.current = true;
    clearTimeout(restartRef.current);
    startRecognition();
  }, [startRecognition]);

  const stop = useCallback(() => {
    wantRef.current = false;
    clearTimeout(restartRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  useEffect(() => stop, [stop]);

  return { isListening, isSupported, start, stop };
}

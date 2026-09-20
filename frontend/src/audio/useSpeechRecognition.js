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
  const retryCount = useRef(0);

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

    rec.onstart = () => {
      setIsListening(true);
      retryCount.current = 0;
      console.log('[STT] Recognition started');
    };

    rec.onaudiostart = () => {
      console.log('[STT] Audio capture started');
    };

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) {
          const text = r[0].transcript.trim();
          console.log('[STT] Final result:', text, '(confidence:', r[0].confidence, ')');
          if (text) onResultRef.current?.(text);
        } else {
          interim += r[0].transcript;
        }
      }
      if (interim) onInterimRef.current?.(interim);
    };

    rec.onerror = (e) => {
      console.warn('[STT] Error:', e.error, e.message);
      if (e.error === 'not-allowed') {
        wantRef.current = false;
        setIsListening(false);
        return;
      }
    };

    rec.onend = () => {
      console.log('[STT] Recognition ended, want:', wantRef.current);
      setIsListening(false);
      recognitionRef.current = null;
      if (wantRef.current) {
        retryCount.current += 1;
        // Exponential backoff: 300ms, 600ms, 1200ms, cap at 2s
        const delay = Math.min(300 * Math.pow(2, retryCount.current - 1), 2000);
        console.log('[STT] Auto-restart in', delay, 'ms (retry', retryCount.current, ')');
        clearTimeout(restartRef.current);
        restartRef.current = setTimeout(() => {
          if (wantRef.current) startRecognition();
        }, delay);
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      console.warn('[STT] Failed to start:', err);
      recognitionRef.current = null;
      // Retry after a delay
      if (wantRef.current && retryCount.current < 5) {
        retryCount.current += 1;
        const delay = Math.min(500 * retryCount.current, 2000);
        clearTimeout(restartRef.current);
        restartRef.current = setTimeout(() => {
          if (wantRef.current) startRecognition();
        }, delay);
      }
    }
  }, []);

  const start = useCallback(() => {
    wantRef.current = true;
    retryCount.current = 0;
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

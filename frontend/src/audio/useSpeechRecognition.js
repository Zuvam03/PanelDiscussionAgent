import { useCallback, useEffect, useRef, useState } from 'react';

const SpeechRecognition =
  typeof window !== 'undefined' &&
  (window.SpeechRecognition || window.webkitSpeechRecognition);

export function useSpeechRecognition({ onResult, onInterim, enabled = true }) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported] = useState(!!SpeechRecognition);

  const recognitionRef = useRef(null);
  const activeRef = useRef(false);
  const enabledRef = useRef(enabled);
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);
  const restartTimerRef = useRef(null);
  const pausedForTTSRef = useRef(false);

  enabledRef.current = enabled;
  onResultRef.current = onResult;
  onInterimRef.current = onInterim;

  const createRecognition = useCallback(() => {
    if (!SpeechRecognition) return null;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) onResultRef.current?.(text);
        } else {
          interim += result[0].transcript;
        }
      }
      if (interim) onInterimRef.current?.(interim);
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      console.warn('[STT] error:', event.error);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;

      if (!activeRef.current || !enabledRef.current) return;

      // Don't auto-restart if TTS is playing — Chrome will just kill it again
      if (pausedForTTSRef.current) return;

      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (activeRef.current && enabledRef.current && !recognitionRef.current && !pausedForTTSRef.current) {
          startRecognition();
        }
      }, 300);
    };

    return recognition;
  }, []);

  const startRecognition = useCallback(() => {
    if (!SpeechRecognition || !activeRef.current || !enabledRef.current) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }

    const recognition = createRecognition();
    if (!recognition) return;

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
    }
  }, [createRecognition]);

  const start = useCallback(() => {
    activeRef.current = true;
    pausedForTTSRef.current = false;
    startRecognition();
  }, [startRecognition]);

  const stop = useCallback(() => {
    activeRef.current = false;
    pausedForTTSRef.current = false;
    clearTimeout(restartTimerRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  // Called when TTS starts — stop fighting Chrome, let recognition die
  const pauseForTTS = useCallback(() => {
    pausedForTTSRef.current = true;
    clearTimeout(restartTimerRef.current);
  }, []);

  // Called when ALL TTS finishes — now restart recognition
  const resumeAfterTTS = useCallback(() => {
    pausedForTTSRef.current = false;
    if (activeRef.current && enabledRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (activeRef.current && enabledRef.current && !pausedForTTSRef.current) {
          startRecognition();
        }
      }, 200);
    }
  }, [startRecognition]);

  // Force restart — used by "Tap to Speak" button after cancelling TTS
  const forceRestart = useCallback(() => {
    pausedForTTSRef.current = false;
    clearTimeout(restartTimerRef.current);
    if (activeRef.current && enabledRef.current) {
      startRecognition();
    }
  }, [startRecognition]);

  // Watchdog: only restart if NOT paused for TTS
  useEffect(() => {
    if (!isSupported) return;
    const watchdog = setInterval(() => {
      if (activeRef.current && enabledRef.current && !recognitionRef.current && !pausedForTTSRef.current) {
        startRecognition();
      }
    }, 3000);
    return () => clearInterval(watchdog);
  }, [isSupported, startRecognition]);

  useEffect(() => {
    return stop;
  }, [stop]);

  return { isListening, isSupported, start, stop, pauseForTTS, resumeAfterTTS, forceRestart };
}

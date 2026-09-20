/**
 * Voice manager — assigns a distinct browser SpeechSynthesis voice to each
 * agent and queues TTS utterances with barge-in support.
 *
 * Each agent gets a unique voice picked from the system's available voices,
 * preferring English voices with different names so the student can tell
 * agents apart by ear.
 */

let voicesLoaded = false;
let voicePool = [];

function loadVoices() {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const tryLoad = () => {
      const all = synth.getVoices();
      if (all.length > 0) {
        voicePool = all.filter((v) => v.lang.startsWith('en'));
        if (voicePool.length === 0) voicePool = all;
        voicesLoaded = true;
        resolve(voicePool);
      }
    };
    tryLoad();
    if (!voicesLoaded) {
      synth.addEventListener('voiceschanged', tryLoad, { once: true });
      setTimeout(() => {
        if (!voicesLoaded) {
          voicePool = synth.getVoices();
          voicesLoaded = true;
          resolve(voicePool);
        }
      }, 2000);
    }
  });
}

export async function assignVoices(agentNames) {
  await loadVoices();
  const assignments = {};

  // Try to spread voices across agents — prefer variety in name/gender
  const available = [...voicePool];
  for (const name of agentNames) {
    if (available.length > 0) {
      const idx = simpleHash(name) % available.length;
      assignments[name] = available.splice(idx, 1)[0];
    } else {
      // ran out of unique voices, cycle back
      assignments[name] = voicePool[simpleHash(name) % voicePool.length];
    }
  }
  return assignments;
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Speaks text with a given voice. Returns a promise that resolves when done
 * or rejects if cancelled (barge-in).
 */
export function speak(text, voice, { rate = 1.05, pitch = 1.0, onStart, onEnd } = {}) {
  return new Promise((resolve, reject) => {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.onstart = () => onStart?.();
    utterance.onend = () => { onEnd?.(); resolve(); };
    utterance.onerror = (e) => {
      onEnd?.();
      if (e.error === 'canceled' || e.error === 'interrupted') {
        reject(new Error('interrupted'));
      } else {
        resolve(); // swallow other errors, don't block the queue
      }
    };
    synth.speak(utterance);
  });
}

/** Cancel all current and queued speech immediately (barge-in). */
export function cancelAllSpeech() {
  window.speechSynthesis.cancel();
}

/** Pitch variation per agent archetype so voices are more distinct. */
export const VOICE_PARAMS = {
  aggressive_dominator: { rate: 1.15, pitch: 0.85 },
  data_driven_analyst:  { rate: 1.0,  pitch: 1.05 },
  quiet_but_sharp:      { rate: 0.9,  pitch: 1.1  },
  devils_advocate:      { rate: 1.05, pitch: 0.95 },
  consensus_builder:    { rate: 0.95, pitch: 1.0  },
};

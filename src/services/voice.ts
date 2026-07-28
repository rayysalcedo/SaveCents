// M5: voice layer for Cents.
//
// Live speech-to-text needs expo-speech-recognition, which is a native module
// and CANNOT run inside Expo Go (this is the known M4/handoff constraint — it
// requires the one-time `eas build --profile development` dev build).
//
// The entire premium voice UI (pulse rings, live transcript, send-on-finish)
// is built and wired NOW; this file is the only seam. When you switch to the
// dev build:
//   1. npm install expo-speech-recognition --legacy-peer-deps
//   2. Replace `loadVoiceModule` below with:
//        const loadVoiceModule = () => require('expo-speech-recognition');
//      (Metro can only resolve the require once the package is installed —
//       that's why it isn't a dynamic import today.)
// Nothing else changes: VoiceOverlay picks it up automatically.

export interface VoiceSession {
  stop: () => void;
  cancel: () => void;
}

interface StartOpts {
  lang?: string; // e.g. 'en-PH' / 'fil-PH'
  onPartial: (transcript: string) => void;
  onFinal: (transcript: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

// ── The seam ────────────────────────────────────────────────────────────────
const loadVoiceModule = (): any | null => null;
// ────────────────────────────────────────────────────────────────────────────

const mod = (() => {
  try {
    return loadVoiceModule();
  } catch {
    return null;
  }
})();

export function voiceAvailable(): boolean {
  return !!mod?.ExpoSpeechRecognitionModule;
}

export async function startListening(opts: StartOpts): Promise<VoiceSession | null> {
  if (!voiceAvailable()) return null;
  const M = mod.ExpoSpeechRecognitionModule;

  const perm = await M.requestPermissionsAsync();
  if (!perm.granted) {
    opts.onError('Microphone permission is needed for voice.');
    return null;
  }

  const subs: { remove: () => void }[] = [];
  const listen = (event: string, cb: (e: any) => void) => {
    subs.push(mod.addSpeechRecognitionListener(event, cb));
  };

  let finalSent = false;
  listen('result', (e: any) => {
    const text: string = e?.results?.[0]?.transcript ?? '';
    if (!text) return;
    if (e.isFinal) {
      finalSent = true;
      opts.onFinal(text);
    } else {
      opts.onPartial(text);
    }
  });
  listen('error', (e: any) => opts.onError(e?.message ?? 'Speech recognition error'));
  listen('end', () => {
    if (!finalSent) opts.onEnd();
    subs.forEach((s) => s.remove());
  });

  M.start({
    lang: opts.lang ?? 'en-PH',
    interimResults: true,
    continuous: false,
  });

  return {
    stop: () => M.stop(),
    cancel: () => {
      try { M.abort(); } catch { M.stop(); }
      subs.forEach((s) => s.remove());
    },
  };
}

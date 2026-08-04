// M5.8: voice layer for Cents. TWO paths, ONE interface, and VoiceOverlay
// adapts automatically via voiceMode():
//
//  * 'recorded' (works in Expo Go, the current default): record the voice
//    note with expo-audio, then transcribe it through the SAME Firebase AI
//    Logic channel as chat and scan (transcribeAudio in cents.ts). No native
//    module, no API key in the app, and Taglish comes back clean because
//    Gemini does the listening. No live partials: the user speaks, taps
//    send, and the transcript arrives in one piece.
//
//  * 'stream' (the dev-build upgrade): live partial transcripts via
//    expo-speech-recognition. The seam below is UNCHANGED from M5 - when the
//    dev build lands:
//      1. npm install expo-speech-recognition --legacy-peer-deps
//      2. Replace `loadVoiceModule` below with:
//           const loadVoiceModule = () => require('expo-speech-recognition');
//         (Metro can only resolve the require once the package is installed -
//          that's why it isn't a dynamic import today.)
//    VoiceOverlay picks the stream path up automatically and shows live
//    captions again. Nothing else changes.
//
//  * 'none': Firebase is not configured AND there is no native module -
//    the overlay falls back to its type-instead note.

import {
  AudioModule,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type RecordingOptions,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { transcribeAudio } from './cents';
import { isFirebaseConfigured } from './firebaseApp';

export interface VoiceSession {
  stop: () => void;   // recorded: stop + process + deliver; stream: finish
  cancel: () => void; // discard everything, no callbacks after this
  // Recorded path only (M5.12): pause the mic mid-turn without ending it.
  // resume() keeps recording the SAME turn. While paused, if speech was
  // already captured and the pause lasts SILENCE_HOLD_MS, the turn is
  // processed automatically; with nothing captured it just stays paused.
  pause?: () => void;
  resume?: () => void;
}

interface StartOpts {
  lang?: string; // e.g. 'en-PH' / 'fil-PH' (stream path only; Gemini auto-detects)
  onPartial: (transcript: string) => void;
  onLevel?: (level: number) => void; // recorded path: live mic level 0..1, ~12x/sec (drives the waveform)
  onTranscribing?: () => void; // recorded path: mic stopped, Gemini is listening back
  onFinal: (transcript: string) => void;
  // Recorded path (M5.12): when provided, the raw audio is handed up INSTEAD
  // of being transcribed here — the store sends it to the combined
  // transcribe-plus-intent brain (parseCentsVoice), saving a full roundtrip.
  // onFinal is not called in that flow.
  onAudio?: (base64: string, mimeType: string) => void;
  onError: (message: string) => void;
  onEnd: () => void; // ended without a usable transcript
  // Recorded path: auto-stop and send about a second after the speaker goes
  // quiet (hands-free turn taking). Manual stop() still works at any time.
  autoStopOnSilence?: boolean;
}

// ── The dev-build seam (do not remove) ──────────────────────────────────────
const loadVoiceModule = (): any | null => null;
// ────────────────────────────────────────────────────────────────────────────

const mod = (() => {
  try {
    return loadVoiceModule();
  } catch {
    return null;
  }
})();

export type VoiceMode = 'stream' | 'recorded' | 'none';

export function voiceMode(): VoiceMode {
  if (mod?.ExpoSpeechRecognitionModule) return 'stream';
  if (isFirebaseConfigured()) return 'recorded';
  return 'none';
}

export function voiceAvailable(): boolean {
  return voiceMode() !== 'none';
}

export async function startListening(opts: StartOpts): Promise<VoiceSession | null> {
  const mode = voiceMode();
  if (mode === 'stream') return startStream(opts);
  if (mode === 'recorded') return startRecorded(opts);
  return null;
}

// ── Recorded path (Expo Go) ─────────────────────────────────────────────────

// AAC mono 16kHz on BOTH platforms: plenty for speech, small enough that a
// full 30s note uploads in a beat. (LOW_QUALITY is avoided on purpose - its
// Android flavor is 3gp/AMR, which the model handles poorly.)
const VOICE_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 48000,
  isMeteringEnabled: true, // powers the live waveform + silence auto-stop
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
};

const MAX_NOTE_SECONDS = 30;    // hard cap; auto-stops and sends
const MIN_NOTE_SECONDS = 0.5;   // shorter than this = accidental tap, discard
const METER_INTERVAL_MS = 80;   // level callback + silence checks
const SPEECH_LEVEL = 0.3;       // normalized level counted as "speaking"
const SILENCE_HOLD_MS = 5000;   // owner call (M5.11): think automatically after ~5s of quiet; Mute sends immediately

// Recorder metering is in dBFS, roughly -60 (silence) to 0 (max). Map the
// useful speech band to 0..1.
const meterToLevel = (dB: number) => Math.max(0, Math.min(1, (dB + 50) / 50));

function guessMime(uri: string): string {
  const u = uri.toLowerCase();
  if (u.endsWith('.wav')) return 'audio/wav';
  if (u.endsWith('.3gp')) return 'audio/3gpp';
  if (u.endsWith('.aac')) return 'audio/aac';
  return 'audio/mp4'; // .m4a / .mp4
}

async function startRecorded(opts: StartOpts): Promise<VoiceSession | null> {
  const perm = await requestRecordingPermissionsAsync();
  if (!perm.granted) {
    opts.onError('Microphone permission is needed for voice. You can enable it in Settings.');
    return null;
  }

  try {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  } catch {}

  const recorder = new AudioModule.AudioRecorder(VOICE_RECORDING);
  let phase: 'recording' | 'busy' | 'done' = 'recording';
  let cancelled = false;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let meterTimer: ReturnType<typeof setInterval> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let everSpoke = false;
  let paused = false;
  let lastLoudAt = 0;

  const resetAudioMode = () => {
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
  };
  const discardFile = (uri: string | null) => {
    if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  };
  const release = () => {
    try { recorder.release(); } catch {}
  };
  const stopMeter = () => {
    if (meterTimer) { clearInterval(meterTimer); meterTimer = null; }
  };
  const clearGrace = () => {
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
  };

  const finishStop = async () => {
    if (phase !== 'recording') return; // idempotent: stop after stop is a no-op
    phase = 'busy';
    if (capTimer) { clearTimeout(capTimer); capTimer = null; }
    stopMeter();
    clearGrace();

    // With metering we KNOW whether speech happened; pure silence (or an
    // accidental tap) is never sent to the model.
    const heardEnough = recorder.currentTime >= MIN_NOTE_SECONDS && everSpoke;
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch {}
    resetAudioMode();

    if (cancelled) { phase = 'done'; discardFile(uri); release(); return; }
    if (!heardEnough || !uri) {
      phase = 'done'; discardFile(uri); release();
      opts.onEnd();
      return;
    }

    opts.onTranscribing?.();
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      // M5.12 fast path: hand the audio up for the ONE-roundtrip brain.
      if (opts.onAudio) {
        phase = 'done'; discardFile(uri); release();
        if (!cancelled) opts.onAudio(base64, guessMime(uri));
        return;
      }
      const text = await transcribeAudio(base64, guessMime(uri));
      phase = 'done'; discardFile(uri); release();
      if (cancelled) return;
      if (text) opts.onFinal(text);
      else opts.onEnd();
    } catch (e: any) {
      phase = 'done'; discardFile(uri); release();
      if (cancelled) return;
      const msg = String(e?.message ?? e);
      opts.onError(
        msg.includes('cents-overloaded')
          ? 'Cents is a little swamped right now. Tap the mic to try again.'
          : 'Could not reach Cents. Check your connection and tap the mic to try again.',
      );
    }
  };

  try {
    await recorder.prepareToRecordAsync();
    recorder.record();
  } catch {
    resetAudioMode();
    release();
    opts.onError('Could not start the microphone. Tap the mic to try again.');
    return null;
  }

  capTimer = setTimeout(finishStop, MAX_NOTE_SECONDS * 1000);

  // Meter loop: feeds the waveform and, when enabled, ends the turn about a
  // second after the speaker goes quiet. Interval work is tiny (one native
  // getStatus + one callback) and always cleared with the session.
  meterTimer = setInterval(() => {
    if (phase !== 'recording') { stopMeter(); return; }
    if (paused) { opts.onLevel?.(0); return; } // flat wave, no silence countdown
    let level = 0;
    try {
      const st = recorder.getStatus();
      level = meterToLevel(st.metering ?? -60);
    } catch {}
    opts.onLevel?.(level);
    const t = Date.now();
    if (level >= SPEECH_LEVEL) { everSpoke = true; lastLoudAt = t; }
    if (opts.autoStopOnSilence && everSpoke && t - lastLoudAt >= SILENCE_HOLD_MS) finishStop();
  }, METER_INTERVAL_MS);

  return {
    stop: () => { finishStop(); },
    pause: () => {
      if (phase !== 'recording' || paused) return;
      paused = true;
      try { recorder.pause(); } catch {}
      clearGrace();
      if (everSpoke) graceTimer = setTimeout(() => { if (paused) finishStop(); }, SILENCE_HOLD_MS);
    },
    resume: () => {
      if (phase !== 'recording' || !paused) return;
      clearGrace();
      paused = false;
      lastLoudAt = Date.now(); // fresh silence window for the resumed turn
      try { recorder.record(); } catch {}
    },
    cancel: () => {
      cancelled = true;
      if (phase === 'recording') {
        if (capTimer) { clearTimeout(capTimer); capTimer = null; }
        stopMeter();
        clearGrace();
        phase = 'busy';
        recorder
          .stop()
          .then(() => { discardFile(recorder.uri); })
          .catch(() => {})
          .finally(() => { phase = 'done'; release(); });
        resetAudioMode();
      }
      // 'busy': transcription may still be in flight; the cancelled flag
      // guarantees no callback ever fires after this point.
    },
  };
}

// ── Stream path (dev build, expo-speech-recognition) ────────────────────────

async function startStream(opts: StartOpts): Promise<VoiceSession | null> {
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

// M5.9: Cents speaks. Voice OUTPUT for Cents replies, two engines behind one
// call, best-first:
//
//  1. GEMINI TTS (the real Cents voice): firebase/ai's beta speechConfig on
//     plain generateContent, through the exact same no-key Firebase AI Logic
//     channel as everything else. Natural HD voice, handles Taglish properly
//     (device voices cannot: iOS ships no Filipino voice at all). Returns raw
//     16-bit PCM which we wrap in a WAV header and play with expo-audio.
//  2. DEVICE TTS (fallback): expo-speech system voice, offline and instant,
//     used when the Gemini TTS call fails, the models are missing, or the
//     backend rejects audio output (the support is beta; if it is rejected
//     once we stop asking for the rest of the session).
//
// The caller decides WHEN Cents speaks (store/finance.ts: replies to voice
// messages, when the Profile "Cents voice" toggle is on). This module only
// knows HOW. stopCentsVoice() silences either engine and is safe to call any
// time, from anywhere (ui.ts calls it on chat/voice close, finance.ts on any
// new message).

import { Platform } from 'react-native';
import { GoogleAIBackend, ResponseModality, getAI, getGenerativeModel } from 'firebase/ai';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as DeviceSpeech from 'expo-speech';
import { getFirebaseApp, isFirebaseConfigured } from './firebaseApp';
import { DEV_GEMINI_TTS_KEY } from './devGeminiKey';

// M5.16: the Cents voice roster the owner can pick from (Profile > Voice).
// Prebuilt Chirp HD voices; extend by adding entries (id = prebuilt voice
// name). Gender steers the DEVICE fallback picker so a fallback reply never
// flips gender mid-conversation.
export const CENTS_VOICES = [
  { id: 'Puck', label: 'Puck (male)', gender: 'male' as const },
  { id: 'Leda', label: 'Leda (female)', gender: 'female' as const },
];
const DEFAULT_VOICE = 'Puck';
export type CentsVoiceStyle = 'english' | 'taglish';

const styleInstruction = (style: CentsVoiceStyle) =>
  style === 'taglish'
    ? 'Read this out loud like a relaxed Filipino friend chatting casually. The text may be English, Tagalog, or Taglish; keep every word exactly as written and give Tagalog words a natural, easy Filipino pronunciation:'
    : 'Read this out loud naturally, like a relaxed guy casually talking to a friend. The text may be English, Tagalog, or Taglish; keep every word exactly as written and pronounce each language naturally, no exaggerated accent:';

// TTS-capable model names, newest first. Retired/unknown names 404 and the
// loop moves on, same convention as MODEL_CANDIDATES in cents.ts. (At launch:
// Remote Config, together with the text models.)
const TTS_CANDIDATES = [
  'gemini-3.1-flash-tts-preview',
  'gemini-3.1-flash-preview-tts',
  'gemini-3-flash-preview-tts',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
];
let workingTtsIndex = 0;

// If the backend refuses audio output entirely (beta surface), remember and
// stop burning a failed request before every reply this session.
let geminiTtsUnsupported = false;

const MISSING_MODEL = /404|not found|not supported|does not exist/i;

const RETRYABLE_TTS = /\b(500|503)\b|overloaded|unavailable|try again|internal error|network request failed/i;
// M5.22: 429s are QUOTA, not a blip - retrying the same model burns more
// quota and adds latency to every reply. Quota errors skip to the next
// candidate (separate quota pool); if every candidate is quota-limited, the
// proxy path rests for 10 minutes (device/dev-bridge voices carry it) and
// then quietly tries again.
const QUOTA_TTS = /\b429\b|quota|rate limit|resource exhausted/i;
let ttsQuotaCooldownUntil = 0;
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ttsModelCache = new Map<string, ReturnType<typeof getGenerativeModel>>();
function getTtsModel(name: string, voice: string) {
  const key = `${name}:${voice}`;
  let m = ttsModelCache.get(key);
  if (!m) {
    const ai = getAI(getFirebaseApp(), { backend: new GoogleAIBackend() });
    m = getGenerativeModel(ai, {
      model: name,
      generationConfig: {
        responseModalities: [ResponseModality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    });
    ttsModelCache.set(key, m);
  }
  return m;
}

// ── PCM → WAV (Gemini TTS returns headerless 16-bit mono PCM) ───────────────

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return globalThis.btoa(bin);
}

function pcm16ToWavBase64(pcmBase64: string, sampleRate: number): string {
  const pcm = base64ToBytes(pcmBase64);
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  const byteRate = sampleRate * 2; // mono, 16-bit
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);      // fmt chunk size
  v.setUint16(20, 1, true);       // PCM
  v.setUint16(22, 1, true);       // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, 2, true);       // block align
  v.setUint16(34, 16, true);      // bits per sample
  writeStr(36, 'data');
  v.setUint32(40, pcm.length, true);
  const wav = new Uint8Array(44 + pcm.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return bytesToBase64(wav);
}

// Gemini TTS mimeType looks like "audio/L16;codec=pcm;rate=24000".
function rateFromMime(mime: string): number {
  const m = /rate=(\d+)/.exec(mime);
  return m ? parseInt(m[1], 10) : 24000;
}

// ── Playback state (one voice at a time) ────────────────────────────────────

let player: AudioPlayer | null = null;
let playerFile: string | null = null;
let generation = 0; // bumped by every speak/stop; stale async work checks it

// M5.10: whoever wants to know when Cents starts/stops talking (the voice
// overlay drives its conversation loop and speaking waveform off this).
const speechListeners = new Set<(speaking: boolean) => void>();
let speakingNow = false;
function notifySpeaking(v: boolean) {
  if (speakingNow === v) return;
  speakingNow = v;
  speechListeners.forEach((cb) => { try { cb(v); } catch {} });
}
export function isCentsSpeaking(): boolean { return speakingNow; }

// M5.19: captions must show EXACTLY what the voice says (they diverged when
// the voice read speechReply while captions showed the card prompt). Every
// speakAsCents records its final sanitized text + a counter; the overlay
// compares counters around a send to know whether speech happened and what
// it said.
let spokenCounter = 0;
let lastSpokenText = '';
export function getSpokenState(): { counter: number; text: string } {
  return { counter: spokenCounter, text: lastSpokenText };
}
export function onCentsSpeech(cb: (speaking: boolean) => void): () => void {
  speechListeners.add(cb);
  return () => { speechListeners.delete(cb); };
}

// M5.20: fires when AUDIO actually starts playing (synthesis finished) - the
// caption reveal syncs to this, not to the floor-hold which fires at
// synthesis START and would race the voice by seconds.
const audioStartListeners = new Set<() => void>();
function notifyAudioStart() {
  audioStartListeners.forEach((cb) => { try { cb(); } catch {} });
}
export function onCentsAudioStart(cb: () => void): () => void {
  audioStartListeners.add(cb);
  return () => { audioStartListeners.delete(cb); };
}

function teardownPlayer() {
  if (player) {
    try { player.pause(); } catch {}
    try { player.release(); } catch {}
    player = null;
  }
  if (playerFile) {
    FileSystem.deleteAsync(playerFile, { idempotent: true }).catch(() => {});
    playerFile = null;
  }
}

export function stopCentsVoice() {
  generation++;
  teardownPlayer();
  DeviceSpeech.stop();
  notifySpeaking(false);
}

// ── The voice ───────────────────────────────────────────────────────────────

// M5.16: chat text is written for READING (₱, symbols, terse fragments);
// speech needs SAYABLE text. Fix the symbols the voice mangles, then cap at
// ~2 sentences' worth on a boundary.
function sanitizeForSpeech(text: string): string {
  let t = text
    .replace(/₱\s?(\d[\d,]*(?:\.\d{1,2})?)/g, '$1 pesos')  // ₱250 → 250 pesos (sentence periods survive)
    .replace(/\bPHP\s?(\d[\d,]*(?:\.\d{1,2})?)/gi, '$1 pesos')
    .replace(/(\d)%/g, '$1 percent')
    .replace(/[&]/g, ' and ')
    .replace(/[*_`#>|~^]/g, ' ')             // markdown-ish noise
    .replace(/[\u2713\u2714\u2192\u2022•→✓✔]/g, ' ')
    .replace(/\(([^)]{0,3})\)/g, ' ')       // tiny parentheticals like (₱)
    .replace(/\.{3,}/g, ', ')
    .replace(/!{2,}/g, '!')
    .replace(/\?{2,}/g, '?')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= 320) return t;
  const cut = t.slice(0, 320);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > 80 ? cut.slice(0, stop + 1) : cut;
}

// Shared playback tail for both Gemini TTS paths: wrap the raw PCM in a WAV
// header, write it, play it, clean up after.
async function playPcm(pcmBase64: string, mimeType: string, myGen: number): Promise<boolean> {
  const wavB64 = pcm16ToWavBase64(pcmBase64, rateFromMime(mimeType));
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const file = `${dir}cents-voice-${Date.now()}.wav`;
  await FileSystem.writeAsStringAsync(file, wavB64, { encoding: FileSystem.EncodingType.Base64 });
  if (myGen !== generation) { FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {}); return true; }

  try { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }); } catch {}
  teardownPlayer();
  playerFile = file;
  player = createAudioPlayer({ uri: file });
  player.addListener('playbackStatusUpdate', (status) => {
    if (status.didJustFinish && myGen === generation) {
      teardownPlayer();
      notifySpeaking(false);
    }
  });
  notifySpeaking(true);
  notifyAudioStart();
  player.play();
  return true;
}

// M5.15 DEV bridge: when the Firebase proxy refuses TTS, a personal key in
// devGeminiKey.ts (dev builds only, never production) calls the Gemini API
// directly so the REAL Cents voice is audible during development.
const DIRECT_TTS_MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview'];
let directTtsDead = false;

async function speakWithGeminiDirect(
  text: string,
  myGen: number,
  voice: string,
  style: CentsVoiceStyle,
): Promise<boolean> {
  if (!__DEV__ || !DEV_GEMINI_TTS_KEY || directTtsDead) return false;
  for (const model of DIRECT_TTS_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${DEV_GEMINI_TTS_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${styleInstruction(style)} ${text}` }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
          }),
        },
      );
      if (!res.ok) {
        if (res.status === 404) continue; // unknown model on this API version
        if ([429, 500, 503].includes(res.status)) {
          console.warn('[Cents TTS direct] transient', res.status, '- device voice for this reply only');
          return false; // this reply only; the bridge stays alive
        }
        console.warn('[Cents TTS direct] rejected:', res.status, (await res.text()).slice(0, 200));
        directTtsDead = true;
        return false;
      }
      if (myGen !== generation) return true;
      const json = await res.json();
      const part = json?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data);
      if (!part) return false;
      return playPcm(part.inlineData.data, part.inlineData.mimeType ?? '', myGen);
    } catch (e: any) {
      console.warn('[Cents TTS direct] error:', String(e?.message ?? e).slice(0, 200));
      return false;
    }
  }
  directTtsDead = true;
  return false;
}

async function speakWithGemini(
  text: string,
  myGen: number,
  voice: string,
  style: CentsVoiceStyle,
): Promise<boolean> {
  if (geminiTtsUnsupported || !isFirebaseConfigured()) return false;
  if (Date.now() < ttsQuotaCooldownUntil) return false; // resting after quota

  let allMissing = true;
  let sawQuota = false;
  for (let i = workingTtsIndex; i < TTS_CANDIDATES.length; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        allMissing = false;
        const m = getTtsModel(TTS_CANDIDATES[i], voice);
        const result = await m.generateContent({
          contents: [{ role: 'user', parts: [{ text: `${styleInstruction(style)} ${text}` }] }],
        });
        if (myGen !== generation) return true; // superseded; swallow silently
        const audio = result.response.inlineDataParts?.()?.[0]?.inlineData;
        if (!audio?.data) return false;

        workingTtsIndex = i;
        return playPcm(audio.data, audio.mimeType ?? '', myGen);
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (MISSING_MODEL.test(msg)) {
          allMissing = true;
          // Dead name: skip it for the rest of the session instead of paying
          // a failed request before every reply.
          if (i + 1 < TTS_CANDIDATES.length) workingTtsIndex = i + 1;
          break; // next candidate
        }
        // M5.16: TRANSIENT errors (overload, network blip) must NOT flip the
        // whole session to the device voice - that is exactly the
        // mid-conversation voice change the owner heard. Retry once, then
        // fall back for THIS reply only.
        if (QUOTA_TTS.test(msg)) {
          sawQuota = true;
          allMissing = false;
          break; // do NOT retry a quota-limited model; the next candidate has its own pool
        }
        if (RETRYABLE_TTS.test(msg)) {
          if (attempt === 0) { await sleepMs(700); continue; }
          if (myGen === generation) console.warn('[Cents TTS] transient error, device voice for this reply only:', msg.slice(0, 160));
          return false;
        }
        // Structural rejection (invalid argument, permission): the proxy does
        // not do TTS here. Device voice for the session. Diagnosis line:
        console.warn('[Cents TTS unavailable, using device voice]', msg.slice(0, 220));
        geminiTtsUnsupported = true;
        return false;
      }
    }
  }
  if (sawQuota) {
    ttsQuotaCooldownUntil = Date.now() + 10 * 60_000;
    console.warn('[Cents TTS] voice quota hit on every model; resting the Gemini voice for 10 minutes (device or dev-bridge voice meanwhile)');
    return false;
  }
  if (allMissing) {
    console.warn('[Cents TTS] no TTS-capable model name was accepted; using the device voice from now on');
    geminiTtsUnsupported = true;
  }
  return false;
}

// M5.14: the device fallback must be a GUY too (owner call) - iOS defaults
// to a female voice. Scan the installed voices once and pick a known male
// English voice; if none matches, drop the pitch as a last resort.
const VOICE_HINTS: Record<'male' | 'female', string[]> = {
  male: ['aaron', 'alex', 'daniel', 'arthur', 'evan', 'nathan', 'oliver', 'fred',
    'rishi', 'gordon', 'reed', 'tom', '#male', 'male_1', 'male_2'],
  female: ['samantha', 'karen', 'moira', 'martha', 'serena', 'ava', 'allison',
    'susan', 'zoe', 'nicky', 'tessa', '#female', 'female_1', 'female_2'],
};
const pickedDeviceVoice: Partial<Record<'male' | 'female', string | null>> = {};

async function pickDeviceVoice(gender: 'male' | 'female'): Promise<string | undefined> {
  if (gender in pickedDeviceVoice) return pickedDeviceVoice[gender] ?? undefined;
  try {
    const voices = await DeviceSpeech.getAvailableVoicesAsync();
    const english = voices.filter((v) => (v.language ?? '').toLowerCase().startsWith('en'));
    const matches = (v: { name?: string; identifier?: string }) => {
      const hay = `${v.name ?? ''} ${v.identifier ?? ''}`.toLowerCase();
      return VOICE_HINTS[gender].some((h) => hay.includes(h));
    };
    // Enhanced-quality voices sound like a person; compact ones sound like a
    // robot. (Owner tip: iPhone Settings > Accessibility > Spoken Content >
    // Voices > English lets you DOWNLOAD an Enhanced voice; this grabs it.)
    const hit =
      english.find((v) => String(v.quality) === 'Enhanced' && matches(v)) ??
      english.find(matches);
    pickedDeviceVoice[gender] = hit?.identifier ?? null;
    if (hit) console.log('[Cents voice] device fallback voice:', hit.name, `(${hit.quality})`);
    return hit?.identifier;
  } catch {
    pickedDeviceVoice[gender] = null;
    return undefined;
  }
}

async function speakWithDevice(text: string, lang: 'en' | 'fil', gender: 'male' | 'female') {
  // iOS has no Filipino voice; en-PH does not exist either, so English voices
  // carry Taglish as best they can. Android resolves fil-PH via Google TTS.
  const voiceId = await pickDeviceVoice(gender);
  const language = lang === 'fil'
    ? (Platform.OS === 'android' ? 'fil-PH' : 'en-US')
    : 'en-US';
  notifySpeaking(true);
  notifyAudioStart();
  DeviceSpeech.speak(text, {
    language,
    voice: voiceId,
    rate: 1.0,
    // Only nudge the pitch when no matching voice could be selected.
    pitch: voiceId ? 1.0 : gender === 'male' ? 0.85 : 1.0,
    onDone: () => notifySpeaking(false),
    onStopped: () => notifySpeaking(false),
    onError: () => notifySpeaking(false),
  });
}

// Speak a Cents reply aloud. Fire-and-forget: never throws, never blocks the
// chat pipeline, and a newer speak/stop always silences an older one. The
// voice/style come from the owner's Profile settings (passed by the store) so
// the voice NEVER changes inside a conversation.
export interface CentsVoiceOpts {
  voiceName?: string;               // one of CENTS_VOICES ids
  style?: CentsVoiceStyle;          // 'english' | 'taglish' delivery
}

export function speakAsCents(text: string, lang: 'en' | 'fil' = 'en', opts?: CentsVoiceOpts) {
  const spoken = sanitizeForSpeech(text);
  if (!spoken) return;
  lastSpokenText = spoken;
  spokenCounter += 1;
  const voice = CENTS_VOICES.find((v) => v.id === opts?.voiceName) ?? CENTS_VOICES.find((v) => v.id === DEFAULT_VOICE)!;
  const style: CentsVoiceStyle = opts?.style === 'taglish' ? 'taglish' : 'english';
  stopCentsVoice();
  // Cents takes the floor NOW, while synthesis runs: listeners (the voice
  // overlay) hold the mic closed instead of racing the network. The floor is
  // released by playback ending, an error, or stopCentsVoice().
  notifySpeaking(true);
  const myGen = generation;
  speakWithGemini(spoken, myGen, voice.id, style)
    .then(async (ok) => {
      if (!ok && myGen === generation) ok = await speakWithGeminiDirect(spoken, myGen, voice.id, style);
      if (!ok && myGen === generation) speakWithDevice(spoken, lang, voice.gender);
    })
    .catch(() => {
      if (myGen === generation) speakWithDevice(spoken, lang, voice.gender);
      else notifySpeaking(false);
    });
}

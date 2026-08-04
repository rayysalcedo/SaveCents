// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY natural voice bridge (M5.15). OPTIONAL. Default: off (empty key).
//
// The production design rule stands: NO API key ships in the app - all AI
// goes through Firebase AI Logic. But while the AI Logic proxy on this
// project rejects TTS output (see the [Cents TTS unavailable] console line),
// the natural Cents voice can still be heard in DEVELOPMENT by calling the
// Gemini API directly with a personal key:
//
//   1. Get a free key at https://aistudio.google.com/apikey (same Google
//      account as the Firebase project).
//   2. Paste it below. This file is meant to stay LOCAL - add it to
//      .gitignore, like firebaseConfig.ts.
//   3. Restart with npx expo start -c.
//
// The key is used ONLY in __DEV__ builds, ONLY for text-to-speech, and ONLY
// after the Firebase proxy path has failed. Production/TestFlight builds
// ignore it entirely (and the long-term fix is server-side TTS at M6).
// ─────────────────────────────────────────────────────────────────────────────
export const DEV_GEMINI_TTS_KEY = '';

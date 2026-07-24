// ─────────────────────────────────────────────────────────────────────────────
// PASTE YOUR FIREBASE WEB CONFIG HERE (5-minute setup, all free):
//
//   1. Go to https://console.firebase.google.com → "Add project" → name it
//      (e.g. savecents), Analytics off, Create.
//   2. In the project: left sidebar → Build → "AI Logic" → Get started →
//      choose "Gemini Developer API" (the free option) → enable.
//   3. Project overview → click the </> (Web) icon → register app
//      (nickname: savecents, no hosting) → copy the firebaseConfig object
//      it shows you and paste it below, replacing the placeholder.
//
// These values are PUBLIC identifiers (safe to ship in the app). Your Gemini
// access is proxied by Firebase server-side — no Gemini API key exists in
// this codebase at all.
//
// Until you paste a real config, Cents runs on the built-in offline parser.
// ─────────────────────────────────────────────────────────────────────────────

export const firebaseConfig = {
  apiKey: 'AIzaSyCF2sDnoBINtW6j_NL2b37RZUe-Vvh-YHg',
  authDomain: 'savecents-78a95.firebaseapp.com',
  projectId: 'savecents-78a95',
  storageBucket: 'savecents-78a95.firebasestorage.app',
  messagingSenderId: '389081247210',
  appId: '1:389081247210:web:2b93c89383535bde855693',
};

export const isFirebaseConfigured = () => !firebaseConfig.apiKey.startsWith('PASTE');

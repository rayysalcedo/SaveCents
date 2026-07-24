// Single shared Firebase app instance for the whole app (AI brain + auth +
// Firestore later). Guarded so hot reloads never double-initialize.
import { getApps, initializeApp, FirebaseApp } from 'firebase/app';
import { firebaseConfig, isFirebaseConfigured } from './firebaseConfig';

export { isFirebaseConfigured };

export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured()) throw new Error('firebase-not-configured');
  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}
// Real Firebase authentication (email/password) with RN session persistence.
// Google Sign-In arrives with the M4 dev build.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  initializeAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type Auth,
  type User,
} from 'firebase/auth';
// getReactNativePersistence exists at runtime in the RN bundle of firebase/auth,
// but the TS types point at the browser entry — hence the ts-ignore. Known
// firebase-js-sdk quirk; do not "fix" by removing the persistence, or sessions
// won't survive app restarts.
// @ts-ignore
import { getReactNativePersistence } from 'firebase/auth';
import { getFirebaseApp, isFirebaseConfigured } from './firebaseApp';

let auth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (!auth) {
    auth = initializeAuth(getFirebaseApp(), {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  }
  return auth;
}

export function authAvailable(): boolean {
  return isFirebaseConfigured();
}

export async function signUp(name: string, email: string, password: string): Promise<User> {
  const a = getFirebaseAuth();
  const cred = await createUserWithEmailAndPassword(a, email.trim(), password);
  if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
  return cred.user;
}

export async function signIn(email: string, password: string): Promise<User> {
  const a = getFirebaseAuth();
  const cred = await signInWithEmailAndPassword(a, email.trim(), password);
  return cred.user;
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(getFirebaseAuth(), email.trim());
}

export async function signOutFirebase(): Promise<void> {
  if (!authAvailable()) return;
  await fbSignOut(getFirebaseAuth());
}

// Apple guideline 5.1.1(v): apps with account creation must offer account
// deletion. Wired into the Profile settings UI in M3.3 (where we also wipe
// the user's Firestore tree). May throw 'auth/requires-recent-login' — the
// caller should then ask the user to log in again first.
export async function deleteAccount(): Promise<void> {
  const u = getFirebaseAuth().currentUser;
  if (u) await deleteUser(u);
}

export function subscribeAuth(cb: (user: User | null) => void): () => void {
  if (!authAvailable()) { cb(null); return () => {}; }
  return onAuthStateChanged(getFirebaseAuth(), cb);
}

// Friendly copy for the alert dialogs.
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/email-already-in-use': return 'That email already has an account. Try logging in instead.';
    case 'auth/invalid-email': return 'That email address doesn\u2019t look right.';
    case 'auth/weak-password': return 'Password must be at least 6 characters.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Email or password is incorrect.';
    case 'auth/too-many-requests': return 'Too many attempts \u2014 wait a minute and try again.';
    case 'auth/network-request-failed': return 'No connection \u2014 check your internet and try again.';
    case 'auth/requires-recent-login': return 'For security, please log in again first.';
    default: return 'Something went wrong. Please try again.';
  }
}
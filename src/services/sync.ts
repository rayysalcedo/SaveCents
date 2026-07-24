// M3.3 — Firestore cloud sync. One document per user: users/{uid}.
//
// Who wins:
// - Same device, same user (normal relaunch): LOCAL wins — we push up.
// - Fresh install or different user on this device: CLOUD wins — we pull down.
// This keeps the app offline-first (AsyncStorage is the on-device truth) while
// the cloud acts as backup + cross-device restore.
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  deleteDoc, doc, getDoc, initializeFirestore, setDoc, type Firestore,
} from 'firebase/firestore';
import { getFirebaseApp, isFirebaseConfigured } from './firebaseApp';
import { subscribeAuth } from './auth';
import { buildSnapshot, useFinance, type CloudSnapshot } from '../store/finance';

const LAST_UID_KEY = 'savecents-last-uid';

let db: Firestore | null = null;
function getDb(): Firestore {
  if (!db) {
    db = initializeFirestore(getFirebaseApp(), {
      // React Native networking can't always hold Firestore's default stream
      // open; auto-detect falls back to long polling when needed.
      experimentalAutoDetectLongPolling: true,
    });
  }
  return db;
}
const userDoc = (uid: string) => doc(getDb(), 'users', uid);

// Firestore rejects `undefined` values; JSON round-trip strips them
// (optional fields like ChatMessage.text / Account.color are often undefined).
const clean = (snap: CloudSnapshot) => JSON.parse(JSON.stringify(snap));

let unsubStore: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let activeUid: string | null = null;

function pushNow(uid: string) {
  return setDoc(userDoc(uid), clean(buildSnapshot(useFinance.getState())))
    .catch((e) => console.warn('[sync] push failed:', (e as Error)?.message));
}

export function startAutoSync(uid: string) {
  stopAutoSync();
  activeUid = uid;
  unsubStore = useFinance.subscribe((state) => {
    if (!state.hasHydrated) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { if (activeUid === uid) pushNow(uid); }, 1500);
  });
}

export function stopAutoSync() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (unsubStore) { unsubStore(); unsubStore = null; }
  activeUid = null;
}

function waitForHydration(): Promise<void> {
  return new Promise((resolve) => {
    if (useFinance.getState().hasHydrated) { resolve(); return; }
    const unsub = useFinance.subscribe((s) => {
      if (s.hasHydrated) { unsub(); resolve(); }
    });
  });
}

export async function enterAuthedSession(uid: string): Promise<void> {
  if (!isFirebaseConfigured()) return;
  if (activeUid === uid) return; // already syncing this user
  await waitForHydration();      // never sync before local data is loaded

  const lastUid = await AsyncStorage.getItem(LAST_UID_KEY);

  if (lastUid === uid) {
    // Normal relaunch on this device: local is the truth.
    startAutoSync(uid);
    pushNow(uid);
    return;
  }

  if (lastUid && lastUid !== uid) {
    // A different person is logging in on this device — never leak the
    // previous user's data into their account.
    useFinance.getState().resetToDefaults();
  }

  try {
    const snap = await getDoc(userDoc(uid));
    if (snap.exists()) {
      useFinance.getState().replaceAll(snap.data() as CloudSnapshot);
    } else {
      await setDoc(userDoc(uid), clean(buildSnapshot(useFinance.getState())));
    }
  } catch (e) {
    // Offline login with a cached session: proceed with local data; auto-sync
    // will reconcile when the connection returns.
    console.warn('[sync] hydrate failed:', (e as Error)?.message);
  }

  await AsyncStorage.setItem(LAST_UID_KEY, uid);
  startAutoSync(uid);
}

export async function deleteCloudData(uid: string): Promise<void> {
  await deleteDoc(userDoc(uid));
}

export async function clearLastUid(): Promise<void> {
  await AsyncStorage.removeItem(LAST_UID_KEY);
}

// Mount once at the app root. Handles login, signup, and cold-start session
// restore through a single code path (Firebase fires the auth callback in
// all three cases), so the auth screen needs no sync code at all.
export function useCloudSync() {
  useEffect(() => {
    const unsub = subscribeAuth((user) => {
      if (user) enterAuthedSession(user.uid);
      else stopAutoSync();
    });
    return () => { unsub(); stopAutoSync(); };
  }, []);
}
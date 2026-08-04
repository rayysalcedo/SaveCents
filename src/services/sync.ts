// M3.3 -> M5.34 — Firestore cloud sync, now multi-device aware. One document
// per user: users/{uid}.
//
// Every push is stamped with _meta { updatedAt, writer }, where writer is a
// per-install device id. That stamp powers two behaviors the original
// design lacked:
//
// 1. Relaunch no longer clobbers. Same device + same user used to blindly
//    push local state, letting a stale phone overwrite edits made on
//    another device. Now the relaunch peeks at the cloud copy first: if a
//    DIFFERENT device wrote it last, we pull; only when this device was the
//    last writer does local win and push.
// 2. Live cross-device updates. An onSnapshot listener applies remote
//    changes to the open app within seconds. Echo-safe: a device ignores
//    docs it wrote itself, and applying a remote snapshot never re-pushes.
//
// Conflict model stays whole-document last-write-wins, which is right for
// a personal finance app: two devices editing in the same second is rare,
// and the loser is always one save behind, never corrupted.
//
// Offline behavior is unchanged: AsyncStorage remains the on-device truth,
// pulls and pushes fail soft, and auto-sync reconciles when back online.
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  deleteDoc, doc, getDoc, initializeFirestore, onSnapshot, setDoc, type Firestore,
} from 'firebase/firestore';
import { getFirebaseApp, isFirebaseConfigured } from './firebaseApp';
import { subscribeAuth } from './auth';
import { buildSnapshot, useFinance, type CloudSnapshot } from '../store/finance';

const LAST_UID_KEY = 'savecents-last-uid';
const CLIENT_ID_KEY = 'savecents-client-id';

interface SyncMeta { updatedAt: number; writer: string }
type CloudDoc = CloudSnapshot & { _meta?: SyncMeta };

let clientId: string | null = null;
async function getClientId(): Promise<string> {
  if (clientId) return clientId;
  let id = await AsyncStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(CLIENT_ID_KEY, id);
  }
  clientId = id;
  return id;
}

let db: Firestore | null = null;
function getDb(): Firestore {
  if (!db) {
    db = initializeFirestore(getFirebaseApp(), {
      // React Native networking can not always hold Firestore's default
      // stream open; auto-detect falls back to long polling when needed.
      experimentalAutoDetectLongPolling: true,
    });
  }
  return db;
}
const userDoc = (uid: string) => doc(getDb(), 'users', uid);

// Firestore rejects `undefined` values; JSON round-trip strips them
// (optional fields like ChatMessage.text / Account.color are often undefined).
const clean = (snap: CloudSnapshot) => JSON.parse(JSON.stringify(snap));

// Remove the sync stamp before handing a cloud doc to the store.
const stripMeta = (d: CloudDoc): CloudSnapshot => {
  const { _meta, ...rest } = d;
  return rest as CloudSnapshot;
};

let unsubStore: (() => void) | null = null;
let unsubCloud: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let activeUid: string | null = null;
// True while a remote snapshot is being applied to the store, so the store
// subscriber does not treat the apply as a local edit and push it back.
let applyingRemote = false;

async function pushNow(uid: string) {
  try {
    const writer = await getClientId();
    const body: CloudDoc = {
      ...clean(buildSnapshot(useFinance.getState())),
      _meta: { updatedAt: Date.now(), writer },
    };
    await setDoc(userDoc(uid), body);
  } catch (e) {
    console.warn('[sync] push failed:', (e as Error)?.message);
  }
}

export function startAutoSync(uid: string) {
  stopAutoSync();
  activeUid = uid;
  unsubStore = useFinance.subscribe((state) => {
    if (!state.hasHydrated) return;
    if (applyingRemote) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { if (activeUid === uid) pushNow(uid); }, 1500);
  });
  unsubCloud = onSnapshot(userDoc(uid), (snap) => {
    (async () => {
      if (!snap.exists()) return;
      if (snap.metadata.hasPendingWrites) return; // local echo, not yet acked
      const data = snap.data() as CloudDoc;
      const me = await getClientId();
      if (data._meta?.writer === me) return;      // this device wrote it
      if (!useFinance.getState().hasHydrated) return;
      applyingRemote = true;
      try {
        useFinance.getState().replaceAll(stripMeta(data));
      } finally {
        // Subscriber callbacks fire synchronously during replaceAll, so the
        // flag has done its job by the time this microtask clears it.
        setTimeout(() => { applyingRemote = false; }, 0);
      }
    })().catch((e) => console.warn('[sync] apply failed:', (e as Error)?.message));
  }, (e) => console.warn('[sync] listener error:', (e as Error)?.message));
}

export function stopAutoSync() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (unsubStore) { unsubStore(); unsubStore = null; }
  if (unsubCloud) { unsubCloud(); unsubCloud = null; }
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
    // Normal relaunch on this device. Peek at the cloud before deciding who
    // wins: if another device wrote last, its edits are newer than ours.
    try {
      const snap = await getDoc(userDoc(uid));
      const data = snap.exists() ? (snap.data() as CloudDoc) : null;
      const me = await getClientId();
      if (data?._meta && data._meta.writer !== me) {
        applyingRemote = true;
        try { useFinance.getState().replaceAll(stripMeta(data)); }
        finally { setTimeout(() => { applyingRemote = false; }, 0); }
      } else {
        // We wrote last (or the doc predates _meta): local is the truth.
        await pushNow(uid);
      }
    } catch (e) {
      // Offline relaunch: proceed with local data; auto-sync reconciles
      // when the connection returns.
      console.warn('[sync] relaunch check failed:', (e as Error)?.message);
    }
    startAutoSync(uid);
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
      useFinance.getState().replaceAll(stripMeta(snap.data() as CloudDoc));
    } else {
      await pushNow(uid);
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
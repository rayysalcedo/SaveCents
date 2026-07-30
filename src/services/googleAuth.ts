// Google Sign-In via expo-auth-session + Firebase credential exchange.
//
// How it works: the Google OAuth flow runs in the system browser, returns an
// ID token, and src/services/auth.ts exchanges it for a Firebase session with
// signInWithCredential. No password, no extra backend.
//
// SETUP (one time, Google Cloud console -> Credentials, SAME project as
// Firebase savecents-78a95):
//   1. Enable the Google provider in Firebase console -> Authentication ->
//      Sign-in method. Firebase auto-creates a WEB client id: paste it below.
//   2. Create an iOS OAuth client (bundle id com.rxsfin.savecents) and an
//      Android OAuth client (package com.rxsfin.savecents + SHA-1 from
//      `eas credentials`). Paste both below.
//
// RUNTIME REALITY:
//   - Development build / TestFlight / production: fully working.
//   - Expo Go: Google rejects Expo Go's exp:// redirect, so the flow cannot
//     complete there. The auth screen detects this and tells the user to use
//     email until the M4 dev build. This is a Google platform restriction,
//     not a bug.

import { useEffect, useRef, useState } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { signInWithGoogleIdToken } from './auth';
import type { User } from 'firebase/auth';

// Dismiss the auth popup correctly when the browser redirects back.
WebBrowser.maybeCompleteAuthSession();

export const GOOGLE_CLIENT_IDS = {
  // Firebase console -> Authentication -> Google -> Web SDK configuration
  web: '389081247210-g2ql0vru55dvuf87jnjj4glaijapgk82.apps.googleusercontent.com',
  // Google Cloud console -> Credentials -> iOS client (com.rxsfin.savecents)
  ios: '389081247210-rdgvj7087bmvmlh2m9gh4cfo5bidco0r.apps.googleusercontent.com',
  // Google Cloud console -> Credentials -> Android client (+ SHA-1)
  android: '',
};

export const IN_EXPO_GO = Constants.appOwnership === 'expo';

export function googleConfigured(): boolean {
  return !!GOOGLE_CLIENT_IDS.web;
}

export type GoogleSignInState = 'idle' | 'working';

interface UseGoogleSignIn {
  state: GoogleSignInState;
  /** Null when the button should be treated as unavailable (no ids pasted). */
  ready: boolean;
  begin: () => Promise<void>;
}

// Hook used by the auth screen. onSuccess fires with the signed-in Firebase
// user; onError fires with a human-readable message.
export function useGoogleSignIn(
  onSuccess: (user: User) => void,
  onError: (message: string) => void,
): UseGoogleSignIn {
  const [state, setState] = useState<GoogleSignInState>('idle');
  // Keep the freshest callbacks without re-creating the auth request.
  const cbs = useRef({ onSuccess, onError });
  cbs.current = { onSuccess, onError };

  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: GOOGLE_CLIENT_IDS.web || undefined,
    iosClientId: GOOGLE_CLIENT_IDS.ios || undefined,
    androidClientId: GOOGLE_CLIENT_IDS.android || undefined,
    scopes: ['openid', 'profile', 'email'],
  });

  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') {
      const idToken = response.authentication?.idToken;
      if (!idToken) {
        setState('idle');
        cbs.current.onError('Google did not return a sign-in token. Try again.');
        return;
      }
      (async () => {
        try {
          const user = await signInWithGoogleIdToken(idToken);
          setState('idle');
          cbs.current.onSuccess(user);
        } catch {
          setState('idle');
          cbs.current.onError('Google sign-in could not finish. Try again or use email.');
        }
      })();
    } else if (response.type === 'error') {
      setState('idle');
      cbs.current.onError('Google sign-in was interrupted. Try again or use email.');
    } else {
      // 'cancel' / 'dismiss' — user backed out, not an error.
      setState('idle');
    }
  }, [response]);

  const begin = async () => {
    if (state === 'working') return;
    setState('working');
    try {
      await promptAsync();
    } catch {
      setState('idle');
      cbs.current.onError('Could not open Google sign-in. Try again.');
    }
  };

  return { state, ready: !!request && googleConfigured(), begin };
}

// M5: overlay coordination for the Cents hub / chat / scan / voice layers.
// Kept separate from the finance store — this is ephemeral UI state and is
// never persisted or synced.
import { create } from 'zustand';

export type ScanMode = 'price' | 'receipt';

interface UIState {
  hubOpen: boolean;
  chatOpen: boolean;
  voiceOpen: boolean;
  // M5.5b: the in-app camera scan overlay (expo-camera). Opened directly from
  // the hub's Scan tile and from the chat header's scan sheet. Renders ABOVE
  // chat so a scan started from chat returns to chat on close.
  scanOpen: boolean;
  scanMode: ScanMode;

  openHub: () => void;
  closeHub: () => void;
  openChat: (opts?: { voice?: boolean }) => void;
  closeChat: () => void;
  openScan: (mode?: ScanMode) => void;
  closeScan: () => void;
  openVoice: () => void;
  closeVoice: () => void;
}

export const useUI = create<UIState>((set) => ({
  hubOpen: false,
  chatOpen: false,
  voiceOpen: false,
  scanOpen: false,
  scanMode: 'price',

  openHub: () => set({ hubOpen: true }),
  closeHub: () => set({ hubOpen: false }),
  openChat: (opts) =>
    set({
      hubOpen: false,
      chatOpen: true,
      voiceOpen: !!opts?.voice,
    }),
  closeChat: () => set({ chatOpen: false, voiceOpen: false }),
  openScan: (mode) => set({ hubOpen: false, scanOpen: true, scanMode: mode ?? 'price' }),
  closeScan: () => set({ scanOpen: false }),
  openVoice: () => set({ voiceOpen: true }),
  closeVoice: () => set({ voiceOpen: false }),
}));

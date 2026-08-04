// M5: overlay coordination for the Cents hub / chat / scan / voice layers.
// Kept separate from the finance store — this is ephemeral UI state and is
// never persisted or synced.
import { create } from 'zustand';
import { stopCentsVoice } from '../services/speech';

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
  // M5.6: quick dial on the center Cents button. Swipe up or hold the button
  // to fan out Cents AI / Cents Scanner / Cents Voice; slide and release to
  // pick, or release in place to pin the dial for tapping.
  quickOpen: boolean;
  quickDragging: boolean;
  quickIndex: number; // -1 = nothing highlighted

  openHub: () => void;
  closeHub: () => void;
  openChat: (opts?: { voice?: boolean }) => void;
  closeChat: () => void;
  openScan: (mode?: ScanMode) => void;
  closeScan: () => void;
  openVoice: () => void;
  closeVoice: () => void;
  openQuick: () => void;
  closeQuick: () => void;
  setQuickIndex: (i: number) => void;
  setQuickDragging: (d: boolean) => void;
}

export const useUI = create<UIState>((set) => ({
  hubOpen: false,
  chatOpen: false,
  voiceOpen: false,
  scanOpen: false,
  scanMode: 'price',
  quickOpen: false,
  quickDragging: false,
  quickIndex: -1,

  openHub: () => set({ hubOpen: true, quickOpen: false, quickDragging: false, quickIndex: -1 }),
  closeHub: () => set({ hubOpen: false }),
  openChat: (opts) =>
    set({
      hubOpen: false,
      chatOpen: true,
      voiceOpen: !!opts?.voice,
      quickOpen: false, quickDragging: false, quickIndex: -1,
    }),
  closeChat: () => { stopCentsVoice(); set({ chatOpen: false, voiceOpen: false }); },
  openScan: (mode) => set({ hubOpen: false, scanOpen: true, scanMode: mode ?? 'price', quickOpen: false, quickDragging: false, quickIndex: -1 }),
  closeScan: () => set({ scanOpen: false }),
  openVoice: () => set({ voiceOpen: true }),
  closeVoice: () => { stopCentsVoice(); set({ voiceOpen: false }); },
  openQuick: () => set({ quickOpen: true, quickDragging: true, quickIndex: -1, hubOpen: false }),
  closeQuick: () => set({ quickOpen: false, quickDragging: false, quickIndex: -1 }),
  setQuickIndex: (i) => set({ quickIndex: i }),
  setQuickDragging: (d) => set({ quickDragging: d }),
}));

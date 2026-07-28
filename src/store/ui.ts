// M5: overlay coordination for the Cents hub / chat / voice layers.
// Kept separate from the finance store — this is ephemeral UI state and is
// never persisted or synced.
import { create } from 'zustand';

interface UIState {
  hubOpen: boolean;
  chatOpen: boolean;
  voiceOpen: boolean;
  // When the hub's "Scan" action opens chat, chat should immediately show
  // the camera sheet. Consumed (reset) by the chat modal on open.
  chatOpensCamera: boolean;

  openHub: () => void;
  closeHub: () => void;
  openChat: (opts?: { camera?: boolean; voice?: boolean }) => void;
  closeChat: () => void;
  openVoice: () => void;
  closeVoice: () => void;
  consumeCameraFlag: () => boolean;
}

export const useUI = create<UIState>((set, get) => ({
  hubOpen: false,
  chatOpen: false,
  voiceOpen: false,
  chatOpensCamera: false,

  openHub: () => set({ hubOpen: true }),
  closeHub: () => set({ hubOpen: false }),
  openChat: (opts) =>
    set({
      hubOpen: false,
      chatOpen: true,
      chatOpensCamera: !!opts?.camera,
      voiceOpen: !!opts?.voice,
    }),
  closeChat: () => set({ chatOpen: false, voiceOpen: false, chatOpensCamera: false }),
  openVoice: () => set({ voiceOpen: true }),
  closeVoice: () => set({ voiceOpen: false }),
  consumeCameraFlag: () => {
    const v = get().chatOpensCamera;
    if (v) set({ chatOpensCamera: false });
    return v;
  },
}));

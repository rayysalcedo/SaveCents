// Hermes (React Native's JS engine) lacks a few newer web APIs that the
// Firebase AI SDK relies on. Loaded first from index.ts.

// AbortSignal.any — combine multiple abort signals
if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).any !== 'function') {
  (AbortSignal as any).any = (signals: AbortSignal[]): AbortSignal => {
    const controller = new AbortController();
    const abort = (reason?: unknown) => {
      if (!controller.signal.aborted) controller.abort(reason);
    };
    for (const s of signals ?? []) {
      if (!s) continue;
      if (s.aborted) {
        abort((s as any).reason);
        break;
      }
      s.addEventListener('abort', () => abort((s as any).reason), { once: true });
    }
    return controller.signal;
  };
}

// AbortSignal.timeout — auto-aborting signal
if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout !== 'function') {
  (AbortSignal as any).timeout = (ms: number): AbortSignal => {
    const controller = new AbortController();
    setTimeout(() => {
      if (!controller.signal.aborted) controller.abort(new Error('TimeoutError'));
    }, ms);
    return controller.signal;
  };
}

export {};

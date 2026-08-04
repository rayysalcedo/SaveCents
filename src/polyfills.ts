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

// atob / btoa — base64 primitives used by the Cents voice (services/speech.ts).
// Present on modern Hermes; this covers older runtimes so a missing global
// never crashes speech synthesis.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
if (typeof (globalThis as any).atob !== 'function') {
  (globalThis as any).atob = (input: string): string => {
    const str = String(input).replace(/=+$/, '');
    let out = '';
    let bc = 0, bs = 0;
    for (let i = 0; i < str.length; i++) {
      const idx = B64.indexOf(str.charAt(i));
      if (idx === -1) continue;
      bs = bc % 4 ? bs * 64 + idx : idx;
      if (bc++ % 4) out += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6)));
    }
    return out;
  };
}
if (typeof (globalThis as any).btoa !== 'function') {
  (globalThis as any).btoa = (input: string): string => {
    const str = String(input);
    let out = '';
    for (let block = 0, charCode: number, i = 0, map = B64;
      str.charAt(i | 0) || ((map = '='), i % 1);
      out += map.charAt(63 & (block >> (8 - (i % 1) * 8)))) {
      charCode = str.charCodeAt((i += 3 / 4));
      if (charCode > 0xff) throw new Error('btoa: character out of range');
      block = (block << 8) | charCode;
    }
    return out;
  };
}

export {};

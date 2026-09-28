export function createLifetime(parent?: AbortSignal) {
  const controller = new AbortController();
  const cleanups: (() => void)[] = [];
  const frames = new Set<number>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const urls = new Set<string>();
  function dispose() {
    if (controller.signal.aborted) return;
    controller.abort();
    parent?.removeEventListener('abort', dispose);
    frames.forEach(cancelAnimationFrame);
    frames.clear();
    timers.forEach(clearTimeout);
    timers.clear();
    urls.forEach(url => URL.revokeObjectURL(url));
    urls.clear();
    for (const cleanup of cleanups.reverse()) {
      try { cleanup(); } catch (error) { console.error('Studio cleanup failed', error); }
    }
    cleanups.length = 0;
  }
  if (parent?.aborted) dispose();
  else parent?.addEventListener('abort', dispose, { once: true });
  return {
    signal: controller.signal,
    dispose,
    timeout(callback: () => void, delay: number) {
      const timer = setTimeout(() => { timers.delete(timer); if (!controller.signal.aborted) callback(); }, delay);
      if (controller.signal.aborted) clearTimeout(timer);
      else timers.add(timer);
      return timer;
    },
    clearTimer(timer: ReturnType<typeof setTimeout> | undefined) { if (timer !== undefined) { clearTimeout(timer); timers.delete(timer); } },
    objectUrl(blob: Blob) { controller.signal.throwIfAborted(); const url = URL.createObjectURL(blob); urls.add(url); return url; },
    releaseUrl(url: string) { URL.revokeObjectURL(url); urls.delete(url); },
    defer(cleanup: () => void) { if (controller.signal.aborted) cleanup(); else cleanups.push(cleanup); },
    frame(callback: FrameRequestCallback) {
      if (controller.signal.aborted) return;
      const handle = requestAnimationFrame(time => { frames.delete(handle); if (!controller.signal.aborted) callback(time); });
      frames.add(handle);
    },
  };
}
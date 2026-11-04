interface Visibility {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** One unsettled activity read per mounted ticker; visibility is not an error. */
export function startActivityPolling<T>({ read, receive, unavailable, visibility }: {
  read: (signal: AbortSignal) => Promise<T>;
  receive: (value: T) => void;
  unavailable: () => void;
  visibility: Visibility;
}): () => void {
  let stopped = false, refreshAfterAbort = false;
  let hidden = visibility.hidden;
  let active: AbortController | undefined;
  async function load() {
    if (stopped || visibility.hidden || active) return;
    const controller = new AbortController(); active = controller;
    try {
      const value = await read(controller.signal);
      if (!stopped && !controller.signal.aborted && !visibility.hidden) receive(value);
    } catch {
      if (!stopped && !controller.signal.aborted && !visibility.hidden) unavailable();
    } finally {
      active = undefined;
      const refresh = refreshAfterAbort; refreshAfterAbort = false;
      // Some readers settle after cancellation. Keep their slot until then, and
      // refresh once on return rather than admit overlapping or stale results.
      if (refresh && !stopped && !visibility.hidden) void load();
    }
  }
  function changedVisibility() {
    if (visibility.hidden === hidden) return;
    hidden = visibility.hidden;
    if (visibility.hidden) { refreshAfterAbort = false; active?.abort(); }
    else if (active?.signal.aborted) refreshAfterAbort = true;
    else void load();
  }
  visibility.addEventListener("visibilitychange", changedVisibility);
  const timer = setInterval(() => { void load(); }, 20_000);
  void load();
  return () => {
    stopped = true; refreshAfterAbort = false;
    clearInterval(timer);
    visibility.removeEventListener("visibilitychange", changedVisibility);
    active?.abort();
  };
}

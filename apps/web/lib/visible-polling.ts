/** Read-only polling: no overlapping requests, no work in a hidden tab. */
export const ADMIN_POLL_INTERVAL_MS = 15_000;

export function startVisiblePolling({
  poll,
  onError,
  intervalMs = ADMIN_POLL_INTERVAL_MS,
}: {
  poll(signal: AbortSignal): Promise<boolean | void>;
  onError(error: unknown): void;
  intervalMs?: number;
}) {
  const visibilityDocument = document;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | null = null;
  let stopped = false;
  let halted = false;
  let resumePending = false;
  const visible = () => visibilityDocument.visibilityState !== 'hidden';
  function clear() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
  function schedule(delay: number) {
    clear();
    if (!stopped && !halted && !inFlight && visible()) timer = setTimeout(tick, delay);
  }
  async function tick() {
    timer = undefined;
    if (stopped || halted || inFlight || !visible()) return;
    const controller = new AbortController();
    inFlight = controller;
    try {
      const keepPolling = await poll(controller.signal);
      if (!controller.signal.aborted && keepPolling === false) halted = true;
    } catch (error) {
      if (!controller.signal.aborted && !stopped) {
        halted = true;
        onError(error);
      }
    } finally {
      inFlight = null;
      const delay = resumePending ? 0 : intervalMs;
      resumePending = false;
      schedule(delay);
    }
  }
  function visibilityChanged() {
    clear();
    if (!visible()) {
      resumePending = false;
      inFlight?.abort();
    } else if (inFlight) {
      // Wait for the aborted request to settle before starting a replacement.
      resumePending = true;
    } else {
      schedule(0);
    }
  }
  visibilityDocument.addEventListener('visibilitychange', visibilityChanged);
  schedule(intervalMs);
  return () => {
    stopped = true;
    clear();
    inFlight?.abort();
    visibilityDocument.removeEventListener('visibilitychange', visibilityChanged);
  };
}

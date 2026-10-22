import console from 'node:console';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { LocalSiteError } from './local-site.mjs';

/** A launcher-owned loop, not an OS daemon. The database owns slots and deduplication. */
export function startLocalAutomationScheduler({
  port,
  fetchImpl = globalThis.fetch,
  log = console.log,
  signals = process,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new LocalSiteError('本地调度器端口无效。');
  const origin = `http://127.0.0.1:${port}`;
  let stopped = false;
  let timer;
  let timeout;
  let request;
  let unavailable = false;

  function schedule() {
    if (stopped) return;
    timer = setTimer(tick, 60_000);
    timer.unref?.();
  }

  async function tick() {
    if (stopped) return;
    request = new globalThis.AbortController();
    timeout = setTimer(() => request?.abort(), 45_000);
    timeout.unref?.();
    try {
      const response = await fetchImpl(`${origin}/api/admin/local-automation-scheduler`, {
        method: 'POST',
        headers: { Origin: origin },
        redirect: 'error',
        signal: request.signal,
      });
      if (!response.ok) throw new Error('unavailable');
      const result = await response.json();
      if (
        ![result?.dispatched, result?.failed].every(
          (value) => Number.isSafeInteger(value) && value >= 0 && value <= 5,
        )
      )
        throw new Error('invalid_response');
      if (stopped) return;
      if (unavailable) log('本地定时采集调度已恢复。');
      unavailable = false;
      if (result.dispatched || result.failed)
        log(
          `本地定时采集：派发 ${result.dispatched} 项，派发失败 ${result.failed} 项；详情请查看后台。`,
        );
    } catch {
      // Never log response bodies, provider errors, URLs or credentials. Unknown dispatches
      // remain recorded in the existing task store; this loop does not replay a paid task.
      if (!stopped && !unavailable)
        log('本地定时采集调度暂不可用；稍后重新检查到期配置，不重试原付费任务。');
      unavailable = true;
    } finally {
      clearTimer(timeout);
      request = undefined;
      schedule();
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimer(timer);
    clearTimer(timeout);
    request?.abort();
    signals.removeListener('SIGINT', stop);
    signals.removeListener('SIGTERM', stop);
  }

  signals.on('SIGINT', stop);
  signals.on('SIGTERM', stop);
  // Let the server start. Subsequent checks are serialized and never overlap.
  schedule();
  return { stop };
}

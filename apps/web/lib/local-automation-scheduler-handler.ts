import {
  assertLocalDevelopmentRequest,
  isLocalAutomationSchedulerEnabled,
  type LocalDevelopmentEnvironment,
} from './local-development.ts';
import { importResponse } from './import-io.ts';

type Dependencies = {
  environment(): LocalDevelopmentEnvironment;
  dispatch(): Promise<{ dispatched: number; failed: number }>;
};

/** Local launcher endpoint; production Cron authentication is deliberately unrelated. */
export function createLocalAutomationSchedulerHandler(deps: Dependencies) {
  return async (request: Request) => {
    if (request.method !== 'POST') return importResponse({ error: 'method_not_allowed' }, 405);
    const env = deps.environment();
    if (!isLocalAutomationSchedulerEnabled(env))
      return importResponse({ error: 'execution_disabled' }, 403);
    try {
      assertLocalDevelopmentRequest(request, env);
    } catch {
      return importResponse({ error: 'forbidden' }, 403);
    }
    const url = new URL(request.url);
    if (url.search || url.hash) return importResponse({ error: 'invalid_request' }, 400);
    try {
      const { dispatched, failed } = await deps.dispatch();
      return importResponse({ dispatched, failed });
    } catch {
      // Database/provider messages can contain private values. Return a fixed code only.
      return importResponse({ error: 'unavailable' }, 503);
    }
  };
}

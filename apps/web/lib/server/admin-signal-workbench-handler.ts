import 'server-only';
import { createSignalWorkbenchHandler } from '../admin-signal-workbench-core';
import { parseAdminAuthEnvironment } from '../admin-auth-policy';
import { getAdminSession } from './admin-auth';
import { executeSignalWorkbench } from './admin-signal-workbench';

export const handleSignalWorkbench = createSignalWorkbenchHandler({
  authenticate: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin ?? null,
  execute: executeSignalWorkbench,
});

import 'server-only';
import { createSignalWorkbenchHandler } from '../admin-signal-workbench-core';
import { getAdminSession, getAdminOrigin } from './admin-auth';
import { executeSignalWorkbench } from './admin-signal-workbench';

export const handleSignalWorkbench = createSignalWorkbenchHandler({
  authenticate: getAdminSession,
  origin: getAdminOrigin,
  execute: executeSignalWorkbench,
});

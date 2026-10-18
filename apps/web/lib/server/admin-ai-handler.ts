import 'server-only';
import { createAiAdminHandler } from '../admin-ai-core';
import { getAdminSession, getAdminOrigin } from './admin-auth';
import { executeAiAdmin } from './admin-ai';

export const handleAiAdmin = createAiAdminHandler({
  authenticate: getAdminSession,
  origin: getAdminOrigin,
  execute: executeAiAdmin,
});

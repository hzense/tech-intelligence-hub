import 'server-only';
import { createAiAdminHandler } from '../admin-ai-core';
import { parseAdminAuthEnvironment } from '../admin-auth-policy';
import { getAdminSession } from './admin-auth';
import { executeAiAdmin } from './admin-ai';

export const handleAiAdmin = createAiAdminHandler({
  authenticate: getAdminSession,
  origin: () => parseAdminAuthEnvironment(process.env)?.origin ?? null,
  execute: executeAiAdmin,
});

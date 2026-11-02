import 'server-only';
import { readAiUsageCosts } from '../ai-usage-costs';
import { getNeonUsageDashboard } from './neon-usage';
import { aiAccountingPool } from './admin-ai';
import { generationHistoryPool } from './generation-database';
import { automationConfigPool } from './automation-store-access';

/** Call only with the authenticated administrator's id. Never samples or invokes AI. */
export async function getAdminUsageDashboard(owner: string) {
  const [dashboard, aiCosts] = await Promise.all([
    getNeonUsageDashboard(),
    readAiUsageCosts({
      owner,
      now: new Date(),
      pools: {
        generation: generationHistoryPool,
        enrichment: generationHistoryPool,
        automation: automationConfigPool,
        probe: aiAccountingPool,
      },
    }),
  ]);
  return { ...dashboard, aiCosts };
}

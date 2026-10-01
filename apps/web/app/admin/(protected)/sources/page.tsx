import type { Metadata } from 'next';
import { requireAdminSession } from '@/lib/server/admin-auth';
import {
  automationStorageConfigured,
  automationExecutionConfigured,
  automationDashboard,
} from '@/lib/server/automation';
import { getAiDashboard } from '@/lib/server/admin-ai';
import { AdminAutomation } from '@/components/admin-automation';
import { getTopicEntries } from '@/lib/content-runtime';

export const metadata: Metadata = { title: '自动采集', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function SourcesPage() {
  const session = await requireAdminSession();
  const configured = automationStorageConfigured();
  const [stateResult, ai, entries] = await Promise.all([
    configured
      ? automationDashboard(session.user.id)
          .then((state) => ({ state, loadError: false }))
          .catch(() => ({ state: { configs: [], runs: [] }, loadError: true }))
      : { state: { configs: [], runs: [] }, loadError: false },
    getAiDashboard().catch(() => ({ profiles: [] })),
    getTopicEntries(),
  ]);
  return (
    <AdminAutomation
      kind="source_collection"
      configured={configured && !stateResult.loadError}
      executionEnabled={automationExecutionConfigured('source_collection')}
      loadError={stateResult.loadError}
      initial={stateResult.state}
      profiles={ai.profiles.map(({ id, revision, name, readiness }) => ({
        id,
        revision,
        name,
        ready: readiness.ready,
      }))}
      topics={entries.map((entry) => ({ id: entry.frontMatter.id, name: entry.frontMatter.title }))}
    />
  );
}

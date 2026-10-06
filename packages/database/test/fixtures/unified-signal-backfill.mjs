import { fileURLToPath, URL } from 'node:url';
import { loadSeedCatalog } from '../../../content/src/seed.ts';
import { projectLegacySignalEntries } from '../../../../apps/web/lib/legacy-signal-projection.ts';
import { buildLegacySignalArchivePlan } from '../../src/legacy-signal-archive.mjs';
import {
  buildUnifiedSignalPlan,
  previewUnifiedPublicSignals,
} from '../../src/unified-signal-plan.mjs';

export async function unifiedBackfillFixture() {
  const catalog = await loadSeedCatalog(
    fileURLToPath(new URL('../../../../data/seed/', import.meta.url)),
    fileURLToPath(new URL('../../../../data/taxonomy/taxonomy.yaml', import.meta.url)),
  );
  const archivePlan = buildLegacySignalArchivePlan(catalog, projectLegacySignalEntries(catalog));
  const content = {
    title: '研究组织发布技术进展',
    summary: '仅用于隔离数据库测试的合成摘要。',
    eventDate: '2026-10-01',
    persons: ['测试研究员'],
    organizations: ['测试研究组织'],
    topics: [{ id: 'ai-safety', title: 'AI 安全' }],
    sourceUrls: ['https://example.com/research'],
    signalType: 'research',
  };
  const editorialRevisions = [];
  for (const [index, actions] of [
    ['publish'],
    ['publish'],
    ['draft', 'publish', 'withdraw'],
    ['draft', 'publish', 'withdraw', 'publish', 'withdraw'],
  ].entries()) {
    for (const [i, action] of actions.entries()) {
      const n = editorialRevisions.length + 1;
      editorialRevisions.push({
        request_id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`,
        run_id: '00000000-0000-0000-0001-000000000001',
        owner_id: 'synthetic-owner',
        candidate_index: index,
        revision: i + 1,
        action,
        content: globalThis.structuredClone(content),
        material_hash: 'a'.repeat(64),
        request_hash: 'b'.repeat(64),
        created_at: `2026-10-01T12:00:${String(n).padStart(2, '0')}.123456Z`,
      });
    }
  }
  const sources = { archivePlan, editorialRevisions };
  const plan = buildUnifiedSignalPlan(sources);
  const publicIds = previewUnifiedPublicSignals(plan, sources).map(({ id }) => ({ signal_id: id }));
  return { sources, plan, publicIds };
}

import type { GenerationPublication } from '../lib/generation-publication';

export const publicationLabels = {
  unpublished: '未发布',
  draft: '草稿 · 未发布',
  published: '已发布',
  withdrawn: '已撤回',
};

export function candidatePublication(
  publication: GenerationPublication | undefined,
  index: unknown,
) {
  if (publication?.state !== 'available' || !Number.isInteger(index)) return undefined;
  const matches = publication.candidates.filter((candidate) => candidate.index === index);
  return matches.length === 1 ? matches[0] : undefined;
}

export function GenerationPublicationSummary({
  status,
  publication,
}: {
  status: string;
  publication?: GenerationPublication | undefined;
}) {
  if (status !== 'completed') return <span>—</span>;
  if (!publication || publication.state !== 'available') return <span>发布状态待核对</span>;
  const candidates = publication.candidates;
  if (!candidates.length) return <span>暂无可发布候选</span>;
  const published = candidates.filter((candidate) => candidate.status === 'published').length;
  const withdrawn = candidates.filter((candidate) => candidate.status === 'withdrawn').length;
  const unpublished = candidates.length - published - withdrawn;
  return (
    <span>
      候选 {candidates.length} 条 · 已发布 {published} 条 · 未发布 {unpublished} 条 · 已撤回{' '}
      {withdrawn} 条
    </span>
  );
}

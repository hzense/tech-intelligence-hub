import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicEntityDetail } from '@/components/public-entity-detail';
import { getPublicExploration } from '@/lib/public-exploration-runtime';
import { getPublicResourceDetail } from '@/lib/server/resource-detail';

export const dynamic = 'force-dynamic';
interface Props {
  params: Promise<{ id: string }>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const entry = (await getPublicExploration()).entities.find((entity) => entity.id === id);
  return entry && entry.type !== 'person'
    ? {
        title: entry.name,
        description: `查看 ${entry.name} 关联的公开信号、洞察报告与技术趋势观察。`,
        alternates: { canonical: `/resources/${entry.id}` },
      }
    : {};
}
export default async function ResourceDetailPage({ params }: Props) {
  const { id } = await params;
  const detail = await getPublicResourceDetail(id);
  if (!detail || detail.entity.type === 'person') notFound();
  return <PublicEntityDetail {...detail} />;
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicEntityDetail } from '@/components/public-entity-detail';
import { getPublicExploration } from '@/lib/public-exploration-runtime';

export const dynamic = 'force-dynamic';
interface Props {
  params: Promise<{ id: string }>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const entry = (await getPublicExploration()).entities.find(
    (entity) => entity.id === id && entity.type === 'person',
  );
  return entry
    ? {
        title: entry.name,
        description: `${entry.name} 的公开关联事件。`,
        alternates: { canonical: `/persons/${entry.id}` },
      }
    : {};
}
export default async function PersonDetailPage({ params }: Props) {
  const { id } = await params;
  const entity = (await getPublicExploration()).entities.find(
    (entry) => entry.id === id && entry.type === 'person',
  );
  if (!entity) notFound();
  return <PublicEntityDetail entity={entity} />;
}

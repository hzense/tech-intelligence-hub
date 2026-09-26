import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicEntityDetail } from '@/components/public-entity-detail';
import { getPublicExploration } from '@/lib/public-exploration-runtime';
import { getRelationsForEntity } from '@/lib/seed-runtime';

export const dynamic = 'force-dynamic';
interface Props {
  params: Promise<{ id: string }>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const entry = (await getPublicExploration()).entities.find((entity) => entity.id === id);
  return entry
    ? {
        title: entry.name,
        description: `与 ${entry.name} 相关的公开信号和人物。`,
        alternates: { canonical: `/resources/${entry.id}` },
      }
    : {};
}
export default async function ResourceDetailPage({ params }: Props) {
  const { id } = await params;
  const [data, relations] = await Promise.all([getPublicExploration(), getRelationsForEntity(id)]);
  const entity = data.entities.find((entry) => entry.id === id);
  if (!entity) notFound();
  return (
    <PublicEntityDetail entity={entity} relations={relations} seedEntities={data.seedEntities} />
  );
}

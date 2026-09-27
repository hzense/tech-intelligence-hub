import type { Metadata } from 'next';
import { SiteShell } from '@/components/site-shell';
import { SignalRadar } from '@/components/signal-radar';
import { getPublicExploration } from '@/lib/public-exploration-runtime';
import { buildSignalRadar } from '@/lib/signal-radar-model';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '技术演进雷达',
  description: '在交互雷达中查看公开信号的领域与分类热度、人物和公司资源，以及关联信号。',
  alternates: { canonical: '/' },
};

export default async function Home() {
  const data = await getPublicExploration();
  const model = buildSignalRadar(data.signals, data.taxonomy.topics, { entities: data.entities });
  return (
    <SiteShell showFooter={false}>
      <SignalRadar model={model} />
    </SiteShell>
  );
}

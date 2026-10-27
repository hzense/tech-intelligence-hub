import type { Metadata } from 'next';
import { SiteShell } from '@/components/site-shell';
import { SignalRadar } from '@/components/signal-radar';
import { getPublicExploration } from '@/lib/public-exploration-runtime';
import { buildSignalRadar } from '@/lib/signal-radar-model';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '技术热点词云',
  description: '通过交互词云查看技术热点、热度趋势，以及热点相关的组织、人物和公开信号。',
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

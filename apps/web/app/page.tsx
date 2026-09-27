import type { Metadata } from 'next';
import { SiteShell } from '@/components/site-shell';
import { SignalRadar } from '@/components/signal-radar';
import { getPublicExploration } from '@/lib/public-exploration-runtime';
import { buildSignalRadar } from '@/lib/signal-radar-model';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '技术演进雷达',
  description: '在同一张雷达中查看全部公开信号的领域分布、月度演进与最近事件。',
  alternates: { canonical: '/' },
};

export default async function Home() {
  const data = await getPublicExploration();
  const model = buildSignalRadar(data.signals, data.taxonomy.topics);
  return (
    <SiteShell>
      <SignalRadar model={model} />
    </SiteShell>
  );
}

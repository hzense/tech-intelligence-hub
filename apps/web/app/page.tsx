import type { Metadata } from 'next';
import { SiteShell } from '@/components/site-shell';
import { SignalRadar } from '@/components/signal-radar';
import { getPublicExploration } from '@/lib/public-exploration-runtime';
import { buildSignalRadar, parseRadarRange } from '@/lib/signal-radar-model';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '雷达 · 当前技术态势',
  description: '基于当前公开信号的领域观察与近期事件排序，展示时间窗口、样本覆盖和计算依据。',
  alternates: { canonical: '/' },
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const [data, params] = await Promise.all([getPublicExploration(), searchParams]);
  const model = buildSignalRadar(data.signals, data.taxonomy.topics, {
    range: parseRadarRange(params.range),
  });
  return (
    <SiteShell>
      <SignalRadar model={model} />
    </SiteShell>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import { getTopicEntries, formatZhDate } from '@/lib/content-runtime';
import { getSignalEntries } from '@/lib/seed-runtime';
import { isCurrentSignal } from '@/lib/public-exploration-core';
import { visibleTopicInsights } from '@/lib/server/topic-insights';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '专题洞察',
  description: '基于当前公开信号持续跟踪技术专题，区分事实、判断与不确定性。',
  alternates: { canonical: '/topics' },
};
export default async function TopicsPage() {
  const [entries, signals] = await Promise.all([getTopicEntries(), getSignalEntries()]);
  const insights = await visibleTopicInsights(signals);
  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE 专题洞察</p>
          <h1>从信号中形成判断。</h1>
          <p>
            每个专题持续汇聚公开信号。深度报告由 AI
            基于固定证据生成，管理员确认后展示；暂无报告时明确标记跟踪中。
          </p>
        </section>
        <section className="topics-index-grid" aria-label="专题洞察列表">
          {entries.map((entry) => {
            const id = entry.frontMatter.id;
            const latest = insights.find((row) => row.result.topicIds.includes(id));
            const count = signals.filter((s) => isCurrentSignal(s) && s.topics.includes(id)).length;
            return (
              <Link className="topic-index-card" href={`/topics/${id}`} key={id}>
                <div className="topic-index-meta">
                  <span>{latest ? '已确认洞察' : '跟踪中'}</span>
                  <strong>{count} 条当前信号</strong>
                </div>
                <h2>{entry.frontMatter.title}</h2>
                <p>{latest?.result.report.summary ?? entry.summary}</p>
                <p>
                  {latest
                    ? `分析日期：${formatZhDate(latest.result.generatedAt.slice(0, 10))} · ${latest.result.inputs.length} 条证据信号`
                    : '尚无已确认的深度报告，不以历史评分代替当前判断。'}
                </p>
              </Link>
            );
          })}
        </section>
      </main>
    </SiteShell>
  );
}

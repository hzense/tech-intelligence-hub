import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/site-shell';
import { formatZhDate, getInsightsForTopic, getTopicEntryById } from '@/lib/content-runtime';
import { getSignalEntries } from '@/lib/seed-runtime';
import { isCurrentSignal } from '@/lib/public-exploration-core';
import { visibleTopicInsights } from '@/lib/server/topic-insights';
import { TopicInsightReport } from '@/components/topic-insight-report';

export const dynamic = 'force-dynamic';
interface Props {
  params: Promise<{ id: string }>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const entry = await getTopicEntryById((await params).id);
  return entry
    ? {
        title: `${entry.frontMatter.title} · 专题洞察`,
        description: entry.summary,
        alternates: { canonical: `/topics/${entry.frontMatter.id}` },
      }
    : {};
}
export default async function TopicDetailPage({ params }: Props) {
  const { id } = await params;
  const [entry, signals, historical] = await Promise.all([
    getTopicEntryById(id),
    getSignalEntries(),
    getInsightsForTopic(id),
  ]);
  if (!entry) notFound();
  const current = signals.filter((s) => isCurrentSignal(s) && s.topics.includes(id));
  const editions = (await visibleTopicInsights(signals)).filter((row) =>
    row.result.topicIds.includes(id),
  );
  const latest = editions[0];
  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href="/topics">
          ← 返回专题洞察
        </Link>
        <header className="article-header">
          <p className="kicker">专题洞察 · {latest ? '已确认报告' : '跟踪中'}</p>
          <h1>{entry.frontMatter.title}</h1>
          <p>{entry.summary}</p>
        </header>
        {latest ? (
          <TopicInsightReport result={latest.result} signals={signals} />
        ) : (
          <section className="topic-overview">
            <h2>深度洞察正在积累证据</h2>
            <p>
              当前有 {current.length}{' '}
              条正式信号；尚无已确认报告。自动分析默认每周一次，也可由管理员手动启动；任务未启用或证据不足时不会生成空报告。
            </p>
          </section>
        )}
        <section className="topic-related-section">
          <h2>当前公开信号 · {current.length}</h2>
          <Link className="back-link" href={`/signals?topic=${encodeURIComponent(id)}`}>
            在信号页筛选此专题 →
          </Link>
          <div className="related-link-list">
            {current.map((s) => (
              <Link key={s.id} href={`/signals/${s.id}`}>
                <span>{formatZhDate(s.occurred_at.slice(0, 10))}</span>
                <strong>{s.title}</strong>
              </Link>
            ))}
          </div>
        </section>
        <section className="topic-related-section">
          <h2>洞察版本</h2>
          <p>每期固定输入版本；关联信号撤回或修订后，旧报告先停止公开，等待重新分析。</p>
          <div className="related-link-list">
            {editions.map((row) => (
              <Link key={row.id} href={`/topics/${id}/editions/${row.id}`}>
                <span>{formatZhDate(row.result.generatedAt.slice(0, 10))}</span>
                <strong>{row.result.report.title}</strong>
              </Link>
            ))}
          </div>
        </section>
        <details className="topic-related-section">
          <summary>历史专题资料与洞察</summary>
          <p>以下为历史档案，不代表当前评估。</p>
          {entry.sections.map((section) => (
            <section key={section.heading}>
              <h3>{section.heading}</h3>
              {section.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </section>
          ))}
          <div className="related-link-list">
            {historical.map((row) => (
              <Link key={row.frontMatter.id} href={`/insights/${row.frontMatter.id}`}>
                {row.frontMatter.title}
              </Link>
            ))}
          </div>
        </details>
      </main>
    </SiteShell>
  );
}

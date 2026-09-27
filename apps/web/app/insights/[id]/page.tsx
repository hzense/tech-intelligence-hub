import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/site-shell';
import { InsightEvidenceTimeline } from '@/components/insight-evidence-timeline';
import pageStyles from '@/components/topic-insight-pages.module.css';
import reportStyles from '@/components/topic-insight.module.css';
import { formatZhDate, getInsightEntryById, getTopicTitleMap } from '@/lib/content-runtime';
import { getSignalEntries } from '@/lib/seed-runtime';

interface InsightDetailProps {
  params: Promise<{ id: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: InsightDetailProps): Promise<Metadata> {
  const { id } = await params;
  const entry = await getInsightEntryById(id);
  if (!entry) return {};

  const canonical = `/insights/${entry.frontMatter.id}`;
  return {
    title: entry.frontMatter.title,
    description: entry.summary,
    alternates: {
      canonical,
    },
    openGraph: {
      title: entry.frontMatter.title,
      description: entry.summary,
      url: canonical,
      type: 'article',
      publishedTime: `${entry.frontMatter.date}T00:00:00Z`,
      images: [{ url: '/og.png', width: 1200, height: 630, alt: 'HZense 科技情报' }],
    },
  };
}

export default async function InsightDetailPage({ params }: InsightDetailProps) {
  const { id } = await params;
  const [entry, topicTitleMap, signals] = await Promise.all([
    getInsightEntryById(id),
    getTopicTitleMap(),
    getSignalEntries(),
  ]);
  if (!entry) notFound();
  const signalsById = new Map(signals.map((signal) => [signal.id, signal]));
  const evidence = entry.frontMatter.evidence_signals.flatMap((signalId) => {
    const signal = signalsById.get(signalId);
    return signal ? [signal] : [];
  });

  return (
    <SiteShell>
      <main className="article-main section-shell">
        <header className={pageStyles.editionHero}>
          <Link className={pageStyles.backLink} href="/topics">
            ← 所有专题洞察
          </Link>
          <p className={pageStyles.eyebrow}>HZENSE / 深度报告</p>
          <h1>{entry.frontMatter.title}</h1>
          <div className={pageStyles.editionStats}>
            <span>发布于 {formatZhDate(entry.frontMatter.date)}</span>
            <span>{evidence.length} 条可公开读取的证据</span>
            {entry.frontMatter.topics.map((topic) => (
              <Link href={`/topics/${topic}`} key={topic}>
                {topicTitleMap.get(topic) ?? topic}
              </Link>
            ))}
          </div>
        </header>
        <article className={reportStyles.report} aria-label="洞察报告正文">
          <div className={reportStyles.lead}>
            <p className={reportStyles.eyebrow}>报告摘要</p>
            <p className={reportStyles.summary}>{entry.summary}</p>
          </div>
          <InsightEvidenceTimeline signals={evidence} />
          {entry.sections.map((section, index) => (
            <section className={reportStyles.editorialSection} key={section.heading}>
              <div className={reportStyles.sectionHeading}>
                <span>{String(index + 1).padStart(2, '0')} / 分析</span>
                <h2>{section.heading}</h2>
              </div>
              <div className={reportStyles.sectionBody}>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
          <section className={reportStyles.uncertainties} aria-labelledby="editorial-evidence">
            <p className={reportStyles.eyebrow}>可追溯阅读</p>
            <h2 id="editorial-evidence">关联证据信号</h2>
            {evidence.length ? (
              <ul>
                {evidence.map((signal) => (
                  <li key={signal.id}>
                    <Link href={`/signals/${signal.id}`}>{signal.title} ↗</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>关联信号暂不可公开读取，不展示虚构的证据图表或链接。</p>
            )}
          </section>
        </article>
      </main>
    </SiteShell>
  );
}

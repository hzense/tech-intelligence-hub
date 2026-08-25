import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteShell } from '@/components/site-shell';
import {
  formatZhDate,
  getInsightEntries,
  getInsightEntryById,
  getTopicTitleMap,
} from '@/lib/content-runtime';

interface InsightDetailProps {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
  return (await getInsightEntries()).map((entry) => ({ id: entry.frontMatter.id }));
}

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
  const [entry, topicTitleMap] = await Promise.all([
    getInsightEntryById(id),
    getTopicTitleMap(),
  ]);
  if (!entry) notFound();

  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href="/insights">← 返回全部洞察</Link>
        <header className="article-header">
          <div className="article-meta">
            <span>HZENSE 洞察</span>
            <time dateTime={entry.frontMatter.date}>{formatZhDate(entry.frontMatter.date)}</time>
          </div>
          <h1>{entry.frontMatter.title}</h1>
          <p>{entry.summary}</p>
          <div className="brief-stats">
            <span>重要度 {entry.frontMatter.importance}/5</span>
            <span>{entry.frontMatter.evidence_signals.length} 条证据信号</span>
            {entry.frontMatter.topics.map((topic) => (
              <Link href={`/topics/${topic}`} key={topic}>
                {topicTitleMap.get(topic) ?? topic}
              </Link>
            ))}
          </div>
        </header>
        <article className="insight-detail-body">
          {entry.sections.map((section, index) => (
            <section className="insight-section" key={section.heading}>
              <span>0{index + 1} · 分析</span>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
          <aside className="insight-evidence">
            <strong>证据关联</strong>
            <p>
              本洞察关联 {entry.frontMatter.evidence_signals.length} 条已校验信号；
              专题与实体引用由内容验证层持续检查。
            </p>
          </aside>
        </article>
      </main>
    </SiteShell>
  );
}

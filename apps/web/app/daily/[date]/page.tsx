import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteShell } from "@/components/site-shell";
import {
  formatZhDate,
  getDailyEntries,
  getDailyEntryByDate,
  splitSignalHeading,
} from "@/lib/content-runtime";

interface DailyDetailProps {
  params: Promise<{ date: string }>;
}

export async function generateStaticParams() {
  return (await getDailyEntries()).map((entry) => ({ date: entry.frontMatter.date }));
}

export async function generateMetadata({ params }: DailyDetailProps): Promise<Metadata> {
  const { date } = await params;
  const entry = await getDailyEntryByDate(date);
  if (!entry) return {};

  const title = `每日简报 — ${formatZhDate(entry.frontMatter.date)}`;
  const canonical = `/daily/${entry.frontMatter.date}`;
  return {
    title,
    description: entry.summary,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      url: canonical,
      description: entry.summary,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "HZense 科技情报" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: entry.summary,
      images: ["/og.png"],
    },
  };
}

export default async function DailyDetailPage({ params }: DailyDetailProps) {
  const { date } = await params;
  const entry = await getDailyEntryByDate(date);
  if (!entry) notFound();

  const executiveSummary = entry.sections.find((section) => section.heading === "执行摘要");
  const signalSections = entry.sections.filter((section) => section.heading !== "执行摘要");

  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href="/daily">← 返回全部每日简报</Link>
        <header className="article-header">
          <div className="article-meta">
            <span>HZENSE 每日简报</span>
            <time dateTime={entry.frontMatter.date}>{formatZhDate(entry.frontMatter.date)}</time>
          </div>
          <h1>{entry.frontMatter.title}</h1>
          <p>{entry.summary}</p>
          <div className="brief-stats">
            <span>{entry.frontMatter.signal_count} 个信号</span>
            <span>{entry.frontMatter.major_developments} 项重大进展</span>
            <span>{entry.frontMatter.language === "zh-CN" ? "中文" : "English"}</span>
          </div>
        </header>
        <div className="article-layout">
          <aside>
            <span>本期内容</span>
            {signalSections.map((section, index) => {
              const signal = splitSignalHeading(section);
              return <a key={section.heading} href={`#signal-${index + 1}`}>0{index + 1} {signal.category}</a>;
            })}
          </aside>
          <article className="article-body">
            {executiveSummary && (
              <section className="executive-summary">
                <span>执行摘要</span>
                <p>{executiveSummary.paragraphs.join(" ")}</p>
              </section>
            )}
            {signalSections.map((section, index) => {
              const signal = splitSignalHeading(section);
              const [summary, ...whyItMatters] = section.paragraphs;
              return (
                <section className="signal-section" id={`signal-${index + 1}`} key={section.heading}>
                  <div className="signal-section-number">0{index + 1}</div>
                  <div>
                    <span className="signal-category">{signal.category}</span>
                    <h2>{signal.title}</h2>
                    <p>{summary}</p>
                    {whyItMatters.length > 0 && (
                      <div className="why-it-matters">
                        <strong>为什么重要</strong>
                        <p>{whyItMatters.join(" ").replace(/^为什么重要[：:]\s*/, "")}</p>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </article>
        </div>
      </main>
    </SiteShell>
  );
}

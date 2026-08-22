import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { formatZhDate, getDailyEntries, splitSignalHeading } from "@/lib/content-runtime";

export const metadata: Metadata = {
  title: "每日简报",
  description: "HZense 每日科技情报简报。",
};

export default async function DailyPage() {
  const dailyEntries = await getDailyEntries();
  const latestDaily = dailyEntries[0];
  const previewSections = latestDaily?.sections.filter((section) => section.heading !== "执行摘要") ?? [];

  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE 每日简报</p>
          <h1>值得带入今天的重要信号。</h1>
          <p>精炼的科技情报，并与更深入的专题、实体和证据相互关联。</p>
        </section>
        <section className="daily-list" aria-label="每日简报列表">
          {dailyEntries.map((entry) => (
            <Link className="daily-list-feature" href={`/daily/${entry.frontMatter.date}`} key={entry.frontMatter.id}>
              <div>
                <span className="archive-label">历史示例简报</span>
                <time dateTime={entry.frontMatter.date}>{formatZhDate(entry.frontMatter.date)}</time>
              </div>
              <div>
                <h2>{entry.frontMatter.title}</h2>
                <p>{entry.summary}</p>
                <div className="brief-stats">
                  <span>{entry.frontMatter.signal_count} 个信号</span>
                  <span>{entry.frontMatter.major_developments} 项进展</span>
                  <span>{entry.frontMatter.rising_topics.length} 个专题</span>
                </div>
              </div>
              <span className="arrow-box">↗</span>
            </Link>
          ))}
          <div className="signal-preview-grid">
            {previewSections.map((section, index) => {
              const signal = splitSignalHeading(section);
              return (
                <article key={section.heading}>
                  <span>0{index + 1} · {signal.category}</span>
                  <h3>{signal.title}</h3>
                  <p>{section.paragraphs[0]}</p>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

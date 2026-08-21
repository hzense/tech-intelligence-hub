import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { dailySignals } from "@/lib/content";

export const metadata: Metadata = {
  title: "每日简报",
  description: "HZense 每日科技情报简报。",
};

export default function DailyPage() {
  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE 每日简报</p>
          <h1>值得带入今天的重要信号。</h1>
          <p>精炼的科技情报，并与更深入的专题、实体和证据相互关联。</p>
        </section>
        <section className="daily-list" aria-label="每日简报列表">
          <Link className="daily-list-feature" href="/daily/2024-06-20">
            <div>
              <span className="archive-label">历史示例简报</span>
              <time dateTime="2024-06-20">2024 年 6 月 20 日</time>
            </div>
            <div>
              <h2>平台转型、基础设施压力与 AI 安全</h2>
              <p>三个相互关联的信号，共同构成 HZense 首个内容模型与阅读体验。</p>
              <div className="brief-stats"><span>3 个信号</span><span>3 项进展</span><span>3 个专题</span></div>
            </div>
            <span className="arrow-box">↗</span>
          </Link>
          <div className="signal-preview-grid">
            {dailySignals.map((signal, index) => (
              <article key={signal.title}>
                <span>0{index + 1} · {signal.category}</span>
                <h3>{signal.title}</h3>
                <p>{signal.summary}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

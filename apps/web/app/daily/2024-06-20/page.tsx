import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { dailySignals } from "@/lib/content";

export const metadata: Metadata = {
  title: "每日简报 — 2024 年 6 月 20 日",
  description: "涵盖基础模型、AI 基础设施与 AI 安全的历史示例简报。",
  openGraph: { images: [] },
  twitter: { images: [] },
};

export default function DailyDetailPage() {
  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href="/daily">← 返回全部每日简报</Link>
        <header className="article-header">
          <div className="article-meta"><span>HZENSE 每日简报</span><time dateTime="2024-06-20">2024 年 6 月 20 日</time></div>
          <h1>平台转型、基础设施压力与 AI 安全</h1>
          <p>这份历史示例简报展示了 HZense 如何把彼此分散的科技动态，转化为相互关联的情报视图。</p>
          <div className="brief-stats"><span>3 个信号</span><span>3 项重大进展</span><span>中文</span></div>
        </header>
        <div className="article-layout">
          <aside>
            <span>本期内容</span>
            {dailySignals.map((signal, index) => <a key={signal.title} href={`#signal-${index + 1}`}>0{index + 1} {signal.category}</a>)}
          </aside>
          <article className="article-body">
            <section className="executive-summary">
              <span>执行摘要</span>
              <p>科技优势正在从孤立的模型性能，转向完整系统能力：平台、基础设施、安全的智能体工作流，以及连接这些要素的证据。</p>
            </section>
            {dailySignals.map((signal, index) => (
              <section className="signal-section" id={`signal-${index + 1}`} key={signal.title}>
                <div className="signal-section-number">0{index + 1}</div>
                <div>
                  <span className="signal-category">{signal.category}</span>
                  <h2>{signal.title}</h2>
                  <p>{signal.summary}</p>
                  <div className="why-it-matters"><strong>为什么重要</strong><p>{index === 0 ? "分发能力与工作流控制带来的复利，可能快于单纯的模型差异化。" : index === 1 ? "基础设施设计正在决定产品经济性、可靠性与能力交付速度。" : "自主执行会放大身份、权限、隔离与可观测性薄弱所带来的风险。"}</p></div>
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>
    </SiteShell>
  );
}

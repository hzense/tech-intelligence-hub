import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { dailySignals } from "@/lib/content";

export const metadata: Metadata = {
  title: "Daily Brief — 20 June 2024",
  description: "Historical seed brief covering foundation models, AI infrastructure, and AI security.",
  openGraph: { images: [] },
  twitter: { images: [] },
};

export default function DailyDetailPage() {
  return (
    <SiteShell>
      <main className="article-main section-shell">
        <Link className="back-link" href="/daily">← All daily briefs</Link>
        <header className="article-header">
          <div className="article-meta"><span>HZENSE DAILY</span><time dateTime="2024-06-20">20 JUNE 2024</time></div>
          <h1>Platform shifts, infrastructure pressure, and AI security</h1>
          <p>This historical seed brief demonstrates how HZense turns separate technology updates into a connected intelligence view.</p>
          <div className="brief-stats"><span>3 signals</span><span>3 major developments</span><span>English</span></div>
        </header>
        <div className="article-layout">
          <aside>
            <span>IN THIS BRIEF</span>
            {dailySignals.map((signal, index) => <a key={signal.title} href={`#signal-${index + 1}`}>0{index + 1} {signal.category}</a>)}
          </aside>
          <article className="article-body">
            <section className="executive-summary">
              <span>EXECUTIVE SUMMARY</span>
              <p>Technology advantage is shifting from isolated model performance toward complete systems: platforms, infrastructure, secure agent workflows, and the evidence connecting them.</p>
            </section>
            {dailySignals.map((signal, index) => (
              <section className="signal-section" id={`signal-${index + 1}`} key={signal.title}>
                <div className="signal-section-number">0{index + 1}</div>
                <div>
                  <span className="signal-category">{signal.category}</span>
                  <h2>{signal.title}</h2>
                  <p>{signal.summary}</p>
                  <div className="why-it-matters"><strong>Why it matters</strong><p>{index === 0 ? "Distribution and workflow ownership can compound faster than model differentiation alone." : index === 1 ? "Infrastructure design now shapes product economics, reliability, and the pace of capability delivery." : "Autonomous action raises the cost of weak identity, permissions, isolation, and observability."}</p></div>
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>
    </SiteShell>
  );
}

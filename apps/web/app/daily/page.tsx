import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { dailySignals } from "@/lib/content";

export const metadata: Metadata = {
  title: "HZense Daily",
  description: "Daily technology intelligence briefs from HZense.",
};

export default function DailyPage() {
  return (
    <SiteShell>
      <main className="page-main section-shell">
        <section className="page-hero">
          <p className="kicker">HZENSE DAILY</p>
          <h1>The signals worth carrying into your day.</h1>
          <p>Concise technology intelligence, connected to deeper topics, entities, and evidence.</p>
        </section>
        <section className="daily-list" aria-label="Daily briefs">
          <Link className="daily-list-feature" href="/daily/2024-06-20">
            <div>
              <span className="archive-label">HISTORICAL SEED BRIEF</span>
              <time dateTime="2024-06-20">20 June 2024</time>
            </div>
            <div>
              <h2>Platform shifts, infrastructure pressure, and AI security</h2>
              <p>Three connected signals establish the initial HZense content model and reading experience.</p>
              <div className="brief-stats"><span>3 signals</span><span>3 developments</span><span>3 topics</span></div>
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

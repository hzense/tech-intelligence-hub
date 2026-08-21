import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { intelligenceCards, radarItems } from "@/lib/content";

export default function Home() {
  return (
    <SiteShell>
      <main>
        <section className="hero section-shell">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" /> Technology intelligence, continuously refined
            </div>
            <h1>
              Sense what <span>matters</span> in technology.
            </h1>
            <p className="hero-intro">
              HZense turns fragmented signals into structured intelligence—so you can see
              what changed, why it matters, and what deserves attention next.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/daily/2024-06-20">
                Read the sample brief <span aria-hidden="true">↗</span>
              </Link>
              <a className="button button-secondary" href="#radar">
                Explore the radar
              </a>
            </div>
            <div className="coverage-row" aria-label="Coverage areas">
              <span>AI</span><i />
              <span>Infrastructure</span><i />
              <span>Security</span><i />
              <span>Robotics</span><i />
              <span>Agents</span>
            </div>
          </div>

          <aside className="signal-panel" aria-label="Technology signal overview">
            <div className="signal-glow" />
            <div className="signal-panel-header">
              <div>
                <span className="panel-kicker">SIGNAL MAP</span>
                <strong>Emerging intelligence</strong>
              </div>
              <span className="status-pill">LIVE</span>
            </div>
            <div className="signal-visual" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="orbit orbit-three" />
              <div className="core-mark">H</div>
              <span className="node node-ai">AI</span>
              <span className="node node-sec">SEC</span>
              <span className="node node-infra">INFRA</span>
              <span className="node node-agent">AGENT</span>
            </div>
            <div className="signal-metrics">
              <div><strong>24</strong><span>signals tracked</span></div>
              <div><strong>5</strong><span>priority shifts</span></div>
              <div><strong>3</strong><span>rising topics</span></div>
            </div>
          </aside>
        </section>

        <section className="section-shell intelligence-section" id="intelligence">
          <div className="section-heading">
            <div>
              <span className="section-number">01</span>
              <p className="kicker">CURATED INTELLIGENCE</p>
              <h2>Signals become understanding.</h2>
            </div>
            <Link className="text-link" href="/daily">View HZense Daily <span>↗</span></Link>
          </div>
          <div className="insight-grid">
            {intelligenceCards.map((card, index) => (
              <article className="insight-card" key={card.title}>
                <div className="card-topline">
                  <span>{card.label}</span>
                  <time>{card.date}</time>
                </div>
                <div className={`card-signal signal-${index + 1}`} aria-hidden="true">
                  <span />
                </div>
                <h3>{card.title}</h3>
                <p>{card.summary}</p>
                <div className="topic-row">
                  {card.topics.map((topic) => <span key={topic}>{topic}</span>)}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="radar-wrap" id="radar">
          <div className="section-shell radar-section">
            <div className="radar-copy">
              <span className="section-number light">02</span>
              <p className="kicker light">HZENSE RADAR</p>
              <h2>Track momentum, not noise.</h2>
              <p>
                A living view of attention, maturity, and strategic value across the
                technologies shaping the next cycle.
              </p>
              <a className="button button-light" href="#radar-list">Open technology radar</a>
            </div>
            <div className="radar-list" id="radar-list">
              {radarItems.map((item, index) => (
                <article key={item.name}>
                  <span className="radar-index">0{index + 1}</span>
                  <div className="radar-name">
                    <strong>{item.name}</strong>
                    <span>{item.stage}</span>
                  </div>
                  <div className="trend-track" aria-label={`${item.name} score ${item.score} out of 100`}>
                    <span style={{ width: `${item.score}%` }} />
                  </div>
                  <strong className="trend-score">{item.score}</strong>
                  <span className={`trend-label ${item.trend}`}>{item.trendLabel}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section-shell daily-section">
          <div className="daily-card">
            <div className="daily-meta">
              <span>HZENSE DAILY</span>
              <time dateTime="2024-06-20">20 JUN 2024 · HISTORICAL SEED</time>
            </div>
            <div className="daily-content">
              <div>
                <p className="kicker">ONE BRIEF. THE SIGNALS THAT MATTER.</p>
                <h2>Your daily technology intelligence briefing.</h2>
              </div>
              <p>
                A concise synthesis of major developments, rising topics, and connected
                signals—designed for fast reading and deeper exploration.
              </p>
              <Link className="circle-link" href="/daily/2024-06-20" aria-label="Read HZense Daily">
                ↗
              </Link>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

import Link from "next/link";
import { SiteShell } from "@/components/site-shell";
import { formatZhDate, getDailyEntries, getInsightEntries, getTopicTitleMap } from "@/lib/content-runtime";
import { formatRadarMaturity, formatRadarTrend } from "@/lib/radar-presentation";
import { getRadarEntries } from "@/lib/radar-runtime";

export default async function Home() {
  const [dailyEntries, insightEntries, radarEntries, topicTitleMap] = await Promise.all([
    getDailyEntries(),
    getInsightEntries(),
    getRadarEntries(),
    getTopicTitleMap(),
  ]);
  const latestDaily = dailyEntries[0];
  const intelligenceCards = insightEntries.slice(0, 3).map((entry) => ({
    label: "洞察",
    href: `/insights/${entry.frontMatter.id}`,
    date: formatZhDate(entry.frontMatter.date),
    title: entry.frontMatter.title,
    summary: entry.summary,
    topics: entry.frontMatter.topics.map((topic) => topicTitleMap.get(topic) ?? topic),
  }));
  const dailyHref = latestDaily ? `/daily/${latestDaily.frontMatter.date}` : "/daily";

  return (
    <SiteShell>
      <main>
        <section className="hero section-shell">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="live-dot" /> 持续提炼的科技情报
            </div>
            <h1>
              感知科技的<span>变化</span>
            </h1>
            <p className="hero-intro">
              HZense 将分散的信号转化为结构化情报——帮助你看清发生了什么、
              为何重要，以及下一步应该关注什么。
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href={dailyHref}>
                阅读示例简报 <span aria-hidden="true">↗</span>
              </Link>
              <Link className="button button-secondary" href="/radar">
                探索技术雷达
              </Link>
            </div>
            <div className="coverage-row" aria-label="关注领域">
              <span>人工智能</span><i />
              <span>基础设施</span><i />
              <span>安全</span><i />
              <span>机器人</span><i />
              <span>智能体</span>
            </div>
          </div>

          <aside className="signal-panel" aria-label="科技信号示例">
            <div className="signal-glow" />
            <div className="signal-panel-header">
              <div>
                <span className="panel-kicker">信号图谱</span>
                <strong>新兴科技情报</strong>
              </div>
              <span className="status-pill">示例数据</span>
            </div>
            <div className="signal-visual" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="orbit orbit-three" />
              <div className="core-mark">H</div>
              <span className="node node-ai">AI</span>
              <span className="node node-sec">安全</span>
              <span className="node node-infra">设施</span>
              <span className="node node-agent">智能体</span>
            </div>
            <div className="signal-metrics">
              <div><strong>24</strong><span>追踪信号（示例）</span></div>
              <div><strong>5</strong><span>优先级变化（示例）</span></div>
              <div><strong>3</strong><span>上升议题（示例）</span></div>
            </div>
          </aside>
        </section>

        <section className="section-shell intelligence-section" id="intelligence">
          <div className="section-heading">
            <div>
              <span className="section-number">01</span>
              <p className="kicker">精选情报</p>
              <h2>让信号形成理解。</h2>
            </div>
            <Link className="text-link" href="/insights">查看全部洞察 <span>↗</span></Link>
          </div>
          <div className="insight-grid">
            {intelligenceCards.map((card, index) => (
              <Link className="insight-card" href={card.href} key={card.title}>
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
              </Link>
            ))}
          </div>
        </section>

        <section className="radar-wrap" id="radar">
          <div className="section-shell radar-section">
            <div className="radar-copy">
              <span className="section-number light">02</span>
              <p className="kicker light">HZENSE 雷达</p>
              <h2>追踪趋势，而不是噪音。</h2>
              <p>
                持续观察正在塑造下一个周期的技术，判断其关注度、成熟度与战略价值。
              </p>
              <Link className="button button-light" href="/radar">打开技术雷达</Link>
            </div>
            <div className="radar-list" id="radar-list">
              {radarEntries.slice(0, 4).map((entry, index) => (
                <article key={entry.snapshot.id}>
                  <span className="radar-index">0{index + 1}</span>
                  <div className="radar-name">
                    <strong>{entry.topic.frontMatter.title}</strong>
                    <span>{formatRadarMaturity(entry.snapshot.maturity)}</span>
                  </div>
                  <div className="trend-track" aria-label={`${entry.topic.frontMatter.title} 关注度 ${entry.snapshot.attention}，满分 100`}>
                    <span style={{ width: `${entry.snapshot.attention}%` }} />
                  </div>
                  <strong className="trend-score">{entry.snapshot.attention}</strong>
                  <span className={`trend-label ${entry.snapshot.trend}`}>
                    {formatRadarTrend(entry.snapshot.trend)}
                  </span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section-shell daily-section">
          <div className="daily-card">
            <div className="daily-meta">
              <span>HZENSE 每日简报</span>
              {latestDaily ? (
                <time dateTime={latestDaily.frontMatter.date}>{formatZhDate(latestDaily.frontMatter.date)} · 历史示例</time>
              ) : <span>内容准备中</span>}
            </div>
            <div className="daily-content">
              <div>
                <p className="kicker">一份简报，聚焦真正重要的信号。</p>
                <h2>{latestDaily?.frontMatter.title ?? "你的每日科技情报简报。"}</h2>
              </div>
              <p>
                精炼汇总重大进展、上升议题与关联信号，既能快速阅读，也能深入探索。
              </p>
              <Link className="circle-link" href={dailyHref} aria-label="阅读 HZense 每日简报">
                ↗
              </Link>
            </div>
          </div>
        </section>
      </main>
    </SiteShell>
  );
}

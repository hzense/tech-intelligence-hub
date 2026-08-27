import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import {
  formatRadarDomain,
  formatRadarMaturity,
  formatRadarStrategicValue,
  formatRadarTrend,
  isRadarDomain,
  isRadarMaturity,
  isRadarTrend,
  radarDomainOptions,
  radarMaturityOptions,
  radarTrendOptions,
} from '@/lib/radar-presentation';
import { getRadarNodePosition, type RadarFilters } from '@/lib/radar-model';
import { getRadarEntries } from '@/lib/radar-runtime';

export const metadata: Metadata = {
  title: '科技雷达',
  description: 'HZense 科技雷达：按关注度、趋势、成熟度与战略价值追踪关键技术方向。',
  alternates: { canonical: '/radar' },
  openGraph: {
    title: 'HZense 科技雷达',
    description: '从结构化信号中识别值得持续关注的技术方向。',
    url: '/radar',
    type: 'website',
  },
};

type RadarSearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default async function RadarPage({ searchParams }: { searchParams: RadarSearchParams }) {
  const params = await searchParams;
  const domainValue = firstValue(params.domain);
  const maturityValue = firstValue(params.maturity);
  const trendValue = firstValue(params.trend);
  const filters: RadarFilters = {
    ...(isRadarDomain(domainValue) ? { domain: domainValue } : {}),
    ...(isRadarMaturity(maturityValue) ? { maturity: maturityValue } : {}),
    ...(isRadarTrend(trendValue) ? { trend: trendValue } : {}),
  };
  const entries = await getRadarEntries(filters);
  const latestDate = entries[0]?.snapshot.date;

  return (
    <SiteShell>
      <main className="page-main section-shell radar-page">
        <section className="page-hero radar-page-hero">
          <p className="kicker">HZENSE RADAR</p>
          <h1>看清技术所处的位置。</h1>
          <p>以专题为观察单元，把已验证信号转化为关注度、趋势、成熟度与战略价值判断。</p>
          {latestDate ? <time dateTime={latestDate}>当前快照 · {latestDate}</time> : null}
        </section>

        <form className="radar-filters" action="/radar" aria-label="科技雷达筛选">
          <label>
            <span>领域</span>
            <select name="domain" defaultValue={filters.domain ?? ''}>
              <option value="">全部领域</option>
              {radarDomainOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>成熟阶段</span>
            <select name="maturity" defaultValue={filters.maturity ?? ''}>
              <option value="">全部阶段</option>
              {radarMaturityOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>趋势</span>
            <select name="trend" defaultValue={filters.trend ?? ''}>
              <option value="">全部趋势</option>
              {radarTrendOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">应用筛选</button>
          <Link href="/radar">重置</Link>
        </form>

        {entries.length > 0 ? (
          <>
            <section className="radar-matrix" aria-label="科技雷达可视化">
              <div className="radar-matrix-label radar-matrix-y">关注度</div>
              <div className="radar-matrix-label radar-matrix-x">成熟度 →</div>
              <div className="radar-matrix-grid" aria-hidden="true" />
              {entries.map((entry) => (
                <Link
                  className={`radar-node radar-node-${entry.snapshot.strategic_value}`}
                  href={`/topics/${entry.snapshot.topic}`}
                  key={entry.snapshot.id}
                  style={getRadarNodePosition(entry.snapshot)}
                  aria-label={`${entry.topic.frontMatter.title}，关注度 ${entry.snapshot.attention}，${formatRadarMaturity(entry.snapshot.maturity)}`}
                >
                  <span>{entry.snapshot.attention}</span>
                  <strong>{entry.topic.frontMatter.title}</strong>
                </Link>
              ))}
            </section>

            <section className="radar-entry-grid" aria-label="科技雷达条目">
              {entries.map((entry) => (
                <article className="radar-entry-card" key={entry.snapshot.id}>
                  <div className="radar-entry-heading">
                    <div>
                      <span>{formatRadarDomain(entry.snapshot.domain)}</span>
                      <h2>{entry.topic.frontMatter.title}</h2>
                    </div>
                    <strong>{entry.snapshot.attention}</strong>
                  </div>
                  <p>{entry.topic.summary}</p>
                  <dl className="radar-metrics">
                    <div>
                      <dt>趋势</dt>
                      <dd>{formatRadarTrend(entry.snapshot.trend)}</dd>
                    </div>
                    <div>
                      <dt>成熟度</dt>
                      <dd>{formatRadarMaturity(entry.snapshot.maturity)}</dd>
                    </div>
                    <div>
                      <dt>战略价值</dt>
                      <dd>{formatRadarStrategicValue(entry.snapshot.strategic_value)}</dd>
                    </div>
                    <div>
                      <dt>置信度</dt>
                      <dd>{Math.round(entry.snapshot.confidence * 100)}%</dd>
                    </div>
                  </dl>
                  <div className="radar-evidence">
                    <div>
                      <span>关联信号</span>
                      {entry.signals.slice(0, 3).map((signal) => (
                        <Link href={`/signals/${signal.id}`} key={signal.id}>
                          {signal.title}
                        </Link>
                      ))}
                    </div>
                    <div>
                      <span>关联资源</span>
                      {entry.resources.slice(0, 4).map((resource) => (
                        <Link href={`/resources/${resource.id}`} key={resource.id}>
                          {resource.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                  <Link className="radar-topic-link" href={`/topics/${entry.snapshot.topic}`}>
                    查看专题证据链 <span aria-hidden="true">↗</span>
                  </Link>
                </article>
              ))}
            </section>
          </>
        ) : (
          <section className="radar-empty" aria-live="polite">
            <h2>当前筛选条件下没有雷达条目。</h2>
            <p>重置筛选后查看全部已发布技术方向。</p>
            <Link className="button button-primary" href="/radar">
              查看全部雷达
            </Link>
          </section>
        )}
      </main>
    </SiteShell>
  );
}

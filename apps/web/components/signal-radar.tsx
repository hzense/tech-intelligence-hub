import Link from 'next/link';
import type { RadarDomainObservation, SignalRadarModel } from '../lib/signal-radar-model';
import styles from './signal-radar.module.css';

const date = (value: string) => value.slice(0, 10);
const timestamp = (value: string) => `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
const point = (index: number, count: number, radius: number, centerX = 420, centerY = 244) => {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return {
    x: Math.round((centerX + radius * Math.cos(angle)) * 10) / 10,
    y: Math.round((centerY + radius * Math.sin(angle)) * 10) / 10,
  };
};
const polygon = (
  domains: readonly RadarDomainObservation[],
  ratio: (domain: RadarDomainObservation) => number,
) =>
  domains
    .map((domain, index) => {
      const { x, y } = point(index, domains.length, 178 * ratio(domain));
      return `${x},${y}`;
    })
    .join(' ');

function DomainRadar({ model }: { model: SignalRadarModel }) {
  const domains = model.domains;
  const maximum = Math.max(1, ...domains.map((domain) => domain.totalCount));
  const maximumRecent = Math.max(1, ...domains.map((domain) => domain.recentCount));
  if (!domains.length) return <p className={styles.emptyChart}>尚无领域分类可供绘制。</p>;
  return (
    <div className={styles.chartFrame}>
      <svg
        className={styles.chart}
        viewBox="0 0 840 492"
        role="img"
        aria-label={`领域雷达：${domains.map((domain) => `${domain.name} 累计 ${domain.totalCount} 条，近 30 日 ${domain.recentCount} 条`).join('；')}`}
      >
        <title>全部公开信号的领域分布与近 30 日观察</title>
        {[0.25, 0.5, 0.75, 1].map((fraction) => (
          <polygon
            key={fraction}
            className={styles.gridRing}
            points={polygon(domains, () => fraction)}
          />
        ))}
        {domains.map((domain, index) => {
          const end = point(index, domains.length, 178);
          const label = point(index, domains.length, 216);
          return (
            <g key={domain.id}>
              <line className={styles.axis} x1="420" y1="244" x2={end.x} y2={end.y} />
              <text
                className={styles.axisLabel}
                x={label.x}
                y={label.y}
                textAnchor={label.x < 380 ? 'end' : label.x > 460 ? 'start' : 'middle'}
                dominantBaseline="middle"
              >
                {domain.name}
              </text>
            </g>
          );
        })}
        <polygon
          className={styles.totalShape}
          points={polygon(domains, (domain) => domain.totalCount / maximum)}
        />
        {domains.map((domain, index) => {
          if (!domain.recentCount) return null;
          const { x, y } = point(index, domains.length, 178);
          return (
            <circle
              key={domain.id}
              className={styles.recentPoint}
              cx={x}
              cy={y}
              r={3 + (domain.recentCount / maximumRecent) * 5}
            />
          );
        })}
        <circle className={styles.centerPoint} cx="420" cy="244" r="3" />
      </svg>
      <div className={styles.chartLegend}>
        <span>
          <i className={styles.totalSwatch} /> 全部收录
        </span>
        <span>
          <i className={styles.recentSwatch} /> 近 30 日
        </span>
        <small>累计轮廓最高 {maximum} 条 · 亮点大小在近 30 日内单独比较</small>
      </div>
    </div>
  );
}

function SubtopicBars({ model }: { model: SignalRadarModel }) {
  const observed = model.subtopics.filter((topic) => topic.totalCount > 0);
  const visible = observed.slice(0, 8);
  const maximumTotal = Math.max(1, ...visible.map((topic) => topic.totalCount));
  const maximumRecent = Math.max(1, ...visible.map((topic) => topic.recentCount));
  return (
    <section className={styles.subtopicSection} aria-labelledby="radar-subtopics">
      <div className={styles.sectionHeading}>
        <div>
          <p className="kicker">DEEP DIVE / 二级专题</p>
          <h2 id="radar-subtopics">领域内部的关注落点</h2>
        </div>
        <span>按累计信号数排列 · 展示前 {visible.length} 个</span>
      </div>
      {visible.length ? (
        <div className={styles.subtopicGrid}>
          {visible.map((topic) => (
            <article className={styles.subtopicCard} key={topic.id}>
              <p>{topic.domainName}</p>
              <h3>{topic.name}</h3>
              <div className={styles.subtopicMeasure}>
                <span>累计</span>
                <div className={styles.subtopicTrack} aria-hidden="true">
                  <i
                    className={styles.subtopicTotalBar}
                    style={{ width: `${(topic.totalCount / maximumTotal) * 100}%` }}
                  />
                </div>
                <strong>{topic.totalCount}</strong>
              </div>
              <div className={styles.subtopicMeasure}>
                <span>近 30 日</span>
                <div className={styles.subtopicTrack} aria-hidden="true">
                  <i
                    className={styles.subtopicRecentBar}
                    style={{ width: `${(topic.recentCount / maximumRecent) * 100}%` }}
                  />
                </div>
                <strong>{topic.recentCount}</strong>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>
          <h3>暂无二级专题映射</h3>
          <p>一级领域仍会在主雷达中计数，不会因缺少细分专题而消失。</p>
        </div>
      )}
      <p className={styles.note}>
        横条的累计与近 30
        日分别按各自最大值缩放，不能跨两行比较长度；数字是本站公开样本的事件数，不是产业热度评分。同一信号可关联多个专题。
        {observed.length > visible.length
          ? `其余 ${observed.length - visible.length} 个有记录专题未在此图展开。`
          : ''}
      </p>
    </section>
  );
}

function FocusDomain({ domain }: { domain: RadarDomainObservation }) {
  const recentShare = domain.totalCount
    ? Math.round((domain.recentCount / domain.totalCount) * 100)
    : 0;
  return (
    <article className={styles.focusCard}>
      <span className={styles.focusEyebrow}>领域观察</span>
      <h3>{domain.name}</h3>
      <div className={styles.focusNumbers}>
        <strong>{domain.recentCount}</strong>
        <span>近 30 日 / 累计 {domain.totalCount} 条</span>
      </div>
      <div
        className={styles.focusTrack}
        role="img"
        aria-label={`近 30 日数量占本领域累计数量 ${recentShare}%`}
      >
        <span style={{ width: `${recentShare}%` }} />
      </div>
      <p>
        前 30 日 {domain.previousCount} 条
        {domain.latestAt ? ` · 最近事件 ${date(domain.latestAt)}` : ''}
      </p>
    </article>
  );
}

function EvolutionMatrix({ model }: { model: SignalRadarModel }) {
  const maximum = Math.max(1, ...model.domains.flatMap((domain) => domain.monthlyCounts));
  return (
    <div className={styles.matrixScroll}>
      <table className={styles.matrix}>
        <thead>
          <tr>
            <th scope="col">领域</th>
            {model.months.map((month) => (
              <th key={month.key} scope="col">
                {month.label}
              </th>
            ))}
            <th scope="col">累计</th>
          </tr>
        </thead>
        <tbody>
          {model.focusDomains.map((domain) => (
            <tr key={domain.id}>
              <th scope="row">{domain.name}</th>
              {domain.monthlyCounts.map((count, index) => {
                const level = count ? Math.max(1, Math.ceil((count / maximum) * 4)) : 0;
                return (
                  <td key={model.months[index]?.key ?? index}>
                    <span className={styles[`heat${level}`]}>{count || '—'}</span>
                  </td>
                );
              })}
              <td className={styles.totalCell}>{domain.totalCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SignalRadar({ model }: { model: SignalRadarModel }) {
  const domainNames = new Map(model.domains.map((domain) => [domain.id, domain.name]));
  const focus = model.focusDomains.filter((domain) => domain.recentCount > 0).slice(0, 3);
  return (
    <main className={`page-main section-shell ${styles.radar}`}>
      <header className={styles.heading}>
        <div>
          <p className="kicker">HZENSE / TECHNOLOGY LANDSCAPE</p>
          <h1>技术演进雷达</h1>
          <p>将本次公开读取的信号放进同一视野。看领域关注落点，也看事件沿时间如何移动。</p>
        </div>
        <div className={styles.watermark}>
          <span>观测截止</span>
          <time dateTime={model.asOf}>{timestamp(model.asOf)}</time>
          <span>以事件发生时间统计</span>
        </div>
      </header>

      <section className={styles.summary} aria-label="雷达概况">
        <div>
          <span>公开信号</span>
          <strong>{model.totalCount}</strong>
          <small>条已收录事件</small>
        </div>
        <div>
          <span>近 30 日</span>
          <strong>{model.recentCount}</strong>
          <small>前 30 日 {model.previousCount} 条</small>
        </div>
        <div>
          <span>有观测领域</span>
          <strong>
            {model.observedDomainCount}
            <em> / {model.domains.length}</em>
          </strong>
          <small>一条信号可能关联多个领域</small>
        </div>
        <div>
          <span>事件跨度</span>
          <strong className={styles.spanValue}>
            {model.earliestAt && model.latestAt
              ? `${date(model.earliestAt)} — ${date(model.latestAt)}`
              : '暂无记录'}
          </strong>
          <small>不是采集或发布时间</small>
        </div>
      </section>

      <section className={styles.visualSection} aria-labelledby="radar-landscape">
        <div className={styles.visualIntro}>
          <p className={styles.visualKicker}>01 / 领域分布</p>
          <h2 id="radar-landscape">重点落在哪里</h2>
          <p>蓝色轮廓是累计信号分布；轴端亮点表示近 30 日有新事件，点越大，该时段收录越多。</p>
          <p className={styles.visualFootnote}>
            本次读取共覆盖 {model.totalCount}{' '}
            条。收录密度只说明本站的公开样本，不能直接推断产业热度或增长率。
          </p>
        </div>
        <DomainRadar model={model} />
      </section>

      <SubtopicBars model={model} />

      <section className={styles.section} aria-labelledby="radar-focus">
        <div className={styles.sectionHeading}>
          <div>
            <p className="kicker">FOCUS / 近 30 日</p>
            <h2 id="radar-focus">近期观察焦点</h2>
          </div>
          <span>按近 30 日信号数排序，同数再比较累计数</span>
        </div>
        {focus.length ? (
          <div className={styles.focusGrid}>
            {focus.map((domain) => (
              <FocusDomain key={domain.id} domain={domain} />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <h3>还没有可绘制的领域观察</h3>
            <p>公开信号进入读取入口并映射领域后，这里会自动显示。</p>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="radar-evolution">
        <div className={styles.sectionHeading}>
          <div>
            <p className="kicker">EVOLUTION / 时间脉络</p>
            <h2 id="radar-evolution">观察重心如何移动</h2>
          </div>
          <span>每格为当月事件数，当前月尚未结束</span>
        </div>
        <EvolutionMatrix model={model} />
        <p className={styles.note}>
          深色方格表示本站在该领域该月收录较多事件。不同月份的来源覆盖可能变化，空白不代表技术活动为零。
        </p>
      </section>

      <section className={styles.section} aria-labelledby="radar-events">
        <div className={styles.sectionHeading}>
          <div>
            <p className="kicker">EVENTS / 时间线</p>
            <h2 id="radar-events">最近发生的信号</h2>
          </div>
          <Link href="/signals" className="text-link">
            浏览全部信号 ↗
          </Link>
        </div>
        <p className={styles.note}>这里只按事件发生时间展示最近 10 条，不声称它们是综合热度榜。</p>
        {model.latestSignals.length ? (
          <ol className={styles.events}>
            {model.latestSignals.map((item, index) => (
              <li key={item.signal.id}>
                <span className={styles.eventIndex}>{String(index + 1).padStart(2, '0')}</span>
                <article>
                  <div className={styles.eventMeta}>
                    <time dateTime={item.signal.occurred_at}>{date(item.signal.occurred_at)}</time>
                    {item.domainIds.map((id) => (
                      <span key={id}>{domainNames.get(id) ?? id}</span>
                    ))}
                    {item.importance !== null ? <span>原有重要度 {item.importance}/5</span> : null}
                  </div>
                  <h3>
                    <Link href={`/signals/${item.signal.id}`}>{item.signal.title}</Link>
                  </h3>
                  <p>{item.signal.summary}</p>
                </article>
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.empty}>
            <h3>暂无可展示的信号</h3>
            <p>公开读取入口目前没有事件时间可用的信号。</p>
          </div>
        )}
      </section>

      <details className={styles.method}>
        <summary>关于这张雷达的数据与口径</summary>
        <div>
          <p>
            首页统一计算本次公开读取入口返回的信号，不以旧审核状态推定新的发布资格。按稳定 ID
            选取较新版本，并合并事件时间、标题和摘要完全相同的记录；相似但不同的事件不自动合并。
          </p>
          <p>
            近 30 日采用以当前 UTC 截止时间向前滚动的窗口；月度矩阵按 UTC
            日历月。没有可比的来源覆盖与采集完整率，故仅展示观测数，不计算产业增速或综合热度。
          </p>
          <p>仅标注日期的事件按 UTC 00:00 存储，这不是其精确发生时刻。</p>
          <dl>
            <div>
              <dt>重复记录合并</dt>
              <dd>{model.exclusions.duplicateCount} 条</dd>
            </div>
            <div>
              <dt>事件时间不可用</dt>
              <dd>{model.exclusions.invalidDates} 条</dd>
            </div>
            <div>
              <dt>事件尚未发生</dt>
              <dd>{model.exclusions.futureDates} 条</dd>
            </div>
            <div>
              <dt>一级领域未映射</dt>
              <dd>{model.unmappedCount} 条</dd>
            </div>
          </dl>
          <small>
            排序版本 {model.rankingVersion} · 领域版本 {model.trendVersion}
          </small>
        </div>
      </details>
    </main>
  );
}

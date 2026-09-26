import Link from 'next/link';
import {
  radarRanges,
  type RadarDomainObservation,
  type SignalRadarModel,
} from '../lib/signal-radar-model';
import styles from './signal-radar.module.css';

const date = (value: string) => value.slice(0, 10);
const timestamp = (value: string) => `${value.slice(0, 10)} ${value.slice(11, 16)} UTC`;
const states = {
  no_observations: '暂无近期观测',
  insufficient_sample: '样本不足',
  coverage_unverified: '覆盖未核验',
};

function DomainCard({ domain }: { domain: RadarDomainObservation }) {
  const maximum = Math.max(1, ...domain.dailyCounts);
  return (
    <article className={styles.domain}>
      <div className={styles.domainHeading}>
        <h3>
          <Link href={`/signals?domain=${encodeURIComponent(domain.id)}`}>{domain.name}</Link>
        </h3>
        <span>{states[domain.state]}</span>
      </div>
      <div className={styles.countComparison}>
        <strong>
          {domain.currentCount}
          <small>近 7 个完整日</small>
        </strong>
        <span>
          前 7 日 <b>{domain.previousCount}</b>
        </span>
      </div>
      <div
        className={styles.sparkline}
        role="img"
        aria-label={`按日公开信号数，前期：${domain.dailyCounts.slice(0, 7).join('、')}；本期：${domain.dailyCounts.slice(7).join('、')}`}
      >
        {domain.dailyCounts.map((count, index) => (
          <span
            key={index}
            className={index < 7 ? styles.previousBar : styles.currentBar}
            style={{ height: `${(count / maximum) * 100}%` }}
          />
        ))}
      </div>
      <p>
        {domain.state === 'no_observations'
          ? '没有可比较的近期公开信号。'
          : domain.state === 'insufficient_sample'
            ? '前期少于 3 条或两期合计少于 6 条，不判涨跌。'
            : '尚无可比来源面板与采集完整率，不判涨跌。'}
      </p>
    </article>
  );
}

export function SignalRadar({ model }: { model: SignalRadarModel }) {
  const domainNames = new Map(model.domains.map((domain) => [domain.id, domain.name]));
  const observed = model.domains.filter((domain) => domain.currentCount + domain.previousCount > 0);
  const unobserved = model.domains.filter(
    (domain) => domain.currentCount + domain.previousCount === 0,
  );
  const label = radarRanges[model.range].label;
  return (
    <main className={`page-main section-shell ${styles.radar}`}>
      <header className={styles.heading}>
        <div>
          <p className="kicker">HZENSE RADAR</p>
          <h1>当前技术态势</h1>
          <p>从已公开信号观察变化，按事件发生时间追踪近期进展。</p>
        </div>
        <div className={styles.watermark}>
          <span>本次计算截止</span>
          <time dateTime={model.asOf}>{timestamp(model.asOf)}</time>
          <span>每次打开页面重新计算</span>
        </div>
      </header>
      <section className={styles.summary} aria-label="雷达概况">
        <div>
          <span>近 {label}公开信号</span>
          <strong>
            {model.recentCount}
            <small>条</small>
          </strong>
        </div>
        <div>
          <span>近 14 个完整日有观测的领域</span>
          <strong>
            {observed.length}
            <small>个 / 共 {model.domains.length} 个</small>
          </strong>
        </div>
        <div>
          <span>综合热度</span>
          <strong className={styles.noScore}>未评估</strong>
          <small>当前采用可复算的事件时效排序</small>
        </div>
      </section>
      <section className={styles.section} aria-labelledby="domain-observations">
        <div className={styles.sectionHeading}>
          <div>
            <p className="kicker">领域观察</p>
            <h2 id="domain-observations">趋势先看样本与覆盖</h2>
          </div>
          <Link href="/signals?view=domain" className="text-link">
            按领域探索信号 ↗
          </Link>
        </div>
        <p className={styles.period}>
          本期 [{date(model.trendStart)}, {date(model.trendEnd)}) · 前期 [
          {date(model.previousStart)}, {date(model.trendStart)}) · UTC 完整日
        </p>
        {observed.length ? (
          <div className={styles.domainGrid}>
            {observed.map((domain) => (
              <DomainCard key={domain.id} domain={domain} />
            ))}
          </div>
        ) : (
          <div className={styles.empty}>
            <h3>暂无可比较的近期领域信号</h3>
            <p>当前公开数据尚不能支持趋势判断。新信号公开后会进入相应的事件时间窗口。</p>
          </div>
        )}
        {unobserved.length ? (
          <details className={styles.otherDomains}>
            <summary>查看暂无近期观测的领域（{unobserved.length}）</summary>
            <div className={styles.domainGrid}>
              {unobserved.map((domain) => (
                <DomainCard key={domain.id} domain={domain} />
              ))}
            </div>
          </details>
        ) : null}
        <p className={styles.note}>
          同一信号可属于多个领域，各领域数量不相加。采集覆盖率、来源可比性与积压处理水位尚未核验，数量变化不代表产业加速。
          {model.unmappedCount ? `另有 ${model.unmappedCount} 条近期信号尚无一级领域映射。` : ''}
        </p>
      </section>
      <div className={styles.mainGrid}>
        <section className={styles.section} aria-labelledby="recent-hotspots">
          <div className={styles.sectionHeading}>
            <div>
              <p className="kicker">热点观察 · 时效排序</p>
              <h2 id="recent-hotspots">近期信号 TOP 10</h2>
            </div>
            <nav className={styles.rangeControl} aria-label="热点时间窗口">
              {Object.entries(radarRanges).map(([range, option]) => (
                <Link
                  key={range}
                  href={`/?range=${range}#recent-hotspots`}
                  aria-current={range === model.range ? 'page' : undefined}
                >
                  {option.label}
                </Link>
              ))}
            </nav>
          </div>
          <p className={styles.period}>
            事件时间 [{timestamp(model.rangeStart)}, {timestamp(model.asOf)})
          </p>
          <p className={styles.note}>
            仅按事件时效排序；不是综合热度或重要度排名。历史补录不因今天上传、发表或更新而获得新鲜度。
          </p>
          {model.rankings.length ? (
            <ol className={styles.ranking}>
              {model.rankings.map((item, index) => (
                <li key={item.signal.id}>
                  <article className={styles.signal}>
                    <span className={styles.rank} aria-label={`第 ${index + 1} 位`}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className={styles.signalBody}>
                      <div className={styles.signalMeta}>
                        <time dateTime={item.signal.occurred_at}>
                          {date(item.signal.occurred_at)}
                        </time>
                        <span>
                          {item.signal.publication_basis === 'manual_confirmation'
                            ? '管理员确认'
                            : '来源证据评估'}
                        </span>
                      </div>
                      <h3>
                        <Link href={`/signals/${item.signal.id}`}>{item.signal.title}</Link>
                      </h3>
                      <p>{item.signal.summary}</p>
                      <div className={styles.participants}>
                        <span>
                          人物：
                          {item.signal.public_people?.map((person) => person.name).join('、') ||
                            '未提供公开人物信息'}
                        </span>
                        <span>
                          组织：
                          {item.signal.public_organizations
                            ?.map((organization) => organization.name)
                            .join('、') || '未提供公开组织信息'}
                        </span>
                      </div>
                      <div className={styles.topics}>
                        {item.domainIds.length ? (
                          item.domainIds.map((id) => (
                            <Link href={`/signals?domain=${encodeURIComponent(id)}`} key={id}>
                              {domainNames.get(id) ?? id}
                            </Link>
                          ))
                        ) : (
                          <span>一级领域待映射</span>
                        )}
                      </div>
                      <details className={styles.explanation}>
                        <summary>为什么进入观察榜 · 时效分 {item.recencyScore.toFixed(1)}</summary>
                        <p>
                          当前公开，事件在所选窗口内，距截止时间 {item.ageHours.toFixed(1)}{' '}
                          小时。时效分 = 100 × 2<sup>−小时数 / 48</sup>；分数每 48
                          小时减半，只衡量时间接近程度。
                        </p>
                        <dl>
                          <div>
                            <dt>已有重要度</dt>
                            <dd>
                              {item.importance === null
                                ? '未提供，不参与排序'
                                : `${item.importance} / 5 · 不参与此排序`}
                            </dd>
                          </div>
                          <div>
                            <dt>独立来源关注度</dt>
                            <dd>未评估；公开链接数不等于独立来源数</dd>
                          </div>
                          <div>
                            <dt>新颖度与综合热度</dt>
                            <dd>评分依据不完整，未评估</dd>
                          </div>
                        </dl>
                        <p>
                          只有日期的记录按 UTC 00:00
                          计时；未四舍五入的分值用于排序，同分按事件时间和稳定 ID 排序。版本：
                          {model.rankingVersion}。
                        </p>
                      </details>
                    </div>
                  </article>
                </li>
              ))}
            </ol>
          ) : (
            <div className={styles.empty}>
              <h3>近 {label}暂无符合窗口的当前公开信号</h3>
              <p>可以切换时间窗口，或查看全部当前信号。旧消息和未公开候选不会用于补满榜单。</p>
            </div>
          )}
          {model.rankings.length < 10 ? (
            <p className={styles.note}>
              本窗口共 {model.recentCount} 条，实际展示 {model.rankings.length} 条，不补满十条。
            </p>
          ) : (
            <p className={styles.note}>本窗口共 {model.recentCount} 条，展示时效排序前 10 条。</p>
          )}
          <Link href="/signals" className="text-link">
            查看全部当前信号 ↗
          </Link>
        </section>
        <aside className={styles.sidebar} aria-label="阅读雷达的方法">
          <section>
            <p className="kicker">继续探索</p>
            <h2>从事件走向理解</h2>
            <p>围绕持续跟踪的专题阅读公开洞察，或查看人物与组织的信号关联。</p>
            <Link href="/topics">
              专题洞察 <span>↗</span>
            </Link>
            <Link href="/resources">
              人物与组织资源 <span>↗</span>
            </Link>
          </section>
          <section>
            <h2>这张雷达如何计算</h2>
            <p>仅使用当前公开集合。管理员确认表示人工发布依据，不等于独立事实核验。</p>
            <p>
              稳定 ID 去重，并合并事件时间、标题和摘要均相同的重复记录；尚未进行跨稿的同事件消歧。
            </p>
            <dl>
              <div>
                <dt>排除历史档案</dt>
                <dd>{model.exclusions.legacy} 条</dd>
              </div>
              <div>
                <dt>合并重复记录</dt>
                <dd>{model.exclusions.duplicateCount} 条</dd>
              </div>
              <div>
                <dt>事件不在所选窗口</dt>
                <dd>{model.exclusions.outsideWindow} 条</dd>
              </div>
              <div>
                <dt>未到截止时间的事件</dt>
                <dd>{model.exclusions.futureDates} 条</dd>
              </div>
            </dl>
            {model.exclusions.invalidDates ? (
              <p>另有 {model.exclusions.invalidDates} 条事件时间不可用，未参与计算。</p>
            ) : null}
            <p className={styles.version}>
              排序 {model.rankingVersion}
              <br />
              领域 {model.trendVersion}
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}

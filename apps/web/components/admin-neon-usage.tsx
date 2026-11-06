'use client';

import { useRef, useState } from 'react';
import type { NeonUsageDashboard } from '../lib/neon-usage-core';
import { AdminAiUsage } from './admin-ai-usage';
import controls from './admin-controls.module.css';
import styles from './admin-neon-usage.module.css';

const errorMessages: Record<string, string> = {
  unauthorized: '登录已过期，请重新登录。',
  forbidden_origin: '请求来源不受信任，请从后台页面重试。',
  forbidden: '当前请求无权执行此操作。',
  not_configured: '流量监控尚未配置完成，请核对下方配置状态。',
  provider_unauthorized: 'Neon 凭据未获授权，请核对服务端配置。',
  provider_forbidden: 'Neon 拒绝读取用量，请核对项目访问权限。',
  provider_rate_limited: 'Neon 暂时限制请求频率，请稍后再试。',
  provider_unavailable: 'Neon 用量接口暂不可用，请稍后再试。',
  project_not_found: 'Neon 项目未找到，请核对服务端的项目配置。',
  invalid_metrics: 'Neon 返回的用量未通过校验，本次未保存。',
  invalid_response: 'Neon 返回的用量未通过校验，本次未保存。',
  storage_unavailable: '监控记录暂时无法读取或保存，请稍后刷新。',
  concurrent_update: '另一项采样正在保存，请稍后刷新记录。',
  storage_conflict: '另一项采样正在保存，请稍后刷新记录。',
  unavailable: '流量监控暂不可用，请稍后刷新。',
};

function errorMessage(code: unknown) {
  return typeof code === 'string' && Object.hasOwn(errorMessages, code)
    ? errorMessages[code]!
    : '本次操作未确认完成，已保留当前记录。请稍后刷新。';
}

export function formatUsageBytes(bytes: number | null) {
  if (bytes === null) return '暂无数据';
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(2)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

function displayTime(value: string | null, timeZone = 'Europe/Berlin') {
  if (!value) return '尚未采样';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

const dayLabels = {
  estimated: '估算',
  partial: '部分时段',
  missing: '缺少采样',
};

const costLabels = {
  compute: '计算',
  storage: '存储',
  history: '历史保留',
  snapshots: '快照',
  publicTransfer: '公网出站',
  privateTransfer: '私网传输（双向）',
  branches: '额外分支',
} as const;

const costReasons: Record<string, string> = {
  missing_org: '项目未返回可用组织信息，暂时无法读取套餐与费用用量。',
  provider_unavailable: '费用用量接口暂不可用，仍可查看下方流量记录。',
  unsupported_plan: '当前套餐暂不支持费用估算。',
  invalid_metrics: '费用用量未通过校验，暂不显示估算金额。',
  incomplete_period: '当前账期的费用用量不完整，暂不能估算。',
  waiting_data: '等待 Neon 返回已完成日期的费用用量。',
};

function formatUsageCost(microusd: number | null) {
  if (microusd === null || !Number.isSafeInteger(microusd) || microusd < 0) return '暂不可用';
  if (microusd === 0) return '$0.00';
  if (microusd < 100) return '< $0.0001';
  const usd = microusd / 1_000_000;
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

function DatabaseCosts({
  costs,
  sampledAt,
}: {
  costs: NeonUsageDashboard['costs'];
  sampledAt: string | null;
}) {
  const estimated = costs?.status === 'estimated' && costs.totalMicrousd !== null;
  const free = costs?.status === 'free' && costs.plan === 'free';
  const available = estimated || free;
  const reason =
    costs?.reason && Object.hasOwn(costReasons, costs.reason)
      ? costReasons[costs.reason]
      : '尚未取得可用的费用记录，流量监控可继续使用。';
  const plan =
    costs?.plan === 'free'
      ? 'Free'
      : costs?.plan === 'launch'
        ? 'Launch'
        : costs?.plan === 'scale'
          ? 'Scale'
          : '套餐待确认';

  return (
    <section className={`${styles.panel} ${styles.costPanel}`} aria-labelledby="usage-cost-title">
      <div className={styles.panelHeading}>
        <h2 id="usage-cost-title">数据库费用</h2>
        <span className={styles.planBadge}>{plan}</span>
      </div>
      <div className={styles.costBody}>
        <dl className={styles.costTotal}>
          <dt>{free ? '当前 Free 套餐' : '已完成日费用估算'}</dt>
          <dd>
            {available ? formatUsageCost(free ? 0 : costs.totalMicrousd) : '暂不可用'}
            {available ? <span>USD</span> : null}
          </dd>
        </dl>
        {estimated ? (
          <dl className={styles.costBreakdown} aria-label="数据库费用明细">
            {(Object.keys(costLabels) as Array<keyof typeof costLabels>).map((kind) => (
              <div key={kind}>
                <dt>{costLabels[kind]}</dt>
                <dd>
                  {formatUsageCost(
                    costs.items.find((item) => item.kind === kind)?.microusd ?? null,
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={styles.costUnavailable}>
            {free ? '仅说明当前套餐，不代表历史账期账单。' : reason}
          </p>
        )}
      </div>
      <div className={styles.costFooter}>
        {estimated && costs.from && costs.through ? (
          <p>
            费用覆盖：{displayTime(costs.from, 'UTC')} — {displayTime(costs.through, 'UTC')}（UTC）
          </p>
        ) : null}
        <p>费用采样：{displayTime(sampledAt)}（柏林时间）</p>
      </div>
      <details className={`${styles.method} ${styles.costMethod}`}>
        <summary>费用口径与单价说明</summary>
        <p>按 Neon 用量 API 与公开单价估算，仅覆盖已完成的 UTC 日期，不含当天尚未完成的用量。</p>
        <p>
          不含 Functions、Auth、税费、折扣及组织级最低消费，不是官方账单。单价版本：
          {costs?.pricingVersion ?? '尚未获取'}。
        </p>
      </details>
    </section>
  );
}

export function AdminNeonUsage({ initialDashboard }: { initialDashboard: NeonUsageDashboard }) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [range, setRange] = useState<7 | 30>(30);
  const [busy, setBusy] = useState<'GET' | 'POST' | null>(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  async function request(method: 'GET' | 'POST') {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(method);
    setMessage('');
    setFailed(false);
    try {
      const response = await fetch('/api/admin/neon-usage', {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(45_000),
      });
      const result = await response.json();
      if (!response.ok) {
        setFailed(true);
        setMessage(errorMessage(result?.error));
        return;
      }
      setDashboard(result as NeonUsageDashboard);
      setMessage(
        method === 'GET'
          ? '已刷新保存的记录，未调用 Neon 用量接口。'
          : '已完成采样检查；距上次采样不足 15 分钟则沿用已有记录。',
      );
    } catch {
      setFailed(true);
      setMessage('暂未取得操作结果，已保留当前记录。请稍后刷新；页面不会自动重复采样。');
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const today = dashboard.days.at(-1);
  const yesterday = dashboard.days.at(-2);
  const days = dashboard.days.slice(-range);
  const maximum = Math.max(1, ...days.map((day) => day.bytes ?? 0));
  const newestFirst = [...days].reverse();
  const hasHistory = dashboard.sampledAt !== null;
  const observedDays = days.filter((day) => day.bytes !== null).length;
  const remaining =
    dashboard.quotaBytes !== null && dashboard.totalBytes !== null
      ? Math.max(0, dashboard.quotaBytes - dashboard.totalBytes)
      : null;
  const overage =
    dashboard.quotaBytes !== null && dashboard.totalBytes !== null
      ? Math.max(0, dashboard.totalBytes - dashboard.quotaBytes)
      : 0;
  const health = !dashboard.configured
    ? '待配置'
    : !dashboard.available
      ? '读取异常'
      : !hasHistory
        ? '等待采样'
        : dashboard.stale
          ? '数据已过期'
          : '记录可用';
  const healthy = health === '记录可用';
  const quotaColor =
    dashboard.alert === 'critical'
      ? '#dc5555'
      : dashboard.alert === 'warning'
        ? '#b67b16'
        : 'var(--brand-bright)';

  return (
    <div className={`${styles.dashboard} ${controls.scope}`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NEON + AI · OPERATIONS</p>
          <h1>运营仪表盘</h1>
          <p className={styles.muted}>查看 Neon 流量、数据库费用与 AI 调用费用。</p>
        </div>
        <div className={styles.actions} aria-label="流量监控操作">
          <button disabled={busy !== null} onClick={() => void request('GET')} type="button">
            {busy === 'GET' ? '刷新中…' : '刷新记录'}
          </button>
          <button
            className={styles.primaryButton}
            disabled={busy !== null || !dashboard.configured}
            onClick={() => void request('POST')}
            type="button"
          >
            {busy === 'POST' ? '采样中…' : '立即采样'}
          </button>
        </div>
      </header>
      <div className={styles.contextBar}>
        <span className={`${styles.health} ${healthy ? styles.healthy : styles.pending}`}>
          <i aria-hidden="true" />
          {health}
        </span>
        <span>
          项目 <strong>{dashboard.projectId ?? '尚未配置'}</strong>
        </span>
        <span>柏林时间 · Europe/Berlin</span>
        <span className={styles.contextEnd}>最近采样 {displayTime(dashboard.sampledAt)}</span>
      </div>
      {message ? (
        <p className={failed ? styles.warning : styles.notice} role={failed ? 'alert' : 'status'}>
          {message}
        </p>
      ) : null}
      {!dashboard.configured ? (
        <section className={styles.notice} aria-labelledby="usage-configuration-title">
          <div className={styles.noticeHeading}>
            <h2 id="usage-configuration-title">监控尚未配置完成</h2>
            <span className={styles.muted}>连接后开始积累每日流量记录</span>
          </div>
          <p>完成服务端配置后即可采样；缺失配置不会被当作零流量。</p>
          {dashboard.missing.length > 0 ? (
            <details className={styles.configuration}>
              <summary>查看待配置项（{dashboard.missing.length}）</summary>
              <ul>
                {dashboard.missing.map((name) => (
                  <li key={name}>
                    <code>{name}</code>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
      {!dashboard.available && dashboard.configured ? (
        <p className={styles.warning} role="alert">
          {errorMessage(dashboard.error)} 已显示的数据仅代表上次保存的记录。
        </p>
      ) : null}
      {dashboard.stale && hasHistory ? (
        <p className={styles.warning} role="status">
          最近采样已过期，请检查每日零点采样任务。以下数值仅截至上次成功采样。
        </p>
      ) : null}
      {dashboard.alert !== 'none' ? (
        <p className={styles.warning} role="status">
          {dashboard.alert === 'critical' ? '流量额度预警：' : '流量额度提醒：'}
          本账期累计已达到配置额度的 {dashboard.quotaPercent?.toFixed(1)}%。
          请留意剩余额度和近期增长。
        </p>
      ) : null}
      <dl className={styles.metrics} aria-label="Neon 流量概览">
        <div className={`${styles.metric} ${styles.featuredMetric}`}>
          <dt>
            本账期累计 <span>NEON</span>
          </dt>
          <dd>{formatUsageBytes(dashboard.totalBytes)}</dd>
          <dd className={styles.metricNote}>截至最近成功采样 · 全部分支</dd>
        </div>
        <div className={styles.metric}>
          <dt>今日流量</dt>
          <dd>{today?.bytes == null ? '待结算' : formatUsageBytes(today.bytes)}</dd>
          <dd className={styles.metricNote}>已采样时段 · 次日零点结算 · 柏林时间</dd>
        </div>
        <div className={styles.metric}>
          <dt>昨日流量估算</dt>
          <dd>{formatUsageBytes(yesterday?.bytes ?? null)}</dd>
          <dd className={styles.metricNote}>
            {yesterday ? dayLabels[yesterday.status] : '缺少采样'} · {yesterday?.date ?? '—'}
          </dd>
        </div>
        <div className={styles.metric}>
          <dt>账期剩余额度</dt>
          <dd>{dashboard.quotaBytes === null ? '未设置' : formatUsageBytes(remaining)}</dd>
          <dd className={styles.metricNote}>
            {overage > 0
              ? `已超出 ${formatUsageBytes(overage)}`
              : dashboard.quotaBytes === null
                ? '设置额度后显示剩余用量'
                : `截至最近采样 · 额度 ${formatUsageBytes(dashboard.quotaBytes)}`}
          </dd>
        </div>
      </dl>
      <DatabaseCosts costs={dashboard.costs} sampledAt={dashboard.costSampledAt} />
      <AdminAiUsage costs={dashboard.aiCosts ?? null} />
      <div className={styles.analysisGrid}>
        <section
          className={`${styles.panel} ${styles.trendPanel}`}
          aria-labelledby="usage-trend-title"
        >
          <div className={styles.panelHeading}>
            <div>
              <h2 id="usage-trend-title">每日流量趋势</h2>
              <p className={styles.muted}>出站流量 · 十进制 MB / GB</p>
            </div>
            <div className={styles.rangeSwitch} role="group" aria-label="查看时间范围">
              {([7, 30] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={range === value}
                  onClick={() => setRange(value)}
                >
                  近 {value} 天
                </button>
              ))}
            </div>
          </div>
          <figure className={styles.figure}>
            <div className={styles.plot}>
              <div className={styles.axis} aria-hidden="true">
                <span>{observedDays ? formatUsageBytes(maximum) : '—'}</span>
                <span>{observedDays ? formatUsageBytes(Math.round(maximum / 2)) : '—'}</span>
                <span>0</span>
              </div>
              <div
                className={styles.chart}
                data-range={range}
                role="img"
                aria-label="每日估算流量柱状图，完整数值和采样状态见下方每日明细表"
              >
                {days.map((day) => (
                  <div
                    key={day.date}
                    className={styles.chartColumn}
                    title={`${day.date}：${formatUsageBytes(day.bytes)}（${day.date === today?.date && day.bytes === null ? '待结算' : dayLabels[day.status]}）`}
                  >
                    <div className={styles.barArea}>
                      <span
                        className={`${styles.bar} ${styles[day.bytes === null ? 'missing' : day.status]}`}
                        style={{
                          height:
                            day.bytes === null
                              ? '4px'
                              : `${Math.max(1, (day.bytes / maximum) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className={styles.chartDate}>{day.date.slice(8)}</span>
                  </div>
                ))}
              </div>
              {observedDays === 0 ? (
                <div className={styles.chartEmpty}>
                  <strong>等待流量数据</strong>
                  <span>取得连续样本后显示每日趋势</span>
                </div>
              ) : null}
            </div>
            <figcaption className={styles.legend}>
              <span>
                <i className={`${styles.swatch} ${styles.estimated}`} />
                估算
              </span>
              <span>
                <i className={`${styles.swatch} ${styles.partial}`} />
                部分时段
              </span>
              <span>
                <i className={`${styles.swatch} ${styles.missing}`} />
                缺少采样
              </span>
            </figcaption>
          </figure>
          <div className={styles.chartFooter}>
            <span>
              {days[0]?.date} — {days.at(-1)?.date}
            </span>
            <span>
              {observedDays} / {days.length} 天有可用估算（含部分时段）
            </span>
          </div>
          {!hasHistory ? (
            <p className={styles.empty}>
              尚无采样记录。首次采样建立基线，取得连续两日零点附近的样本后才能结算日流量。
            </p>
          ) : null}
        </section>
        <aside
          className={`${styles.panel} ${styles.quotaPanel}`}
          aria-labelledby="usage-quota-title"
        >
          <h2 id="usage-quota-title">账期额度</h2>
          <div
            className={styles.gauge}
            style={{
              background:
                dashboard.quotaPercent === null
                  ? 'var(--line)'
                  : `conic-gradient(${quotaColor} ${Math.min(100, dashboard.quotaPercent) * 3.6}deg, var(--line) 0deg)`,
            }}
          >
            <div>
              <strong>
                {dashboard.quotaPercent === null ? '—' : `${dashboard.quotaPercent.toFixed(1)}%`}
              </strong>
              <span>
                {dashboard.quotaBytes === null
                  ? '额度未设置'
                  : dashboard.totalBytes === null
                    ? '等待采样'
                    : '已使用'}
              </span>
            </div>
          </div>
          <dl className={styles.quotaDetails}>
            <div>
              <dt>配置额度</dt>
              <dd>
                {dashboard.quotaBytes === null ? '未设置' : formatUsageBytes(dashboard.quotaBytes)}
              </dd>
            </div>
            <div>
              <dt>采样状态</dt>
              <dd className={healthy ? styles.healthy : styles.pending}>{health}</dd>
            </div>
          </dl>
          <p className={styles.period}>
            {dashboard.periodStart && dashboard.periodEnd
              ? `${displayTime(dashboard.periodStart)} — ${displayTime(dashboard.periodEnd)}`
              : '等待有效账期信息'}
          </p>
          <p className={styles.sideNote}>
            每天柏林时间 00:00 采样并结算上一日；调度与供应商指标可能延迟。手动采样最短间隔 15
            分钟。
          </p>
        </aside>
      </div>
      <section
        className={`${styles.panel} ${styles.detailPanel}`}
        aria-labelledby="usage-details-title"
      >
        <div className={styles.panelHeading}>
          <div>
            <h2 id="usage-details-title">每日流量明细</h2>
            <p className={styles.muted}>最近 {days.length} 天 · 按日期倒序</p>
          </div>
          <span className={styles.tableHint}>可滚动查看全部记录</span>
        </div>
        <div
          className={styles.tableScroll}
          tabIndex={0}
          role="region"
          aria-label="每日流量明细，可横向滚动"
        >
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>每日流量明细（Europe/Berlin）</caption>
            <thead>
              <tr>
                <th scope="col">日期</th>
                <th scope="col">估算流量</th>
                <th scope="col">采样数</th>
                <th scope="col">数据状态</th>
              </tr>
            </thead>
            <tbody>
              {newestFirst.map((day) => (
                <tr key={day.date}>
                  <th scope="row">
                    {day.date}
                    {day.date === today?.date ? (
                      <span className={styles.todayTag}>今天</span>
                    ) : null}
                  </th>
                  <td>{formatUsageBytes(day.bytes)}</td>
                  <td>{day.samples}</td>
                  <td>
                    <span className={`${styles.dayStatus} ${styles[`${day.status}Text`]}`}>
                      {day.date === today?.date && day.bytes === null
                        ? '待结算'
                        : dayLabels[day.status]}
                    </span>
                    {day.from && day.through ? (
                      <div>
                        采样区间：{displayTime(day.from)} — {displayTime(day.through)}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <details className={styles.method}>
        <summary>数据口径与采样说明</summary>
        <p>
          每天柏林时间 00:00 结算刚结束的上一日，以相邻两日零点前后 90
          分钟内的累计值之差估算流量。延迟采样仅展示相邻日期的实际采样区间并标为部分时段，不等同于完整自然日。今日有两次采样时展示已观测增量。采样时间不是供应商计费时间；跨账期重置或缺少相邻日期样本时保留空缺，不把多天流量归到一天。
        </p>
        <p>
          本页监控配置所指向的 Neon 云项目，包含项目各分支的累计出站流量，不是本机 PostgreSQL
          流量，也不是网站访客下载量。每日数值不能作为官方账单；未记录的历史无法还原。历史记录保留{' '}
          {dashboard.historyDays} 天。
        </p>
      </details>
    </div>
  );
}

import type { AiUsageCosts } from '../lib/ai-usage-costs';
import styles from './admin-ai-usage.module.css';

const labels = {
  generation: '信号生成',
  enrichment: '材料补全',
  collection: '自动采集',
  insight: '洞察报告',
  probe: '能力测试',
} as const;

type Amounts = NonNullable<AiUsageCosts['today']>;

function formatCost(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isSafeInteger(value) || value < 0)
    return '暂不可用';
  if (value === 0) return '$0.00';
  if (value < 100) return '< $0.0001';
  const usd = value / 1_000_000;
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

function AmountCell({ amounts }: { amounts: Amounts | null }) {
  return (
    <td>
      {amounts ? (
        <>
          <span className={styles.charged}>已记账 {formatCost(amounts.chargedMicrousd)}</span>
          <span className={styles.unsettled}>未结额 {formatCost(amounts.unsettledMicrousd)}</span>
        </>
      ) : (
        <span className={styles.unavailable}>暂不可用</span>
      )}
    </td>
  );
}

export function AdminAiUsage({ costs }: { costs?: AiUsageCosts | null }) {
  const partial = costs?.status === 'partial';
  const unavailable = !costs || costs.status === 'unavailable';
  const today = unavailable ? null : (costs.today ?? null);
  const month = unavailable ? null : (costs.monthToDate ?? null);
  const status = unavailable ? '暂不可用' : partial ? '数据不完整' : '记录可用';
  const sampledAt = costs?.sampledAt
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(costs.sampledAt))
    : '尚未读取';

  return (
    <section className={styles.panel} aria-labelledby="ai-usage-title">
      <header className={styles.heading}>
        <div>
          <h2 id="ai-usage-title">AI 调用费用</h2>
          <p>按 UTC 日期统计 · 美元 USD</p>
        </div>
        <span className={styles.status}>{status}</span>
      </header>
      {partial ? (
        <p className={styles.notice} role="status">
          部分账本暂不可用，以下合计仅为已知小计，不代表完整费用。
        </p>
      ) : unavailable ? (
        <p className={styles.notice}>暂未取得可用的 AI 费用账本，数据库流量与费用仍可独立查看。</p>
      ) : null}
      <dl className={styles.totals} aria-label="AI 费用概览">
        {[
          {
            key: 'today',
            label: partial ? '今日已知小计' : '今日已记账',
            amounts: today,
            date: costs?.day,
          },
          {
            key: 'month',
            label: partial ? '本月已知小计' : '本月已记账',
            amounts: month,
            date: costs?.month,
          },
        ].map(({ key, label, amounts, date }) => (
          <div key={key}>
            <dt>
              {label}
              <span>{date ?? '日期待确认'}</span>
            </dt>
            <dd>{formatCost(amounts?.chargedMicrousd)}</dd>
            <dd className={styles.totalUnsettled}>
              未结额 {formatCost(amounts?.unsettledMicrousd)}
              <span>单独列示，不计入已记账费用</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.tableHint}>左右滑动查看完整费用明细</p>
      <div
        className={styles.tableScroll}
        tabIndex={0}
        role="region"
        aria-label="AI 调用费用明细，可横向滚动"
      >
        <table>
          <caption className={styles.visuallyHidden}>AI 调用费用明细（USD，UTC）</caption>
          <thead>
            <tr>
              <th scope="col">用途</th>
              <th scope="col">统计范围</th>
              <th scope="col">今日</th>
              <th scope="col">本月至今</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(labels) as Array<keyof typeof labels>).map((kind) => {
              const item = costs?.items.find((entry) => entry.kind === kind);
              const available = !unavailable && item?.status === 'available';
              return (
                <tr key={kind}>
                  <th scope="row">{labels[kind]}</th>
                  <td>{item?.scope === 'site' || kind === 'probe' ? '全站' : '当前管理员'}</td>
                  <AmountCell amounts={available ? (item.today ?? null) : null} />
                  <AmountCell amounts={available ? (item.monthToDate ?? null) : null} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <footer className={styles.footer}>
        <p>
          账本读取：{sampledAt}（UTC）。生成、补全、采集和洞察按当前管理员统计；能力测试按全站统计。
        </p>
        <details>
          <summary>AI 费用口径</summary>
          <p>
            统计当前环境数据库中的真实调用，不含模拟。已记账金额包含 API
            返回值与未取得返回值时的估算，非供应商最终账单。未结额尚未完成记账，单独展示，不计入已记账费用。
          </p>
        </details>
      </footer>
    </section>
  );
}

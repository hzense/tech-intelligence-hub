import type { ReactNode } from 'react';
import type {
  SignalWorkbenchDetail,
  SignalWorkbenchHead,
  SignalWorkbenchList,
  SignalWorkbenchParticipant,
  WorkbenchVerificationStatus,
} from '../../../packages/database/src/signal-workbench-store.mjs';
import styles from './admin-signal-workbench.module.css';

type WorkbenchFailure = 'not_configured' | 'unavailable' | 'invalid_request' | 'incompatible_data';

export type SignalWorkbenchListState =
  { status: 'ready'; data: SignalWorkbenchList } | { status: WorkbenchFailure };

export type SignalWorkbenchDetailState =
  { status: 'ready'; data: SignalWorkbenchDetail } | { status: WorkbenchFailure | 'not_found' };

const verificationLabels: Record<WorkbenchVerificationStatus, string> = {
  pending: '待核验',
  verified: '已核验',
  rejected: '已拒绝',
};

const originLabels = {
  legacy_seed: '历史种子导入',
  pipeline: '流水线',
  manual: '手动录入',
};

const relationLabels = {
  supports: '支持',
  contradicts: '反驳',
  context: '背景',
};

const verificationChecks = {
  claims_supported: '主张有证据支持',
  people_disambiguated: '人物身份已消歧',
  people_are_participants: '人物是事件参与者',
  organizations_supported: '组织关联有依据',
  public_sources_cleared: '公开来源已核对',
  contradictions_resolved: '冲突已处理',
};

function signalHref(signalId: string, version: number) {
  return `/admin/signals/${encodeURIComponent(signalId)}?version=${version}`;
}

function listHref(query = '', after?: string) {
  const search = new URLSearchParams();
  if (query) search.set('q', query);
  if (after) search.set('after', after);
  return `/admin/signals${search.size ? `?${search}` : ''}`;
}

function timestamp(value: string | null) {
  if (!value) return '未提供';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '无有效时间记录';
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

// Defense in depth for synthetic/stale DTOs. Never render an unsafe URL, even as text.
function safeSourceHref(value: string | null) {
  if (
    !value ||
    value.length > 2048 ||
    !/^https:\/\//i.test(value) ||
    /[\s\\?#]/u.test(value) ||
    /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value) ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function WorkbenchFrame({
  title,
  detail = false,
  publicReadEnabled,
  children,
}: {
  title: string;
  detail?: boolean;
  publicReadEnabled: boolean;
  children: ReactNode;
}) {
  return (
    <main className={`section-shell ${styles.main}`}>
      <nav className={styles.navigation} aria-label="信号工作台导航">
        <a className={styles.linkButton} href="/admin">
          返回管理后台
        </a>
        {detail && (
          <a className={styles.linkButton} href="/admin/signals">
            返回信号列表
          </a>
        )}
      </nav>
      <header className={styles.header}>
        <p className="kicker">管理后台 · SIGNALS</p>
        <h1>{title}</h1>
        <div className={styles.badges}>
          <span className={styles.badge}>只读工作台</span>
          <span className={styles.badge}>管理员私有数据</span>
        </div>
        <p className={styles.muted}>
          查看信号快照、证据关联与版本记录。本页不采集、编辑、核验或发布信号，也不会改变当前公开资格。
        </p>
      </header>
      <aside className={styles.notice} aria-label="公开站数据源说明">
        <strong>
          公开站数据源：{publicReadEnabled ? '新版数据库读取已启用' : '仍使用旧版数据源'}
        </strong>
        <p>
          {publicReadEnabled
            ? '公开站仅按当前公开资格读取数据；工作台中存在记录，不代表已经展示在网站。'
            : '工作台读取新数据库的私有记录，不代表公开站已切换数据源。即使某版本当前具备公开资格，也不代表网站正在展示该版本。'}
        </p>
      </aside>
      {children}
    </main>
  );
}

function FailureNotice({ status }: { status: WorkbenchFailure | 'not_found' }) {
  const messages = {
    not_configured: {
      title: '信号工作台尚未配置',
      body: '尚未配置专用只读数据库连接。这里没有加载信号数据，不会用示例数据或其他数据库账号代替。',
    },
    unavailable: {
      title: '信号工作台暂时不可用',
      body: '未能安全读取数据库，可能涉及连接、权限或结构准备状态。请稍后重试或联系管理员检查服务；这不表示数据库中没有信号。',
    },
    invalid_request: {
      title: '查询条件无效',
      body: '请检查筛选词、分页游标或版本号。筛选词最多 100 个字符；可以返回信号列表重新查询。',
    },
    incompatible_data: {
      title: '信号标识与站内规范不兼容',
      body: '数据库存在不符合站内标识规范的信号，当前列表暂不可展示，需要先核对数据。本页不会忽略这些记录、展示异常标识或自动修复数据。',
    },
    not_found: {
      title: '未找到该信号版本',
      body: '当前读取范围内没有对应的信号快照。请返回列表选择现有信号及版本。',
    },
  };
  const message = messages[status];
  return (
    <section className={styles.card} role="status">
      <h2>{message.title}</h2>
      <p className={styles.muted}>{message.body}</p>
      <a className={styles.linkButton} href="/admin/signals">
        重新打开信号列表
      </a>
    </section>
  );
}

function PublicationState({
  head,
  publicVersion,
}: {
  head: SignalWorkbenchHead | null;
  publicVersion: number | null;
}) {
  return (
    <dl className={styles.facts}>
      <dt>历史发布头记录</dt>
      <dd>
        {head
          ? `v${head.content_version} · ${head.status === 'published' ? '已发布（历史记录）' : '已撤回（历史记录）'} · 发布修订 ${head.publication_revision}`
          : '无发布记录'}
      </dd>
      <dt>当前公开资格</dt>
      <dd>
        {publicVersion === null
          ? '当前无具备公开资格的版本'
          : `当前具备公开资格：v${publicVersion}`}
      </dd>
    </dl>
  );
}

function DisplayCount({ count, truncated }: { count: number; truncated: boolean }) {
  return (
    <p className={styles.muted}>
      当前展示 {count} 条。
      {truncated && '已达到单组读取上限，仅展示部分记录；以下数量不是总数。'}
    </p>
  );
}

export function AdminSignalWorkbenchList({
  state,
  query = '',
  after,
  publicReadEnabled,
}: {
  state: SignalWorkbenchListState;
  query?: string;
  after?: string;
  publicReadEnabled: boolean;
}) {
  return (
    <WorkbenchFrame title="信号工作台" publicReadEnabled={publicReadEnabled}>
      <form action="/admin/signals" method="get" className={styles.filter} role="search">
        <label htmlFor="signal-workbench-query">筛选信号</label>
        <div className={styles.filterRow}>
          <input
            id="signal-workbench-query"
            type="search"
            name="q"
            maxLength={100}
            defaultValue={query.slice(0, 100)}
            placeholder="输入标题关键词或信号 ID"
          />
          <button type="submit" className={styles.button}>
            筛选
          </button>
          {(query || after) && (
            <a href="/admin/signals" className={styles.linkButton}>
              清除筛选与分页
            </a>
          )}
        </div>
        <p className={styles.muted}>最多 100 个字符。修改筛选条件后会从第一页开始。</p>
      </form>
      {state.status !== 'ready' ? (
        <FailureNotice status={state.status} />
      ) : (
        <section className={styles.stack} aria-label="信号列表">
          <p className={styles.muted}>
            读取时间：{timestamp(state.data.observed_at)}
            。每条展示最新快照；最新快照不等于已组装候选、已核验版本或公开版本。
          </p>
          {state.data.items.length === 0 ? (
            <div className={styles.card} role="status">
              <h2>
                {after ? '当前分页没有更多信号' : query ? '没有匹配的信号' : '数据库中暂无信号快照'}
              </h2>
              <p className={styles.muted}>
                {query || after
                  ? '可以清除筛选与分页后重新查看。'
                  : '已成功读取，但没有可展示的信号快照；这里不会生成或导入信号。'}
              </p>
            </div>
          ) : (
            <ul className={styles.items}>
              {state.data.items.map((item) => (
                <li key={item.signal_id} className={styles.card}>
                  <article>
                    <div className={styles.badges}>
                      <span className={styles.badge}>最新快照 v{item.latest_snapshot_version}</span>
                      <span className={styles.badge}>{item.type}</span>
                    </div>
                    <h2 className={styles.signalTitle}>
                      <a href={signalHref(item.signal_id, item.latest_snapshot_version)}>
                        {item.title}
                      </a>
                    </h2>
                    <p className={styles.muted}>事件发生时间：{timestamp(item.occurred_at)}</p>
                    <PublicationState
                      head={item.recorded_head}
                      publicVersion={item.current_public_version}
                    />
                  </article>
                </li>
              ))}
            </ul>
          )}
          <nav className={styles.pagination} aria-label="信号分页">
            {after && (
              <a className={styles.linkButton} href={listHref(query)}>
                回到第一页
              </a>
            )}
            {state.data.next_after && (
              <a className={styles.linkButton} href={listHref(query, state.data.next_after)}>
                下一页
              </a>
            )}
          </nav>
        </section>
      )}
    </WorkbenchFrame>
  );
}

function Participants({
  title,
  items,
  truncated,
}: {
  title: string;
  items: SignalWorkbenchParticipant[];
  truncated: boolean;
}) {
  return (
    <section className={styles.card} aria-label={title}>
      <h2>{title}</h2>
      <DisplayCount count={items.length} truncated={truncated} />
      <p className={styles.muted}>以下为本版本的事件关联，不等于人物任职关系，也不授予公开资格。</p>
      {items.length === 0 ? (
        <p className={styles.empty}>本版本暂无{title}记录。</p>
      ) : (
        <ul className={styles.rows}>
          {items.map((item) => (
            <li key={`${item.entity_id}:${item.evidence_id}:${item.event_role}`}>
              <h3>{item.name}</h3>
              <dl className={styles.facts}>
                <dt>实体类型 / 状态</dt>
                <dd>
                  {item.entity_type} / {item.entity_status}
                </dd>
                <dt>事件角色</dt>
                <dd>{item.event_role}</dd>
                <dt>关联核验状态</dt>
                <dd>{verificationLabels[item.verification_status]}</dd>
                <dt>依据证据 ID</dt>
                <dd>{item.evidence_id}</dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SignalDetailContent({ data }: { data: SignalWorkbenchDetail }) {
  const snapshot = data.snapshot;
  return (
    <div className={styles.stack}>
      <section className={styles.card} aria-labelledby="signal-version-title">
        <div className={styles.badges}>
          <span className={styles.badge}>固定查看 v{data.selected_version}</span>
          <span className={styles.badge}>最新快照 v{data.latest_snapshot_version}</span>
        </div>
        <h2 id="signal-version-title" className={styles.signalTitle}>
          {snapshot.title}
        </h2>
        <p className={styles.muted}>信号 ID：{data.signal_id}</p>
        <PublicationState head={data.recorded_head} publicVersion={data.current_public_version} />
        <p className={styles.notice}>
          历史发布头中的“已发布”不等于当前公开资格。当前公开资格来自独立公开视图，针对整个信号；不一定对应正在查看的
          v{data.selected_version}。最新快照也不等于已组装候选或已核验版本。
        </p>
        <p className={styles.muted}>
          版本正文和事件关联边固定；来源状态、实体名称与状态、依赖失效标记反映本次读取时间
          {timestamp(data.observed_at)}的当前依赖状态，不是历史状态的原样还原。
        </p>
        <dl className={styles.facts}>
          <dt>信号类型</dt>
          <dd>{snapshot.type}</dd>
          <dt>事件发生时间</dt>
          <dd>
            {snapshot.date_precision === 'day'
              ? snapshot.occurred_at.slice(0, 10)
              : timestamp(snapshot.occurred_at)}
            （{snapshot.date_precision === 'day' ? '按天记录' : '精确时刻'}）
          </dd>
          <dt>事件时间依据</dt>
          <dd className={styles.prose}>{snapshot.date_basis}</dd>
          <dt>采集时间</dt>
          <dd>{timestamp(snapshot.captured_at)}（不是事件发生时间）</dd>
          <dt>快照创建时间</dt>
          <dd>{timestamp(snapshot.created_at)}</dd>
          <dt>快照来源</dt>
          <dd>{originLabels[snapshot.origin]}</dd>
          <dt>版本修订原因</dt>
          <dd className={styles.prose}>{snapshot.revision_reason}</dd>
          <dt>记录评分</dt>
          <dd>
            重要度 {snapshot.importance} · 强度 {snapshot.strength} · 置信度 {snapshot.confidence} ·
            新颖度 {snapshot.novelty}
          </dd>
        </dl>
      </section>
      <section className={styles.card} aria-label="信号内容摘要">
        <h2>摘要</h2>
        <p className={styles.prose}>{snapshot.summary || '本版本未提供摘要。'}</p>
        <h2>分析</h2>
        <p className={styles.prose}>{snapshot.analysis || '本版本未提供分析。'}</p>
        {data.truncated.text && (
          <p className={styles.notice}>部分文本已按读取上限截断，当前展示不是完整内容。</p>
        )}
      </section>
      <section className={styles.card} aria-label="来源与证据">
        <h2>来源与证据</h2>
        <DisplayCount count={data.evidence.length} truncated={data.truncated.evidence} />
        <p className={styles.muted}>
          仅展示主张、来源及核验状态摘要；不读取或展示私有原文、摘录、定位和元数据。
        </p>
        {data.evidence.length === 0 ? (
          <p className={styles.empty}>本版本暂无来源证据关联。</p>
        ) : (
          <ul className={styles.rows}>
            {data.evidence.map((evidence) => {
              const href = safeSourceHref(evidence.source_url);
              return (
                <li key={evidence.evidence_id}>
                  <div className={styles.badges}>
                    <span className={styles.badge}>{relationLabels[evidence.relation]}</span>
                    <span className={styles.badge}>
                      证据核验状态：{verificationLabels[evidence.verification_status]}
                    </span>
                  </div>
                  <h3 className={styles.prose}>{evidence.claim}</h3>
                  <dl className={styles.facts}>
                    <dt>来源</dt>
                    <dd>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer noopener">
                          {evidence.source_name}（打开来源）
                        </a>
                      ) : (
                        <>
                          {evidence.source_name}
                          <br />
                          <span className={styles.muted}>无可安全打开的来源链接</span>
                        </>
                      )}
                    </dd>
                    <dt>来源状态</dt>
                    <dd>{evidence.source_active ? '启用' : '停用'}</dd>
                    <dt>来源发布时间</dt>
                    <dd>{timestamp(evidence.source_published_at)}</dd>
                    <dt>证据采集时间</dt>
                    <dd>{timestamp(evidence.captured_at)}</dd>
                    <dt>证据 ID</dt>
                    <dd>{evidence.evidence_id}</dd>
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <div className={styles.grid}>
        <Participants title="关键人物" items={data.people} truncated={data.truncated.people} />
        <Participants
          title="相关组织"
          items={data.organizations}
          truncated={data.truncated.organizations}
        />
      </div>
      <section className={styles.card} aria-label="主题关联">
        <h2>主题关联</h2>
        <DisplayCount count={data.topics.length} truncated={data.truncated.topics} />
        {data.topics.length === 0 ? (
          <p className={styles.empty}>本版本暂无主题关联。</p>
        ) : (
          <ul className={styles.topics}>
            {data.topics.map((topic) => (
              <li key={topic.id}>{topic.title}</li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.card} aria-label="版本历史">
        <h2>版本历史</h2>
        <DisplayCount count={data.versions.length} truncated={data.truncated.versions} />
        <p className={styles.muted}>
          选择版本后固定查看该快照；组装标记或发布快照标记不代表当前可发布或当前可公开。
        </p>
        <ul className={styles.rows}>
          {data.versions.map((version) => (
            <li key={version.version}>
              <h3>
                <a
                  href={signalHref(data.signal_id, version.version)}
                  aria-current={version.version === data.selected_version ? 'page' : undefined}
                >
                  v{version.version} · {version.title}
                </a>
              </h3>
              <p className={styles.muted}>
                {timestamp(version.created_at)} · {originLabels[version.origin]}
              </p>
              <p className={styles.prose}>{version.revision_reason}</p>
              <div className={styles.badges}>
                <span className={styles.badge}>
                  候选组装标记：{version.assembled_candidate ? '有' : '无'}
                </span>
                <span className={styles.badge}>
                  发布快照标记：{version.publication_snapshot ? '有' : '无'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.card} aria-label="独立核验记录">
        <h2>独立核验记录</h2>
        <DisplayCount count={data.verifications.length} truncated={data.truncated.verifications} />
        <p className={styles.muted}>
          核验结论仅为已记录的结果，不等于当前发布许可。这里的过期仅指候选核验许可过期，不代表已发表版本已经撤回；依赖变化和当前公开资格须分别判断。
        </p>
        {data.verifications.length === 0 ? (
          <p className={styles.empty}>本版本暂无独立核验记录。</p>
        ) : (
          <ul className={styles.rows}>
            {data.verifications.map((verification) => (
              <li key={verification.verification_id}>
                <h3>
                  来源版本 v{verification.source_version} · 核验结论：
                  {verification.decision === 'approved' ? '通过（记录）' : '拒绝（记录）'}
                </h3>
                <dl className={styles.facts}>
                  <dt>核验时间</dt>
                  <dd>{timestamp(verification.verified_at)}</dd>
                  <dt>有效期截止</dt>
                  <dd>
                    {timestamp(verification.expires_at)} ·{' '}
                    {verification.expired ? '已过期' : '记录未过期'}
                  </dd>
                  <dt>依赖失效记录</dt>
                  <dd>
                    {verification.dependency_invalidated === null
                      ? '无可用记录'
                      : verification.dependency_invalidated
                        ? '已失效'
                        : '未标记失效（不等于当前资格）'}
                  </dd>
                  <dt>核验 ID</dt>
                  <dd>{verification.verification_id}</dd>
                </dl>
                <ul className={styles.checks}>
                  {Object.entries(verificationChecks).map(([key, label]) => {
                    const value = verification.checks[key as keyof typeof verificationChecks];
                    return (
                      <li key={key}>
                        {label}：{value === null ? '无记录' : value ? '通过' : '未通过'}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className={styles.muted}>
        读取时间：{timestamp(data.observed_at)}。以上均为本次只读观察，不会更新记录。
      </p>
    </div>
  );
}

export function AdminSignalWorkbenchDetail({
  state,
  publicReadEnabled,
}: {
  state: SignalWorkbenchDetailState;
  publicReadEnabled: boolean;
}) {
  return (
    <WorkbenchFrame title="信号版本详情" detail publicReadEnabled={publicReadEnabled}>
      {state.status === 'ready' ? (
        <SignalDetailContent data={state.data} />
      ) : (
        <FailureNotice status={state.status} />
      )}
    </WorkbenchFrame>
  );
}

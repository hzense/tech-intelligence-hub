import styles from './admin-signal-generation.module.css';
import preview from './private-generation-result.module.css';

function objectRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    : [];
}

function Evidence({ value }: { value: unknown }) {
  const entries = objectRows(value);
  if (!entries.length) return <p className={preview.missing}>未提供原文证据，需人工补充核对。</p>;
  return (
    <ul className={preview.evidenceList}>
      {entries.map((entry, index) => (
        <li key={index}>
          <span className={preview.fragment}>
            原文片段{' '}
            {typeof entry.fragment_id === 'number' || typeof entry.fragment_id === 'string'
              ? entry.fragment_id
              : '待核对'}
          </span>
          <blockquote>{typeof entry.quote === 'string' ? entry.quote : '无有效引用'}</blockquote>
        </li>
      ))}
    </ul>
  );
}

export function PrivateResult({ result }: { result: unknown }) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const row = result as Record<string, unknown>;
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  const rejected = objectRows(row.rejected);
  const errorLabels: Record<string, string> = {
    title_too_long: '标题超过 80 个字符（含字母、标点和空白）',
    summary_too_long: '摘要超过 500 个字符',
    unknown_date_has_evidence: '日期未知时，日期证据必须为空数组',
    invalid_event_date: '事件日期必须是有效的 YYYY-MM-DD 或 null',
    invalid_evidence: '证据缺失、重复或引用未逐字匹配原文片段',
    invalid_candidate_shape: '候选字段缺失、类型错误或包含不允许的字段',
    invalid_field: '字段结构、长度或原文引用不符合约定',
  };
  return (
    <section aria-label="私有候选结果" className={styles.result}>
      <h3>私有候选结果 · 尚未审核或发布</h3>
      {row.validation_version === 1 && (
        <p>
          结构与引用校验通过 {candidates.length} 条，拒绝 {rejected.length}{' '}
          条。通过不代表事实核验或发布批准。
        </p>
      )}
      {/* Historical free-form reasons may contain model self-analysis. Render
          result state only; never echo that field or provider reasoning. */}
      {candidates.length === 0 && <p>本次没有生成可供审核的候选信号。</p>}
      {candidates.map((candidate: unknown, index: number) => {
        const data =
          candidate && typeof candidate === 'object' && !Array.isArray(candidate)
            ? (candidate as Record<string, unknown>)
            : {};
        const people = objectRows(data.persons);
        const claims = objectRows(data.claims);
        const organizations = Array.isArray(data.organizations)
          ? data.organizations.filter(
              (value): value is string => typeof value === 'string' && value.trim().length > 0,
            )
          : [];
        return (
          <article className={preview.signal} key={index} aria-label={`候选信号 ${index + 1}`}>
            <header className={preview.header}>
              <div className={preview.meta}>
                <span className={preview.badge}>待审核 · 未发布</span>
                <span>候选 {typeof data.index === 'number' ? data.index + 1 : index + 1}</span>
              </div>
              <h4 className={preview.title}>
                {typeof data.title === 'string' ? data.title : `候选信号 ${index + 1}`}
              </h4>
              <p className={preview.date}>
                事件发生时间：
                {typeof data.event_date === 'string' ? data.event_date : '来源未提供，待核对'}
              </p>
              <p className={preview.summary}>
                {typeof data.summary === 'string' && data.summary.trim()
                  ? data.summary
                  : '摘要未提供，需人工补充。'}
              </p>
            </header>
            <div className={preview.layout}>
              <section className={preview.body} aria-label="信号要点与证据">
                <h5>核心要点</h5>
                <p className={preview.hint}>以下为候选主张；展开证据，对照原文判断是否成立。</p>
                {claims.length === 0 && <p className={preview.missing}>未提供可核对的主张。</p>}
                {claims.map((claim, claimIndex) => (
                  <section key={claimIndex} className={preview.claim}>
                    <p className={preview.claimText}>
                      <span className={preview.number}>{claimIndex + 1}</span>
                      {typeof claim.text === 'string' ? claim.text : '主张待核对'}
                    </p>
                    <details className={preview.evidence}>
                      <summary>
                        核对要点 {claimIndex + 1} 的原文证据（{objectRows(claim.evidence).length}{' '}
                        条引用）
                      </summary>
                      <Evidence value={claim.evidence} />
                    </details>
                  </section>
                ))}
              </section>
              <aside className={preview.context} aria-label="候选核对辅助信息">
                <section>
                  <h5>关键人物与组织</h5>
                  <p className={preview.hint}>来源提及，关系尚待核实。</p>
                  {people.length === 0 && (
                    <p className={preview.missing}>未识别关键人物，需补充核对。</p>
                  )}
                  {people.map((person, personIndex) => (
                    <div key={personIndex} className={preview.person}>
                      <p>
                        {typeof person.name === 'string' ? person.name : '姓名待核对'}
                        {typeof person.role === 'string' ? ` · ${person.role}` : ''}
                        {typeof person.organization === 'string' ? ` · ${person.organization}` : ''}
                      </p>
                      <details className={preview.evidence}>
                        <summary>核对人物 {personIndex + 1} 的来源依据</summary>
                        <Evidence value={person.evidence} />
                      </details>
                    </div>
                  ))}
                </section>
                <section>
                  <h5>时间依据</h5>
                  <details className={preview.evidence}>
                    <summary>核对事件日期的来源依据</summary>
                    <Evidence value={data.event_date_evidence} />
                  </details>
                </section>
                {organizations.length > 0 && (
                  <section>
                    <h5>相关组织（待核对）</h5>
                    <ul className={preview.organizations}>
                      {organizations.map((name, organizationIndex) => (
                        <li key={organizationIndex}>{name}</li>
                      ))}
                    </ul>
                  </section>
                )}
                <section className={preview.reviewNote}>
                  <h5>决策前需确认</h5>
                  <ul>
                    <li>主张是否被原文充分支持</li>
                    <li>日期是否为事件发生时间</li>
                    <li>人物及组织是否与事件直接相关</li>
                  </ul>
                  <p>引用匹配不代表独立事实核验。本页仅供阅读核对，不会保存审核决定或发布。</p>
                </section>
              </aside>
            </div>
            <details className={preview.raw}>
              <summary>查看候选完整字段（含证据与人物）</summary>
              <pre className={styles.output}>{JSON.stringify(candidate, null, 2)}</pre>
            </details>
          </article>
        );
      })}
      {rejected.length > 0 && (
        <section aria-label="被拒绝项校验记录">
          <h4>被拒绝项 · 不可用候选，仅保留私有诊断</h4>
          <p>未自动改写模型内容或重试。这里不保存被拒绝项的原始正文。</p>
          {rejected.map((entry, index) => (
            <div key={index}>
              <h5>原始候选 {typeof entry.index === 'number' ? entry.index + 1 : index + 1}</h5>
              <ul>
                {objectRows(entry.errors).map((error, errorIndex) => (
                  <li key={errorIndex}>
                    {typeof error.field === 'string' ? error.field : '候选'}：
                    {typeof error.code === 'string' && errorLabels[error.code]
                      ? errorLabels[error.code]
                      : '校验未通过'}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}

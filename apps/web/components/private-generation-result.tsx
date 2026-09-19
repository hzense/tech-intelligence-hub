import styles from './admin-signal-generation.module.css';

function objectRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    : [];
}

function Evidence({ value }: { value: unknown }) {
  return (
    <ul>
      {objectRows(value).map((entry, index) => (
        <li key={index}>
          原文片段{' '}
          {typeof entry.fragment_id === 'number' || typeof entry.fragment_id === 'string'
            ? entry.fragment_id
            : '待核对'}
          ：{typeof entry.quote === 'string' ? entry.quote : '无有效引用'}
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
      {typeof row.reason === 'string' && <p>{row.reason}</p>}
      {candidates.length === 0 && <p>本次没有生成可供审核的候选信号。</p>}
      {candidates.map((candidate: unknown, index: number) => {
        const data =
          candidate && typeof candidate === 'object' && !Array.isArray(candidate)
            ? (candidate as Record<string, unknown>)
            : {};
        return (
          <article className={styles.candidate} key={index}>
            <p>原始候选序号：{typeof data.index === 'number' ? data.index + 1 : index + 1}</p>
            <h4>{typeof data.title === 'string' ? data.title : `候选信号 ${index + 1}`}</h4>
            {typeof data.summary === 'string' && <p>{data.summary}</p>}
            <p>
              事件发生时间：
              {typeof data.event_date === 'string' ? data.event_date : '来源未提供，待核对'}
            </p>
            <Evidence value={data.event_date_evidence} />
            <h5>关键人物（待核对）</h5>
            {objectRows(data.persons).map((person, personIndex) => (
              <div key={personIndex}>
                <p>
                  {typeof person.name === 'string' ? person.name : '姓名待核对'}
                  {typeof person.role === 'string' ? ` · ${person.role}` : ''}
                  {typeof person.organization === 'string' ? ` · ${person.organization}` : ''}
                </p>
                <Evidence value={person.evidence} />
              </div>
            ))}
            <h5>主张与来源证据（未独立核验）</h5>
            {objectRows(data.claims).map((claim, claimIndex) => (
              <div key={claimIndex}>
                <p>{typeof claim.text === 'string' ? claim.text : '主张待核对'}</p>
                <Evidence value={claim.evidence} />
              </div>
            ))}
            <p>
              引用匹配只证明内容来自原文，不代表事实已经验证。AI
              提及人物不等于已建立正式关系，当前候选尚未审核或发布。
            </p>
            <details>
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

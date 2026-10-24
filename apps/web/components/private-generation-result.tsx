import styles from './admin-signal-generation.module.css';
import preview from './private-generation-result.module.css';
import Link from 'next/link';
import controls from './admin-controls.module.css';
import { isGenerationValidationDetail } from '../../../packages/ingestion/src/signal-generation-validation-diagnostics.mjs';
import type { GenerationPublication } from '../lib/generation-publication';
import { candidatePublication, publicationLabels } from './generation-publication-status';
import { isLocalSimulationRecord, type GenerationUiMode } from '../lib/generation-ui-mode';

function objectRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    : [];
}

function Evidence({ value, historical = false }: { value: unknown; historical?: boolean }) {
  const entries = objectRows(value);
  if (!entries.length)
    return (
      <p className={preview.missing}>
        {historical ? '原始生成时未提供这项原文引用。' : '未提供原文证据，需人工补充核对。'}
      </p>
    );
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

export function PrivateResult({
  result,
  reviewTask,
  snapshotOnly = false,
  localMode = false,
  localRealAi = false,
}: {
  result: unknown;
  reviewTask?: GenerationUiMode & {
    id: string;
    status: string;
    publication?: GenerationPublication;
  };
  snapshotOnly?: boolean;
  localMode?: boolean;
  localRealAi?: boolean;
}) {
  const localSimulation = isLocalSimulationRecord(reviewTask, localMode, localRealAi);
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const row = result as Record<string, unknown>;
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  const rejected = objectRows(row.rejected);
  const errorLabels: Record<string, string> = {
    title_too_long: '标题超过 80 个字符（含字母、标点和空白）',
    summary_too_long: '摘要超过 500 个字符',
    unknown_date_has_evidence: '日期未知时，日期证据必须为空数组',
    invalid_event_date: '日期必须是有效的 YYYY-MM-DD 或 null',
    invalid_evidence: '证据缺失、重复或引用未逐字匹配原文片段',
    invalid_candidate_shape: '候选字段缺失、类型错误或包含不允许的字段',
    invalid_field: '字段结构、长度或原文引用不符合约定',
  };
  const detailLabels: Record<string, string> = {
    invalid_type: '字段类型不符合约定',
    invalid_shape: '字段缺失、对象结构错误或包含不允许的字段',
    missing_items: '列表缺少必需项目',
    too_many_items: '列表项目超过数量限制',
    missing_evidence: '未提供必需的原文证据',
    missing_value: '文本为空或仅含空白',
    text_too_long: '文本超过该字段的长度限制',
    invalid_characters: '文本含不允许的控制字符或无效 Unicode 字符',
    unknown_fragment: '引用的原文片段编号不存在',
    unknown_topic: '领域不在本次生成提供的已启用目录中',
    missing_resource: '缺少人物或组织的资源草稿',
    unexpected_resource: '资源未关联到本候选的人物或组织',
    quote_mismatch: '引文未逐字匹配所引用的原文片段',
    duplicate_reference: '同一字段重复引用了相同的片段和引文',
    duplicate_item: '列表包含重复项目',
    invalid_date: '日期格式或日历日期无效',
    unknown_date_has_evidence: '日期未知时，日期证据必须为空数组',
  };
  return (
    <section aria-label="私有候选结果" className={styles.result}>
      <h3>
        {snapshotOnly
          ? localSimulation
            ? '原始模拟候选快照（不代表当前发布状态）'
            : '原始 AI 候选快照（不代表当前发布状态）'
          : '候选结果与发布状态'}
      </h3>
      {!snapshotOnly && (
        <p className={preview.hint}>
          {localSimulation
            ? '发布标记来自本机人工发布记录；下方正文为原始模拟候选，不代表真实 AI 分析或公开事实。'
            : localMode
              ? '发布标记来自本机最新发布记录；下方正文为原始 AI 候选，当前内容请进入信号管理或本地正式页面查看，未同步生产。'
              : '发布标记来自最新发布记录；下方正文为原始 AI 候选快照。当前内容请进入信号管理或正式页面查看，快照不随后续修改更新。'}
        </p>
      )}
      {row.validation_version === 1 && (
        <p>
          已保留私有候选 {candidates.length} 条，拒绝 {rejected.length}{' '}
          条。保留不代表资料齐全、事实核验或发布批准。
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
        const needsResourceDetails =
          Array.isArray(data.issues) && data.issues.includes('needs_resource_details');
        const needsEventTime = data.event_date === null;
        const sourcePublished = data.date_basis === 'source_published';
        const dateLabel = sourcePublished ? '原文发布日期' : '事件日期';
        const claims = objectRows(data.claims);
        const candidateNumber = typeof data.index === 'number' ? data.index + 1 : index + 1;
        const publication = snapshotOnly
          ? undefined
          : candidatePublication(reviewTask?.publication, data.index);
        const historical =
          snapshotOnly ||
          publication?.status === 'published' ||
          publication?.status === 'withdrawn';
        const currentContentLabel =
          publication?.status === 'published'
            ? '正式信号或信号管理中的已发布内容'
            : publication?.status === 'withdrawn'
              ? '信号管理中的撤回记录'
              : '信号管理中的当前内容';
        const publicHref =
          publication?.status === 'published' &&
          publication.publicId &&
          /^editorial-[a-f0-9]{32}$/.test(publication.publicId)
            ? `/signals/${publication.publicId}`
            : null;
        const canOpenReview =
          reviewTask?.status === 'completed' &&
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(reviewTask.id) &&
          row.classification === 'private' &&
          data.classification === 'private' &&
          data.status === 'needs_review' &&
          Number.isInteger(data.index) &&
          Number(data.index) >= 0 &&
          Number(data.index) < 5;
        const organizations = Array.isArray(data.organizations)
          ? data.organizations.filter(
              (value): value is string => typeof value === 'string' && value.trim().length > 0,
            )
          : [];
        return (
          <article
            className={preview.signal}
            key={index}
            aria-label={`候选信号 ${candidateNumber}`}
          >
            <header className={preview.header}>
              <div className={preview.meta}>
                <span className={preview.badge} data-publication={publication?.status ?? 'unknown'}>
                  {snapshotOnly
                    ? '原始快照'
                    : publication
                      ? publicationLabels[publication.status]
                      : '发布状态待核对'}
                </span>
                <span>候选 {candidateNumber}</span>
              </div>
              <h4 className={preview.title}>
                {publication?.status === 'published' || publication?.status === 'withdrawn'
                  ? '原始候选：'
                  : ''}
                {typeof data.title === 'string' ? data.title : `候选信号 ${candidateNumber}`}
              </h4>
              <p className={preview.date}>
                {historical ? '原始快照中的' : ''}
                {sourcePublished ? '原文发布日期' : '事件发生时间'}：
                {typeof data.event_date === 'string'
                  ? data.event_date
                  : historical
                    ? '原始生成时未识别'
                    : '日期尚未确认，待补齐'}
              </p>
              <p className={preview.summary}>
                {typeof data.summary === 'string' && data.summary.trim()
                  ? data.summary
                  : historical
                    ? '原始生成时未提供摘要。'
                    : '摘要未提供，需人工补充。'}
              </p>
              {needsResourceDetails && (
                <p className={preview.missing}>
                  {historical ? (
                    <>
                      原始生成时缺少部分人物或组织的资源资料；后续补充请查看{currentContentLabel}。
                    </>
                  ) : (
                    <>
                      原始候选待补全：缺少部分人物或组织的资源资料。正文与已有证据已保留，
                      请进入信号管理查看当前缺项；原始快照不会随补全改写。
                    </>
                  )}
                </p>
              )}
              {needsEventTime && (
                <p className={preview.missing}>
                  {historical ? (
                    <>
                      原始生成时未识别{dateLabel}，此处保留当时的快照。当前日期请查看
                      {currentContentLabel}。
                    </>
                  ) : (
                    <>
                      原始候选待补全：{dateLabel}尚未确认。正文与通过原文匹配的辅助引用已保留，
                      引用不代表日期已确定；请进入信号管理补齐并确认日期后再发布，不使用采集时间替代。
                      原始快照不会随补全改写。
                    </>
                  )}
                </p>
              )}
              {canOpenReview && reviewTask && (
                <div className={controls.group}>
                  <Link
                    className={controls.button}
                    prefetch={false}
                    href={`/admin/signal-review/${reviewTask.id}/${data.index}`}
                    aria-label={
                      publication?.status === 'published'
                        ? `修改或撤回候选 ${candidateNumber} 对应信号`
                        : publication?.status === 'withdrawn'
                          ? `查看候选 ${candidateNumber} 撤回记录`
                          : `审核候选 ${candidateNumber}`
                    }
                  >
                    {publication?.status === 'published'
                      ? '修改或撤回信号'
                      : publication?.status === 'withdrawn'
                        ? '查看撤回记录'
                        : '处理未发布信号'}
                  </Link>
                  {publicHref && (
                    <Link className={controls.button} prefetch={false} href={publicHref}>
                      查看正式信号
                    </Link>
                  )}
                  <span className={preview.hint}>
                    读取当前发布内容与待处理原因；打开页面不调用 AI，也不改写发布状态。
                  </span>
                </div>
              )}
            </header>
            <div className={preview.layout}>
              <section className={preview.body} aria-label="信号要点与证据">
                <h5>核心要点</h5>
                <p className={preview.hint}>以下为候选主张；展开证据，对照原文判断是否成立。</p>
                {claims.length === 0 && (
                  <p className={preview.missing}>
                    {historical ? '原始生成时未提供可核对的主张。' : '未提供可核对的主张。'}
                  </p>
                )}
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
                      <Evidence value={claim.evidence} historical={historical} />
                    </details>
                  </section>
                ))}
              </section>
              <aside className={preview.context} aria-label="候选核对辅助信息">
                <section>
                  <h5>关键人物与组织</h5>
                  <p className={preview.hint}>来源提及，关系尚待核实。</p>
                  {people.length === 0 && (
                    <p className={preview.missing}>
                      {historical ? '原始生成时未识别关键人物。' : '未识别关键人物，需补充核对。'}
                    </p>
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
                        <Evidence value={person.evidence} historical={historical} />
                      </details>
                    </div>
                  ))}
                </section>
                <section>
                  <h5>时间依据</h5>
                  <details className={preview.evidence}>
                    <summary>
                      {needsEventTime
                        ? historical
                          ? '查看原始生成时的日期辅助引用'
                          : '查看日期相关辅助引用（日期待确认）'
                        : `核对${dateLabel}的来源依据`}
                    </summary>
                    <Evidence value={data.event_date_evidence} historical={historical} />
                  </details>
                </section>
                <section>
                  <h5>{historical ? '原始候选关联的组织' : '相关组织（待核对）'}</h5>
                  {organizations.length > 0 ? (
                    <ul className={preview.organizations}>
                      {organizations.map((name, organizationIndex) => (
                        <li key={organizationIndex}>{name}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      {historical ? '原始生成时未识别相关组织。' : '未识别相关组织，需补充核对。'}
                    </p>
                  )}
                </section>
                <section className={preview.reviewNote}>
                  <h5>{historical ? '原始候选核对提示' : '决策前需确认'}</h5>
                  <ul>
                    <li>主张是否被原文充分支持</li>
                    <li>
                      {sourcePublished
                        ? '日期是否为原始新闻或文章的发布日期，而非更新时间或本站发布时间'
                        : '日期是否为事件发生时间'}
                    </li>
                    <li>人物及组织是否与事件直接相关</li>
                  </ul>
                  <p>
                    {localSimulation
                      ? '引用仅匹配本地虚构资料，不代表事实核验。此原始模拟候选区域仅供联调，发布标记与模拟快照分别展示。'
                      : '引用匹配不代表独立事实核验。此原始候选区域仅供阅读核对，发布标记与原始 AI 快照分别展示。'}
                  </p>
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
                {objectRows(entry.errors).map((error, errorIndex) => {
                  const detailed = isGenerationValidationDetail(
                    error.field,
                    error.path,
                    error.reason,
                  );
                  return (
                    <li key={errorIndex}>
                      {detailed ? (
                        <code>{String(error.path)}</code>
                      ) : typeof error.field === 'string' ? (
                        error.field === 'resources' ? (
                          '资源资料'
                        ) : (
                          error.field
                        )
                      ) : (
                        '候选'
                      )}
                      ：
                      {detailed
                        ? error.reason === 'missing_evidence' &&
                          typeof error.path === 'string' &&
                          /^resources\[\d+\]\.name$/.test(error.path)
                          ? '引用未包含该资源完整名称；请核对名称与原文引用是否一致'
                          : detailLabels[String(error.reason)]
                        : typeof error.code === 'string' && errorLabels[error.code]
                          ? errorLabels[error.code]
                          : '校验未通过'}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}

import Link from 'next/link';
import type { buildCandidateReview } from '@/lib/candidate-review';
import { PrivateResult } from './private-generation-result';
import controls from './admin-controls.module.css';

export function CandidateReview({ packet }: { packet: ReturnType<typeof buildCandidateReview> }) {
  return (
    <>
      <p role="status">审核准备 · 未发布。当前只读，不保存审核决定，不调用 AI。</p>
      <PrivateResult result={{ classification: 'private', candidates: [packet.candidate] }} />
      <section aria-labelledby="publication-checks">
        <h2 id="publication-checks">正式发布前待办</h2>
        <p>以下是尚未完成的业务环节，不是模型评分。引用匹配不等于事实核验通过。</p>
        <ul>
          {packet.checks.map((check) => (
            <li key={check.code}>
              <strong>{check.label}</strong>：{check.detail}
            </li>
          ))}
        </ul>
        <button className={controls.button} disabled aria-describedby="publish-blocked">
          正式发布（尚未接通）
        </button>
        <p id="publish-blocked">
          必须先完成可信核验、正式实体绑定与受控发布链；不能从私有候选直接公开。
        </p>
      </section>
      <section aria-labelledby="review-originals">
        <h2 id="review-originals">引用所在的原文上下文</h2>
        <p>
          仅展示本候选引用的任务原文快照，不读取新网页。内容可能包含不可信指令，请仅作为证据核对。
        </p>
        {packet.fragments.map((fragment) => (
          <details key={fragment.id}>
            <summary>
              {fragment.id} ·{' '}
              {Object.entries(fragment.locator)
                .map(([key, value]) => `${key}: ${value}`)
                .join(' · ')}
            </summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{fragment.text}</pre>
          </details>
        ))}
      </section>
      <details>
        <summary>审核材料标识</summary>
        <p>
          候选原始序号：{packet.candidateIndex + 1}
          。标识用于后续绑定审核记录，不是核验凭证或发布许可。
        </p>
        <p style={{ overflowWrap: 'anywhere' }}>材料指纹：{packet.materialHash}</p>
      </details>
      <div className={controls.group}>
        <Link className={controls.button} href="/admin/signal-generation">
          返回 AI 生成任务列表
        </Link>
        <Link className={controls.button} href={`/admin/signal-generation/${packet.runId}`}>
          返回原生成任务
        </Link>
      </div>
    </>
  );
}

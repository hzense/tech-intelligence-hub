import Link from 'next/link';
import type { buildCandidateReview } from '@/lib/candidate-review';
import { PrivateResult } from './private-generation-result';
import controls from './admin-controls.module.css';
import { EditorialPublicationEditor } from './editorial-publication-editor';
import { isLocalSimulationRecord, type GenerationUiMode } from '../lib/generation-ui-mode';

export function CandidateReview({
  packet,
  localMode = false,
  localRealAi = false,
}: {
  packet: ReturnType<typeof buildCandidateReview> & GenerationUiMode;
  localMode?: boolean;
  localRealAi?: boolean;
}) {
  const localSimulation = isLocalSimulationRecord(packet, localMode, localRealAi);
  return (
    <>
      <EditorialPublicationEditor
        key={`${packet.runId}:${packet.candidateIndex}`}
        runId={packet.runId}
        candidateIndex={packet.candidateIndex}
      />
      <details>
        <summary>{localSimulation ? '辅助资料与原始模拟候选' : '辅助资料与原始 AI 候选'}</summary>
        <p>
          以下保留生成时的原始结果，不代表当前正式信号。当前发布内容和缺项以上方信号管理为准，修改不会覆盖原始快照。
        </p>
        <PrivateResult
          localMode={localMode}
          localRealAi={localRealAi}
          reviewTask={{
            id: packet.runId,
            status: 'completed',
            ...(packet.ai_mode ? { ai_mode: packet.ai_mode } : {}),
            ...(packet.profile_id ? { profile_id: packet.profile_id } : {}),
          }}
          snapshotOnly
          result={{ classification: 'private', candidates: [packet.candidate] }}
        />
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
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {fragment.text}
              </pre>
            </details>
          ))}
        </section>
      </details>
      <details>
        <summary>审核材料标识</summary>
        <p>
          候选原始序号：{packet.candidateIndex + 1}
          。标识用于后续绑定审核记录，不是核验凭证或发布许可。
        </p>
        <p style={{ overflowWrap: 'anywhere' }}>材料指纹：{packet.materialHash}</p>
        <Link
          className={controls.button}
          href={`/admin/signal-review/${packet.runId}/${packet.candidateIndex}/history`}
        >
          查看历史核验通道记录
        </Link>
      </details>
      <div className={controls.group}>
        <Link className={controls.button} href="/admin/signal-generation">
          {localSimulation ? '返回本地模拟任务列表' : '返回 AI 生成任务列表'}
        </Link>
        <Link className={controls.button} href={`/admin/signal-generation/${packet.runId}`}>
          返回原生成任务
        </Link>
      </div>
    </>
  );
}

'use client';
import { useState } from 'react';
import type {
  OrganizationReview,
  OrganizationConfirmation,
} from '../lib/material-organization-review';
import controls from './admin-controls.module.css';

export function MaterialOrganizationConfirmation({
  review,
  disabled,
  onConfirm,
}: {
  review: OrganizationReview;
  disabled: boolean;
  onConfirm: (confirmation: OrganizationConfirmation) => Promise<void>;
}) {
  const [selections, setSelections] = useState<
    Record<string, { type: string; evidenceId: string }>
  >({});
  const [consent, setConsent] = useState(false);
  const complete =
    review.organizations.length > 0 &&
    review.organizations.every(
      (org) =>
        selections[org.name]?.type &&
        org.evidence.some((e) => e.id === selections[org.name]?.evidenceId),
    );
  function update(name: string, field: 'type' | 'evidenceId', value: string) {
    setSelections((previous) => ({
      ...previous,
      [name]: { type: '', evidenceId: '', ...previous[name], [field]: value },
    }));
    setConsent(false);
  }
  return (
    <section aria-label="手动确认组织类型">
      <h4>手动确认组织类型（不调用 AI）</h4>
      <p>
        以下组织未匹配正式档案，规则也未识别出类型。请选择有原文支持的类型和来源片段；这是人工判断，不是自动核实。无需填写
        ID、JSON 或改写原文。
      </p>
      {review.organizations.map((org) => {
        const selected = selections[org.name];
        const evidence = org.evidence.find((e) => e.id === selected?.evidenceId);
        return (
          <fieldset key={org.name} disabled={disabled}>
            <legend>{org.name}</legend>
            <label>
              组织类型 · {org.name}
              <select
                value={selected?.type ?? ''}
                onChange={(event) => update(org.name, 'type', event.target.value)}
              >
                <option value="">请选择有依据的类型</option>
                <option value="company">公司（含商业银行、投资银行）</option>
                <option value="institution">机构（如大学、研究机构、非营利组织）</option>
              </select>
            </label>
            <label>
              原文依据 · {org.name}
              <select
                value={selected?.evidenceId ?? ''}
                onChange={(event) => update(org.name, 'evidenceId', event.target.value)}
              >
                <option value="">请选择并核对原文片段</option>
                {org.evidence.map((e, index) => (
                  <option key={e.id} value={e.id}>
                    片段 {index + 1} · {e.quote.slice(0, 70)}
                  </option>
                ))}
              </select>
            </label>
            {evidence ? (
              <blockquote>
                <p>{evidence.quote}</p>
                <a href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer">
                  打开所选原文来源
                </a>
              </blockquote>
            ) : null}
            {!org.evidence.length ? (
              <p>
                没有提及该组织的可用公开来源片段，请先导入来源并建立新补证资料包，不能无依据确认。
              </p>
            ) : null}
            {org.truncated ? (
              <p>仅列出前 20 个匹配片段；若无适用依据，请使用更精简的补证来源建立新资料包。</p>
            ) : null}
          </fieldset>
        );
      })}
      <label>
        <input
          type="checkbox"
          checked={consent}
          disabled={disabled || !complete}
          onChange={(event) => setConsent(event.target.checked)}
        />
        我已阅读所选原文，确认其支持各组织的身份及所选类型；不是仅凭名称、模型输出或同段其他组织的描述判断。
      </label>
      <p>
        确认随核验材料提案追加保存；若还有其他缺项，本次不会保存为完整提案。仍须完成六项人工审核、独立复查与签名、登记及发布确认。
      </p>
      <button
        type="button"
        className={controls.button}
        disabled={disabled || !complete || !consent}
        onClick={() =>
          void onConfirm({
            contextHash: review.contextHash,
            consent: true,
            selections: review.organizations.map((org) => ({
              name: org.name,
              type: selections[org.name]!.type as 'company' | 'institution',
              evidenceId: selections[org.name]!.evidenceId,
            })),
          })
        }
      >
        确认组织类型并准备材料（不调用 AI）
      </button>
    </section>
  );
}

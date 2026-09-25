import { createHash } from 'node:crypto';
import type { EditorialContent, EditorialDashboard } from './editorial-review';
import { normalizeEditorialRequest } from '../../../packages/database/src/editorial-signal-contract.mjs';
import type { EditorialRequest } from '../../../packages/database/src/editorial-signal-contract.mjs';

type Row = {
  request_id: string;
  revision: number;
  action: 'draft' | 'publish' | 'withdraw';
  content: EditorialContent;
};
type Material = { materialHash: string; content: EditorialContent; warnings: string[] };
const fail = (code: string): never => {
  throw Object.assign(new Error(code), { code });
};
export const editorialPublicId = (runId: string, index: number) =>
  `editorial-${createHash('md5').update(`${runId}:${index}`).digest('hex')}`;
function identity(runId: unknown, index: unknown) {
  if (
    typeof runId !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId) ||
    !Number.isInteger(index) ||
    Number(index) < 0 ||
    Number(index) > 4
  )
    fail('invalid_request');
}
export function createEditorialReviewService(deps: {
  enabled(): boolean;
  material(owner: string, runId: string, index: number): Promise<Material>;
  topics(): Promise<EditorialContent['topics']>;
  read(owner: string, runId: string, index: number): Promise<Row | null>;
  save(
    owner: string,
    request: EditorialRequest,
    material: { materialHash: string; title: string; summary: string; sourceUrls: string[] },
  ): Promise<Row>;
}) {
  return {
    async read(owner: string, runId: string, index: number): Promise<EditorialDashboard> {
      identity(runId, index);
      const material = await deps.material(owner, runId, index);
      const configured = deps.enabled();
      const [saved, topicOptions] = await Promise.all([
        configured ? deps.read(owner, runId, index) : null,
        deps.topics(),
      ]);
      return {
        configured,
        materialHash: material.materialHash,
        revision: saved?.revision ?? 0,
        action: saved?.action ?? null,
        content: saved?.content ?? material.content,
        topicOptions,
        warnings: saved ? [] : material.warnings,
        requestId: saved?.request_id ?? null,
        publicId: saved?.action === 'publish' ? editorialPublicId(runId, index) : null,
      };
    },
    async write(owner: string, value: unknown) {
      if (!deps.enabled()) fail('not_configured');
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(',') !==
          'action,candidateIndex,consent,content,expectedRevision,materialHash,requestId,runId'
      )
        fail('invalid_request');
      const request = value as Record<string, unknown>;
      identity(request.runId, request.candidateIndex);
      const material = await deps.material(
        owner,
        String(request.runId),
        Number(request.candidateIndex),
      );
      if (request.materialHash !== material.materialHash) fail('material_changed');
      // The store rechecks ownership, immutable material, live topic catalog,
      // readiness, explicit consent, request idempotency and revision in one transaction.
      const bound = {
        materialHash: material.materialHash,
        title: material.content.title,
        summary: material.content.summary,
        sourceUrls: material.content.sourceUrls,
      };
      const record = await deps.save(owner, normalizeEditorialRequest(request, bound), bound);
      return {
        revision: record.revision,
        action: record.action,
        content: record.content,
        requestId: record.request_id,
        publicId:
          record.action === 'publish'
            ? editorialPublicId(String(request.runId), Number(request.candidateIndex))
            : null,
      };
    },
  };
}

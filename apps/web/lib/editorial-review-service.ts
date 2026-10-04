import { createHash } from 'node:crypto';
import type {
  EditorialContent,
  EditorialDashboard,
  EditorialResourceOption,
} from './editorial-review';
import { normalizeEditorialRequest } from '../../../packages/database/src/editorial-signal-contract.mjs';
import type {
  EditorialRequest,
  EditorialMaterial,
} from '../../../packages/database/src/editorial-signal-contract.mjs';

type Row = {
  request_id: string;
  revision: number;
  action: 'draft' | 'publish' | 'withdraw';
  content: EditorialContent;
};
type Material = {
  materialHash: string;
  content: EditorialContent;
  warnings: string[];
  generatedTopicIds?: string[];
  sourceOptions?: string[];
  resources?: EditorialMaterial['resources'];
  resourceCatalog?: EditorialMaterial['resourceCatalog'];
  resourceSourceOptions?: Array<{
    name: string;
    type: 'person' | 'company' | 'institution';
    sourceUrls: string[];
  }>;
};
const resourceKind = (type: string) => (type === 'person' ? 'person' : 'organization');
const resourceKey = (resource: { type: string; name: string }) =>
  `${resourceKind(resource.type)}:${resource.name.normalize('NFKC').trim().toLocaleLowerCase('en-US')}`;
const resourcePayload = (resource: NonNullable<EditorialContent['resources']>[number]) => ({
  type: resourceKind(resource.type),
  name: resource.name,
  introduction: resource.introduction,
  event_role: resource.event_role,
  evidence: resource.evidence.map(({ fragment_id, quote }) => ({ fragment_id, quote })),
});
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
  save(owner: string, request: EditorialRequest, material: EditorialMaterial): Promise<Row>;
  resources?(
    resources: NonNullable<EditorialMaterial['resources']>,
    catalog: NonNullable<EditorialMaterial['resourceCatalog']>,
  ): Promise<EditorialResourceOption[]>;
  resourcePublicationReady?(): Promise<boolean>;
}) {
  return {
    async read(owner: string, runId: string, index: number): Promise<EditorialDashboard> {
      identity(runId, index);
      const material = await deps.material(owner, runId, index);
      const configured = deps.enabled();
      const [saved, topicOptions, resourceOptions, resourcePublicationReady] = await Promise.all([
        configured ? deps.read(owner, runId, index) : null,
        deps.topics(),
        configured && material.resources && deps.resources
          ? deps.resources(material.resources, material.resourceCatalog ?? [])
          : [],
        configured && material.resources !== undefined && deps.resourcePublicationReady
          ? deps.resourcePublicationReady()
          : false,
      ]);
      const currentTopics = new Map(topicOptions.map((topic) => [topic.id, topic]));
      let selected = saved?.content ?? {
        ...material.content,
        topics:
          material.generatedTopicIds === undefined
            ? material.content.topics
            : [...new Set(material.generatedTopicIds)]
                .flatMap((id) => {
                  const current = currentTopics.get(id);
                  return current ? [current] : [];
                })
                .slice(0, 5),
      };
      const warnings = [...material.warnings];
      // A saved draft can precede a completed enrichment. Refresh its bound
      // resource proposal while retaining manual topic/date/source selections
      // and previously chosen identities; otherwise its read-only resource list
      // can never pass the latest material binding on publication.
      if (saved && material.resources !== undefined && !material.warnings.length) {
        const previous = new Map(
          (selected.resources ?? []).map((resource) => [resourceKey(resource), resource]),
        );
        const resources = material.resources.map((resource) => {
          const existing = previous.get(resourceKey(resource));
          return {
            ...resource,
            type: existing?.entity_id ? existing.type : resource.type,
            entity_id: existing?.entity_id ?? null,
          };
        });
        if (
          JSON.stringify(selected.resources?.map(resourcePayload)) !==
          JSON.stringify(resources.map(resourcePayload))
        ) {
          warnings.push(
            saved.action === 'publish'
              ? '补全资料已更新，以下资源为待确认版本；再次确认发布后才会更新公开档案。'
              : '补全资料已更新，资源草稿已同步；请核对新增人物、组织和来源后发布。',
          );
          selected = {
            ...selected,
            resources,
            persons: resources
              .filter((resource) => resource.type === 'person')
              .map((resource) => resource.name),
            organizations: resources
              .filter((resource) => resource.type !== 'person')
              .map((resource) => resource.name),
          };
        }
      }
      const content = selected.resources
        ? {
            ...selected,
            resources: selected.resources.map((resource) => {
              // A published ID is stable even if the current directory changes.
              if (resource.entity_id) return resource;
              const option = resourceOptions.find(
                (entry) => entry.type === resource.type && entry.name === resource.name,
              );
              const match = option?.status === 'reuse' ? option.matches[0] : undefined;
              return match && option?.matches.length === 1
                ? { ...resource, entity_id: match.id }
                : resource;
            }),
          }
        : selected;
      const resourceSourceOptions = content.resources?.map((resource) => {
        const current = material.resourceSourceOptions?.find(
          (option) => resourceKey(option) === resourceKey(resource),
        );
        // Only server-registered published/withdrawn resource sources are
        // authoritative. A draft may contain caller-supplied source_urls.
        const retained =
          saved && (saved.action === 'publish' || saved.action === 'withdraw')
            ? saved.content.resources?.find(
                (previous) =>
                  previous.entity_id === resource.entity_id &&
                  previous.type === resource.type &&
                  JSON.stringify(resourcePayload(previous)) ===
                    JSON.stringify(resourcePayload(resource)),
              )
            : undefined;
        return {
          name: resource.name,
          type: resource.type,
          sourceUrls: [
            ...new Set([
              ...(current?.sourceUrls ?? []),
              ...(retained?.source_urls ?? []).filter((url) =>
                saved?.content.sourceUrls.includes(url),
              ),
            ]),
          ],
        };
      });
      return {
        configured,
        materialHash: material.materialHash,
        revision: saved?.revision ?? 0,
        action: saved?.action ?? null,
        content,
        topicOptions,
        sourceOptions: [...new Set([...(material.sourceOptions ?? []), ...content.sourceUrls])],
        ...(material.resources === undefined
          ? {}
          : {
              resourceOptions,
              resourceSourceOptions: resourceSourceOptions ?? [],
              resourcePublicationReady,
            }),
        warnings,
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
        sourceOptions: material.sourceOptions ?? material.content.sourceUrls,
        ...(material.resources === undefined
          ? {}
          : {
              resources: material.resources,
              resourceSourceOptions: material.resourceSourceOptions,
              resourceCatalog: material.resourceCatalog ?? [],
            }),
      };
      // Publication checks depend on current state. The store must return an
      // existing matching request receipt before applying those checks to new writes.
      const record = await deps.save(
        owner,
        normalizeEditorialRequest(request, bound, { checkPublication: false }),
        bound,
      );
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

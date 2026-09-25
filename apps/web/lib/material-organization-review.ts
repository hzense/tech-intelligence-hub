import { createHash } from 'node:crypto';
import type { MaterialWorkerRequest } from '../../../packages/database/src/material-verification-worker.mjs';
import type { MaterialCandidate } from './candidate-publication-materials';
import type { MaterialHints } from './material-enrichment';
import { mentionsOrganization, type OrganizationType } from './organization-type-evidence.ts';

export type OrganizationReview = {
  contextHash: string;
  organizations: Array<{
    name: string;
    truncated: boolean;
    evidence: Array<{ id: string; fragmentId: string; quote: string; sourceUrl: string }>;
  }>;
};
export type OrganizationConfirmation = {
  contextHash: string;
  consent: true;
  selections: Array<{ name: string; type: OrganizationType; evidenceId: string }>;
};
export type OrganizationConfirmationRecord = {
  version: 'organization-confirmation-v1';
  contextHash: string;
  confirmedBy: string;
  selections: Array<{
    name: string;
    type: OrganizationType;
    fragmentId: string;
    quote: string;
    sourceUrl: string;
  }>;
};
function fail(code = 'invalid_request'): never {
  throw Object.assign(new Error(code), { code });
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> =>
  Boolean(
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys.sort().join(','),
  );
export function validOrganizationConfirmation(value: unknown): value is OrganizationConfirmation {
  return (
    exact(value, ['contextHash', 'consent', 'selections']) &&
    value.consent === true &&
    typeof value.contextHash === 'string' &&
    /^[a-f0-9]{64}$/.test(value.contextHash) &&
    Array.isArray(value.selections) &&
    value.selections.length > 0 &&
    value.selections.length <= 24 &&
    value.selections.every(
      (row) =>
        exact(row, ['name', 'type', 'evidenceId']) &&
        typeof row.name === 'string' &&
        row.name.length > 0 &&
        [...row.name].length <= 200 &&
        typeof row.type === 'string' &&
        ['company', 'institution'].includes(row.type) &&
        typeof row.evidenceId === 'string' &&
        /^[a-f0-9]{64}$/.test(row.evidenceId),
    )
  );
}

export function buildOrganizationReview(
  packet: MaterialWorkerRequest,
  hints?: MaterialHints,
): OrganizationReview {
  const candidate = packet.candidate as MaterialCandidate;
  const names = [
    ...new Set([
      ...candidate.organizations,
      ...candidate.persons.flatMap((p) => (p.organization ? [p.organization] : [])),
    ]),
  ];
  const normalized = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  const organizations = names
    .filter(
      (name) =>
        !hints?.organizations.some((row) => row.name === name) &&
        !packet.catalog.entities.some((row) =>
          [row.name, ...(row.aliases ?? [])].some(
            (alias) => normalized(alias) === normalized(name),
          ),
        ),
    )
    .map((name) => {
      const evidence = packet.bundle.source.fragments.flatMap((fragment, index) => {
        const provenance = packet.bundle.provenance[index];
        const sourceUrl =
          provenance?.kind === 'original' ? packet.originalSourceUrl : provenance?.sourceUrl;
        if (!sourceUrl || !mentionsOrganization(fragment.text, name)) return [];
        return [
          {
            id: digest({ name, fragment, sourceUrl }),
            fragmentId: fragment.id,
            quote: fragment.text,
            sourceUrl,
          },
        ];
      });
      return { name, evidence: evidence.slice(0, 20), truncated: evidence.length > 20 };
    });
  return {
    contextHash: digest({
      owner: packet.owner,
      requestId: packet.requestId,
      runId: packet.runId,
      candidateIndex: packet.candidateIndex,
      baseMaterialHash: packet.baseMaterialHash,
      bundleHash: packet.bundle.sourceBundleHash,
      originalSourceUrl: packet.originalSourceUrl ?? null,
      candidate,
      catalog: packet.catalog,
      hints: hints ?? null,
      organizations,
    }),
    organizations,
  };
}

/** All text and URLs come from the immutable owner-scoped packet, not the client.
 * Manual classification remains a human assertion, not an AI/regex verification. */
export function confirmOrganizationReview(
  packet: MaterialWorkerRequest,
  hints: MaterialHints | undefined,
  input: unknown,
) {
  if (!validOrganizationConfirmation(input)) fail();
  const review = buildOrganizationReview(packet, hints);
  if (input.contextHash !== review.contextHash) fail('material_changed');
  if (
    input.selections.length !== review.organizations.length ||
    new Set(input.selections.map((s) => s.name)).size !== input.selections.length
  )
    fail();
  const selections = review.organizations.map((org) => {
    const selected = input.selections.find((row) => row.name === org.name);
    const evidence = org.evidence.find((row) => row.id === selected?.evidenceId);
    if (!selected || !evidence) fail('material_changed');
    return {
      name: org.name,
      type: selected.type,
      fragmentId: evidence.fragmentId,
      quote: evidence.quote,
      sourceUrl: evidence.sourceUrl,
    };
  });
  const record: OrganizationConfirmationRecord = {
    version: 'organization-confirmation-v1',
    contextHash: review.contextHash,
    confirmedBy: packet.owner,
    selections,
  };
  return {
    record,
    hints: {
      topicIds: hints?.topicIds ?? [],
      organizations: [
        ...(hints?.organizations ?? []),
        ...selections.map((row) => ({
          name: row.name,
          type: row.type,
          evidence: [{ fragment_id: row.fragmentId, quote: row.quote }],
        })),
      ],
    } satisfies MaterialHints,
  };
}

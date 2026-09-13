import { z } from 'zod';

const nonblank = z.string().refine((value) => value.trim().length > 0, 'Must not be blank');
const version = z.number().int().positive().max(2_147_483_647);
const verificationStatus = z.enum(['pending', 'verified', 'rejected']);

/** Explicit event identity, not a URL hash, title slug or automatically upgraded Seed hint. */
export const signalEventKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine((value) => !/[^a-z0-9-]/.test(value), 'Expected an ASCII lowercase event key');

export const signalEventIdentitySchema = z.strictObject({
  signal_id: nonblank,
  event_key: signalEventKeySchema,
  basis_version: version,
  basis_evidence_id: nonblank,
  identity_basis: nonblank,
});
export type SignalEventIdentity = z.infer<typeof signalEventIdentitySchema>;

const versionSchema = z.strictObject({ signal_id: nonblank, version });
const evidenceLinkSchema = z.strictObject({
  signal_id: nonblank,
  version,
  evidence_id: nonblank,
  relation: z.enum(['supports', 'contradicts', 'context']),
});
const sourceEvidenceSchema = z.strictObject({
  id: nonblank,
  verification_status: verificationStatus,
});
const versionKey = (signalId: string, basisVersion: number): string =>
  JSON.stringify([signalId, basisVersion]);
const linkKey = (signalId: string, basisVersion: number, evidenceId: string): string =>
  JSON.stringify([signalId, basisVersion, evidenceId]);

function uniqueIndex<T>(
  rows: T[],
  key: (row: T) => string,
  collection: string,
  context: z.RefinementCtx,
): Map<string, T> {
  const result = new Map<string, T>();
  rows.forEach((row, index) => {
    const id = key(row);
    if (result.has(id)) {
      context.addIssue({
        code: 'custom',
        path: [collection, index],
        message: 'Duplicate identifier',
      });
    }
    result.set(id, row);
  });
  return result;
}

/** Strict status projections only: parsing neither reads sources nor proves event identity. */
export const signalEventIdentityCatalogSchema = z
  .strictObject({
    signal_versions: z.array(versionSchema),
    signal_version_evidence: z.array(evidenceLinkSchema),
    public_source_evidence: z.array(sourceEvidenceSchema),
    signal_event_identities: z.array(signalEventIdentitySchema),
  })
  .superRefine((catalog, context) => {
    const versions = uniqueIndex(
      catalog.signal_versions,
      (row) => versionKey(row.signal_id, row.version),
      'signal_versions',
      context,
    );
    const evidence = uniqueIndex(
      catalog.public_source_evidence,
      (row) => row.id,
      'public_source_evidence',
      context,
    );
    const links = uniqueIndex(
      catalog.signal_version_evidence,
      (row) => linkKey(row.signal_id, row.version, row.evidence_id),
      'signal_version_evidence',
      context,
    );
    uniqueIndex(
      catalog.signal_event_identities,
      (row) => row.signal_id,
      'signal_event_identities',
      context,
    );
    uniqueIndex(
      catalog.signal_event_identities,
      (row) => row.event_key,
      'signal_event_identities',
      context,
    );
    catalog.signal_version_evidence.forEach((row, index) => {
      if (!versions.has(versionKey(row.signal_id, row.version))) {
        context.addIssue({
          code: 'custom',
          path: ['signal_version_evidence', index],
          message: 'Unknown Signal version',
        });
      }
      if (!evidence.has(row.evidence_id)) {
        context.addIssue({
          code: 'custom',
          path: ['signal_version_evidence', index, 'evidence_id'],
          message: 'Unknown source evidence',
        });
      }
    });
    catalog.signal_event_identities.forEach((row, index) => {
      if (!links.has(linkKey(row.signal_id, row.basis_version, row.basis_evidence_id))) {
        context.addIssue({
          code: 'custom',
          path: ['signal_event_identities', index],
          message: 'Identity basis must reference evidence on the same Signal version',
        });
      }
    });
  });
export type SignalEventIdentityCatalog = z.infer<typeof signalEventIdentityCatalogSchema>;

export function parseSignalEventIdentityCatalog(input: unknown): SignalEventIdentityCatalog {
  return signalEventIdentityCatalogSchema.parse(input);
}

/** Missing or uncertain identity is held for review; no defaults manufacture a key or basis. */
export const signalEventIdentityProposalSchema = z.strictObject({
  signal_id: nonblank,
  identity_status: z.enum(['confirmed', 'uncertain', 'legacy_hint']),
  event_key: signalEventKeySchema.nullable().optional(),
  basis_version: version.nullable().optional(),
  basis_evidence_id: nonblank.nullable().optional(),
  identity_basis: nonblank.nullable().optional(),
});
export type SignalEventIdentityProposal = z.infer<typeof signalEventIdentityProposalSchema>;

type PlanItemBase = { signal_id: string; event_key: string | null };
export type SignalEventIdentityPlanItem = PlanItemBase &
  (
    | { action: 'register'; reason: 'confirmed_supported_identity'; identity: SignalEventIdentity }
    | { action: 'no_change'; reason: 'exact_existing_identity'; identity: SignalEventIdentity }
    | {
        action: 'conflict';
        reason:
          | 'batch_signal_conflict'
          | 'batch_key_conflict'
          | 'existing_signal_conflict'
          | 'existing_key_conflict';
      }
    | {
        action: 'deferred';
        reason:
          | 'identity_uncertain'
          | 'legacy_hint_only'
          | 'missing_event_key'
          | 'incomplete_basis'
          | 'basis_not_supporting'
          | 'basis_evidence_unverified'
          | 'unresolved_contradiction';
      }
  );

function identityFingerprint(row: SignalEventIdentityProposal | SignalEventIdentity): string {
  return JSON.stringify([
    row.signal_id,
    row.event_key ?? null,
    row.basis_version ?? null,
    row.basis_evidence_id ?? null,
    row.identity_basis ?? null,
  ]);
}

/**
 * Deterministic dry run: no IO, key generation, publication, registry writes or
 * first-wins conflict resolution. Existing exact retries recheck recorded evidence
 * statuses without deleting or releasing an existing key. Register actions still need
 * transactional uniqueness checks and review by the eventual database writer.
 */
export function planSignalEventIdentities(
  catalogInput: unknown,
  proposalInput: unknown,
): SignalEventIdentityPlanItem[] {
  const catalog = parseSignalEventIdentityCatalog(catalogInput);
  const proposals = z.array(signalEventIdentityProposalSchema).parse(proposalInput);
  const versions = new Set(
    catalog.signal_versions.map((row) => versionKey(row.signal_id, row.version)),
  );
  const signals = new Set(catalog.signal_versions.map((row) => row.signal_id));
  const evidence = new Map(catalog.public_source_evidence.map((row) => [row.id, row]));
  const links = new Map(
    catalog.signal_version_evidence.map((row) => [
      linkKey(row.signal_id, row.version, row.evidence_id),
      row,
    ]),
  );
  const bySignal = new Map(catalog.signal_event_identities.map((row) => [row.signal_id, row]));
  const byKey = new Map(catalog.signal_event_identities.map((row) => [row.event_key, row]));
  const proposalKeys = new Set<string>();
  const batchSignals = new Map<string, Set<string>>();
  const batchKeys = new Map<string, Set<string>>();

  for (const proposal of proposals) {
    const fingerprint = identityFingerprint(proposal);
    const duplicateKey = JSON.stringify([proposal.identity_status, fingerprint]);
    if (proposalKeys.has(duplicateKey)) throw new Error('Duplicate event identity proposal');
    proposalKeys.add(duplicateKey);
    if (!signals.has(proposal.signal_id)) throw new Error(`Unknown Signal: ${proposal.signal_id}`);
    if (
      proposal.basis_version != null &&
      !versions.has(versionKey(proposal.signal_id, proposal.basis_version))
    ) {
      throw new Error('Proposal basis references an unknown Signal version');
    }
    if (proposal.basis_evidence_id != null && !evidence.has(proposal.basis_evidence_id)) {
      throw new Error('Proposal basis references unknown source evidence');
    }
    if (
      proposal.basis_version != null &&
      proposal.basis_evidence_id != null &&
      !links.has(linkKey(proposal.signal_id, proposal.basis_version, proposal.basis_evidence_id))
    ) {
      throw new Error('Proposal basis must reference evidence on the same Signal version');
    }
    if (proposal.identity_status !== 'confirmed' || proposal.event_key == null) continue;
    const signalProposals = batchSignals.get(proposal.signal_id) ?? new Set<string>();
    signalProposals.add(fingerprint);
    batchSignals.set(proposal.signal_id, signalProposals);
    const keySignals = batchKeys.get(proposal.event_key) ?? new Set<string>();
    keySignals.add(proposal.signal_id);
    batchKeys.set(proposal.event_key, keySignals);
  }

  return proposals
    .map((proposal): SignalEventIdentityPlanItem => {
      const base = { signal_id: proposal.signal_id, event_key: proposal.event_key ?? null };
      if (proposal.identity_status === 'uncertain')
        return { ...base, action: 'deferred', reason: 'identity_uncertain' };
      if (proposal.identity_status === 'legacy_hint')
        return { ...base, action: 'deferred', reason: 'legacy_hint_only' };
      if (proposal.event_key == null)
        return { ...base, action: 'deferred', reason: 'missing_event_key' };
      if ((batchSignals.get(proposal.signal_id)?.size ?? 0) > 1)
        return { ...base, action: 'conflict', reason: 'batch_signal_conflict' };
      if ((batchKeys.get(proposal.event_key)?.size ?? 0) > 1)
        return { ...base, action: 'conflict', reason: 'batch_key_conflict' };
      const existingSignal = bySignal.get(proposal.signal_id);
      const existingKey = byKey.get(proposal.event_key);
      if (
        existingSignal &&
        (existingSignal.event_key !== proposal.event_key ||
          (proposal.basis_version != null &&
            existingSignal.basis_version !== proposal.basis_version) ||
          (proposal.basis_evidence_id != null &&
            existingSignal.basis_evidence_id !== proposal.basis_evidence_id) ||
          (proposal.identity_basis != null &&
            existingSignal.identity_basis !== proposal.identity_basis))
      )
        return { ...base, action: 'conflict', reason: 'existing_signal_conflict' };
      if (existingKey && existingKey.signal_id !== proposal.signal_id)
        return { ...base, action: 'conflict', reason: 'existing_key_conflict' };
      if (
        proposal.basis_version == null ||
        proposal.basis_evidence_id == null ||
        proposal.identity_basis == null
      )
        return { ...base, action: 'deferred', reason: 'incomplete_basis' };
      const identity = signalEventIdentitySchema.parse({
        signal_id: proposal.signal_id,
        event_key: proposal.event_key,
        basis_version: proposal.basis_version,
        basis_evidence_id: proposal.basis_evidence_id,
        identity_basis: proposal.identity_basis,
      });
      const anchor = links.get(
        linkKey(identity.signal_id, identity.basis_version, identity.basis_evidence_id),
      );
      if (
        catalog.signal_version_evidence.some(
          (row) =>
            row.signal_id === identity.signal_id &&
            row.version === identity.basis_version &&
            row.relation === 'contradicts' &&
            evidence.get(row.evidence_id)?.verification_status !== 'rejected',
        )
      ) {
        return { ...base, action: 'deferred', reason: 'unresolved_contradiction' };
      }
      if (anchor?.relation !== 'supports')
        return { ...base, action: 'deferred', reason: 'basis_not_supporting' };
      if (evidence.get(identity.basis_evidence_id)?.verification_status !== 'verified')
        return { ...base, action: 'deferred', reason: 'basis_evidence_unverified' };
      return existingSignal
        ? { ...base, action: 'no_change', reason: 'exact_existing_identity', identity }
        : { ...base, action: 'register', reason: 'confirmed_supported_identity', identity };
    })
    .sort((left, right) => {
      const leftKey = JSON.stringify([left.signal_id, left.event_key, left.action, left.reason]);
      const rightKey = JSON.stringify([
        right.signal_id,
        right.event_key,
        right.action,
        right.reason,
      ]);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
}

import type { FrontMatter } from './schema.js';

export type ReferenceKind = 'content' | 'daily' | 'entity' | 'signal' | 'topic';

export interface ContentDocument {
  file: string;
  frontMatter: FrontMatter;
}

export interface ReferenceCatalogs {
  archivedTopicIds: ReadonlySet<string>;
  entityIds: ReadonlySet<string>;
  signalIds: ReadonlySet<string>;
  topicIds: ReadonlySet<string>;
}

interface ReferenceIssueBase {
  file: string;
  field: string;
  kind: ReferenceKind;
}

export type ReferenceIssue =
  | (ReferenceIssueBase & {
      reason: 'archived' | 'duplicate' | 'missing';
      target: string;
    })
  | (ReferenceIssueBase & { reason: 'cycle'; cycle: readonly string[] });

function checkReferences(
  issues: ReferenceIssue[],
  document: ContentDocument,
  field: string,
  kind: ReferenceKind,
  values: readonly string[],
  allowed: ReadonlySet<string>,
) {
  for (const target of values) {
    if (!allowed.has(target)) {
      issues.push({ file: document.file, field, kind, reason: 'missing', target });
    }
  }
}

function checkTopicReferences(
  issues: ReferenceIssue[],
  document: ContentDocument,
  field: string,
  values: readonly string[],
  allowed: ReadonlySet<string>,
  archived: ReadonlySet<string>,
) {
  checkReferences(issues, document, field, 'topic', values, allowed);

  if (document.frontMatter.type === 'topic' || document.frontMatter.status !== 'published') {
    return;
  }

  for (const target of values) {
    if (archived.has(target)) {
      issues.push({
        file: document.file,
        field,
        kind: 'topic',
        reason: 'archived',
        target,
      });
    }
  }
}

function canonicalizeTopicCycle(topicIds: readonly string[]): string[] {
  let startIndex = 0;
  for (let index = 1; index < topicIds.length; index += 1) {
    if (topicIds[index]! < topicIds[startIndex]!) startIndex = index;
  }
  return [...topicIds.slice(startIndex), ...topicIds.slice(0, startIndex)];
}

function checkTopicParentCycles(issues: ReferenceIssue[], documents: readonly ContentDocument[]) {
  const topicCounts = new Map<string, number>();
  for (const document of documents) {
    if (document.frontMatter.type !== 'topic') continue;
    const topicId = document.frontMatter.id;
    topicCounts.set(topicId, (topicCounts.get(topicId) ?? 0) + 1);
  }

  const topicParents = new Map<string, string | undefined>();
  const topicFiles = new Map<string, string>();
  for (const document of documents) {
    if (document.frontMatter.type !== 'topic') continue;
    const topicId = document.frontMatter.id;
    if (topicCounts.get(topicId) !== 1) continue;
    topicParents.set(topicId, document.frontMatter.parent ?? undefined);
    topicFiles.set(topicId, document.file);
  }

  const done = new Set<string>();
  const reportedCycles = new Set<string>();

  for (const startTopicId of [...topicParents.keys()].sort()) {
    if (done.has(startTopicId)) continue;

    const path: string[] = [];
    const pathPositions = new Map<string, number>();
    let topicId: string | undefined = startTopicId;

    while (topicId && topicParents.has(topicId) && !done.has(topicId)) {
      const cycleStart = pathPositions.get(topicId);
      if (cycleStart !== undefined) {
        const cycleIds = canonicalizeTopicCycle(path.slice(cycleStart));
        const firstTopicId = cycleIds[0];
        const cycleKey = cycleIds.join('\0');
        const file = firstTopicId ? topicFiles.get(firstTopicId) : undefined;
        if (firstTopicId && file && !reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          issues.push({
            file,
            field: 'parent',
            kind: 'topic',
            reason: 'cycle',
            cycle: [...cycleIds, firstTopicId],
          });
        }
        break;
      }

      pathPositions.set(topicId, path.length);
      path.push(topicId);
      const parentId = topicParents.get(topicId);
      topicId = parentId && topicParents.has(parentId) ? parentId : undefined;
    }

    for (const visitedTopicId of path) done.add(visitedTopicId);
  }
}

export function findReferenceIssues(
  documents: readonly ContentDocument[],
  catalogs: ReferenceCatalogs,
): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const contentIds = new Set<string>();
  const dailyIds = new Set<string>();

  for (const document of documents) {
    const { id, type } = document.frontMatter;
    if (contentIds.has(id)) {
      issues.push({
        file: document.file,
        field: 'id',
        kind: 'content',
        reason: 'duplicate',
        target: id,
      });
    }
    contentIds.add(id);
    if (type === 'daily') dailyIds.add(id);
    if (type === 'topic') {
      if (!catalogs.topicIds.has(id)) {
        issues.push({
          file: document.file,
          field: 'id',
          kind: 'topic',
          reason: 'missing',
          target: id,
        });
      }
    }
  }

  const topicIds = catalogs.topicIds;

  for (const document of documents) {
    const frontMatter = document.frontMatter;
    switch (frontMatter.type) {
      case 'daily':
        checkTopicReferences(
          issues,
          document,
          'rising_topics',
          frontMatter.rising_topics,
          topicIds,
          catalogs.archivedTopicIds,
        );
        checkReferences(
          issues,
          document,
          'signal_refs',
          'signal',
          frontMatter.signal_refs,
          catalogs.signalIds,
        );
        break;
      case 'weekly':
        checkReferences(issues, document, 'daily_refs', 'daily', frontMatter.daily_refs, dailyIds);
        checkTopicReferences(
          issues,
          document,
          'featured_topics',
          frontMatter.featured_topics,
          topicIds,
          catalogs.archivedTopicIds,
        );
        break;
      case 'insight':
        checkTopicReferences(
          issues,
          document,
          'topics',
          frontMatter.topics,
          topicIds,
          catalogs.archivedTopicIds,
        );
        checkReferences(
          issues,
          document,
          'companies',
          'entity',
          frontMatter.companies ?? [],
          catalogs.entityIds,
        );
        checkReferences(
          issues,
          document,
          'technologies',
          'entity',
          frontMatter.technologies ?? [],
          catalogs.entityIds,
        );
        checkReferences(
          issues,
          document,
          'evidence_signals',
          'signal',
          frontMatter.evidence_signals,
          catalogs.signalIds,
        );
        checkReferences(
          issues,
          document,
          'counter_signals',
          'signal',
          frontMatter.counter_signals ?? [],
          catalogs.signalIds,
        );
        break;
      case 'briefing':
        checkTopicReferences(
          issues,
          document,
          'topics',
          frontMatter.topics,
          topicIds,
          catalogs.archivedTopicIds,
        );
        checkReferences(
          issues,
          document,
          'technologies',
          'entity',
          frontMatter.technologies ?? [],
          catalogs.entityIds,
        );
        break;
      case 'topic':
        // A canonical parent may exist in Taxonomy without being enabled in Seed.
        // validateTopicContentProjection owns the exact primary-parent check.
        break;
      case 'paper_note':
        checkReferences(
          issues,
          document,
          'paper',
          'entity',
          [frontMatter.paper],
          catalogs.entityIds,
        );
        checkTopicReferences(
          issues,
          document,
          'topics',
          frontMatter.topics,
          topicIds,
          catalogs.archivedTopicIds,
        );
        checkReferences(
          issues,
          document,
          'related_entities',
          'entity',
          frontMatter.related_entities ?? [],
          catalogs.entityIds,
        );
        break;
    }
  }

  checkTopicParentCycles(issues, documents);

  return issues;
}

import type { FrontMatter } from './schema.js';

export type ReferenceKind = 'content' | 'daily' | 'entity' | 'signal' | 'topic';

export interface ContentDocument {
  file: string;
  frontMatter: FrontMatter;
}

export interface ReferenceCatalogs {
  entityIds: ReadonlySet<string>;
  signalIds: ReadonlySet<string>;
  topicIds: ReadonlySet<string>;
}

export interface ReferenceIssue {
  file: string;
  field: string;
  kind: ReferenceKind;
  reason: 'archived' | 'duplicate' | 'missing';
  target: string;
}

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

export function findReferenceIssues(
  documents: readonly ContentDocument[],
  catalogs: ReferenceCatalogs,
): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const contentIds = new Set<string>();
  const dailyIds = new Set<string>();
  const contentTopicIds = new Set<string>();
  const archivedTopicIds = new Set<string>();

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
      contentTopicIds.add(id);
      if (document.frontMatter.status === 'archived') archivedTopicIds.add(id);
    }
  }

  const topicIds = new Set([...catalogs.topicIds, ...contentTopicIds]);

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
          archivedTopicIds,
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
          archivedTopicIds,
        );
        break;
      case 'insight':
        checkTopicReferences(
          issues,
          document,
          'topics',
          frontMatter.topics,
          topicIds,
          archivedTopicIds,
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
          archivedTopicIds,
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
        checkTopicReferences(
          issues,
          document,
          'parent',
          frontMatter.parent ? [frontMatter.parent] : [],
          topicIds,
          archivedTopicIds,
        );
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
          archivedTopicIds,
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

  return issues;
}

import type { FrontMatter } from './schema.js';

export type ReferenceKind = 'content' | 'entity' | 'signal' | 'topic';

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
  reason: 'duplicate' | 'missing';
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

export function findReferenceIssues(
  documents: readonly ContentDocument[],
  catalogs: ReferenceCatalogs,
): ReferenceIssue[] {
  const issues: ReferenceIssue[] = [];
  const contentIds = new Set<string>();
  const dailyIds = new Set<string>();
  const contentTopicIds = new Set<string>();

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
    if (type === 'topic') contentTopicIds.add(id);
  }

  const topicIds = new Set([...catalogs.topicIds, ...contentTopicIds]);

  for (const document of documents) {
    const frontMatter = document.frontMatter;
    switch (frontMatter.type) {
      case 'daily':
        checkReferences(issues, document, 'rising_topics', 'topic', frontMatter.rising_topics, topicIds);
        checkReferences(issues, document, 'signal_refs', 'signal', frontMatter.signal_refs, catalogs.signalIds);
        break;
      case 'weekly':
        checkReferences(issues, document, 'daily_refs', 'content', frontMatter.daily_refs, dailyIds);
        checkReferences(issues, document, 'featured_topics', 'topic', frontMatter.featured_topics, topicIds);
        break;
      case 'insight':
        checkReferences(issues, document, 'topics', 'topic', frontMatter.topics, topicIds);
        checkReferences(issues, document, 'companies', 'entity', frontMatter.companies ?? [], catalogs.entityIds);
        checkReferences(issues, document, 'technologies', 'entity', frontMatter.technologies ?? [], catalogs.entityIds);
        checkReferences(issues, document, 'evidence_signals', 'signal', frontMatter.evidence_signals, catalogs.signalIds);
        checkReferences(issues, document, 'counter_signals', 'signal', frontMatter.counter_signals ?? [], catalogs.signalIds);
        break;
      case 'briefing':
        checkReferences(issues, document, 'topics', 'topic', frontMatter.topics, topicIds);
        checkReferences(issues, document, 'technologies', 'entity', frontMatter.technologies ?? [], catalogs.entityIds);
        break;
      case 'topic':
        checkReferences(issues, document, 'parent', 'topic', frontMatter.parent ? [frontMatter.parent] : [], topicIds);
        break;
      case 'paper_note':
        checkReferences(issues, document, 'paper', 'entity', [frontMatter.paper], catalogs.entityIds);
        checkReferences(issues, document, 'topics', 'topic', frontMatter.topics, topicIds);
        checkReferences(issues, document, 'related_entities', 'entity', frontMatter.related_entities ?? [], catalogs.entityIds);
        break;
    }
  }

  return issues;
}

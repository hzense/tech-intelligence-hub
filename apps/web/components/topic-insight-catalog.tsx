'use client';

import { useState, type ReactNode } from 'react';
import styles from './topic-insight-pages.module.css';

interface CatalogReport {
  id: string;
  topicIds: string[];
  card: ReactNode;
}

export function TopicInsightCatalog({
  topics,
  reports,
}: {
  topics: { id: string; title: string }[];
  reports: CatalogReport[];
}) {
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const topicIds = new Set(topics.map((topic) => topic.id));
  const assignedReports = reports.filter((report) =>
    report.topicIds.some((id) => topicIds.has(id)),
  );
  const unassignedReports = reports.filter(
    (report) => !report.topicIds.some((id) => topicIds.has(id)),
  );
  const counts = new Map<string, number>();
  for (const report of assignedReports) {
    for (const id of new Set(report.topicIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  // Use the same eligible catalog and order as the tracking cards, including
  // topics awaiting their first report. Saved broad scopes cannot invent filters.
  const availableTopics = topics.map((topic) => ({ ...topic, count: counts.get(topic.id) ?? 0 }));
  const activeTopic = availableTopics.find((topic) => topic.id === selectedTopic);
  // A withdrawn report may remove the selected topic on refresh: show the full catalog then.
  const filteredReports = activeTopic
    ? assignedReports.filter((report) => report.topicIds.includes(activeTopic.id))
    : assignedReports;
  let shownTopics = expanded ? availableTopics : availableTopics.slice(0, 6);
  if (!expanded && activeTopic && !shownTopics.some((topic) => topic.id === activeTopic.id)) {
    shownTopics = [...shownTopics.slice(0, 5), activeTopic];
  }

  return (
    <section className={styles.catalogSection} aria-labelledby="reports-heading">
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="reports-heading">洞察报告</h2>
          <p>与上方跟踪专题对应，按专题阅读证据与研判。</p>
        </div>
        <p role="status" aria-live="polite">
          {activeTopic ? `${activeTopic.title} · ` : ''}
          {filteredReports.length} 份对应报告 · 按发布日期排序
        </p>
      </div>

      {availableTopics.length > 0 ? (
        <div className={styles.topicNavigation}>
          <p id="topic-navigation-label" className={styles.topicNavigationLabel}>
            按跟踪专题浏览
          </p>
          <div
            className={styles.topicFilters}
            role="group"
            aria-labelledby="topic-navigation-label"
          >
            <button
              type="button"
              aria-pressed={!activeTopic}
              onClick={() => setSelectedTopic(null)}
            >
              全部 <span>{assignedReports.length}</span>
            </button>
            {shownTopics.map((topic) => (
              <button
                key={topic.id}
                type="button"
                aria-pressed={activeTopic?.id === topic.id}
                onClick={() => setSelectedTopic(topic.id)}
              >
                {topic.title} <span>{topic.count}</span>
              </button>
            ))}
          </div>
          {availableTopics.length > 6 ? (
            <button
              className={styles.topicExpansion}
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? '收起专题' : `展开更多专题（${availableTopics.length - 6}）`}
            </button>
          ) : null}
        </div>
      ) : null}

      {activeTopic ? (
        <p className={styles.selectedTopicLink}>
          <a href={`/topics/${encodeURIComponent(activeTopic.id)}`}>
            查看{activeTopic.title}的信号与报告 →
          </a>
        </p>
      ) : null}

      {filteredReports.length ? (
        <div className={styles.reportGrid}>
          {filteredReports.map((report) => (
            <div className={styles.reportSlot} key={report.id}>
              {report.card}
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <p>
            {activeTopic
              ? `${activeTopic.title}尚无已公开的对应报告。`
              : '跟踪专题暂无已公开的对应报告。'}
          </p>
        </div>
      )}

      {unassignedReports.length ? (
        <details className={styles.unassignedReports}>
          <summary>尚未对应跟踪专题的报告（{unassignedReports.length}）</summary>
          <p>
            这些报告的原归属尚未细分，或未达到跟踪专题的信号门槛。保留原报告供查阅，不计入上方专题。
          </p>
          <div className={styles.reportGrid}>
            {unassignedReports.map((report) => (
              <div className={styles.reportSlot} key={report.id}>
                {report.card}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

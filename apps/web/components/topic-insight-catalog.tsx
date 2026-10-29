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
  const titles = new Map(topics.map((topic) => [topic.id, topic.title]));
  const counts = new Map<string, number>();
  for (const report of reports) {
    for (const id of new Set(report.topicIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const availableTopics = [...counts]
    .map(([id, count]) => ({
      id,
      title: titles.get(id) ?? id,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'zh-CN'));
  const activeTopic = availableTopics.find((topic) => topic.id === selectedTopic);
  // A withdrawn report may remove the selected topic on refresh: show the full catalog then.
  const filteredReports = activeTopic
    ? reports.filter((report) => report.topicIds.includes(activeTopic.id))
    : reports;
  let shownTopics = expanded ? availableTopics : availableTopics.slice(0, 6);
  if (!expanded && activeTopic && !shownTopics.some((topic) => topic.id === activeTopic.id)) {
    shownTopics = [...shownTopics.slice(0, 5), activeTopic];
  }

  return (
    <section className={styles.catalogSection} aria-labelledby="reports-heading">
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="reports-heading">洞察报告</h2>
          <p>从专题出发，阅读证据与研判。</p>
        </div>
        <p role="status" aria-live="polite">
          {activeTopic ? `${activeTopic.title} · ` : ''}
          {filteredReports.length} 份已公开报告 · 按发布日期排序
        </p>
      </div>

      {availableTopics.length > 0 ? (
        <div className={styles.topicNavigation}>
          <p id="topic-navigation-label" className={styles.topicNavigationLabel}>
            按专题浏览
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
              全部 <span>{reports.length}</span>
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
          <p>暂无已公开的洞察报告，确认发布后会出现在这里。</p>
        </div>
      )}
    </section>
  );
}

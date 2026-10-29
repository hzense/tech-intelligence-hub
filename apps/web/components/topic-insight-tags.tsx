import Link from 'next/link';
import styles from './topic-insight-tags.module.css';

export function TopicInsightTags({
  topics,
  linked = false,
}: {
  topics: readonly { id: string; name?: string | undefined; isLeaf?: boolean | undefined }[];
  linked?: boolean;
}) {
  const groups = [
    { label: '所属专题', topics: topics.filter((topic) => topic.isLeaf === true) },
    { label: '原生成范围（待细分）', topics: topics.filter((topic) => topic.isLeaf !== true) },
  ];
  return (
    <div>
      {topics.length ? (
        groups
          .filter((group) => group.topics.length)
          .map((group) => (
            <div
              className={styles.topics}
              aria-label={`${group.label}：${group.topics.map((topic) => topic.name || topic.id).join('、')}`}
              key={group.label}
            >
              <span className={styles.label}>{group.label}</span>
              <ul className={styles.tags}>
                {group.topics.map((topic, index) => (
                  <li key={`${topic.id}:${index}`}>
                    {linked && topic.name ? (
                      <Link href={`/topics/${encodeURIComponent(topic.id)}`} prefetch={false}>
                        {topic.name}
                      </Link>
                    ) : (
                      <span>{topic.name || topic.id}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
      ) : (
        <div className={styles.topics}>
          <span className={styles.empty}>未标注专题</span>
        </div>
      )}
    </div>
  );
}

import Link from 'next/link';
import { formatZhDate } from '@/lib/content-runtime';
import styles from './topic-insight-pages.module.css';

export interface TopicInsightCardEntry {
  id: string;
  href: string;
  title: string;
  summary: string;
  date: string;
  evidenceCount: number;
  topics: string[];
}

export function TopicInsightCard({ report }: { report: TopicInsightCardEntry }) {
  return (
    <Link className={styles.reportCard} href={report.href}>
      <div className={styles.reportCardTop}>
        <span>专题报告</span>
        <time dateTime={report.date}>{formatZhDate(report.date)}</time>
      </div>
      <h3>{report.title}</h3>
      <p>{report.summary}</p>
      <div className={styles.reportCardBottom}>
        <span>{report.evidenceCount} 条可公开读取的证据</span>
        <span>{report.topics.join(' · ') || '跨领域'}</span>
        <span aria-hidden="true">↗</span>
      </div>
    </Link>
  );
}

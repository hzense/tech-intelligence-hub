import type { Metadata } from 'next';
import Link from 'next/link';
import { ResourceCard } from '@/components/resource-cards';
import styles from '@/components/resource-directory.module.css';
import { SiteShell } from '@/components/site-shell';
import { getPublicExploration } from '@/lib/public-exploration-runtime';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '资源',
  description: '从全部公开信号发现相关组织和关键人物，并查看关联的事件与洞察。',
  alternates: { canonical: '/resources' },
};

export default async function ResourcesPage() {
  const data = await getPublicExploration();
  const topicNames = new Map(data.taxonomy.topics.map((topic) => [topic.id, topic.name]));
  // The directory is derived from the same public Signal authority as the
  // Signal page. Never create an entity page from a display-only name.
  const linked = data.entities.filter((entity) => entity.signals.length > 0);
  const organizations = linked.filter(
    (entity) => entity.type === 'company' || entity.type === 'institution',
  );
  const people = linked.filter((entity) => entity.type === 'person');
  return (
    <SiteShell>
      <main className={`page-main section-shell ${styles.directory}`}>
        <section className={styles.hero}>
          <p className="kicker">HZENSE RESOURCES</p>
          <h1>把参与者放回技术变化中。</h1>
          <p className={styles.intro}>
            组织与人物汇集在同一个资源目录。卡片来自已公开信号的实体 ID，按近 30 天关联事件数排序；
            同名不会自动合并，只有名称而未核实身份的参与者仍在信号正文中展示。
          </p>
        </section>
        <nav className={styles.jumpLinks} aria-label="跳转到资源类型">
          <Link href="#organizations">组织 · {organizations.length}</Link>
          <Link href="#people">人物 · {people.length}</Link>
        </nav>
        <section
          className={styles.section}
          id="organizations"
          aria-labelledby="organization-heading"
        >
          <div className={styles.sectionHeading}>
            <h2 id="organization-heading">相关组织</h2>
            <p>每张卡片概括公开信号，不代表任职或合作关系。</p>
          </div>
          {organizations.length ? (
            <div className={styles.grid}>
              {organizations.map((entity) => (
                <ResourceCard key={entity.id} entity={entity} topicNames={topicNames} />
              ))}
            </div>
          ) : (
            <p className={styles.empty}>暂无关联公开信号的已登记组织。</p>
          )}
        </section>
        <section className={styles.section} id="people" aria-labelledby="people-heading">
          <div className={styles.sectionHeading}>
            <h2 id="people-heading">关键人物</h2>
            <p>仅展示已登记人物；头像缺少可靠来源时显示姓名缩写。</p>
          </div>
          {people.length ? (
            <div className={styles.grid}>
              {people.map((entity) => (
                <ResourceCard key={entity.id} entity={entity} topicNames={topicNames} />
              ))}
            </div>
          ) : (
            <p className={styles.empty}>暂无关联公开信号的已登记人物。</p>
          )}
        </section>
        <p className={styles.note}>
          活跃度按事件发生时间统计，截至 {new Date().toISOString().slice(0, 10)}
          （UTC）。资源图像只使用与实体 ID
          对应、来源和授权可核对的公开素材；其余为占位，不用搜索图片推测身份。
        </p>
      </main>
    </SiteShell>
  );
}

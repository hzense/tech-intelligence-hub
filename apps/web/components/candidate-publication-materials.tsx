import type { PublicationMaterials } from '../lib/candidate-publication-materials';
import styles from './candidate-review-editor.module.css';

const statuses = { matched: '已关联 / 已提供', missing: '缺少材料', ambiguous: '需消歧' };
function sourceLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function CandidatePublicationMaterials({ materials }: { materials: PublicationMaterials }) {
  return (
    <section className={styles.history} aria-labelledby="publication-materials-heading">
      <h3 id="publication-materials-heading">正式发布材料</h3>
      <p>
        以下为当前候选及补全后的实际关联材料，仍属私有审核。
        已关联不等于事实核验通过；确认送核验不会公开。
      </p>
      <h4>{materials.title}</h4>
      <p>{materials.summary}</p>
      <div className={styles.materialsGrid}>
        {materials.items.map((item, index) => (
          <article className={styles.materialCard} key={`${item.key}:${index}`}>
            <h4>{item.label}</h4>
            <span className={styles[item.status]}>{statuses[item.status]}</span>
            <p>{item.proposed}</p>
            {item.matches.length ? (
              <ul>
                {item.matches.map((match) => (
                  <li key={match.id}>
                    <strong>{match.name}</strong>
                    {match.sourceUrl ? (
                      sourceLink(match.sourceUrl) ? (
                        <p>
                          <a href={match.sourceUrl} target="_blank" rel="noopener noreferrer">
                            查看登记的公开来源
                          </a>
                        </p>
                      ) : (
                        <p>来源地址无效，不能打开。</p>
                      )
                    ) : null}
                    <details>
                      <summary>关联记录</summary>
                      <code>{match.id}</code>
                      {match.sourceUrl && sourceLink(match.sourceUrl) ? (
                        <p>{match.sourceUrl}</p>
                      ) : null}
                    </details>
                  </li>
                ))}
              </ul>
            ) : null}
            {item.references.length ? (
              <details>
                <summary>核对原文依据（{item.references.length} 条）</summary>
                {item.references.map((reference, index) => (
                  <blockquote key={`${reference.fragment_id ?? 'quote'}:${index}`}>
                    <p>{reference.quote}</p>
                    <small>
                      私有原文引用{reference.fragment_id ? ` · ${reference.fragment_id}` : ''}
                    </small>
                  </blockquote>
                ))}
              </details>
            ) : null}
            <p className={styles.materialNextStep}>{item.nextStep}</p>
          </article>
        ))}
      </div>
      <p>缺失的实体登记、公开许可及独立核验须先完成；本页不会自动创建正式实体或公开私有资料。</p>
    </section>
  );
}

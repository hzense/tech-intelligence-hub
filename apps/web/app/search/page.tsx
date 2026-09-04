import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteShell } from '@/components/site-shell';
import { formatZhDate } from '@/lib/content-runtime';
import { isSearchType, searchTypeLabels, searchTypes, type SearchType } from '@/lib/search-runtime';
import { searchPublishedContent } from '@/lib/server/search';

export const metadata: Metadata = {
  title: '搜索',
  description: '搜索 HZense 已发布的简报、洞察、专题、信号与资源。',
  alternates: {
    canonical: '/search',
  },
  robots: {
    index: false,
    follow: true,
  },
};

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function filterHref(query: string, type?: SearchType): string {
  const parameters = new URLSearchParams();
  parameters.set('q', query);
  if (type) parameters.set('type', type);
  return `/search?${parameters.toString()}`;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const parameters = await searchParams;
  const query = firstValue(parameters.q).trim().slice(0, 120);
  const requestedType = firstValue(parameters.type);
  const selectedType = isSearchType(requestedType) ? requestedType : undefined;
  const results = query ? await searchPublishedContent(query, selectedType) : [];

  return (
    <SiteShell>
      <main className="page-main section-shell search-page">
        <section className="page-hero search-hero">
          <p className="kicker">HZENSE SEARCH</p>
          <h1>搜索结构化科技情报。</h1>
          <p>覆盖已发布的每日简报、周报、洞察、专题、信号与资源，并保留原始内容入口。</p>
        </section>

        <form className="search-form" action="/search" role="search">
          <label htmlFor="search-query">关键词</label>
          <div className="search-form-row">
            <input
              id="search-query"
              name="q"
              type="search"
              defaultValue={query}
              maxLength={120}
              placeholder="例如：AI 安全、OpenAI、基础设施"
              autoComplete="off"
            />
            <select name="type" defaultValue={selectedType ?? ''} aria-label="内容类型">
              <option value="">全部类型</option>
              {searchTypes.map((type) => (
                <option value={type} key={type}>
                  {searchTypeLabels[type]}
                </option>
              ))}
            </select>
            <button type="submit">搜索</button>
          </div>
        </form>

        {query ? (
          <>
            <nav className="search-filters" aria-label="搜索结果类型">
              <Link className={!selectedType ? 'active' : undefined} href={filterHref(query)}>
                全部
              </Link>
              {searchTypes.map((type) => (
                <Link
                  className={selectedType === type ? 'active' : undefined}
                  href={filterHref(query, type)}
                  key={type}
                >
                  {searchTypeLabels[type]}
                </Link>
              ))}
            </nav>
            <div className="search-summary" aria-live="polite">
              <strong>{results.length}</strong>
              <span>条结果 · “{query}”</span>
            </div>
            {results.length > 0 ? (
              <ol className="search-results" aria-label="搜索结果">
                {results.map((result) => (
                  <li key={`${result.type}-${result.id}`}>
                    <Link href={result.href}>
                      <div className="search-result-meta">
                        <span>{searchTypeLabels[result.type]}</span>
                        {result.date ? (
                          <time dateTime={result.date}>{formatZhDate(result.date)}</time>
                        ) : null}
                      </div>
                      <h2>{result.title}</h2>
                      <p>{result.summary}</p>
                      <strong>打开内容 ↗</strong>
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <section className="search-empty">
                <h2>没有找到匹配内容。</h2>
                <p>可以减少关键词、切换到全部类型，或尝试专题和实体名称。</p>
              </section>
            )}
          </>
        ) : (
          <section className="search-empty search-empty-initial">
            <h2>从一个关键词开始。</h2>
            <p>搜索标题、摘要、正文、专题、实体和来源名称。</p>
          </section>
        )}
      </main>
    </SiteShell>
  );
}

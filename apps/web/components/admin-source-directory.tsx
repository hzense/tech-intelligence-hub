'use client';

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';
import { formatSourceType } from '../lib/signal-presentation';
import type { SourceDirectory, SourceDirectoryRow } from '../lib/source-directory';
import { filterSourceDirectoryRows } from '../lib/source-directory-view';
import { TaskListToolbar, TaskSortHeader, useTaskList } from './admin-task-list';
import tables from './admin-task-table.module.css';
import styles from './admin-source-directory.module.css';

const statuses = [
  { value: 'registered', label: '已登记' },
  { value: 'unregistered', label: '未登记' },
  { value: 'uncited', label: '已登记且无引用' },
];

function SiteRow({
  row,
  domainLabels,
}: {
  row: SourceDirectoryRow;
  domainLabels: ReadonlyMap<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  return (
    <>
      <tr>
        <th scope="row">
          {row.signalCount > 0 ? (
            <button
              type="button"
              className={styles.expand}
              aria-label={`${expanded ? '收起' : '查看'} ${row.domain} 的引用明细`}
              aria-expanded={expanded}
              aria-controls={expanded ? detailsId : undefined}
              onClick={() => setExpanded((current) => !current)}
            >
              <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
              {row.domain}
            </button>
          ) : (
            row.domain
          )}
        </th>
        <td>
          {row.registrations.length ? (
            row.registrations.map((registration) => (
              <p key={registration.id}>
                {registration.name}
                <small className={tables.meta}>
                  {formatSourceType(registration.type)}
                  {!registration.active && ' · 已停用'}
                </small>
              </p>
            ))
          ) : (
            <span className={styles.muted}>未登记</span>
          )}
        </td>
        <td>
          <ul className={styles.domainTags} aria-label={`${row.domain} 涉及的领域`}>
            {row.domainIds.map((id) => (
              <li key={id}>{domainLabels.get(id)}</li>
            ))}
          </ul>
        </td>
        <td className={styles.number}>{row.signalCount}</td>
        <td className={styles.number}>{row.urlCount}</td>
        <td className={tables.time}>
          {row.latestDate ? <time dateTime={row.latestDate}>{row.latestDate}</time> : '暂无引用'}
        </td>
      </tr>
      {expanded && (
        <tr id={detailsId}>
          <td colSpan={6}>
            <ul className={styles.references} aria-label={`${row.domain} 的引用明细`}>
              {row.references.map((reference) => (
                <li key={reference.id}>
                  <Link href={`/signals/${encodeURIComponent(reference.id)}`} prefetch={false}>
                    {reference.title}
                  </Link>{' '}
                  <time dateTime={reference.date}>{reference.date}</time>
                  {reference.urls.map((url) => (
                    <a
                      key={url}
                      className={styles.original}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {url}
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  ))}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

export function AdminSourceDirectory({ directory }: { directory: SourceDirectory }) {
  const { domains, rows, stats } = directory;
  const [domainKey, setDomainKey] = useState('all');
  const domainLabels = useMemo(
    () => new Map(domains.map(({ key, label }) => [key, label])),
    [domains],
  );
  const scopedRows = useMemo(() => filterSourceDirectoryRows(rows, domainKey), [rows, domainKey]);
  const searchableSites = useMemo(
    () =>
      new Map(
        scopedRows.map((row) => {
          const terms = new Set([row.domain, ...row.registeredHosts]);
          for (const { urls } of row.references) {
            for (const url of urls) terms.add(new URL(url).hostname);
          }
          for (const registration of row.registrations) {
            terms.add(registration.name);
            terms.add(registration.id);
            terms.add(formatSourceType(registration.type));
          }
          return [row.domain, [...terms].join(' ')] as const;
        }),
      ),
    [scopedRows],
  );
  const list = useTaskList({
    items: scopedRows,
    initialSort: 'signals',
    searchText: (row) => searchableSites.get(row.domain) ?? row.domain,
    statusValue: (row) => {
      if (!row.registrations.length) return 'unregistered';
      return row.signalCount ? 'registered' : ['registered', 'uncited'];
    },
    sortValues: {
      domain: (row) => row.domain,
      signals: (row) => row.signalCount,
      urls: (row) => row.urlCount,
      latest: (row) => row.latestDate,
    },
  });
  return (
    <>
      <dl className={styles.metrics} aria-label="全库信源概览">
        <div>
          <dt>名录登记条目</dt>
          <dd>{stats.registeredSources}</dd>
        </div>
        <div>
          <dt>实际引用站点</dt>
          <dd>{stats.citedSites}</dd>
        </div>
        <div>
          <dt>引用过的未登记站点</dt>
          <dd>{stats.unregisteredCitedSites}</dd>
        </div>
      </dl>
      <p className={styles.coverage}>
        全库共有 {stats.signalsWithSources} 条公开信号附有原文链接，{stats.signalsWithoutSources}{' '}
        条缺少原文链接。按注册域名汇总站点，同一条信号在同一站点只计一次。
      </p>
      <fieldset className={styles.domainPicker}>
        <legend>按一级领域查看</legend>
        <p>
          按引用信号的主题统计站点数，同一站点可覆盖多个领域。「待归类」表示信号尚未匹配领域，「无引用」表示尚无公开信号引用该站点。
        </p>
        <div className={styles.domainOptions}>
          {[{ key: 'all', label: '全部站点', siteCount: stats.sites }, ...domains].map(
            ({ key, label, siteCount }) => (
              <button
                key={key}
                type="button"
                aria-pressed={key === domainKey}
                aria-label={`${label}，${siteCount} 个站点`}
                onClick={() => setDomainKey(key)}
              >
                {label}
                <span>{siteCount}</span>
              </button>
            ),
          )}
        </div>
      </fieldset>
      <TaskListToolbar
        label="信源"
        list={{
          ...list,
          reset() {
            list.reset();
            setDomainKey('all');
          },
        }}
        statuses={statuses}
        shown={list.visibleItems.length}
        total={scopedRows.length}
        countLabel={`${domainLabels.get(domainKey) ?? '全部站点'} · 显示 ${list.visibleItems.length} / ${scopedRows.length} 个站点`}
      />
      <div className={tables.scroll} tabIndex={0} role="region" aria-label="信源列表，可横向滚动">
        <table className={tables.table} aria-label="信源站点">
          <thead>
            <tr>
              <TaskSortHeader sortKey="domain" list={list}>
                站点
              </TaskSortHeader>
              <th scope="col">该域名下的登记信源</th>
              <th scope="col">站点涉及的领域</th>
              <TaskSortHeader sortKey="signals" list={list}>
                关联信号数
              </TaskSortHeader>
              <TaskSortHeader sortKey="urls" list={list}>
                不同原文数
              </TaskSortHeader>
              <TaskSortHeader sortKey="latest" list={list}>
                最近信号日期
              </TaskSortHeader>
            </tr>
          </thead>
          <tbody>
            {list.visibleItems.map((row) => (
              <SiteRow key={row.domain} row={row} domainLabels={domainLabels} />
            ))}
            {list.visibleItems.length === 0 && (
              <tr>
                <td className={tables.empty} colSpan={6}>
                  {rows.length ? '没有符合当前条件的信源。' : '暂无登记信源或公开引用。'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

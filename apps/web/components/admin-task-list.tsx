'use client';

import { useId, useState, type ReactNode } from 'react';
import { filterAndSortTasks, type TaskSortDirection, type TaskSortValue } from '../lib/task-list';
import styles from './admin-task-table.module.css';

type SortControls = {
  sortKey: string;
  direction: TaskSortDirection;
  toggleSort: (key: string) => void;
};
type ListControls = SortControls & {
  query: string;
  setQuery: (query: string) => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  reset: () => void;
};

export function useTaskList<T>({
  items,
  searchText,
  statusValue,
  sortValues,
  initialSort = 'created',
  initialDirection = 'desc',
}: {
  items: readonly T[];
  searchText: (item: T) => string;
  statusValue: (item: T) => string | readonly string[];
  sortValues: Record<string, (item: T) => TaskSortValue>;
  initialSort?: string;
  initialDirection?: TaskSortDirection;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState({ key: initialSort, direction: initialDirection });
  const visibleItems = filterAndSortTasks(items, {
    query,
    status: statusFilter,
    searchText,
    statusValue,
    sortValue: sortValues[sort.key] ?? (() => null),
    direction: sort.direction,
  });
  return {
    visibleItems,
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    sortKey: sort.key,
    direction: sort.direction,
    toggleSort(key: string) {
      if (!Object.hasOwn(sortValues, key)) return;
      setSort((current) => ({
        key,
        direction: current.key === key ? (current.direction === 'asc' ? 'desc' : 'asc') : 'asc',
      }));
    },
    reset() {
      setQuery('');
      setStatusFilter('all');
      setSort({ key: initialSort, direction: initialDirection });
    },
  };
}

export function TaskListToolbar({
  label,
  list,
  statuses,
  shown,
  total,
  countLabel,
}: {
  label: string;
  list: ListControls;
  statuses: readonly { value: string; label: string }[];
  shown: number;
  total: number;
  countLabel?: string;
}) {
  const id = useId();
  return (
    <div className={styles.toolbar} role="group" aria-label={`${label}筛选`}>
      <label className={styles.searchField} htmlFor={`${id}-search`}>
        搜索{label}
        <input
          id={`${id}-search`}
          type="search"
          placeholder="名称、ID 或关键词"
          value={list.query}
          onChange={(event) => list.setQuery(event.target.value)}
        />
      </label>
      <label className={styles.statusField} htmlFor={`${id}-status`}>
        {label}状态
        <select
          id={`${id}-status`}
          aria-label={`${label}状态`}
          value={list.statusFilter}
          onChange={(event) => list.setStatusFilter(event.target.value)}
        >
          <option value="all">全部状态</option>
          {statuses.map((status) => (
            <option key={status.value} value={status.value}>
              {status.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className={styles.resetButton} onClick={list.reset}>
        重置筛选与排序
      </button>
      <span className={styles.count} role="status" aria-live="polite" aria-atomic="true">
        {countLabel ?? `显示 ${shown} / ${total} 条已加载记录`}
      </span>
    </div>
  );
}

export function TaskSortHeader({
  sortKey,
  list,
  children,
}: {
  sortKey: string;
  list: SortControls;
  children: ReactNode;
}) {
  const active = list.sortKey === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (list.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className={styles.sortButton} onClick={() => list.toggleSort(sortKey)}>
        {children}
        <span aria-hidden="true" className={styles.sortIcon}>
          {active ? (list.direction === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

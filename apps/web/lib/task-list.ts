export type TaskSortValue = string | number | null | undefined;
export type TaskSortDirection = 'asc' | 'desc';

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-CN');
const missing = (value: TaskSortValue) =>
  value == null || value === '' || (typeof value === 'number' && !Number.isFinite(value));

/** A local view of the supplied records; never mutates or fetches task data. */
export function filterAndSortTasks<T>(
  items: readonly T[],
  options: {
    query: string;
    status: string;
    searchText: (item: T) => string;
    statusValue: (item: T) => string | readonly string[];
    sortValue: (item: T) => TaskSortValue;
    direction: TaskSortDirection;
  },
): T[] {
  const terms = normalize(options.query).trim().split(/\s+/).filter(Boolean);
  const filtered = items.filter((item) => {
    if (options.status !== 'all') {
      const statuses = options.statusValue(item);
      if (
        typeof statuses === 'string'
          ? statuses !== options.status
          : !statuses.includes(options.status)
      )
        return false;
    }
    const text = normalize(options.searchText(item));
    return terms.every((term) => text.includes(term));
  });
  return filtered.sort((left, right) => {
    const a = options.sortValue(left);
    const b = options.sortValue(right);
    // Unknown cost/time stays last in both directions, rather than pretending to be zero.
    if (missing(a)) return missing(b) ? 0 : 1;
    if (missing(b)) return -1;
    const comparison =
      typeof a === 'number' && typeof b === 'number'
        ? a - b
        : collator.compare(String(a), String(b));
    return options.direction === 'asc' ? comparison : -comparison;
  });
}

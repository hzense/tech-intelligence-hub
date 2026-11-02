/** Render only a complete, internally consistent budget snapshot from task details. */
export function discoveryBudgetItems(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const field = (key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
  if (field('version') !== 1) return [];
  const keys = [
    'estimatedMicrousd',
    'batchLimitMicrousd',
    'dailyLimitMicrousd',
    'dailyUsedMicrousd',
    'dailyRemainingMicrousd',
  ] as const;
  const values = keys.map(field);
  if (
    !values.every(
      (entry): entry is number =>
        typeof entry === 'number' && Number.isSafeInteger(entry) && entry >= 0,
    )
  )
    return [];
  const [estimated, batch, daily, used, remaining] = values as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (
    estimated < 1 ||
    batch < 1 ||
    batch > daily ||
    daily > 50_000_000 ||
    remaining !== Math.max(0, daily - used)
  )
    return [];
  const money = (microusd: number) => `$${(microusd / 1_000_000).toFixed(6)}`;
  return [
    `本次采集预估：${money(estimated)}`,
    `单次预算上限：${money(batch)}`,
    `当日预算上限：${money(daily)}`,
    `当时已记账或占用：${money(used)}`,
    `当时可用余额：${money(remaining)}`,
  ];
}

export function assertAutomationRole(
  client: { query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }> },
  role?: 'admin' | 'reader',
): Promise<void>;

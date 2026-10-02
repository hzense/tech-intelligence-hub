type AutomationRoleClient = {
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
};
export function automationConfigDeletionAvailable(client: AutomationRoleClient): Promise<boolean>;
export function assertAutomationRole(
  client: AutomationRoleClient,
  role?: 'admin' | 'reader',
): Promise<{ canDelete: boolean }>;

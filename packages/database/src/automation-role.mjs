import { assertRestrictedApplicationRole } from './editorial-signal-role.mjs';
import { AutomationError } from './automation-contract.mjs';
export const automationRoleColumns = {
  automation_configs: [
    'id',
    'owner_id',
    'revision',
    'config',
    'enabled',
    'next_run_at',
    'created_at',
    'updated_at',
  ],
  automation_runs: [
    'id',
    'config_id',
    'owner_id',
    'config_revision',
    'snapshot',
    'slot',
    'trigger',
    'status',
    'phase',
    'result',
    'frozen_inputs',
    'error_code',
    'lease_token',
    'lease_until',
    'budget_day',
    'reserved_microusd',
    'charged_microusd',
    'cost_source',
    'publication_status',
    'published_at',
    'created_at',
    'started_at',
    'finished_at',
  ],
};
export const automationUpdateColumns = {
  automation_configs: ['revision', 'config', 'enabled', 'next_run_at', 'updated_at'],
  automation_runs: [
    'status',
    'phase',
    'result',
    'frozen_inputs',
    'error_code',
    'lease_token',
    'lease_until',
    'budget_day',
    'reserved_microusd',
    'charged_microusd',
    'cost_source',
    'publication_status',
    'published_at',
    'started_at',
    'finished_at',
  ],
};
export async function assertAutomationRole(client, role = 'admin') {
  if (!['admin', 'reader'].includes(role)) throw new AutomationError('automation_role_invalid');
  const capabilities =
    role === 'reader'
      ? ['id', 'result', 'published_at'].map(
          (column) => `published_topic_insights|${column}|SELECT`,
        )
      : Object.entries(automationRoleColumns).flatMap(([table, columns]) =>
          columns.flatMap((column) => [
            `${table}|${column}|SELECT`,
            `${table}|${column}|INSERT`,
            ...(automationUpdateColumns[table].includes(column)
              ? [`${table}|${column}|UPDATE`]
              : []),
          ]),
        );
  try {
    await assertRestrictedApplicationRole(
      client,
      role === 'reader' ? 'hzense_insight_reader' : 'hzense_automation_admin',
      capabilities,
    );
  } catch {
    throw new AutomationError('automation_role_invalid');
  }
}

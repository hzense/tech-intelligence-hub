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
// Frozen 0026 dictionaries above are also used by historical provisioning
// evidence. Soft deletion adds only these two capabilities, never INSERT.
export const automationDeletionCapabilities = [
  'automation_configs|deleted_at|SELECT',
  'automation_configs|deleted_at|UPDATE',
];

export async function automationConfigDeletionAvailable(client) {
  const result = await client.query(`SELECT c.relkind='r'
    AND a.atttypid='pg_catalog.timestamptz'::regtype
    AND NOT a.attnotnull AND NOT a.atthasdef
    AND a.attgenerated='' AND a.attidentity='' AS safe
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='automation_configs'
      AND a.attname='deleted_at' AND a.attnum>0 AND NOT a.attisdropped`);
  if (result.rows.length === 0) return false;
  if (result.rows.length !== 1 || result.rows[0].safe !== true)
    throw new AutomationError('automation_role_invalid');
  return true;
}

export async function assertAutomationRole(client, role = 'admin') {
  if (!['admin', 'reader'].includes(role)) throw new AutomationError('automation_role_invalid');
  const canDelete = role === 'admin' && (await automationConfigDeletionAvailable(client));
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
  if (canDelete) capabilities.push(...automationDeletionCapabilities);
  try {
    await assertRestrictedApplicationRole(
      client,
      role === 'reader' ? 'hzense_insight_reader' : 'hzense_automation_admin',
      capabilities,
    );
  } catch {
    throw new AutomationError('automation_role_invalid');
  }
  return { canDelete };
}

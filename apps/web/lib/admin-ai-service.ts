import {
  createAiConnection,
  updateAiConnection,
  listAiConnections,
  getAiConnectionHistory,
  saveAiProfile,
  listAiProfiles,
  getAiProfileHistory,
  runAiProbe,
  getAiProbe,
  listAiProbes,
  type AiKeyring,
  type AiAllowedHosts,
  type AiProbeInvoker,
} from '../../../packages/database/src/ai-config-store.mjs';
import type { AiAdminOperation } from './admin-ai-core.ts';

/** Trusted server-owned dependencies only, never accepted from an HTTP payload.
 * The same command dispatcher is exercised by the isolated HTTP/PG fixture.
 * Production authentication and environment validation remain at their original boundary.
 */
export function createAiAdminExecutor(dependencies: {
  pool: unknown;
  keyring: AiKeyring;
  allowedHosts: AiAllowedHosts;
  invoke: AiProbeInvoker;
  /** Local mock mode permits keyless connection drafts and disables provider probes. */
  localConfigurationDrafts?: boolean;
  /** Local profile persistence only; does not change connection, probe or execution admission. */
  localProfileDrafts?: boolean;
}) {
  return async (
    operation: AiAdminOperation,
    command: Record<string, unknown>,
  ): Promise<unknown> => {
    const input = {
      pool: dependencies.pool,
      request: command,
      keyring: dependencies.keyring,
      allowedHosts: dependencies.allowedHosts,
      localConfigurationDrafts: dependencies.localConfigurationDrafts === true,
    };
    switch (operation) {
      case 'list-connections':
        return { connections: await listAiConnections(input) };
      case 'create-connection':
        return { connection: await createAiConnection(input) };
      case 'update-connection':
        return { connection: await updateAiConnection(input) };
      case 'connection-history':
        return { history: await getAiConnectionHistory({ ...input, id: String(command.id) }) };
      case 'list-profiles':
        return { profiles: await listAiProfiles(input) };
      case 'save-profile':
        return {
          profile: await saveAiProfile({
            ...input,
            localConfigurationDrafts:
              dependencies.localConfigurationDrafts === true ||
              dependencies.localProfileDrafts === true,
          }),
        };
      case 'profile-history':
        return { history: await getAiProfileHistory({ ...input, id: String(command.id) }) };
      case 'list-probes':
        return { probes: await listAiProbes(input) };
      case 'get-probe':
        return { probe: await getAiProbe({ ...input, id: String(command.id) }) };
      case 'run-probe':
        if (dependencies.localConfigurationDrafts === true)
          throw Object.assign(new Error('local_provider_disabled'), {
            code: 'local_provider_disabled',
          });
        return { probe: await runAiProbe({ ...input, invoke: dependencies.invoke }) };
    }
  };
}

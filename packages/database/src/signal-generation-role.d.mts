export const signalGenerationRoleColumns: Record<'SELECT' | 'INSERT' | 'UPDATE', readonly string[]>;
export function assertGenerationRole(client: {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}): Promise<void>;

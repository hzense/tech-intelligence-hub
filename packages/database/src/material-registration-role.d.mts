export const materialRoleColumns: Record<string, Record<string, Record<string, string[]>>>;
export function materialRoleCheckSQL(
  role: string,
  options?: { session?: boolean; proposals?: boolean },
): string;
export function assertMaterialRole(
  client: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> },
  role: string,
  options?: { proposals?: boolean },
): Promise<void>;
export function materialRoleProvisionSQL(): string;
export function materialProposalRoleProvisionSQL(): string;

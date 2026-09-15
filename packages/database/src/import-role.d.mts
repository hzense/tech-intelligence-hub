export const importRoleCheckSQL: string;
export function assertImportRole(client: {
  query(sql: string): Promise<{ rows: { safe?: boolean }[] }>;
}): Promise<void>;

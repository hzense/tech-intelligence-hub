import type { Metadata } from 'next';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { importConfigurationDiagnostics } from '@/lib/server/import-service';
import { importConfigurationMessages } from '@/lib/import-config';
import { AdminImports } from '@/components/admin-imports';
export const metadata: Metadata = { title: '批量导入', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function ImportsPage() {
  await requireAdminSession();
  const diagnostics = importConfigurationDiagnostics();
  return (
    <AdminImports
      configured={diagnostics.ready}
      diagnostics={{
        enabled: diagnostics.enabled,
        valid: diagnostics.valid,
        issues: diagnostics.issues.map((code) => `${importConfigurationMessages[code]}（${code}）`),
      }}
    />
  );
}

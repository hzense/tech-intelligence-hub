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
    <>
      <section className="section-shell" aria-label="导入配置诊断">
        <h2>导入配置诊断</h2>
        <p>导入开关：{diagnostics.enabled ? '开启' : '关闭'}</p>
        <p>配置校验：{diagnostics.valid ? '通过' : '未通过'}</p>
        <p>此检查不连接数据库、不读取原件、不调用 AI；通过不代表真实认证、权限及解析验收已通过。</p>
        <ul>
          {diagnostics.issues.map((code) => (
            <li key={code}>
              {importConfigurationMessages[code]}（{code}）
            </li>
          ))}
        </ul>
      </section>
      <AdminImports configured={diagnostics.ready} />
    </>
  );
}

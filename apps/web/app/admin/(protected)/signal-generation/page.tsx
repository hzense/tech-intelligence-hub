import type { Metadata } from 'next';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { generationConfigured, generationHistoryConfigured } from '@/lib/server/signal-generation';
import { AdminSignalGeneration } from '@/components/admin-signal-generation';
export const metadata: Metadata = {
  title: 'AI 信号候选生成',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export default async function SignalGenerationPage() {
  await requireAdminSession();
  return (
    <AdminSignalGeneration
      configured={generationConfigured()}
      historyConfigured={generationHistoryConfigured()}
    />
  );
}

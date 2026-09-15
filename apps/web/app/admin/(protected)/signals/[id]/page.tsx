import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AdminSignalWorkbenchDetail } from '@/components/admin-signal-workbench';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { getSignalWorkbenchDetailState } from '@/lib/server/admin-signal-workbench';
import { signalWorkbenchSearchParams } from '@/lib/admin-signal-workbench-core';

export const metadata: Metadata = {
  title: '信号版本详情',
  robots: { index: false, follow: false },
};

export default async function AdminSignalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  const [{ id }, values] = await Promise.all([params, searchParams]);
  const state = await getSignalWorkbenchDetailState(id, signalWorkbenchSearchParams(values));
  if (state.status === 'not_found') notFound();
  return (
    <AdminSignalWorkbenchDetail
      state={state}
      publicReadEnabled={process.env.HZENSE_SIGNAL_READ_MODE === 'database'}
    />
  );
}

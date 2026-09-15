import type { Metadata } from 'next';
import { AdminSignalWorkbenchList } from '@/components/admin-signal-workbench';
import { requireAdminSession } from '@/lib/server/admin-auth';
import { getSignalWorkbenchList } from '@/lib/server/admin-signal-workbench';
import { signalWorkbenchSearchParams } from '@/lib/admin-signal-workbench-core';

export const metadata: Metadata = {
  title: '信号只读工作台',
  robots: { index: false, follow: false },
};

export default async function AdminSignalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminSession();
  const params = signalWorkbenchSearchParams(await searchParams);
  const state = await getSignalWorkbenchList(params);
  return (
    <AdminSignalWorkbenchList
      state={state}
      query={state.status === 'ready' ? (params.get('q') ?? '') : ''}
      after={state.status === 'ready' ? (params.get('after') ?? '') : ''}
      publicReadEnabled={process.env.HZENSE_SIGNAL_READ_MODE === 'database'}
    />
  );
}

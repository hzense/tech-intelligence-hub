import { AdminSignalWorkbenchDetail } from '@/components/admin-signal-workbench';

export default function SignalNotFound() {
  return (
    <AdminSignalWorkbenchDetail
      state={{ status: 'not_found' }}
      publicReadEnabled={process.env.HZENSE_SIGNAL_READ_MODE === 'database'}
    />
  );
}

import { handleSignalWorkbench } from '@/lib/server/admin-signal-workbench-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleSignalWorkbench(request, 'detail', id);
}

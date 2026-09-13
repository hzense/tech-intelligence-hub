import { handleAiAdmin } from '@/lib/server/admin-ai-handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleAiAdmin(request, 'get-probe', (await params).id);
}

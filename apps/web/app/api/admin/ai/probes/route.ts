import { handleAiAdmin } from '@/lib/server/admin-ai-handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  return handleAiAdmin(request, 'list-probes');
}
export async function POST(request: Request) {
  return handleAiAdmin(request, 'run-probe');
}

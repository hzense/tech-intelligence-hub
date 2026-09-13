import { handleAiAdmin } from '@/lib/server/admin-ai-handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handleAiAdmin(request, 'list-profiles');
}
export async function POST(request: Request) {
  return handleAiAdmin(request, 'save-profile');
}

import { handleAiAdmin } from '@/lib/server/admin-ai-handler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handleAiAdmin(request, 'list-connections');
}
export async function POST(request: Request) {
  return handleAiAdmin(request, 'create-connection');
}
export async function PATCH(request: Request) {
  return handleAiAdmin(request, 'update-connection');
}

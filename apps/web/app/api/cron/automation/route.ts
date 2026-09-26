import { dispatchDueAutomations } from '@/lib/server/automation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  const token = process.env.CRON_SECRET;
  if (!token || token.length < 24 || request.headers.get('authorization') !== `Bearer ${token}`)
    return new Response(null, { status: 401 });
  try {
    const result = await dispatchDueAutomations();
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json(
      { error: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}

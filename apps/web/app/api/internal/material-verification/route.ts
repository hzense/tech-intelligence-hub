import { createMaterialWorkerHandler } from '@/lib/material-worker-handler';
import {
  materialWorkerInbox,
  materialWorkerRequest,
  acceptMaterialReport,
} from '@/lib/server/material-registration';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const GET = createMaterialWorkerHandler({
  token: () => process.env.HZENSE_MATERIAL_WORKER_TOKEN,
  inbox: materialWorkerInbox,
  read: materialWorkerRequest,
  accept: acceptMaterialReport,
});
export const POST = GET;

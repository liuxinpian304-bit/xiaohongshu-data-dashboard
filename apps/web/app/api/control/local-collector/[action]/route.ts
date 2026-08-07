import { authenticatedGet, forwardMutation } from '../../../../../lib/bff';

const allowedPost = new Set(['start', 'refresh', 'close', 'sync']);
const allowedGet = new Set(['status', 'sync-status']);

export async function GET(_request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!allowedGet.has(action)) return Response.json({ error: 'not found' }, { status: 404 });
  return authenticatedGet(`/local-collector/${action}`);
}

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!allowedPost.has(action)) return Response.json({ error: 'not found' }, { status: 404 });
  return forwardMutation(request, `/local-collector/${action}`, 'POST', action === 'sync' ? ['accountId'] : [], 256);
}

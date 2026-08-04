import { authenticatedGet, forwardMutation } from '../../../../../lib/bff';

const allowed = new Set(['start', 'status', 'confirm', 'close']);

export async function GET(_request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (action !== 'status') return Response.json({ error: 'not found' }, { status: 404 });
  return authenticatedGet('/local-collector/status');
}

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!allowed.has(action) || action === 'status') return Response.json({ error: 'not found' }, { status: 404 });
  return forwardMutation(request, `/local-collector/${action}`, 'POST', [], 256);
}

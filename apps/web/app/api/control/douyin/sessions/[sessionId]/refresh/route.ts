import { forwardMutation } from '../../../../../../../lib/bff';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!uuid.test(sessionId)) return Response.json({ error: 'not found' }, { status: 404 });
  return forwardMutation(request, `/douyin-local/sessions/${sessionId}/refresh`, 'POST', [], 64);
}

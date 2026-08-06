import { authenticatedGet } from '../../../lib/bff';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams; const noteId = input.get('noteId'); const cursor = input.get('cursor'); const limit = input.get('limit') ?? '200';
  if (!noteId || !uuid.test(noteId) || !/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 200 || (cursor !== null && (cursor.length < 1 || cursor.length > 200)) || [...input.keys()].some((key) => !['noteId', 'cursor', 'limit'].includes(key))) return Response.json({ error: 'invalid filter' }, { status: 400 });
  const output = new URLSearchParams({ noteId, limit }); if (cursor) output.set('cursor', cursor);
  const upstream = await authenticatedGet(`/comments?${output}`);
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' } });
}

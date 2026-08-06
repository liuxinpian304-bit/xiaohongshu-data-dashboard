import { authenticatedGet } from '../../../../lib/bff';

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams; const output = new URLSearchParams();
  for (const [key, value] of input) { if (key !== 'accountId' || !/^[0-9a-f-]{36}$/i.test(value)) return Response.json({ error: 'invalid filter' }, { status: 400 }); output.set(key, value); }
  const upstream = await authenticatedGet(`/notes/export.zip?${output}`);
  return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'content-disposition': upstream.headers.get('content-disposition') ?? '' } });
}

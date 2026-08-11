import { authenticatedGet } from '../../../../../../../lib/bff';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await context.params;
  if (!uuid.test(sessionId)) return Response.json({ error: 'not found' }, { status: 404 });
  const upstream = await authenticatedGet(`/douyin-local/sessions/${sessionId}/qr`);
  if (!upstream.ok) return upstream;
  if (upstream.headers.get('content-type') !== 'image/png') return Response.json({ error: '二维码响应无效' }, { status: 502 });
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength > 1024 * 1024 || bytes.byteLength < 8 || !Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return Response.json({ error: '二维码响应无效' }, { status: 502 });
  return new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.byteLength), 'cache-control': 'private, no-store, max-age=0', 'x-content-type-options': 'nosniff' } });
}

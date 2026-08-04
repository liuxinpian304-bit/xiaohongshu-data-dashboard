import { authenticatedGet } from '../../../../../lib/bff';

export async function GET() {
  const upstream = await authenticatedGet('/local-collector/qr');
  if (!upstream.ok) return upstream;
  if (upstream.headers.get('content-type') !== 'image/png') return Response.json({ error: '二维码响应无效' }, { status: 502 });
  const declared = Number(upstream.headers.get('content-length') ?? 0);
  if (declared > 1024 * 1024) return Response.json({ error: '二维码响应过大' }, { status: 502 });
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength > 1024 * 1024 || bytes.byteLength < 4 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return Response.json({ error: '二维码响应无效' }, { status: 502 });
  }
  const headers = new Headers({
    'content-type': 'image/png',
    'content-length': String(bytes.byteLength),
    'cache-control': 'private, no-store, max-age=0',
    'x-content-type-options': 'nosniff',
  });
  const etag = upstream.headers.get('etag'); const expires = upstream.headers.get('expires');
  if (etag) headers.set('etag', etag);
  if (expires) headers.set('expires', expires);
  return new Response(bytes, { status: 200, headers });
}

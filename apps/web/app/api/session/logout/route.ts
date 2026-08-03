import { NextResponse } from 'next/server'; import { forwardMutation } from '../../../../lib/bff';
export async function POST(request: Request) { const upstream = await forwardMutation(request, '/auth/logout'); const response = NextResponse.json({ ok: upstream.ok }, { status: upstream.status }); response.cookies.delete('admin_session'); response.cookies.delete('web_csrf'); return response; }

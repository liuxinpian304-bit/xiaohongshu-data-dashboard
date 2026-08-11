import { authenticatedGet, forwardMutation } from '../../../../../lib/bff';

export async function GET() { return authenticatedGet('/douyin-local/sessions'); }
export async function POST(request: Request) { return forwardMutation(request, '/douyin-local/sessions', 'POST', [], 64); }

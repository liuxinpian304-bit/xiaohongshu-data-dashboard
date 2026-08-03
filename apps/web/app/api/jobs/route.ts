import { forwardMutation } from '../../../lib/bff'; export async function POST(request: Request) { return forwardMutation(request, '/jobs','POST',['accountId']); }

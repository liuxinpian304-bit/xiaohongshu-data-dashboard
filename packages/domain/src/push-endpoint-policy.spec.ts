import { describe, expect, it } from 'vitest';
import { PushEndpointPolicy } from './push-endpoint-policy';

describe('PushEndpointPolicy', () => {
  it.each(['fe90::1', '::ffff:127.0.0.1', '::', '::1', 'fc00::1', 'fd12::1', '10.0.0.1', '169.254.1.1'])('rejects non-public destination %s', async (address) => {
    const policy = new PushEndpointPolicy(['push.example.test'], async () => [address]);
    await expect(policy.resolveAndPin('https://push.example.test/sub')).rejects.toThrow('public');
  });

  it('pins the validated public address without resolving again in the HTTPS agent', async () => {
    let resolutions = 0;
    const policy = new PushEndpointPolicy(['push.example.test'], async () => {
      resolutions += 1;
      return resolutions === 1 ? ['8.8.8.8'] : ['127.0.0.1'];
    });
    const pinned = await policy.resolveAndPin('https://push.example.test/sub');
    const lookup = pinned.agent.options.lookup!;
    const result = await new Promise<{ address: string; family: number }>((resolve, reject) => lookup('push.example.test', {}, (error, address, family) => error ? reject(error) : resolve({ address: String(address), family: Number(family) })));
    expect(result).toEqual({ address: '8.8.8.8', family: 4 });
    expect(resolutions).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { request as httpsRequest, type RequestOptions } from 'node:https';
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

  it('implements Node lookup all and family selection contracts from one pinned resolution', async () => {
    let resolutions = 0;
    const policy = new PushEndpointPolicy(['push.example.test'], async () => {
      resolutions += 1;
      return ['8.8.8.8', '2001:4860:4860::8888'];
    });
    const pinned = await policy.resolveAndPin('https://push.example.test/sub');
    const lookup = pinned.agent.options.lookup!;

    expect(await lookupAll(lookup)).toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ]);
    expect(await lookupAll(lookup, 4)).toEqual([{ address: '8.8.8.8', family: 4 }]);
    expect(await lookupAll(lookup, 6)).toEqual([{ address: '2001:4860:4860::8888', family: 6 }]);
    expect(await lookupOne(lookup, 0)).toEqual({ address: '8.8.8.8', family: 4 });
    expect(await lookupOne(lookup, 4)).toEqual({ address: '8.8.8.8', family: 4 });
    expect(await lookupOne(lookup, 6)).toEqual({ address: '2001:4860:4860::8888', family: 6 });
    expect(pinned.url.hostname).toBe('push.example.test');
    expect(resolutions).toBe(1);
  });

  it('fails lookup instead of returning an address from the wrong requested family', async () => {
    const pinned = await new PushEndpointPolicy(['push.example.test'], async () => ['8.8.8.8']).resolveAndPin('https://push.example.test/sub');
    await expect(lookupOne(pinned.agent.options.lookup!, 6)).rejects.toThrow('family 6');
    await expect(lookupAll(pinned.agent.options.lookup!, 6)).rejects.toThrow('family 6');
  });

  it('supports the real HTTPS auto-family lookup path while preserving the original TLS hostname', async () => {
    let resolutions = 0;
    const pinned = await new PushEndpointPolicy(['push.example.test'], async () => { resolutions += 1; return ['8.8.8.8', '2001:4860:4860::8888']; })
      .resolveAndPin('https://push.example.test/sub');
    await new Promise<void>((resolve, reject) => {
      const options = { agent: pinned.agent, autoSelectFamily: true, servername: pinned.url.hostname } as RequestOptions & { autoSelectFamily: boolean };
      const request = httpsRequest(pinned.url, options);
      request.once('error', (error) => (error as NodeJS.ErrnoException).code === 'ERR_INVALID_IP_ADDRESS' ? reject(error) : resolve());
      request.setTimeout(500, () => request.destroy(new Error('expected network stop after successful pinned lookup')));
      request.end();
    });
    expect(pinned.url.hostname).toBe('push.example.test');
    expect(resolutions).toBe(1);
  });
});

type Lookup = NonNullable<import('node:https').AgentOptions['lookup']>;
function lookupAll(lookup: Lookup, family: 0 | 4 | 6 = 0) {
  return new Promise<Array<{ address: string; family: number }>>((resolve, reject) => lookup('push.example.test', { all: true, family }, (error, addresses) => error ? reject(error) : resolve(addresses as Array<{ address: string; family: number }>)));
}
function lookupOne(lookup: Lookup, family: 0 | 4 | 6) {
  return new Promise<{ address: string; family: number }>((resolve, reject) => lookup('push.example.test', { family }, (error, address, resolvedFamily) => error ? reject(error) : resolve({ address: String(address), family: Number(resolvedFamily) })));
}

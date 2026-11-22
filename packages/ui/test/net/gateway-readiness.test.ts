// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useGatewayReadiness } from '../../src/net/gateway-readiness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

it('moves from loading to ready after a retry reaches the gateway', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new Error('connection refused'))
    .mockResolvedValueOnce(response(200, { protocol: 4, ok: true, format: 'commander', ready: true }));
  vi.stubGlobal('fetch', fetch);
  const rendered = renderHook(() => useGatewayReadiness('commander'));

  await waitFor(() => expect(rendered.result.current.status).toBe('loading'));
  act(() => {
    if (rendered.result.current.status === 'loading') rendered.result.current.retry();
  });
  await waitFor(() => expect(rendered.result.current.status).toBe('ready'));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenLastCalledWith(
    '/engine-api/readiness?format=commander',
    expect.objectContaining({ signal: expect.any(AbortSignal) as AbortSignal }),
  );
});

it('treats a gateway without the readiness route as unknown', async () => {
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(404, {})));
  const rendered = renderHook(() => useGatewayReadiness('commander'));
  await waitFor(() => expect(rendered.result.current).toEqual({ status: 'unknown' }));
});

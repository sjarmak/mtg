// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { DEFAULT_ADVISOR_WEIGHTS, advisorModelIdentityText } from '@mtg/draft-export';
import { loadAdvisorCalibration, useAdvisorCalibration } from '../../src/routes/legacy-cube/calibration';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const catalogSha256 = 'a'.repeat(64);
const body = {
  version: 'legacy-cube-advisor-calibration/v1',
  identity: { catalogSha256, modelSha256: hash(advisorModelIdentityText()) },
  weights: { ...DEFAULT_ADVISOR_WEIGHTS, revision: 'trial/v1', synergy: 1.25 },
  provenance: {
    status: 'provisional',
    transitionSha256: 'c'.repeat(64),
    decisionSha256: 'd'.repeat(64),
    runtimeSha256: 'e'.repeat(64),
    independentHumanValidation: false,
    botValidated: false,
  },
};
function response(input: unknown, status = 200, type = 'application/json') {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status,
      ok: status === 200,
      headers: { get: () => type },
      json: async () => input,
    }),
  );
}

it('loads the same portable snapshot produced offline', async () => {
  response({ ...body, sha256: hash(JSON.stringify(body)) });
  const loaded = await loadAdvisorCalibration('advisor.json', catalogSha256);
  expect(loaded).toMatchObject({ status: 'ready', snapshot: { weights: body.weights } });
});

it('distinguishes an absent file from unavailable or invalid calibration', async () => {
  response(null, 404);
  expect(await loadAdvisorCalibration('advisor.json', catalogSha256)).toEqual({ status: 'absent' });
  response(null, 200, 'text/html');
  expect(await loadAdvisorCalibration('advisor.json', catalogSha256)).toEqual({ status: 'absent' });
  response(null, 503);
  expect(await loadAdvisorCalibration('advisor.json', catalogSha256)).toMatchObject({ status: 'failed' });
  response({ ...body, sha256: 'f'.repeat(64) });
  expect(await loadAdvisorCalibration('advisor.json', catalogSha256)).toMatchObject({
    status: 'failed',
    message: expect.stringContaining('checksum'),
  });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  expect(await loadAdvisorCalibration('advisor.json', catalogSha256)).toMatchObject({
    status: 'failed',
    message: 'offline',
  });
});

it('loads once across rerenders and does not expose the old snapshot under a new catalog', async () => {
  response({ ...body, sha256: hash(JSON.stringify(body)) });
  const reader = renderHook(({ catalog }) => useAdvisorCalibration('advisor.json', catalog), {
    initialProps: { catalog: catalogSha256 },
  });
  await waitFor(() => expect(reader.result.current.status).toBe('ready'));
  reader.rerender({ catalog: catalogSha256 });
  expect(fetch).toHaveBeenCalledTimes(1);
  reader.rerender({ catalog: 'f'.repeat(64) });
  expect(reader.result.current.status).toBe('loading');
  await waitFor(() => expect(reader.result.current.status).toBe('failed'));
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not request an optional absent snapshot or load before the catalog is ready', () => {
  response(null);
  const absent = renderHook(() => useAdvisorCalibration(undefined, catalogSha256));
  expect(absent.result.current.status).toBe('absent');
  const pending = renderHook(() => useAdvisorCalibration('advisor.json', undefined));
  expect(pending.result.current.status).toBe('loading');
  expect(fetch).not.toHaveBeenCalled();
});

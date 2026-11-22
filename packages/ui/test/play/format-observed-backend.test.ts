import { expect, it, vi } from 'vitest';
import type { ObservedBackend, SessionSpec } from '@mtg/engine';
import { routeBackend } from '@mtg/engine';
import { formatObservedBackend } from '../../tools/format-observed-backend';

const table = (format: string): SessionSpec => ({
  content: { kind: 'printed', format },
  seats: [
    { name: 'You', controller: 'local', deck: { name: 'You', cards: [{ name: 'Plains', count: 40 }] } },
    { name: 'Bot', controller: 'engine', deck: { name: 'Bot', cards: [{ name: 'Island', count: 40 }] } },
  ],
  seed: 'format-dispatch/v1',
  maximumTurns: 100,
});

function backend() {
  return {
    id: 'forge-2.0.14',
    determinism: 'observed' as const,
    capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
    supports: vi.fn(async () => [] as readonly string[]),
    open: vi.fn<ObservedBackend['open']>(async () => ({
      ok: false,
      error: { kind: 'backend-failure', message: 'test backend' },
    })),
    shutdown: vi.fn<NonNullable<ObservedBackend['shutdown']>>(async () => undefined),
  };
}

it('routes both support checks and opens to exactly one owner under one backend ID', async () => {
  const legacy = backend();
  const akh = backend();
  const dispatch = formatObservedBackend([
    { format: 'legacy-cube-2021-08', backend: legacy },
    { format: 'akh-hou', backend: akh },
  ]);
  for (const format of ['legacy-cube-2021-08', 'akh-hou']) {
    expect(
      await routeBackend(table(format), [dispatch], {
        generated: 'kernel',
        printed: { [format]: dispatch.id },
      }),
    ).toEqual({ ok: true, backend: dispatch });
    const result = await dispatch.open(table(format));
    expect(result).toEqual({ ok: false, error: { kind: 'backend-failure', message: 'test backend' } });
  }
  expect(legacy.supports).toHaveBeenCalledExactlyOnceWith(table('legacy-cube-2021-08'));
  expect(akh.supports).toHaveBeenCalledExactlyOnceWith(table('akh-hou'));
  expect(legacy.open).toHaveBeenCalledExactlyOnceWith(table('legacy-cube-2021-08'));
  expect(akh.open).toHaveBeenCalledExactlyOnceWith(table('akh-hou'));
  await dispatch.shutdown?.();
});

it('never probes an alternative when the selected owner refuses or throws', async () => {
  const legacy = backend();
  const akh = backend();
  akh.supports.mockResolvedValue(['unreviewed card']);
  akh.open.mockRejectedValue(new Error('unsupported decision'));
  const dispatch = formatObservedBackend([
    { format: 'legacy', backend: legacy },
    { format: 'akh-hou', backend: akh },
  ]);
  expect(await dispatch.supports(table('akh-hou'))).toEqual(['unreviewed card']);
  await expect(dispatch.open(table('akh-hou'))).rejects.toThrow('unsupported decision');
  expect(legacy.supports).not.toHaveBeenCalled();
  expect(legacy.open).not.toHaveBeenCalled();
  await dispatch.shutdown?.();
});

it('refuses unknown formats and generated content before touching a child', async () => {
  const child = backend();
  const dispatch = formatObservedBackend([{ format: 'akh-hou', backend: child }]);
  for (const input of [
    table('unknown'),
    table('__proto__'),
    {
      ...table('akh-hou'),
      content: { kind: 'dsl-set' as const, setCode: 'akh-hou' },
    },
  ]) {
    expect(await dispatch.supports(input)).toHaveLength(1);
    expect(await dispatch.open(input)).toMatchObject({ ok: false, error: { kind: 'content-unsupported' } });
  }
  expect(child.supports).not.toHaveBeenCalled();
  expect(child.open).not.toHaveBeenCalled();
  await dispatch.shutdown?.();
});

it('preserves mixed-content policy on the selected backend', async () => {
  const child = backend();
  const dispatch = formatObservedBackend([{ format: 'legacy', backend: child }]);
  const input = {
    ...table('legacy'),
    content: { kind: 'mixed' as const, format: 'legacy', customSetCodes: ['custom'] },
  };
  await dispatch.supports(input);
  await dispatch.open(input);
  expect(child.supports).toHaveBeenCalledWith(input);
  expect(child.open).toHaveBeenCalledWith(input);
  await dispatch.shutdown?.();
});

it('freezes its routing entries and closes a shared owner only once', async () => {
  const child = backend();
  const routes = [{ format: 'akh-hou', backend: child }];
  const dispatch = formatObservedBackend(routes);
  routes.splice(0, 1, { format: 'different', backend: backend() });
  await dispatch.open(table('akh-hou'));
  expect(child.open).toHaveBeenCalledTimes(1);
  await Promise.all([dispatch.shutdown?.(), dispatch.shutdown?.()]);
  expect(child.shutdown).toHaveBeenCalledTimes(1);
});

it('waits for every child shutdown, aggregates failures, and refuses new work immediately', async () => {
  const first = backend();
  const second = backend();
  let finish: () => void = () => undefined;
  first.shutdown.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  second.shutdown.mockRejectedValue(new Error('second cleanup failed'));
  const dispatch = formatObservedBackend([
    { format: 'legacy', backend: first },
    { format: 'akh-hou', backend: second },
    { format: 'another', backend: first },
  ]);
  const closing = dispatch.shutdown!();
  const rejected = expect(closing).rejects.toMatchObject({ errors: [new Error('second cleanup failed')] });
  expect(await dispatch.supports(table('akh-hou'))).toHaveLength(1);
  expect(await dispatch.open(table('legacy'))).toMatchObject({ ok: false });
  expect(first.open).not.toHaveBeenCalled();
  expect(second.supports).not.toHaveBeenCalled();
  finish();
  await rejected;
  await expect(dispatch.shutdown!()).rejects.toThrow('format backend shutdown failed');
  expect(first.shutdown).toHaveBeenCalledTimes(1);
  expect(second.shutdown).toHaveBeenCalledTimes(1);
});

it('rejects ambiguous routes, identities, and capability declarations before taking ownership', () => {
  const first = backend();
  expect(() => formatObservedBackend([])).toThrow('at least one');
  expect(() => formatObservedBackend([{ format: '', backend: first }])).toThrow('format');
  expect(() =>
    formatObservedBackend([
      { format: 'same', backend: first },
      { format: 'same', backend: backend() },
    ]),
  ).toThrow('duplicate');
  expect(() =>
    formatObservedBackend([
      { format: 'legacy', backend: first },
      { format: 'akh-hou', backend: { ...backend(), id: 'different' } },
    ]),
  ).toThrow('identity');
  expect(() =>
    formatObservedBackend([
      { format: 'legacy', backend: first },
      {
        format: 'akh-hou',
        backend: { ...backend(), capabilities: { ...first.capabilities, engineSeats: false } },
      },
    ]),
  ).toThrow('capabilities');
  expect(first.shutdown).not.toHaveBeenCalled();
});

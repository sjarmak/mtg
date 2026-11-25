import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservedBackend } from '@mtg/engine';
import { compileInstalledForgeBridge, installedForgeBackend } from '@mtg/forge-export';
import { serveBackendGateway, serveStartingBackendGateway } from '@mtg/netplay';
import {
  MISSING_EVIDENCE_REASON,
  RUNTIME_MISMATCH_REASON,
  readBackendPort,
  startBackendService,
} from '../../tools/backend-service';
import { admitPrintedBackends } from '../../tools/admitted-printed-backend';
import { bundleInstalledForgeAdapter } from '../../tools/installed-adapter-bundle';
import { discoverForgeHome } from '../../tools/forge-home';
import { LEGACY_CUBE_FORMAT } from '../../src/routes/legacy-cube/model';

vi.mock('@mtg/forge-export', () => ({
  compileInstalledForgeBridge: vi.fn(),
  installedForgeBackend: vi.fn(),
}));
vi.mock('@mtg/netplay', () => ({ serveBackendGateway: vi.fn(), serveStartingBackendGateway: vi.fn() }));
vi.mock('../../tools/admitted-printed-backend', () => ({ admitPrintedBackends: vi.fn() }));
vi.mock('../../tools/installed-adapter-bundle', () => ({
  bundleInstalledForgeAdapter: vi.fn(async () => '/adapter.mjs'),
}));
vi.mock('../../tools/forge-home', () => ({ discoverForgeHome: vi.fn(() => '/forge') }));

const dispose = vi.fn();
const shutdown = vi.fn(async () => undefined);
const close = vi.fn(async () => undefined);
const startingClose = vi.fn(async () => undefined);
const probe: ObservedBackend = {
  id: 'forge-2.0.14',
  determinism: 'observed',
  capabilities: { undo: false, fork: false, perSeatProjection: false, engineSeats: true },
  supports: async () => [],
  open: async () => {
    throw new Error('probe cannot open');
  },
  shutdown,
};
let exitListeners = 0;
let repoRoot: string;
beforeEach(() => {
  vi.resetAllMocks();
  repoRoot = mkdtempSync(join(tmpdir(), 'mtg-backend-service-test-'));
  exitListeners = process.listenerCount('exit');
  vi.mocked(compileInstalledForgeBridge).mockReturnValue({ classDirectory: '/classes', dispose });
  vi.mocked(installedForgeBackend).mockReturnValue(probe);
  vi.mocked(discoverForgeHome).mockReturnValue('/forge');
  vi.mocked(serveBackendGateway).mockResolvedValue({ port: 45750, host: '127.0.0.1', close });
  vi.mocked(serveStartingBackendGateway).mockResolvedValue({
    port: 45750,
    host: '127.0.0.1',
    close: startingClose,
  });
});
afterEach(() => {
  expect(process.listenerCount('exit')).toBe(exitListeners);
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('independent backend service', () => {
  const printedAdmission = {
    formatId: 'akh-hou',
    format: {},
    catalogs: [],
    evidence: null,
  };
  const subject = {
    formatId: 'akh-hou',
    formatSha256: 'a'.repeat(64),
    catalogs: { akh: 'b'.repeat(64) },
    forgeVersion: '2.0.14',
    forgeJarSha256: 'c'.repeat(64),
    scriptArchiveSha256: 'd'.repeat(64),
    bridgeSha256: 'e'.repeat(64),
    adapterSha256: 'f'.repeat(64),
    resourcesSha256: 'a'.repeat(64),
    protocolVersion: 1,
  };

  it('verifies requested admission before registering both exact formats under a single identity', async () => {
    const admittedShutdown = vi.fn(async () => undefined);
    const admitted = { ...probe, shutdown: admittedShutdown };
    vi.mocked(admitPrintedBackends).mockResolvedValue([{ admitted: true, subject, backend: admitted }]);
    const service = await startBackendService({
      repoRoot,
      port: 0,
      printedAdmissions: [printedAdmission],
    });
    expect(admitPrintedBackends).toHaveBeenCalledExactlyOnceWith({
      runtime: {
        forgeHome: '/forge',
        bridge: { kind: 'compiled', path: '/classes' },
        adapterBundlePath: '/adapter.mjs',
      },
      outputParent: expect.stringContaining('snapshots'),
      admissions: [printedAdmission],
    });
    expect(bundleInstalledForgeAdapter).toHaveBeenCalledTimes(1);
    const options = vi.mocked(serveBackendGateway).mock.calls[0]![0];
    expect(options.installed).toHaveLength(1);
    expect(options.routes.printed).toEqual({ 'legacy-cube-2021-08': probe.id, 'akh-hou': probe.id });
    expect(service.message).toContain('akh-hou');
    // The real gateway owns backend shutdown; this fixture invokes that boundary.
    await options.installed[0]?.shutdown?.();
    await service.close();
    expect(admittedShutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('keeps a refused admission out of routing while Legacy Cube stays available', async () => {
    vi.mocked(admitPrintedBackends).mockResolvedValue([
      { admitted: false, reasons: [{ code: 'missing-evidence' }] },
    ]);
    const service = await startBackendService({
      repoRoot,
      port: 0,
      printedAdmissions: [printedAdmission],
    });
    const options = vi.mocked(serveBackendGateway).mock.calls[0]![0];
    expect(options.routes.printed).toEqual({ 'legacy-cube-2021-08': probe.id });
    expect(service.message).toContain('Printed format akh-hou admission refused');
    expect(service.withheld).toEqual([{ formatId: 'akh-hou', reason: MISSING_EVIDENCE_REASON }]);
    await service.close();
  });

  it('withholds a runtime-mismatched format by name, with the sentence the page shows', async () => {
    vi.mocked(admitPrintedBackends).mockResolvedValue([
      { admitted: true, subject, backend: probe },
      { admitted: false, reasons: [{ code: 'runtime-mismatch', detail: 'stale' }] },
    ]);
    const service = await startBackendService({
      repoRoot,
      port: 0,
      printedAdmissions: [printedAdmission, { ...printedAdmission, formatId: 'isd' }],
    });
    expect(service.withheld).toEqual([{ formatId: 'isd', reason: RUNTIME_MISMATCH_REASON }]);
    await service.close();
  });

  it('closes both runtime owners after a gateway startup failure', async () => {
    const admittedShutdown = vi.fn(async () => undefined);
    vi.mocked(admitPrintedBackends).mockResolvedValue([
      { admitted: true, subject, backend: { ...probe, shutdown: admittedShutdown } },
    ]);
    vi.mocked(serveBackendGateway).mockRejectedValue(new Error('EADDRINUSE'));
    await expect(
      startBackendService({ repoRoot, port: 0, printedAdmissions: [printedAdmission] }),
    ).rejects.toThrow('EADDRINUSE');
    expect(admittedShutdown).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('propagates broken evidence and releases Legacy Cube startup resources', async () => {
    vi.mocked(admitPrintedBackends).mockRejectedValue(new Error('evidence checksum mismatch'));
    await expect(
      startBackendService({ repoRoot, port: 0, printedAdmissions: [printedAdmission] }),
    ).rejects.toThrow('evidence checksum mismatch');
    expect(serveBackendGateway).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it.each(['legacy-cube-2021-08', 'wrong-backend-id'])(
    'cleans both owners when admission conflicts: %s',
    async (conflict) => {
      const admittedShutdown = vi.fn(async () => undefined);
      vi.mocked(admitPrintedBackends).mockResolvedValue([
        {
          admitted: true,
          subject: {
            ...subject,
            formatId: conflict === 'legacy-cube-2021-08' ? conflict : 'akh-hou',
          },
          backend: {
            ...probe,
            id: conflict === 'wrong-backend-id' ? conflict : probe.id,
            shutdown: admittedShutdown,
          },
        },
      ]);
      await expect(
        startBackendService({ repoRoot, port: 0, printedAdmissions: [printedAdmission] }),
      ).rejects.toThrow();
      expect(serveBackendGateway).not.toHaveBeenCalled();
      expect(shutdown).toHaveBeenCalledTimes(1);
      expect(admittedShutdown).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);
    },
  );

  it('can serve an admitted copied runtime when the separate Legacy installation is absent', async () => {
    vi.mocked(installedForgeBackend).mockReturnValue(null);
    vi.mocked(admitPrintedBackends).mockResolvedValue([{ admitted: true, subject, backend: probe }]);
    const service = await startBackendService({
      repoRoot,
      port: 0,
      printedAdmissions: [printedAdmission],
    });
    const options = vi.mocked(serveBackendGateway).mock.calls[0]![0];
    expect(options.installed).toHaveLength(1);
    expect(
      await options.installed[0]!.supports({
        content: { kind: 'printed', format: 'legacy-cube-2021-08' },
        seats: [
          { name: 'You', controller: 'local', deck: { name: 'You', cards: [] } },
          { name: 'Bot', controller: 'engine', deck: { name: 'Bot', cards: [] } },
        ],
        seed: 'refuse-legacy',
        maximumTurns: null,
      }),
    ).toHaveLength(1);
    expect(options.routes.printed['akh-hou']).toBe(probe.id);
    await options.installed[0]?.shutdown?.();
    await service.close();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('advertises the Legacy Cube under the model’s own format id, which the landing’s network cell matches', async () => {
    const service = await startBackendService({ repoRoot, port: 0 });
    const options = vi.mocked(serveBackendGateway).mock.calls[0]![0];
    expect(Object.keys(options.routes.printed)).toEqual([LEGACY_CUBE_FORMAT]);
    await service.close();
  });

  it('binds loopback on the requested port and disposes once after shutdown', async () => {
    const service = await startBackendService({ repoRoot, port: 45750 });
    expect(installedForgeBackend).toHaveBeenCalledWith({
      forgeHome: '/forge',
      compiledBridgeClasses: '/classes',
    });
    expect(serveBackendGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 45750,
        host: '127.0.0.1',
        routes: { generated: 'kernel', printed: { 'legacy-cube-2021-08': 'forge-2.0.14' } },
      }),
    );
    expect(service.message).toContain('precompiled');
    await Promise.all([service.close(), service.close()]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0]!);
  });

  it('keeps missing Forge explicit without compiling or admitting a fallback', async () => {
    vi.mocked(compileInstalledForgeBridge).mockReturnValue(null);
    vi.mocked(installedForgeBackend).mockReturnValue(null);
    const service = await startBackendService({ repoRoot, port: 0 });
    expect(service.message).toContain('not installed');
    expect(serveBackendGateway).toHaveBeenCalledWith(expect.objectContaining({ installed: [] }));
    expect(service.observed).toBeNull();
    await service.close();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('admits several printed formats side by side under the one Forge identity', async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    vi.mocked(admitPrintedBackends).mockResolvedValue([
      { admitted: true, subject, backend: { ...probe, shutdown: first } },
      {
        admitted: true,
        subject: { ...subject, formatId: 'isd' },
        backend: { ...probe, shutdown: second },
      },
    ]);
    const service = await startBackendService({
      repoRoot,
      port: 0,
      printedAdmissions: [printedAdmission, printedAdmission],
    });
    expect(admitPrintedBackends).toHaveBeenCalledTimes(1);
    expect(bundleInstalledForgeAdapter).toHaveBeenCalledTimes(1);
    const options = vi.mocked(serveBackendGateway).mock.calls[0]![0];
    expect(options.installed).toHaveLength(1);
    expect(options.routes.printed).toEqual({
      'legacy-cube-2021-08': probe.id,
      'akh-hou': probe.id,
      isd: probe.id,
    });
    expect(service.message).toContain('Printed format akh-hou: verified runtime admission loaded.');
    expect(service.message).toContain('Printed format isd: verified runtime admission loaded.');
    expect(service.observed).toEqual({
      backend: options.installed[0],
      formats: ['legacy-cube-2021-08', 'akh-hou', 'isd'],
    });
    await options.installed[0]?.shutdown?.();
    await service.close();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('keeps a refused later admission out of routing while an earlier one stays admitted', async () => {
    vi.mocked(admitPrintedBackends).mockResolvedValue([
      { admitted: true, subject, backend: probe },
      { admitted: false, reasons: [{ code: 'missing-evidence' }] },
    ]);
    const service = await startBackendService({
      repoRoot,
      port: 0,
      printedAdmissions: [printedAdmission, printedAdmission],
    });
    const options = vi.mocked(serveBackendGateway).mock.calls[0]![0];
    expect(options.routes.printed).toEqual({ 'legacy-cube-2021-08': probe.id, 'akh-hou': probe.id });
    expect(service.message).toContain('Printed format akh-hou: verified runtime admission loaded.');
    expect(service.message).toContain('missing-evidence');
    await service.close();
  });

  it('refuses two admissions claiming one format and closes every admitted owner', async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    vi.mocked(admitPrintedBackends).mockResolvedValue([
      { admitted: true, subject, backend: { ...probe, shutdown: first } },
      { admitted: true, subject, backend: { ...probe, shutdown: second } },
    ]);
    await expect(
      startBackendService({
        repoRoot,
        port: 0,
        printedAdmissions: [printedAdmission, printedAdmission],
      }),
    ).rejects.toThrow(/duplicate format backend route: akh-hou/u);
    expect(serveBackendGateway).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('releases the Legacy owner when batch admission breaks', async () => {
    vi.mocked(admitPrintedBackends).mockRejectedValue(new Error('evidence checksum mismatch'));
    await expect(
      startBackendService({
        repoRoot,
        port: 0,
        printedAdmissions: [printedAdmission, printedAdmission],
      }),
    ).rejects.toThrow('evidence checksum mismatch');
    expect(serveBackendGateway).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('explains why requested printed admission is unavailable without Forge', async () => {
    vi.mocked(discoverForgeHome).mockReturnValue(undefined);
    vi.mocked(compileInstalledForgeBridge).mockReturnValue(null);
    vi.mocked(installedForgeBackend).mockReturnValue(null);
    const service = await startBackendService({
      repoRoot,
      port: 0,
      printedAdmissions: [printedAdmission],
    });
    expect(service.message).toContain('Printed format admission unavailable');
    expect(service.message).toContain('Forge 2.0.14 is not installed');
    expect(admitPrintedBackends).not.toHaveBeenCalled();
    await service.close();
  });

  it('propagates compilation failure before allocating a gateway or listener', async () => {
    vi.mocked(compileInstalledForgeBridge).mockImplementation(() => {
      throw new Error('javac failed');
    });
    await expect(startBackendService({ repoRoot, port: 0 })).rejects.toThrow('javac failed');
    expect(serveBackendGateway).not.toHaveBeenCalled();
  });

  it('disposes compiled files when the admission root cannot be allocated', async () => {
    writeFileSync(join(repoRoot, 'out'), 'occupied', 'utf8');

    await expect(
      startBackendService({ repoRoot, port: 0, printedAdmissions: [printedAdmission] }),
    ).rejects.toThrow();

    expect(installedForgeBackend).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes compiled files when backend construction throws', async () => {
    vi.mocked(installedForgeBackend).mockImplementation(() => {
      throw new Error('spawn failed');
    });
    await expect(startBackendService({ repoRoot, port: 0 })).rejects.toThrow('spawn failed');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('shuts down the probe and disposes compiled files after a port conflict', async () => {
    vi.mocked(serveBackendGateway).mockRejectedValue(new Error('EADDRINUSE'));
    await expect(startBackendService({ repoRoot, port: 45750 })).rejects.toThrow('EADDRINUSE');
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('preserves both startup and cleanup errors and still disposes files', async () => {
    const startError = new Error('EADDRINUSE');
    const cleanupError = new Error('shutdown failed');
    vi.mocked(serveBackendGateway).mockRejectedValue(startError);
    shutdown.mockRejectedValue(cleanupError);
    await expect(startBackendService({ repoRoot, port: 0 })).rejects.toMatchObject({
      errors: [startError, cleanupError],
    });
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes files even when gateway shutdown fails', async () => {
    close.mockRejectedValue(new Error('shutdown failed'));
    const service = await startBackendService({ repoRoot, port: 0 });
    await expect(service.close()).rejects.toThrow('shutdown failed');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('retains admission files when an admitted backend fails shutdown', async () => {
    const admittedShutdown = vi.fn(async () => {
      throw new Error('admitted shutdown failed');
    });
    let retained = '';
    vi.mocked(admitPrintedBackends).mockImplementation(async ({ outputParent }) => {
      retained = join(outputParent, 'retained');
      mkdirSync(retained);
      return [{ admitted: true, subject, backend: { ...probe, shutdown: admittedShutdown } }];
    });
    const service = await startBackendService({
      repoRoot,
      port: 0,
      printedAdmissions: [printedAdmission],
    });
    const installed = vi.mocked(serveBackendGateway).mock.calls[0]![0].installed[0]!;
    close.mockImplementation(async () => {
      await installed.shutdown?.();
      return undefined;
    });
    await expect(service.close()).rejects.toThrow('format backend shutdown failed');
    expect(existsSync(retained)).toBe(true);
  });

  it.each([-1, 65536, 1.5, NaN])('rejects invalid embedded port %s before compiling', async (port) => {
    await expect(startBackendService({ repoRoot, port })).rejects.toThrow('port');
    expect(compileInstalledForgeBridge).not.toHaveBeenCalled();
  });

  it('requires an explicit stable CLI port', () => {
    expect(readBackendPort(['--port', '45750'])).toBe(45750);
    for (const args of [
      [],
      ['--port', '0'],
      ['--port', 'NaN'],
      ['--port', '65536'],
      ['--port', '1.5'],
      ['--port', '80', '--extra'],
    ]) {
      expect(() => readBackendPort(args)).toThrow('port');
    }
  });
});

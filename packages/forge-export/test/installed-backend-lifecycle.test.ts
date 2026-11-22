/** The downloaded Forge adapter owns one private runtime root for its lifetime. */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionSpec } from '@mtg/engine';
import {
  compileInstalledForgeBridge,
  installedForgeAdmittedBackend,
  installedForgeBackend,
  installedForgeDiagnosticBackend,
} from '@mtg/forge-export';
import { installedForgeScenarioBackend } from '../src/observed/installed';
import { forgeJvmCommand } from '../src/install';

const TABLE: SessionSpec = {
  content: { kind: 'printed', format: 'legacy-cube-2021-08' },
  seats: [
    {
      name: 'Human',
      controller: 'local',
      deck: { name: 'human', cards: [{ name: 'Mountain', count: 60 }] },
    },
    {
      name: 'Forge AI',
      controller: 'engine',
      deck: { name: 'engine', cards: [{ name: 'Mountain', count: 60 }] },
    },
  ],
  seed: 'lifecycle',
  maximumTurns: 1,
};

const FAKE_XVFB = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const prefix = '@@MTG_FORGE_JSON@@';
if (process.env['MTG_FAKE_XVFB_ARGS']) fs.writeFileSync(process.env['MTG_FAKE_XVFB_ARGS'], JSON.stringify(process.argv.slice(2)));
function send(value) { process.stdout.write(prefix + JSON.stringify(value) + '\n'); }
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.type === 'hello') return send({ protocolVersion: 2, type: 'hello', requestId: request.requestId, forgeVersion: '2.0.14-test' });
  if (request.type === 'open') return send({
    protocolVersion: 2,
    type: 'snapshot',
    requestId: request.requestId,
    sessionId: 'lifecycle-session',
    revision: 0,
    status: 'finished',
    view: {
      version: 4,
      turn: { number: 1, active: 0, phase: 'Main', step: 'Main' },
      priority: null,
      stack: [],
      seats: [
        { id: 0, name: 'Human', life: 20, hand: [], handSize: 0, librarySize: 60, graveyard: [], exile: [], battlefield: [] },
        { id: 1, name: 'Forge AI', life: 20, hand: null, handSize: 0, librarySize: 60, graveyard: [], exile: [], battlefield: [] }
      ]
    },
    events: [],
    decision: null,
    result: { winner: 0, reason: 'fixture', endedOnTurn: 1 }
  });
  if (request.type === 'close') {
    send({ protocolVersion: 2, type: 'closed', requestId: request.requestId });
    process.exit(0);
  }
});
`;

const sandboxes: string[] = [];
const originalPath = process.env['PATH'];
const originalXvfbArgsPath = process.env['MTG_FAKE_XVFB_ARGS'];

function sandbox(): string {
  const path = mkdtempSync(join(tmpdir(), 'mtg-installed-lifecycle-test-'));
  sandboxes.push(path);
  return path;
}

afterEach(() => {
  process.env['PATH'] = originalPath;
  if (originalXvfbArgsPath === undefined) delete process.env['MTG_FAKE_XVFB_ARGS'];
  else process.env['MTG_FAKE_XVFB_ARGS'] = originalXvfbArgsPath;
  for (const path of sandboxes.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture(): {
  readonly forgeHome: string;
  readonly runtimeParent: string;
  readonly bridgeSource: string;
  readonly outside: string;
} {
  const root = sandbox();
  const forgeHome = join(root, 'forge-source');
  const runtimeParent = join(root, 'runtimes');
  const bin = join(root, 'bin');
  mkdirSync(join(forgeHome, 'res'), { recursive: true });
  mkdirSync(runtimeParent);
  mkdirSync(bin);
  writeFileSync(join(forgeHome, 'forge-gui-desktop-2.0.14-test-jar-with-dependencies.jar'), 'jar');
  writeFileSync(join(forgeHome, 'res', 'source-sentinel'), 'source');
  const bridgeSource = join(root, 'ForgeBridge.java');
  writeFileSync(bridgeSource, '// fixture');
  const outside = join(root, 'outside-sentinel');
  writeFileSync(outside, 'outside');
  const xvfb = join(bin, 'xvfb-run');
  writeFileSync(xvfb, FAKE_XVFB);
  chmodSync(xvfb, 0o755);
  process.env['PATH'] = `${bin}:${originalPath ?? ''}`;
  return { forgeHome, runtimeParent, bridgeSource, outside };
}

describe('the command a Forge JVM starts under', () => {
  it('wraps java in xvfb-run on Linux, which has no display of its own', () => {
    expect(forgeJvmCommand(['java', '-jar', 'forge.jar'], 'linux')).toStrictEqual({
      command: 'xvfb-run',
      args: ['-a', 'java', '-jar', 'forge.jar'],
    });
  });

  it('runs java directly on macOS and Windows, where xvfb-run does not exist', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      expect(forgeJvmCommand(['java', '-jar', 'forge.jar'], platform)).toStrictEqual({
        command: 'java',
        args: ['-jar', 'forge.jar'],
      });
    }
  });
});

describe('installed Forge backend lifecycle', () => {
  it('keeps an installed catalog-discovery backend separate from ordinary play admission', async () => {
    const paths = fixture();
    const deck = { name: 'discovery', cards: [{ name: 'Lightning Bolt', count: 60 }] };
    const table: SessionSpec = {
      ...TABLE,
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        { ...TABLE.seats[0], deck },
        { ...TABLE.seats[1], deck },
      ],
    };
    const ordinary = installedForgeBackend({ ...paths, printedCardNames: new Set(['Lightning Bolt']) });
    if (ordinary === null) throw new Error('Expected fake installed backend');
    expect(await ordinary.supports(table)).toContain(
      'printed card "Lightning Bolt" is outside the audited Forge decision-family slice',
    );
    await ordinary.shutdown?.();

    const diagnostic = installedForgeDiagnosticBackend(new Set(['Lightning Bolt']), {
      ...paths,
      printedCardNames: new Set(['Lightning Bolt']),
    });
    if (diagnostic === null) throw new Error('Expected fake installed diagnostic backend');
    expect(diagnostic.id).toMatch(/-catalog-discovery$/u);
    expect(await diagnostic.supports(table)).toEqual([]);
    const opened = await diagnostic.open(table);
    if (!opened.ok) throw new Error(opened.error.message);
    await opened.session.close();
    await diagnostic.shutdown?.();
  });

  it('uses a distinct installed backend for an externally verified admitted card inventory', async () => {
    const paths = fixture();
    const deck = { name: 'admitted', cards: [{ name: 'Lightning Bolt', count: 60 }] };
    const table: SessionSpec = {
      ...TABLE,
      content: { kind: 'printed', format: 'akh-hou' },
      seats: [
        { ...TABLE.seats[0], deck },
        { ...TABLE.seats[1], deck },
      ],
    };
    const admitted = installedForgeAdmittedBackend(new Set(['Lightning Bolt']), {
      ...paths,
      printedCardNames: new Set(['Lightning Bolt']),
    });
    if (admitted === null) throw new Error('Expected fake installed admitted backend');
    expect(admitted.id).toBe('forge-2.0.14-test');
    expect(await admitted.supports(table)).toEqual([]);
    const opened = await admitted.open(table);
    if (!opened.ok) throw new Error(opened.error.message);
    await opened.session.close();
    await admitted.shutdown?.();
  });

  it('compiles the bridge once for reuse by isolated runtime instances', async () => {
    const paths = fixture();
    const javac = join(paths.forgeHome, '..', 'bin', 'javac');
    writeFileSync(
      javac,
      String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const output = args[args.indexOf('-d') + 1];
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'ForgeBridge.class'), 'compiled');
`,
    );
    chmodSync(javac, 0o755);
    const compileParent = join(paths.forgeHome, '..', 'compiled');
    mkdirSync(compileParent);

    const compiled = compileInstalledForgeBridge({
      forgeHome: paths.forgeHome,
      bridgeSource: paths.bridgeSource,
      outputParent: compileParent,
    });
    expect(compiled).not.toBeNull();
    if (compiled === null) return;
    expect(existsSync(join(compiled.classDirectory, 'ForgeBridge.class'))).toBe(true);
    expect(readdirSync(compileParent)).toHaveLength(1);

    const argsPath = join(paths.forgeHome, '..', 'xvfb-args.json');
    process.env['MTG_FAKE_XVFB_ARGS'] = argsPath;
    const backend = installedForgeBackend({
      ...paths,
      compiledBridgeClasses: compiled.classDirectory,
    });
    expect(backend).not.toBeNull();
    if (backend === null) return;
    const opened = await backend.open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    const launchArgs = JSON.parse(readFileSync(argsPath, 'utf8')) as string[];
    expect(launchArgs.at(-1)).toBe('ForgeBridge');
    expect(launchArgs.some((argument) => argument.includes(compiled.classDirectory))).toBe(true);
    expect(launchArgs).not.toContain(paths.bridgeSource);
    expect(launchArgs.some((argument) => argument.startsWith('-Dmtg.forge.test.scenario='))).toBe(false);

    await opened.session.close();
    await backend.shutdown!();
    expect(existsSync(compiled.classDirectory)).toBe(true);
    compiled.dispose();
    expect(readdirSync(compileParent)).toEqual([]);
    expect(existsSync(paths.outside)).toBe(true);
  });

  it('isolates verification state, marks its backend, and removes the fixture at shutdown', async () => {
    const paths = fixture();
    const argsPath = join(paths.forgeHome, '..', 'scenario-args.json');
    process.env['MTG_FAKE_XVFB_ARGS'] = argsPath;
    const seat = { life: 20, hand: [], library: ['Island'], battlefield: [], graveyard: [] };
    const state = { schemaVersion: 1, active: 0, phase: 'MAIN1', seats: [seat, seat] };
    const backend = installedForgeScenarioBackend(state, paths);
    if (backend === null) throw new Error('Expected fake installed backend');
    expect(backend.id).toMatch(/-verification-scenario$/u);
    const runtime = join(paths.runtimeParent, readdirSync(paths.runtimeParent)[0]!);
    const statePath = join(runtime, 'verification-state.json');
    expect(existsSync(statePath)).toBe(false);
    try {
      const opened = await backend.open(TABLE);
      if (!opened.ok) throw new Error(opened.error.message);
      try {
        const launchArgs = JSON.parse(readFileSync(argsPath, 'utf8')) as string[];
        expect(launchArgs).toContain(`-Dmtg.forge.test.scenario=${statePath}`);
        expect(JSON.parse(readFileSync(statePath, 'utf8'))).toEqual(state);
        expect(statSync(statePath).mode & 0o777).toBe(0o600);
      } finally {
        await opened.session.close();
      }
    } finally {
      await backend.shutdown!();
    }
    expect(existsSync(runtime)).toBe(false);
    expect(existsSync(paths.outside)).toBe(true);
  });

  it('refuses a compiled bridge directory without the main class before allocating a runtime', () => {
    const paths = fixture();
    const classes = join(paths.forgeHome, '..', 'empty-classes');
    mkdirSync(classes);
    expect(() =>
      installedForgeBackend({
        ...paths,
        compiledBridgeClasses: classes,
      }),
    ).toThrow(/compiled Forge bridge does not contain ForgeBridge\.class/u);
    expect(readdirSync(paths.runtimeParent)).toEqual([]);
  });

  it('reports compiler failure and removes only its owned compilation root', () => {
    const paths = fixture();
    const javac = join(paths.forgeHome, '..', 'bin', 'javac');
    writeFileSync(
      javac,
      String.raw`#!/usr/bin/env node
process.stderr.write('hostile compiler fixture');
process.exit(9);
`,
    );
    chmodSync(javac, 0o755);
    const compileParent = join(paths.forgeHome, '..', 'failed-compilation');
    mkdirSync(compileParent);

    expect(() =>
      compileInstalledForgeBridge({
        forgeHome: paths.forgeHome,
        bridgeSource: paths.bridgeSource,
        outputParent: compileParent,
      }),
    ).toThrow(/Could not compile the installed Forge bridge/u);
    expect(readdirSync(compileParent)).toEqual([]);
    expect(existsSync(paths.bridgeSource)).toBe(true);
    expect(existsSync(paths.outside)).toBe(true);
    expect(readdirSync(paths.runtimeParent)).toEqual([]);
  });

  it('waits for its live session, then unlinks only its exact runtime root', async () => {
    const paths = fixture();
    const backend = installedForgeBackend(paths);
    expect(backend).not.toBeNull();
    if (backend === null) return;
    const [runtimeName] = readdirSync(paths.runtimeParent);
    expect(runtimeName).toBeDefined();
    const runtime = join(paths.runtimeParent, runtimeName!);
    expect(readlinkSync(join(runtime, 'res'))).toBe(join(paths.forgeHome, 'res'));
    symlinkSync(paths.outside, join(runtime, 'outside-link'));

    const opened = await backend.open(TABLE);
    if (!opened.ok) throw new Error(opened.error.message);
    const queuedOpen = backend.open(TABLE);
    let settled = false;
    const firstShutdown = backend.shutdown!().then(() => {
      settled = true;
    });
    const secondShutdown = backend.shutdown!();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(existsSync(runtime)).toBe(true);

    await opened.session.close();
    const queued = await queuedOpen;
    if (!queued.ok) throw new Error(queued.error.message);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(existsSync(runtime)).toBe(true);
    await queued.session.close();
    await Promise.all([firstShutdown, secondShutdown]);
    expect(existsSync(runtime)).toBe(false);
    expect(existsSync(join(paths.forgeHome, 'res', 'source-sentinel'))).toBe(true);
    expect(existsSync(paths.outside)).toBe(true);
    await expect(backend.shutdown!()).resolves.toBeUndefined();

    const late = await backend.open(TABLE);
    expect(late).toMatchObject({
      ok: false,
      error: { kind: 'backend-failure', message: expect.stringContaining('shut down') },
    });
  });

  it('leaves the private root for OS cleanup when shutdown is omitted', () => {
    const paths = fixture();
    const backend = installedForgeBackend(paths);
    expect(backend).not.toBeNull();
    expect(readdirSync(paths.runtimeParent)).toHaveLength(1);
  });

  it('validates the companion source before allocating a runtime root', () => {
    const paths = fixture();
    expect(() =>
      installedForgeBackend({
        ...paths,
        bridgeSource: join(paths.runtimeParent, 'missing-bridge.java'),
      }),
    ).toThrow(/bridge source does not exist/u);
    expect(readdirSync(paths.runtimeParent)).toEqual([]);
  });
});

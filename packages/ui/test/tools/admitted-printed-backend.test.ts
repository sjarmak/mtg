/** Synthetic receipts test admission plumbing, never claim actual card compatibility. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureForgeRuntime } from '@mtg/forge-export';
import { parsePrintedCardCatalog, parsePrintedLimitedFormat } from '@mtg/printed-card';
import { admitPrintedBackend, admitPrintedBackends } from '../../tools/admitted-printed-backend';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mtg-admitted-backend-test-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const read = (name: string): unknown =>
  JSON.parse(readFileSync(`packages/data/data/akh-hou/${name}`, 'utf8'));
const format = parsePrintedLimitedFormat(read('akh-hou-limited-format-v1.json'));
const catalogs = ['akh', 'hou', 'mp2'].map((code) =>
  parsePrintedCardCatalog(read(`${code}-printed-catalog-v1.json`)),
);
const hash = (body: string) => createHash('sha256').update(body).digest('hex');

function fixture(adapter = '', shutdown = '') {
  const source = join(root, 'source');
  mkdirSync(join(source, 'res/cardsfolder'), { recursive: true });
  mkdirSync(join(source, 'classes'));
  mkdirSync(join(root, 'snapshots'));
  writeFileSync(join(source, 'forge-gui-desktop-2.0.14-jar-with-dependencies.jar'), 'fixture jar');
  writeFileSync(join(source, 'res/cardsfolder/cardsfolder.zip'), 'fixture scripts');
  writeFileSync(join(source, 'classes/ForgeBridge.class'), 'fixture class');
  writeFileSync(
    join(source, 'adapter.mjs'),
    adapter ||
      `
    import { writeFileSync, existsSync } from 'node:fs';
    import { join } from 'node:path';
    export function installedForgeAdmittedBackend(cardNames, options, generatedObjectPolicy) {
      return {
        id: 'fixture-forge', determinism: 'observed',
        capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
        supports: async () => [],
        open: async () => {
          writeFileSync(${JSON.stringify(join(root, 'launched.json'))}, JSON.stringify({ options, cardNames: [...cardNames], generatedObjectPolicy }));
          if (!existsSync(join(options.forgeHome, 'res/cardsfolder/cardsfolder.zip'))) throw new Error('missing snapshot');
          return { ok: false, error: { kind: 'backend-failure', message: 'synthetic backend' } };
        },
        shutdown: async () => { ${shutdown} }
      };
    }
  `,
  );
  const runtime = {
    forgeHome: source,
    bridge: { kind: 'compiled' as const, path: join(source, 'classes') },
    adapterBundlePath: join(source, 'adapter.mjs'),
  };
  const subject = {
    ...measureForgeRuntime(runtime),
    formatId: format.id,
    formatSha256: format.contentSha256,
    catalogs: Object.fromEntries(format.sources.map((s) => [s.code, s.catalogSha256])),
  };
  const ids = catalogs.flatMap((c) => c.cards.map((card) => card.physicalId));
  const results = (['local', 'engine'] as const).flatMap((controller) => [
    {
      id: `card-${controller}`,
      scope: 'card',
      controller,
      cardIds: ids,
      decisionFamilies: ['fixture'],
      status: 'passed',
      assertions: ['Synthetic fixture only'],
    },
    {
      id: `match-${controller}`,
      scope: 'match',
      controller,
      cardIds: [],
      decisionFamilies: ['starting-player', 'mulligan', 'priority'],
      status: 'passed',
      assertions: ['Synthetic fixture only'],
    },
  ]);
  const receipts = new Map(
    results.map((result) => [
      `probes/${result.id}.json`,
      JSON.stringify({ schemaVersion: 1, kind: 'printed-play-probe-receipt', subject, result }),
    ]),
  );
  const artifact = {
    schemaVersion: 1,
    kind: 'printed-play-admission',
    subject,
    cards: ids.map((id) => ({
      id,
      review: 'reviewed',
      decisionFamilies: ['fixture'],
      probeIds: ['card-local', 'card-engine'],
      note: 'Synthetic fixture only',
    })),
    matchProbeIds: ['match-local', 'match-engine'],
    probes: results.map((result) => {
      const path = `probes/${result.id}.json`;
      return { ...result, evidence: { path, sha256: hash(receipts.get(path)!) } };
    }),
  };
  const options = {
    runtime,
    format,
    catalogs,
    outputParent: join(root, 'snapshots'),
    evidence: { body: JSON.stringify(artifact), read: (path: string) => receipts.get(path)! },
  };
  return { options, artifact, source };
}

it('withholds a backend when no evidence is supplied without loading executable code', async () => {
  const { options } = fixture('throw new Error("must not import");');
  expect(await admitPrintedBackend({ ...options, evidence: null })).toEqual({
    admitted: false,
    reasons: [{ code: 'missing-evidence' }],
  });
  expect(readdirSync(options.outputParent)).toEqual([]);
});

it('checks all 550 printings before importing an otherwise correctly hashed adapter', async () => {
  const { options, artifact } = fixture('throw new Error("must not import");');
  const result = await admitPrintedBackend({
    ...options,
    evidence: {
      ...options.evidence,
      body: JSON.stringify({
        ...artifact,
        cards: artifact.cards.map((card) => ({ ...card, review: 'pending' })),
      }),
    },
  });
  expect(result.admitted).toBe(false);
  if (result.admitted) throw new Error('unexpected admission');
  expect(result.reasons.filter((reason) => reason.code === 'unreviewed-card')).toHaveLength(550);
  expect(readdirSync(options.outputParent)).toEqual([]);
});

it('rejects stale runtime claims before adapter import and removes the refused snapshot', async () => {
  const { options } = fixture('throw new Error("must not import");');
  writeFileSync(join(options.runtime.forgeHome, 'res/cardsfolder/cardsfolder.zip'), 'changed');
  const result = await admitPrintedBackend(options);
  expect(result.admitted).toBe(false);
  if (result.admitted) throw new Error('unexpected admission');
  expect(result.reasons).toContainEqual({ code: 'subject-mismatch', subjectField: 'scriptArchiveSha256' });
  expect(readdirSync(options.outputParent)).toEqual([]);
});

it('propagates damaged receipts and cleans its unlaunched snapshot', async () => {
  const { options } = fixture();
  await expect(
    admitPrintedBackend({ ...options, evidence: { ...options.evidence, read: () => 'changed' } }),
  ).rejects.toThrow(/checksum mismatch/);
  expect(readdirSync(options.outputParent)).toEqual([]);
});

it('launches only copied inputs, confines the format, and owns snapshot shutdown', async () => {
  const { options, source } = fixture();
  const result = await admitPrintedBackend(options);
  expect(result.admitted).toBe(true);
  if (!result.admitted) throw new Error('unexpected refusal');
  rmSync(source, { recursive: true, force: true });
  const table = {
    content: { kind: 'printed' as const, format: format.id },
    seats: [
      { name: 'You', controller: 'local' as const, deck: { name: 'fixture', cards: [] } },
      { name: 'Bot', controller: 'engine' as const, deck: { name: 'fixture', cards: [] } },
    ] as const,
    seed: 'fixture',
    maximumTurns: null,
  };
  const other = { ...table, content: { kind: 'printed' as const, format: 'legacy-cube-2021-08' } };
  expect(await result.backend.supports(other)).toEqual(['Printed backend is admitted only for akh-hou.']);
  expect((await result.backend.open(other)).ok).toBe(false);
  expect(existsSync(join(root, 'launched.json'))).toBe(false);
  expect(await result.backend.supports(table)).toEqual([]);
  expect((await result.backend.open(table)).ok).toBe(false);
  const launched = JSON.parse(readFileSync(join(root, 'launched.json'), 'utf8'));
  expect(launched.options.forgeHome.startsWith(options.outputParent)).toBe(true);
  expect(launched.options.compiledBridgeClasses.startsWith(options.outputParent)).toBe(true);
  expect(launched.options.bridgeSource).toBeUndefined();
  expect(launched.cardNames).toHaveLength(
    new Set(catalogs.flatMap((catalog) => catalog.cards.map((card) => card.correctedName))).size,
  );
  expect(readdirSync(options.outputParent)).toHaveLength(1);
  await result.backend.shutdown?.();
  await result.backend.shutdown?.();
  expect(readdirSync(options.outputParent)).toEqual([]);
  expect((await result.backend.open(table)).ok).toBe(false);
});

it('passes the verified generated-object policy to the copied adapter', async () => {
  const { options, artifact } = fixture();
  const result = await admitPrintedBackend({
    ...options,
    evidence: {
      ...options.evidence,
      body: JSON.stringify({
        ...artifact,
        generatedObjectPolicy: 'forge-momir-global-creatures',
      }),
    },
  });
  if (!result.admitted) throw new Error('unexpected refusal');
  const table = {
    content: { kind: 'printed' as const, format: format.id },
    seats: [
      { name: 'You', controller: 'local' as const, deck: { name: 'fixture', cards: [] } },
      { name: 'Bot', controller: 'engine' as const, deck: { name: 'fixture', cards: [] } },
    ] as const,
    seed: 'fixture',
    maximumTurns: null,
  };
  await result.backend.open(table);
  const launched = JSON.parse(readFileSync(join(root, 'launched.json'), 'utf8'));
  expect(launched.generatedObjectPolicy).toBe('forge-momir-global-creatures');
  await result.backend.shutdown?.();
});

it.each([
  'export const unrelated = true;',
  'export function installedForgeAdmittedBackend() { return null; }',
  'throw new Error("adapter import failed");',
])('fails explicitly for an unusable copied adapter: %s', async (adapter) => {
  const { options } = fixture(adapter);
  await expect(admitPrintedBackend(options)).rejects.toThrow(/adapter|absent/);
  expect(readdirSync(options.outputParent)).toEqual([]);
});

it('keeps the verified recipe identity even when evidence IO changes the caller object', async () => {
  const { options } = fixture();
  const input = { ...format };
  const result = await admitPrintedBackend({
    ...options,
    format: input,
    evidence: {
      ...options.evidence,
      read: (path) => {
        Object.assign(input, { id: 'not-the-verified-format' });
        return options.evidence.read(path);
      },
    },
  });
  if (!result.admitted) throw new Error('unexpected refusal');
  try {
    expect(result.subject.formatId).toBe(format.id);
  } finally {
    await result.backend.shutdown?.();
  }
});

it('retains the shared snapshot when any owner fails shutdown', async () => {
  const { options } = fixture('', 'throw new Error("shutdown failed");');
  const results = await admitPrintedBackends({
    runtime: options.runtime,
    outputParent: options.outputParent,
    admissions: [options, options],
  });
  const admitted = results.flatMap((result) => (result.admitted ? [result] : []));
  expect(admitted).toHaveLength(2);
  await expect(admitted[0]!.backend.shutdown?.()).rejects.toThrow(/shutdown/);
  await expect(admitted[1]!.backend.shutdown?.()).rejects.toThrow(/shutdown/);
  await expect(admitted[0]!.backend.shutdown?.()).rejects.toThrow(/shutdown/);
  expect(readdirSync(options.outputParent)).toHaveLength(1);
});

it('refuses a source bridge without allocating a runtime snapshot', async () => {
  const { options } = fixture();
  await expect(
    admitPrintedBackend({
      ...options,
      runtime: { ...options.runtime, bridge: { kind: 'source', path: 'unused' } },
    }),
  ).rejects.toThrow(/compiled bridge/);
  expect(readdirSync(options.outputParent)).toEqual([]);
});

it('detects copied runtime changes during evidence IO before executing the adapter', async () => {
  const { options } = fixture('throw new Error("must not import");');
  await expect(
    admitPrintedBackend({
      ...options,
      evidence: {
        ...options.evidence,
        read: (path) => {
          const snapshot = readdirSync(options.outputParent)[0]!;
          writeFileSync(join(options.outputParent, snapshot, 'forge/res/changed-by-reader.txt'), 'changed');
          return options.evidence.read(path);
        },
      },
    }),
  ).rejects.toThrow(/runtime changed during evidence/);
  expect(readdirSync(options.outputParent)).toEqual([]);
});

it('shares one measured snapshot and disposes it only after the final backend closes', async () => {
  const { options } = fixture();
  const results = await admitPrintedBackends({
    runtime: options.runtime,
    outputParent: options.outputParent,
    admissions: [options, options],
  });
  const admitted = results.flatMap((result) => (result.admitted ? [result] : []));
  expect(admitted).toHaveLength(2);
  expect(readdirSync(options.outputParent)).toHaveLength(1);
  await admitted[0]!.backend.shutdown?.();
  expect(readdirSync(options.outputParent)).toHaveLength(1);
  await admitted[1]!.backend.shutdown?.();
  expect(readdirSync(options.outputParent)).toEqual([]);
});

it('refuses a shared snapshot changed during any evidence verification before executing the adapter', async () => {
  const { options } = fixture('throw new Error("must not import");');
  let changed = false;
  await expect(
    admitPrintedBackends({
      runtime: options.runtime,
      outputParent: options.outputParent,
      admissions: [
        options,
        {
          ...options,
          evidence: {
            ...options.evidence,
            read: (path) => {
              if (!changed) {
                changed = true;
                const snapshot = readdirSync(options.outputParent)[0]!;
                writeFileSync(
                  join(options.outputParent, snapshot, 'forge/res/changed-by-reader.txt'),
                  'changed',
                );
              }
              return options.evidence.read(path);
            },
          },
        },
      ],
    }),
  ).rejects.toThrow(/runtime changed during evidence/);
  expect(readdirSync(options.outputParent)).toEqual([]);
});

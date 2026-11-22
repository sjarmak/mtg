/** CLI infrastructure fixtures use synthetic scripts; they do not qualify any Magic card. */
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parsePrintedCardCatalog,
  parsePrintedLimitedFormat,
  serializedPrintedCardCatalogContent,
  serializedPrintedLimitedFormatContent,
} from '@mtg/printed-card';
import { printedSupportReportMain } from '../tools/printed-support-report';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.resetAllMocks();
});
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const script = 'Name:Example\nK:Cycling:2\n';
const archive = 'synthetic archive bytes';
const data = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../data/akh-hou/${name}.json`, import.meta.url), 'utf8'));
const save = (root: string, file: string, value: unknown) =>
  writeFileSync(join(root, file), JSON.stringify(value));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'mtg-support-cli-'));
  roots.push(root);
  const catalogs = ['akh', 'hou', 'mp2'].map((code) => {
    const original = parsePrintedCardCatalog(data(`${code}-printed-catalog-v1`));
    const catalog = {
      ...original,
      cards: [{ ...original.cards[0]!, forgeScript: 'e/example.txt', forgeScriptSha256: hash(script) }],
    };
    return { ...catalog, contentSha256: hash(serializedPrintedCardCatalogContent(catalog)) };
  });
  const original = parsePrintedLimitedFormat(data('akh-hou-limited-format-v1'));
  const changed = {
    ...original,
    sources: original.sources.map((source) => ({
      ...source,
      catalogSha256: catalogs.find((catalog) => catalog.format === source.catalogFormat)!.contentSha256,
    })),
  };
  const format = { ...changed, contentSha256: hash(serializedPrintedLimitedFormatContent(changed)) };
  const subject = {
    forgeVersion: '2.0.14',
    forgeJarSha256: 'a'.repeat(64),
    scriptArchiveSha256: hash(archive),
    resourcesSha256: 'b'.repeat(64),
    bridgeSha256: 'c'.repeat(64),
    adapterSha256: 'd'.repeat(64),
    protocolVersion: 1,
    formatId: format.id,
    formatSha256: format.contentSha256,
    catalogs: Object.fromEntries(format.sources.map((source) => [source.code, source.catalogSha256])),
  };
  const result = {
    id: 'fixture-local',
    scope: 'card',
    controller: 'local',
    cardIds: [catalogs[0]!.cards[0]!.physicalId],
    decisionFamilies: ['fixture'],
    status: 'passed',
    assertions: ['Infrastructure fixture only'],
  };
  const receipt = { schemaVersion: 1, kind: 'printed-play-probe-receipt', subject, result };
  const admission = {
    schemaVersion: 1,
    kind: 'printed-play-admission',
    subject,
    cards: [
      {
        id: result.cardIds[0],
        review: 'pending',
        decisionFamilies: ['fixture'],
        probeIds: [result.id],
        note: 'Incomplete',
      },
    ],
    matchProbeIds: [],
    probes: [{ ...result, evidence: { path: 'receipts/local.json', sha256: hash(JSON.stringify(receipt)) } }],
  };
  const config = {
    schemaVersion: 1,
    runtimeScope: 'historical',
    runtimeProvenance: 'runtime.json',
    format: 'format.json',
    catalogs: ['0.json', '1.json', '2.json'],
    admission: 'admission.json',
    evidenceRoot: 'evidence',
    forgeScripts: 'cards.zip',
  };
  mkdirSync(join(root, 'evidence/receipts'), { recursive: true });
  save(root, 'evidence/receipts/local.json', receipt);
  catalogs.forEach((catalog, index) => save(root, `${index}.json`, catalog));
  save(root, 'format.json', format);
  save(root, 'runtime.json', { subject, qualification: 'unproven', sources: [] });
  save(root, 'admission.json', admission);
  save(root, 'config.json', config);
  writeFileSync(join(root, 'cards.zip'), archive);
  vi.mocked(execFileSync).mockReturnValue(Buffer.from(script));
  return {
    root,
    config,
    subject,
    admission,
    args: ['--config', join(root, 'config.json')],
    io: { stdout: vi.fn(), stderr: vi.fn() },
  };
}

it('verifies saved evidence and scripts without promoting partial evidence to live support', () => {
  const { root, args, io } = fixture();
  expect(printedSupportReportMain(args, io)).toBe(0);
  const report = JSON.parse(io.stdout.mock.calls[0]![0] as string);
  expect(report).toMatchObject({
    runtimeScope: 'historical',
    liveRuntimeVerified: false,
    admitted: false,
    evidenceVerification: 'verified',
  });
  expect(report.cards).toHaveLength(3);
  expect(report.cards.filter((card: { review: string }) => card.review === 'missing')).toHaveLength(2);
  expect(report.cards[0]).toMatchObject({ review: 'pending', script: { keywords: ['Cycling'] } });
  expect(report.matchGaps).toHaveLength(6);
  expect(execFileSync).toHaveBeenCalledWith(
    'unzip',
    ['-p', join(root, 'cards.zip'), 'e/example.txt'],
    expect.objectContaining({ timeout: 10000, maxBuffer: 1048576 }),
  );
  expect(printedSupportReportMain(args, io)).toBe(0);
  expect(io.stdout.mock.calls[1]![0]).toBe(io.stdout.mock.calls[0]![0]);
  expect(io.stderr).not.toHaveBeenCalled();
});

it.each([
  [],
  ['--config'],
  ['--config', 'x', '--config', 'y'],
  ['--enable'],
  ['extra'],
  ['--help', '--config', 'x'],
])('rejects ambiguous or missing arguments %j', (...args) => {
  const io = { stdout: vi.fn(), stderr: vi.fn() };
  expect(printedSupportReportMain(args, io)).toBe(1);
  expect(io.stdout).not.toHaveBeenCalled();
  expect(io.stderr).toHaveBeenCalled();
  expect(execFileSync).not.toHaveBeenCalled();
});

it.each([{ runtimeScope: 'local' }, { runtimeScope: undefined }, { enable: true }, { catalogs: [] }])(
  'refuses nonhistorical or malformed config %j',
  (change) => {
    const { root, config, args, io } = fixture();
    save(root, 'config.json', { ...config, ...change });
    expect(printedSupportReportMain(args, io)).toBe(1);
    expect(execFileSync).not.toHaveBeenCalled();
  },
);

it.each(['subject', 'archive', 'receipt', 'format', 'catalog', 'json'])(
  'rejects changed %s before extracting scripts',
  (change) => {
    const { root, subject, args, io } = fixture();
    if (change === 'subject') save(root, 'runtime.json', { subject: { ...subject, protocolVersion: 2 } });
    if (change === 'archive') writeFileSync(join(root, 'cards.zip'), 'changed');
    if (change === 'receipt') save(root, 'evidence/receipts/local.json', {});
    if (change === 'format') save(root, 'format.json', {});
    if (change === 'catalog') save(root, '0.json', {});
    if (change === 'json') writeFileSync(join(root, 'config.json'), 'not json');
    expect(printedSupportReportMain(args, io)).toBe(1);
    expect(io.stdout).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
  },
);

it.each(['../outside.json', '/outside.json', 'receipts/../../outside.json'])(
  'refuses escaping evidence reference %s',
  (path) => {
    const { root, admission, args, io } = fixture();
    save(root, 'admission.json', {
      ...admission,
      probes: admission.probes.map((probe) => ({ ...probe, evidence: { ...probe.evidence, path } })),
    });
    expect(printedSupportReportMain(args, io)).toBe(1);
    expect(execFileSync).not.toHaveBeenCalled();
  },
);

it.each(['file', 'directory'])('refuses a symlinked evidence %s outside the root', (kind) => {
  const { root, args, io } = fixture();
  const target = join(root, 'evidence/receipts/local.json');
  const bytes = readFileSync(target);
  rmSync(target);
  if (kind === 'file') {
    writeFileSync(join(root, 'outside.json'), bytes);
    symlinkSync(join(root, 'outside.json'), target);
  } else {
    rmSync(join(root, 'evidence/receipts'), { recursive: true });
    mkdirSync(join(root, 'outside'));
    writeFileSync(join(root, 'outside/local.json'), bytes);
    symlinkSync(join(root, 'outside'), join(root, 'evidence/receipts'));
  }
  expect(printedSupportReportMain(args, io)).toBe(1);
  expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('outside evidence root'));
  expect(execFileSync).not.toHaveBeenCalled();
});

it('refuses nonregular evidence and propagates archive-reader failures', () => {
  const { root, args, io } = fixture();
  const path = join(root, 'evidence/receipts/local.json');
  const bytes = readFileSync(path);
  rmSync(path);
  mkdirSync(path);
  expect(printedSupportReportMain(args, io)).toBe(1);
  expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('regular file'));
  rmSync(path, { recursive: true });
  writeFileSync(path, bytes);
  vi.mocked(execFileSync).mockImplementation(() => {
    throw new Error('archive deadline');
  });
  expect(printedSupportReportMain(args, io)).toBe(1);
  expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('archive deadline'));
  expect(io.stdout).not.toHaveBeenCalled();
});

it('prints help without requiring artifacts', () => {
  const io = { stdout: vi.fn(), stderr: vi.fn() };
  expect(printedSupportReportMain(['--help'], io)).toBe(0);
  expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('does not enable play'));
  expect(execFileSync).not.toHaveBeenCalled();
});

it.each(['formatId', 'formatSha256', 'catalogs'] as const)(
  'refuses foreign historical %s rather than borrowing its runtime identity',
  (field) => {
    const { root, subject, args, io } = fixture();
    const value =
      field === 'catalogs' ? { AKH: 'f'.repeat(64) } : field === 'formatId' ? 'foreign' : 'f'.repeat(64);
    save(root, 'runtime.json', { subject: { ...subject, [field]: value } });
    expect(printedSupportReportMain(args, io)).toBe(1);
    expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('provenance does not match'));
    expect(execFileSync).not.toHaveBeenCalled();
  },
);

it('refuses an archive that changes while the inventory is being read', () => {
  const { root, args, io } = fixture();
  vi.mocked(execFileSync).mockImplementation(() => {
    writeFileSync(join(root, 'cards.zip'), 'changed during extraction');
    return Buffer.from(script);
  });
  expect(printedSupportReportMain(args, io)).toBe(1);
  expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('changed during verification'));
  expect(io.stdout).not.toHaveBeenCalled();
});

it('rejects a file as evidence root and a valid archive returning changed script bytes', () => {
  const { root, config, args, io } = fixture();
  save(root, 'config.json', { ...config, evidenceRoot: 'cards.zip' });
  expect(printedSupportReportMain(args, io)).toBe(1);
  expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('Evidence root must be a directory'));
  save(root, 'config.json', config);
  vi.mocked(execFileSync).mockReturnValue(Buffer.from('changed script'));
  expect(printedSupportReportMain(args, io)).toBe(1);
  expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('script checksum mismatch'));
});

it('uses the default output streams and reports non-Error extraction failures', () => {
  const { args } = fixture();
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  try {
    expect(printedSupportReportMain(['--help'])).toBe(0);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('does not enable play'));
    vi.mocked(execFileSync).mockImplementation(() => {
      throw 'fixture failure';
    });
    expect(printedSupportReportMain(args)).toBe(1);
    expect(stderr).toHaveBeenCalledWith('Printed support report failed: fixture failure\n');
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
});

it('the executable exposes help and exits nonzero without an explicit config', async () => {
  const actual = await vi.importActual<{ execFileSync: typeof execFileSync }>('node:child_process');
  const command = ['--import', 'tsx', 'packages/data/tools/printed-support-report.ts'];
  const options = { encoding: 'utf8', timeout: 10000, stdio: 'pipe' } as const;
  expect(actual.execFileSync(process.execPath, [...command, '--help'], options)).toContain(
    'does not enable play',
  );
  expect(() => actual.execFileSync(process.execPath, command, options)).toThrow();
}, 15000);

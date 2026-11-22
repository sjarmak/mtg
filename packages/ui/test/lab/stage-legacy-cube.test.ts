/** The play launcher stages the printed cube beside, never inside, set.json. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { describe, expect, it, vi } from 'vitest';
import {
  LEGACY_CUBE_FORGE_READY_FILENAME,
  LEGACY_CUBE_TOKEN_PRINTINGS_FILENAME,
  stageLegacyCubeCatalog,
  stageLegacyCubeForgeReadyPool,
  stageLegacyCubeTokenPrintings,
} from '../../tools/stage-legacy-cube';
import { writeCompleteLegacyCubeLedgerFixture } from '../legacy-cube/complete-ledger-fixture';

/**
 * Budgeted at 20s rather than left to vitest's 5s default. Measured with this
 * file alone, MTG_TEST_WORKERS=1, three runs at host load 9.9 to 10.4 on 16
 * cores: the slowest test (the 600-card byte copy) took 2.2 to 2.5s, so 20s is
 * about 8x the worst run.
 *
 * The default was too tight under load: the copy was seen at 5553ms once at
 * load 20 to 29, so the default decided which lane went red.
 *
 * File-scoped on purpose: the global `testTimeout` stays at the default and
 * nothing retries (`mtg-tqwbq`).
 */
vi.setConfig({ testTimeout: 20_000 });

const SOURCE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
  'data',
  'legacy-cube-2021-card-catalog-v1.json',
);
const LEDGER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'data',
  'data',
  'legacy-cube-2021-forge-decisions-v1.json',
);
const PLAY_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'play.ts'),
  'utf8',
);
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const BACKEND_SOURCE = readFileSync(join(REPO_ROOT, 'packages/ui/tools/backend-service.ts'), 'utf8');

describe('Legacy Cube launcher staging', () => {
  it('keeps every browser-staged Legacy Cube artifact out of version control', () => {
    for (const filename of [
      'legacy-cube-2021-card-catalog-v1.json',
      LEGACY_CUBE_FORGE_READY_FILENAME,
      LEGACY_CUBE_TOKEN_PRINTINGS_FILENAME,
    ]) {
      expect(() =>
        execFileSync('git', ['check-ignore', '-q', '--', `packages/ui/public/${filename}`], {
          cwd: REPO_ROOT,
          stdio: 'ignore',
        }),
      ).not.toThrow();
    }
  });

  it('wires the staged artifact and bounded backend gateway into npm run play', () => {
    expect(PLAY_SOURCE).toMatch(/stageLegacyCubeCatalog\(/u);
    expect(PLAY_SOURCE).toMatch(/stageLegacyCubeTokenPrintings\(/u);
    expect(PLAY_SOURCE).toMatch(/startBackendService\(/u);
    expect(BACKEND_SOURCE).toMatch(/serveBackendGateway\(/u);
    expect(BACKEND_SOURCE).toMatch(/compileInstalledForgeBridge\(/u);
    expect(BACKEND_SOURCE).toMatch(/compiledBridgeClasses: compiled\.classDirectory/u);
    expect(BACKEND_SOURCE).toMatch(/installedForgeBackend\(/u);
    expect(BACKEND_SOURCE).toMatch(/isolatedObservedBackend\(forge, forgeFactory\)/u);
    expect(BACKEND_SOURCE).toMatch(/process\.once\('exit', disposeCompiled\)/u);
    expect(BACKEND_SOURCE).toMatch(
      /const disposeRuntime = \(removeAdmissionRoot: boolean\): void => \{[\s\S]*?compiled\?\.dispose\(\);/u,
    );
    expect(BACKEND_SOURCE).toMatch(
      /closing \?\?= gateway\.close\(\)\.then\(\s*\(\) => disposeRuntime\(true\),/u,
    );
    expect(PLAY_SOURCE).toMatch(/MTG_BACKEND_GATEWAY_PORT/u);
  });

  it('copies the verified 600-card portable artifact byte for byte', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-legacy-stage-'));
    const target = join(directory, 'legacy-cube.json');
    const result = await stageLegacyCubeCatalog(SOURCE, target);

    expect(result).toMatchObject({ status: 'ready', cards: 600, format: 'legacy-cube-2021-08' });
    expect(readFileSync(target)).toEqual(readFileSync(SOURCE));
  });

  it('refuses to disguise an incomplete admission projection as a smaller cube draft', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-legacy-ready-stage-'));
    const incomplete = join(directory, 'incomplete-ledger.json');
    const first = join(directory, LEGACY_CUBE_FORGE_READY_FILENAME);
    const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as {
      bridgeReview: unknown;
      families: unknown;
      controllerSurface: unknown;
      syntaxReview: unknown;
      syntaxInventory: unknown;
      auditedCards: Array<{ corpus: string; cardFamilySafe: boolean }>;
      runtimeProbes: unknown;
      contentSha256: string;
    };
    const official = ledger.auditedCards.find((card) => card.corpus === 'official-full-cardlist');
    if (official === undefined) throw new Error('fixture ledger has no official row');
    official.cardFamilySafe = false;
    const content = {
      bridgeReview: ledger.bridgeReview,
      families: ledger.families,
      controllerSurface: ledger.controllerSurface,
      syntaxReview: ledger.syntaxReview,
      syntaxInventory: ledger.syntaxInventory,
      auditedCards: ledger.auditedCards,
      runtimeProbes: ledger.runtimeProbes,
    };
    ledger.contentSha256 = createHash('sha256')
      .update(`${JSON.stringify(content)}\n`)
      .digest('hex');
    writeFileSync(incomplete, JSON.stringify(ledger));

    writeFileSync(first, 'stale');
    await expect(stageLegacyCubeForgeReadyPool(SOURCE, incomplete, first)).rejects.toThrow(
      /complete.*600.*599|599.*complete.*600/i,
    );
    expect(existsSync(first)).toBe(false);
  });

  it('derives one deterministic eight-seat pool from all 600 admitted positions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-legacy-complete-stage-'));
    const completeLedger = writeCompleteLegacyCubeLedgerFixture(LEDGER, join(directory, 'ledger.json'));
    const first = join(directory, LEGACY_CUBE_FORGE_READY_FILENAME);
    const second = join(directory, 'second.json');

    const staged = await stageLegacyCubeForgeReadyPool(SOURCE, completeLedger, first);
    const repeated = await stageLegacyCubeForgeReadyPool(SOURCE, completeLedger, second);
    const artifact = JSON.parse(readFileSync(first, 'utf8')) as {
      cards: number;
      positions: number[];
      draft: { seats: number; rounds: number; packSize: number };
      catalogContentSha256: string;
      decisionLedgerContentSha256: string;
      decisionLedgerFileSha256: string;
      contentSha256: string;
    };

    expect(staged).toMatchObject({ status: 'ready', cards: 600, seats: 8, forgeVersion: '2.0.14' });
    expect(repeated).toEqual(staged);
    expect(readFileSync(second)).toEqual(readFileSync(first));
    const bytes = readFileSync(first, 'utf8');
    expect(bytes.endsWith('\n')).toBe(true);
    expect(bytes).toBe(
      await format(bytes, {
        ...((await resolveConfig(fileURLToPath(import.meta.url))) ?? {}),
        parser: 'json',
      }),
    );
    expect(artifact.cards).toBe(600);
    expect(artifact.positions).toEqual(Array.from({ length: 600 }, (_unused, index) => index + 1));
    expect(artifact.draft).toEqual({ seats: 8, rounds: 3, packSize: 15 });
    expect(artifact.catalogContentSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(artifact.decisionLedgerContentSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(artifact.decisionLedgerFileSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(artifact.contentSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('refuses ledger rows that do not exactly identify their catalog position', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-legacy-ready-hostile-'));
    const drifted = join(directory, 'ledger.json');
    const target = join(directory, 'ready.json');
    const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as {
      auditedCards: Array<{ corpus: string; correctedName: string }>;
    };
    const official = ledger.auditedCards.find((card) => card.corpus === 'official-full-cardlist');
    if (official === undefined) throw new Error('fixture ledger has no official row');
    official.correctedName = 'Not the catalog card';
    writeFileSync(drifted, JSON.stringify(ledger));
    writeFileSync(target, 'stale');

    await expect(stageLegacyCubeForgeReadyPool(SOURCE, drifted, target)).rejects.toThrow(
      /ledger.*position.*does not match/i,
    );
    expect(existsSync(target)).toBe(false);
  });

  it('refuses a safe-card projection whose ledger content checksum is stale', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-legacy-ready-checksum-'));
    const drifted = join(directory, 'ledger.json');
    const target = join(directory, 'ready.json');
    const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as {
      auditedCards: Array<{ corpus: string; cardFamilySafe: boolean }>;
    };
    const official = ledger.auditedCards.find((card) => card.corpus === 'official-full-cardlist');
    if (official === undefined) throw new Error('fixture ledger has no official row');
    official.cardFamilySafe = !official.cardFamilySafe;
    writeFileSync(drifted, JSON.stringify(ledger));
    writeFileSync(target, 'stale');

    await expect(stageLegacyCubeForgeReadyPool(SOURCE, drifted, target)).rejects.toThrow(
      /ledger content checksum drift/i,
    );
    expect(existsSync(target)).toBe(false);
  });

  it('stages the token sheet byte for byte and removes it when the source is gone', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-legacy-tokens-'));
    const target = join(directory, 'tokens.json');
    const source = join(dirname(SOURCE), LEGACY_CUBE_TOKEN_PRINTINGS_FILENAME);
    const result = await stageLegacyCubeTokenPrintings(source, target);

    expect(result).toMatchObject({ status: 'ready', forgeVersion: '2.0.14' });
    expect(result.status === 'ready' && result.tokens).toBeGreaterThan(0);
    expect(readFileSync(target)).toEqual(readFileSync(source));

    await expect(stageLegacyCubeTokenPrintings(join(directory, 'missing.json'), target)).resolves.toEqual({
      status: 'absent',
    });
    expect(existsSync(target)).toBe(false);

    writeFileSync(target, 'stale');
    const invalid = join(directory, 'invalid.json');
    writeFileSync(invalid, '{"schemaVersion":1,"sets":[],"tokens":[]}');
    await expect(stageLegacyCubeTokenPrintings(invalid, target)).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });

  it('removes a stale target when the source is absent or invalid', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'mtg-legacy-stage-bad-'));
    const target = join(directory, 'legacy-cube.json');
    writeFileSync(target, 'stale');
    await expect(stageLegacyCubeCatalog(join(directory, 'missing.json'), target)).resolves.toEqual({
      status: 'absent',
    });
    expect(existsSync(target)).toBe(false);

    writeFileSync(target, 'stale again');
    const invalid = join(directory, 'invalid.json');
    writeFileSync(invalid, '{"cards":[]}');
    await expect(stageLegacyCubeCatalog(invalid, target)).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });
});

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import {
  loadGeneralForgeHoldoutInputs,
  prepareGeneralForgeHoldoutInputs,
} from '../../tools/general-forge-holdout-input';
import { parseGeneralForgeHoldoutCommand } from '../../tools/forge-bot-strength-holdout';

const roots: string[] = [];
const repoRoot = process.cwd();

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function newOutput(): string {
  const root = mkdtempSync(join(tmpdir(), 'general-forge-holdout-'));
  roots.push(root);
  return join(root, 'sealed');
}

it('seals deterministic fresh Cube and printed Limited decks with exact byte hashes', async () => {
  const first = newOutput();
  const second = newOutput();
  const firstManifest = await prepareGeneralForgeHoldoutInputs(repoRoot, first);
  const secondManifest = await prepareGeneralForgeHoldoutInputs(repoRoot, second);

  expect(firstManifest).toEqual(secondManifest);
  expect(firstManifest.version).toBe('general-forge-holdout-input/v1');
  expect(firstManifest.split).toBe('holdout');
  expect(firstManifest.cube.root).toBe('general-forge-holdout-v1');
  expect(firstManifest.printed).toEqual({ draftSeed: 970031, sealedSeed: 970032 });
  expect(firstManifest.decks.map((deck) => deck.id)).toEqual([
    'cubeFocal',
    'cubeOpponentA',
    'cubeOpponentB',
    'draftFocal',
    'draftOpponent',
    'sealedFocal',
    'sealedOpponent',
  ]);

  for (const deck of firstManifest.decks) {
    const bytes = readFileSync(join(first, deck.file));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(deck.sha256);
  }
  expect(loadGeneralForgeHoldoutInputs(first).manifest).toEqual(firstManifest);
  await expect(prepareGeneralForgeHoldoutInputs(repoRoot, first)).rejects.toThrow();
});

it('seals an explicitly versioned population without reusing v1 decks or seeds', async () => {
  const first = newOutput();
  const second = newOutput();
  const v1 = await prepareGeneralForgeHoldoutInputs(repoRoot, first);
  const v2 = await prepareGeneralForgeHoldoutInputs(repoRoot, second, {
    campaignId: 'general-forge-holdout-v2',
    draftSeed: 980031,
    sealedSeed: 980032,
  });

  expect(v2.campaignId).toBe('general-forge-holdout-v2');
  expect(v2.cube.root).toBe('general-forge-holdout-v2');
  expect(v2.printed).toEqual({ draftSeed: 980031, sealedSeed: 980032 });
  const v1Decks = new Set(v1.decks.map((deck) => deck.sha256));
  expect(v2.decks.every((deck) => !v1Decks.has(deck.sha256))).toBe(true);
  expect(loadGeneralForgeHoldoutInputs(second).manifest).toEqual(v2);
});

it('requires explicit valid campaign identity and distinct seeds at the CLI boundary', () => {
  expect(
    parseGeneralForgeHoldoutCommand([
      '--prepare',
      'out/new-input',
      '--campaign',
      'general-forge-holdout-v2',
      '--draft-seed',
      '980031',
      '--sealed-seed',
      '980032',
    ]),
  ).toMatchObject({
    kind: 'prepare',
    specification: {
      campaignId: 'general-forge-holdout-v2',
      draftSeed: 980031,
      sealedSeed: 980032,
    },
  });
  expect(() =>
    parseGeneralForgeHoldoutCommand([
      '--prepare',
      'out/new-input',
      '--campaign',
      'general-forge-holdout-v2',
      '--draft-seed',
      '980031',
      '--sealed-seed',
      '980031',
    ]),
  ).toThrow(/distinct/u);
});

it('labels a replay of sealed inputs as tuning under a fresh campaign identity', () => {
  expect(
    parseGeneralForgeHoldoutCommand([
      '--tuning-input',
      'out/bot-strength/general-forge-holdout-v2-input',
      '--out',
      'out/bot-strength/general-forge-optional-cost-tuning-v1',
      '--campaign',
      'general-forge-optional-cost-tuning-v1',
    ]),
  ).toMatchObject({
    kind: 'run',
    campaign: {
      id: 'general-forge-optional-cost-tuning-v1',
      split: 'tuning',
      seedPrefix: 'general-forge-optional-cost-tuning-v1',
    },
  });

  expect(() =>
    parseGeneralForgeHoldoutCommand([
      '--tuning-input',
      'out/input',
      '--out',
      'out/output',
      '--campaign',
      'general-forge-holdout-v3',
    ]),
  ).toThrow(/usage/u);
});

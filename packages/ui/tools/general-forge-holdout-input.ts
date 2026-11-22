/** Freeze untouched cross-format deck inputs before any Forge holdout game runs. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { preparePrintedLimitedFormat } from '@mtg/draft-export';
import { renderDeck } from '@mtg/forge-export';
import { buildCalibrationDeck, calibrationSeed, draftCalibrationPool } from '@mtg/metrics';
import { parsePrintedCardCatalog, parsePrintedFormat } from '@mtg/printed-card';
import { loadForgeDeckFile, type LoadedForgeDeckFile } from './forge-deck-file';
import { samplePrintedLimitedDecks } from './printed-limited-decks';
import { loadPrintedAdmissionSource, parsePrintedFormatRegistry } from './printed-format-registry';

const DEFAULT_CAMPAIGN_ID = 'general-forge-holdout-v1';
const PRINTED_FORMAT = 'akh-hou';
const DEFAULT_DRAFT_SEED = 970031;
const DEFAULT_SEALED_SEED = 970032;
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const CampaignId = z.string().regex(/^general-forge-holdout-v[1-9][0-9]*$/u);
const Seed = z.number().int().positive().safe();
const GeneralForgeHoldoutSpecificationSchema = z
  .strictObject({
    campaignId: CampaignId,
    draftSeed: Seed,
    sealedSeed: Seed,
  })
  .refine((specification) => specification.draftSeed !== specification.sealedSeed, {
    message: 'draft and sealed seeds must be distinct',
  });
export type GeneralForgeHoldoutSpecification = z.infer<typeof GeneralForgeHoldoutSpecificationSchema>;
const DeckId = z.enum([
  'cubeFocal',
  'cubeOpponentA',
  'cubeOpponentB',
  'draftFocal',
  'draftOpponent',
  'sealedFocal',
  'sealedOpponent',
]);

const GeneralForgeHoldoutInputSchema = z
  .strictObject({
    version: z.literal('general-forge-holdout-input/v1'),
    campaignId: CampaignId,
    split: z.literal('holdout'),
    cube: z.strictObject({
      root: CampaignId,
      draftSeed: Sha256,
      policy: z.literal('power'),
      catalogSha256: Sha256,
      builderVersion: z.string().trim().min(1),
    }),
    printed: z.strictObject({
      draftSeed: Seed,
      sealedSeed: Seed,
    }),
    decks: z
      .array(
        z.strictObject({
          id: DeckId,
          file: z.string().regex(/^decks\/[a-z][a-z0-9-]*\.dck$/u),
          sha256: Sha256,
        }),
      )
      .length(7),
  })
  .superRefine((manifest, context) => {
    if (manifest.cube.root !== manifest.campaignId)
      context.addIssue({ code: 'custom', message: 'cube root must match campaign id' });
    if (manifest.printed.draftSeed === manifest.printed.sealedSeed)
      context.addIssue({ code: 'custom', message: 'draft and sealed seeds must be distinct' });
    if (new Set(manifest.decks.map((deck) => deck.id)).size !== manifest.decks.length)
      context.addIssue({ code: 'custom', message: 'duplicate holdout deck id' });
    if (new Set(manifest.decks.map((deck) => deck.file)).size !== manifest.decks.length)
      context.addIssue({ code: 'custom', message: 'duplicate holdout deck file' });
    if (new Set(manifest.decks.map((deck) => deck.sha256)).size !== manifest.decks.length)
      context.addIssue({ code: 'custom', message: 'holdout deck hashes must be unique' });
  });

export type GeneralForgeHoldoutInput = z.infer<typeof GeneralForgeHoldoutInputSchema>;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function cubeDeckText(deck: ReturnType<typeof buildCalibrationDeck>, name: string): string {
  return renderDeck({
    name,
    entries: deck.ref.cards.map((card) => ({ count: card.count, cardName: card.name })),
  });
}

function printedSource(repoRoot: string) {
  const registry = parsePrintedFormatRegistry(
    repoRoot,
    JSON.parse(readFileSync(join(repoRoot, 'packages/data/data/printed-formats-v1.json'), 'utf8')),
  );
  const source = registry.find((entry) => {
    const input = JSON.parse(readFileSync(join(entry.directory, entry.formatFile), 'utf8')) as unknown;
    return parsePrintedFormat(input).id === PRINTED_FORMAT;
  });
  if (source === undefined) throw new Error(`Printed registry has no ${PRINTED_FORMAT} format.`);
  const admission = loadPrintedAdmissionSource(source);
  if (admission === undefined) throw new Error(`${PRINTED_FORMAT} has no installed play admission.`);
  return admission;
}

function writeDecks(output: string, texts: Readonly<Record<z.infer<typeof DeckId>, string>>) {
  const names: Readonly<Record<z.infer<typeof DeckId>, string>> = {
    cubeFocal: 'cube-focal.dck',
    cubeOpponentA: 'cube-opponent-a.dck',
    cubeOpponentB: 'cube-opponent-b.dck',
    draftFocal: 'draft-focal.dck',
    draftOpponent: 'draft-opponent.dck',
    sealedFocal: 'sealed-focal.dck',
    sealedOpponent: 'sealed-opponent.dck',
  };
  return DeckId.options.map((id) => {
    const file = `decks/${names[id]}`;
    const text = texts[id];
    writeFileSync(join(output, file), text, { flag: 'wx' });
    return { id, file, sha256: sha256(text) };
  });
}

/** Create a new sealed input directory; a partial preparation is never a valid manifest. */
export async function prepareGeneralForgeHoldoutInputs(
  repoRootInput: string,
  outputDirectory: string,
  specificationInput: GeneralForgeHoldoutSpecification = {
    campaignId: DEFAULT_CAMPAIGN_ID,
    draftSeed: DEFAULT_DRAFT_SEED,
    sealedSeed: DEFAULT_SEALED_SEED,
  },
): Promise<GeneralForgeHoldoutInput> {
  const specification = GeneralForgeHoldoutSpecificationSchema.parse(specificationInput);
  const repoRoot = resolve(repoRootInput);
  const output = resolve(outputDirectory);
  mkdirSync(output);
  mkdirSync(join(output, 'decks'));

  const cubeCatalog = parsePrintedCardCatalog(
    JSON.parse(
      readFileSync(join(repoRoot, 'packages/data/data/legacy-cube-2021-card-catalog-v1.json'), 'utf8'),
    ),
  );
  const cubeSeed = calibrationSeed(specification.campaignId, 'holdout', 'draft', 0);
  const cubeDraft = draftCalibrationPool(cubeCatalog, cubeSeed, 'power');
  const cubeFocal = buildCalibrationDeck(cubeDraft.pool, 'holdout-cube-focal');
  const opponentPools = cubeDraft.opponentPools.slice(0, 2);
  if (opponentPools.length !== 2) throw new Error('Cube holdout requires two frozen opponents.');
  const cubeOpponentA = buildCalibrationDeck(opponentPools[0]!.pool, 'holdout-cube-opponent-a');
  const cubeOpponentB = buildCalibrationDeck(opponentPools[1]!.pool, 'holdout-cube-opponent-b');

  const admission = printedSource(repoRoot);
  const prepared = await preparePrintedLimitedFormat(admission.format, admission.catalogs, async (text) =>
    sha256(text),
  );
  const draft = samplePrintedLimitedDecks(prepared, 'draft', specification.draftSeed);
  const sealed = samplePrintedLimitedDecks(prepared, 'sealed', specification.sealedSeed);
  const decks = writeDecks(output, {
    cubeFocal: cubeDeckText(cubeFocal, 'holdout-cube-focal'),
    cubeOpponentA: cubeDeckText(cubeOpponentA, 'holdout-cube-opponent-a'),
    cubeOpponentB: cubeDeckText(cubeOpponentB, 'holdout-cube-opponent-b'),
    draftFocal: draft[0].text,
    draftOpponent: draft[1].text,
    sealedFocal: sealed[0].text,
    sealedOpponent: sealed[1].text,
  });
  const manifest = GeneralForgeHoldoutInputSchema.parse({
    version: 'general-forge-holdout-input/v1',
    campaignId: specification.campaignId,
    split: 'holdout',
    cube: {
      root: specification.campaignId,
      draftSeed: cubeSeed,
      policy: 'power',
      catalogSha256: cubeCatalog.contentSha256,
      builderVersion: cubeFocal.builderVersion,
    },
    printed: { draftSeed: specification.draftSeed, sealedSeed: specification.sealedSeed },
    decks,
  });
  writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

/** Re-read a sealed input and reject changed, missing, or extra deck bytes. */
export function loadGeneralForgeHoldoutInputs(outputDirectory: string): {
  readonly manifest: GeneralForgeHoldoutInput;
  readonly decks: ReadonlyMap<z.infer<typeof DeckId>, LoadedForgeDeckFile>;
} {
  const output = resolve(outputDirectory);
  const manifest = GeneralForgeHoldoutInputSchema.parse(
    JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')),
  );
  const expectedFiles = manifest.decks.map((deck) => deck.file.slice('decks/'.length)).sort();
  const actualFiles = readdirSync(join(output, 'decks')).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles))
    throw new Error('Holdout deck directory differs from its sealed manifest.');
  const decks = new Map<z.infer<typeof DeckId>, LoadedForgeDeckFile>();
  for (const entry of manifest.decks) {
    const loaded = loadForgeDeckFile(join(output, entry.file));
    if (loaded.sha256 !== entry.sha256) throw new Error(`Holdout deck hash drift: ${entry.id}`);
    decks.set(entry.id, loaded);
  }
  return { manifest, decks };
}

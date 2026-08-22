/**
 * The pool the one recorded live call was made against.
 *
 * Thirty-nine real cards, each one checked against `data/store/mtg.sqlite` for
 * its exact printed name, mana cost, mana value, type line and Modern legality
 * before it was written down here. It stands in for the real Modern pool at a
 * size that can be committed: the whole legal pool is ~20,000 rows and a
 * fixture cannot carry it, while a pool of invented cards could never be hit by
 * a model choosing from cards it actually knows.
 *
 * The excluded names are real cards the store holds and this pool does not,
 * which is the distinction the gate has to draw between a card the model
 * invented and a card the cube may not have. They arrive from two places and
 * the split is the point: `STRUCTURALLY_EXCLUDED` are chosen here for a stated
 * reason that predates any answer, and the rest are derived from the recording
 * by `tools/record-proposal.ts`, which asks the store about every name the
 * model actually used. Naming the model's card here by hand is what made the
 * headline assertion in `recorded-proposal.test.ts` partly constructed after
 * seeing the answer (mtg-bc2.125).
 *
 * Changing anything in this file that reaches the prompt changes the fixture
 * key, which means the recording has to be made again: `npx tsx
 * packages/cube/tools/record-proposal.ts`. The excluded names are not such a
 * thing — they are `knownNames`, not the pool.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CandidateCard } from '@mtg/decklab';
import { CubeCriteriaSchema } from '../../src/criteria';
import { fixtureCard, fixturePool } from './fixture-cube';
import type { CardSpec } from './fixture-cube';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where the one recorded request/response pair lives. */
export const FIXTURE_DIR = join(PACKAGE_ROOT, 'fixtures', 'llm');

/** Where the derived excluded names live, beside the recording they came from. */
export const EXCLUDED_PATH = join(PACKAGE_ROOT, 'fixtures', 'recorded-excluded.json');

const BOROS: readonly CardSpec[] = [
  { name: 'Lightning Bolt', manaCost: '{R}', manaValue: 1, typeLine: 'Instant', colorIdentity: 'R' },
  {
    name: 'Monastery Swiftspear',
    manaCost: '{R}',
    manaValue: 1,
    typeLine: 'Creature — Human Monk',
    colorIdentity: 'R',
  },
  {
    name: 'Goblin Guide',
    manaCost: '{R}',
    manaValue: 1,
    typeLine: 'Creature — Goblin Scout',
    colorIdentity: 'R',
  },
  { name: 'Lava Spike', manaCost: '{R}', manaValue: 1, typeLine: 'Sorcery — Arcane', colorIdentity: 'R' },
  { name: 'Boros Charm', manaCost: '{R}{W}', manaValue: 2, typeLine: 'Instant', colorIdentity: 'WR' },
  { name: 'Skewer the Critics', manaCost: '{2}{R}', manaValue: 3, typeLine: 'Sorcery', colorIdentity: 'R' },
  {
    name: 'Eidolon of the Great Revel',
    manaCost: '{R}{R}',
    manaValue: 2,
    typeLine: 'Enchantment Creature — Spirit',
    colorIdentity: 'R',
  },
  {
    name: 'Kor Skyfisher',
    manaCost: '{1}{W}',
    manaValue: 2,
    typeLine: 'Creature — Kor Soldier',
    colorIdentity: 'W',
  },
  {
    name: 'Thalia, Guardian of Thraben',
    manaCost: '{1}{W}',
    manaValue: 2,
    typeLine: 'Legendary Creature — Human Soldier',
    colorIdentity: 'W',
  },
  {
    name: 'Adanto Vanguard',
    manaCost: '{1}{W}',
    manaValue: 2,
    typeLine: 'Creature — Vampire Soldier',
    colorIdentity: 'W',
  },
  { name: 'Lightning Helix', manaCost: '{R}{W}', manaValue: 2, typeLine: 'Instant', colorIdentity: 'WR' },
  {
    name: 'Showdown of the Skalds',
    manaCost: '{2}{R}{W}',
    manaValue: 4,
    typeLine: 'Enchantment — Saga',
    colorIdentity: 'WR',
  },
  {
    name: 'Seasoned Pyromancer',
    manaCost: '{1}{R}{R}',
    manaValue: 3,
    typeLine: 'Creature — Human Shaman',
    colorIdentity: 'R',
  },
  {
    name: 'Ragavan, Nimble Pilferer',
    manaCost: '{R}',
    manaValue: 1,
    typeLine: 'Legendary Creature — Monkey Pirate',
    colorIdentity: 'R',
  },
  {
    name: 'Phoenix Chick',
    manaCost: '{R}',
    manaValue: 1,
    typeLine: 'Creature — Phoenix',
    colorIdentity: 'R',
  },
  {
    name: 'Bomat Courier',
    manaCost: '{1}',
    manaValue: 1,
    typeLine: 'Artifact Creature — Construct',
    colorIdentity: 'R',
  },
  { name: 'Path to Exile', manaCost: '{W}', manaValue: 1, typeLine: 'Instant', colorIdentity: 'W' },
  { name: 'Prismatic Ending', manaCost: '{X}{W}', manaValue: 1, typeLine: 'Sorcery', colorIdentity: 'W' },
  {
    name: 'Solitude',
    manaCost: '{3}{W}{W}',
    manaValue: 5,
    typeLine: 'Creature — Elemental Incarnation',
    colorIdentity: 'W',
  },
  { name: 'Ephemerate', manaCost: '{W}', manaValue: 1, typeLine: 'Instant', colorIdentity: 'W' },
  { name: 'Static Prison', manaCost: '{W}', manaValue: 1, typeLine: 'Enchantment', colorIdentity: 'W' },
];

const DIMIR: readonly CardSpec[] = [
  { name: 'Counterspell', manaCost: '{U}{U}', manaValue: 2, typeLine: 'Instant', colorIdentity: 'U' },
  { name: 'Thoughtseize', manaCost: '{B}', manaValue: 1, typeLine: 'Sorcery', colorIdentity: 'B' },
  { name: 'Fatal Push', manaCost: '{B}', manaValue: 1, typeLine: 'Instant', colorIdentity: 'B' },
  { name: 'Drown in the Loch', manaCost: '{U}{B}', manaValue: 2, typeLine: 'Instant', colorIdentity: 'UB' },
  {
    name: 'Murktide Regent',
    manaCost: '{5}{U}{U}',
    manaValue: 7,
    typeLine: 'Creature — Dragon',
    colorIdentity: 'U',
  },
  {
    name: 'Snapcaster Mage',
    manaCost: '{1}{U}',
    manaValue: 2,
    typeLine: 'Creature — Human Wizard',
    colorIdentity: 'U',
  },
  { name: 'Consider', manaCost: '{U}', manaValue: 1, typeLine: 'Instant', colorIdentity: 'U' },
  { name: 'Opt', manaCost: '{U}', manaValue: 1, typeLine: 'Instant', colorIdentity: 'U' },
  { name: "Archmage's Charm", manaCost: '{U}{U}{U}', manaValue: 3, typeLine: 'Instant', colorIdentity: 'U' },
  {
    name: 'Ledger Shredder',
    manaCost: '{1}{U}',
    manaValue: 2,
    typeLine: 'Creature — Bird Advisor',
    colorIdentity: 'U',
  },
  {
    name: 'Sheoldred, the Apocalypse',
    manaCost: '{2}{B}{B}',
    manaValue: 4,
    typeLine: 'Legendary Creature — Phyrexian Praetor',
    colorIdentity: 'B',
  },
  {
    name: 'Cryptic Command',
    manaCost: '{1}{U}{U}{U}',
    manaValue: 4,
    typeLine: 'Instant',
    colorIdentity: 'U',
  },
  { name: 'Force of Negation', manaCost: '{1}{U}{U}', manaValue: 3, typeLine: 'Instant', colorIdentity: 'U' },
  {
    name: "Tasha's Hideous Laughter",
    manaCost: '{1}{U}{U}',
    manaValue: 3,
    typeLine: 'Sorcery',
    colorIdentity: 'U',
  },
  {
    name: 'Kaito Shizuki',
    manaCost: '{1}{U}{B}',
    manaValue: 3,
    typeLine: 'Legendary Planeswalker — Kaito',
    colorIdentity: 'UB',
  },
  {
    name: 'Dauthi Voidwalker',
    manaCost: '{B}{B}',
    manaValue: 2,
    typeLine: 'Creature — Dauthi Rogue',
    colorIdentity: 'B',
  },
  {
    name: 'Bitterblossom',
    manaCost: '{1}{B}',
    manaValue: 2,
    typeLine: 'Kindred Enchantment — Faerie',
    colorIdentity: 'B',
  },
  { name: 'Inquisition of Kozilek', manaCost: '{B}', manaValue: 1, typeLine: 'Sorcery', colorIdentity: 'B' },
];

/**
 * Real cards left out for a reason stated before the model was ever asked: two
 * banned in Modern, one never legal there. Nothing chose them from an answer,
 * which is why they can stay written down.
 */
const STRUCTURALLY_EXCLUDED: readonly string[] = ['Fury', 'Grief', 'Baleful Strix'];

const DerivedExcludedSchema = z
  .object({
    /** The recording these names were read out of, so the two cannot drift apart. */
    fixtureKey: z.string().min(1),
    names: z.array(z.string().min(1)),
  })
  .strict();

export type DerivedExcluded = z.infer<typeof DerivedExcludedSchema>;

/**
 * The store cards the recorded answer named that this pool does not hold.
 *
 * Read from disk rather than declared, and read strictly: a missing or
 * malformed file is a hard error naming the tool that writes it, because an
 * empty list would quietly turn the gate's "that one is not available here"
 * into "you made it up" and the test asserting the difference would fail
 * somewhere else entirely.
 */
export function loadDerivedExcluded(): DerivedExcluded {
  if (!existsSync(EXCLUDED_PATH)) {
    throw new Error(
      `missing ${EXCLUDED_PATH}; it is a tracked artifact — restore it with git checkout, ` +
        'or regenerate it with `npx tsx packages/cube/tools/record-proposal.ts`',
    );
  }
  return DerivedExcludedSchema.parse(JSON.parse(readFileSync(EXCLUDED_PATH, 'utf8')));
}

export const DERIVED_EXCLUDED = loadDerivedExcluded();

export const RECORDED_CARDS: readonly CandidateCard[] = [...BOROS, ...DIMIR].map(fixtureCard);

export const RECORDED_POOL = fixturePool(
  RECORDED_CARDS,
  [...STRUCTURALLY_EXCLUDED, ...DERIVED_EXCLUDED.names],
  ['legal in modern', 'no card over $60'],
);

export const RECORDED_CRITERIA = CubeCriteriaSchema.parse({
  prompt:
    'a two-archetype practice cube: boros aggro against dimir control, cards a Modern player would know',
  format: 'modern',
  size: 45,
  seats: 3,
  cardsPerSeat: 15,
  maxCardUsd: 60,
  archetypes: [
    { name: 'boros aggro', colors: ['W', 'R'], minPlayable: 9 },
    { name: 'dimir control', colors: ['U', 'B'], minPlayable: 9 },
  ],
});

/** Cards the one recorded round was asked for. */
export const RECORDED_NEED = 18;

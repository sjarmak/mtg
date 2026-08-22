/**
 * A built deck the artifact tests share, and the store it was built from.
 *
 * Two files consume it: `artifact.test.ts`, which checks what the producer
 * writes, and `artifact-seam.test.ts`, which reads that output back through
 * `@mtg/ui`'s independent declaration of the same document. Both must run the
 * real producer over the real assembler, so the deck is built once here rather
 * than hand-written twice — a seam test that builds its own artifact proves
 * nothing about the producer.
 */
import { assembleDeck } from '../../src/assemble';
import type { BuiltDeck } from '../../src/build';
import { DeckCriteriaSchema } from '../../src/criteria';
import { resolveCriteria, type LandPlan } from '../../src/land-plan';
import { parseManaCost } from '../../src/mana-cost';
import type { CandidateCard } from '../../src/candidates';
import type { Inclusion } from '../../src/verify';
import type { FakeCard } from './fake-store';

export const ART = 'https://cards.example/bolt-art.jpg';
const REPRINT_ART = 'https://cards.example/bolt-reprint.jpg';
export const MOUNTAIN_ART = 'https://cards.example/mountain-art.jpg';

export const DECK_CARDS: readonly FakeCard[] = [
  {
    name: 'Lightning Bolt',
    manaCost: '{R}',
    manaValue: 1,
    typeLine: 'Instant',
    colorIdentity: 'R',
    priceUsd: 2.5,
    printings: [
      // Digital-only and released first, so it wins on date and loses on kind:
      // the preference for a real printing is what is under test here.
      {
        setCode: 'dig',
        releasedAt: '1993-01-01',
        digital: true,
        imageUris: { art_crop: 'https://cards.example/bolt-digital.jpg' },
      },
      {
        setCode: 'lea',
        releasedAt: '1993-08-05',
        artist: 'Christopher Rush',
        imageUris: { art_crop: ART, normal: 'https://cards.example/bolt-full.jpg' },
      },
      {
        setCode: 'm11',
        releasedAt: '2010-07-16',
        artist: 'Someone Else',
        imageUris: { art_crop: REPRINT_ART },
      },
    ],
  },
  {
    name: 'Goblin Guide',
    manaCost: '{R}',
    manaValue: 1,
    typeLine: 'Creature — Goblin Scout',
    colorIdentity: 'R',
    priceUsd: 8,
    printings: [{ setCode: 'zen', releasedAt: '2009-10-02' }],
  },
  {
    name: 'Plains',
    manaCost: null,
    manaValue: 0,
    typeLine: 'Basic Land — Plains',
    colorIdentity: '',
    producedMana: ['W'],
    printings: [{ setCode: 'lea', releasedAt: '1993-08-05' }],
  },
  {
    name: 'Mountain',
    manaCost: null,
    manaValue: 0,
    typeLine: 'Basic Land — Mountain',
    colorIdentity: '',
    producedMana: ['R'],
    printings: [
      {
        setCode: 'lea',
        releasedAt: '1993-08-05',
        artist: 'Jesper Myrfors',
        imageUris: { art_crop: MOUNTAIN_ART },
      },
    ],
  },
];

function candidate(
  name: string,
  manaCost: string | null,
  typeLine: string,
  manaValue: number,
): CandidateCard {
  return {
    oracleId: name === 'Lightning Bolt' ? 'oracle-0' : 'oracle-1',
    name,
    manaCost,
    manaValue,
    typeLine,
    oracleText: null,
    power: null,
    toughness: null,
    colorIdentity: 'R',
    keywords: [],
    priceUsd: name === 'Lightning Bolt' ? 2.5 : 8,
    parsedCost: parseManaCost(manaCost),
    producedMana: [],
  };
}

export function builtDeck(): BuiltDeck {
  const landPlan: LandPlan = {
    count: 16,
    source: 'model',
    reason: 'a twelve-spell curve topping out at one',
  };
  const criteria = resolveCriteria(
    DeckCriteriaSchema.parse({ prompt: 'red burn', format: 'modern', colors: ['R'], size: 40 }),
    landPlan,
  );
  const inclusions: readonly Inclusion[] = [
    {
      card: candidate('Lightning Bolt', '{R}', 'Instant', 1),
      count: 16,
      criteria: ['format', 'colors'],
      reason: 'three damage for one mana',
    },
    {
      card: candidate('Goblin Guide', '{R}', 'Creature — Goblin Scout', 1),
      count: 8,
      criteria: ['archetype'],
      reason: 'fastest one-drop in the format',
    },
  ];
  const deck = assembleDeck(inclusions, criteria);
  return {
    criteria,
    landPlan,
    deck,
    plan: 'burn them out by turn four',
    rejections: [],
    universeSize: 4_231,
    rounds: 1,
    shortBy: 0,
    report: 'unused here',
  };
}

/**
 * The mtg-bc2.81 case at the seam: a deck of colorless spells, whose land slot
 * the basic split has no pip demand to apportion anything to. The artifact used
 * to claim a size that counted lands it then listed none of.
 */
export function builtColorlessDeck(): BuiltDeck {
  const landPlan: LandPlan = {
    count: 16,
    source: 'model',
    reason: 'a curve that tops out at zero',
  };
  const criteria = resolveCriteria(
    DeckCriteriaSchema.parse({ prompt: 'artifacts', format: 'modern', size: 40 }),
    landPlan,
  );
  const card: CandidateCard = {
    ...candidate('Ornithopter', '{0}', 'Artifact Creature — Thopter', 0),
    colorIdentity: '',
  };
  const deck = assembleDeck([{ card, count: 24, criteria: ['format'], reason: 'free body' }], criteria);
  return {
    criteria,
    landPlan,
    deck,
    plan: 'a pile of artifacts',
    rejections: [],
    universeSize: 1_204,
    rounds: 1,
    shortBy: 0,
    report: 'unused here',
  };
}

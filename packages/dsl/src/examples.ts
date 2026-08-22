/**
 * Hand-authored fixture library for the thin slice.
 *
 * Together these cards cover every evergreen keyword, every effect primitive,
 * every targeting mode, all five colors plus colorless, and all three
 * rarities. Downstream packages import them as fixtures instead of inventing
 * their own cards, so kernel, sim, deck-builder and transpiler tests all agree
 * on what a legal card looks like.
 *
 * The array is authored as schema *input* and pushed through `parseCard`, so a
 * fixture that stops being legal fails at import time.
 */
import type { Card, CardInput } from './card';
import { parseCard } from './parse';
import type { BasicLandType } from './vocabulary';
import { BASIC_LAND_COLOR, BASIC_LAND_TYPES } from './vocabulary';

const SET_CODE = 'SLC';

const EXAMPLE_CARD_INPUTS: CardInput[] = [
  {
    kind: 'creature',
    id: 'slc-skywatch-sentinel',
    name: 'Skywatch Sentinel',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 1 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: ['Bird', 'Soldier'],
    keywords: ['flying', 'vigilance'],
    power: 2,
    toughness: 1,
  },
  {
    kind: 'instant',
    id: 'slc-radiant-charge',
    name: 'Radiant Charge',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 2 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    effects: [
      { kind: 'pumpUntilEndOfTurn', power: 2, toughness: 2, target: { kind: 'targetCreature' } },
      { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } },
    ],
  },
  {
    kind: 'creature',
    id: 'slc-lifebound-cleric',
    name: 'Lifebound Cleric',
    rarity: 'uncommon',
    set: { code: SET_CODE, collectorNumber: 3 },
    manaCost: { generic: 2, W: 1 },
    colors: ['W'],
    subtypes: ['Human', 'Cleric'],
    keywords: ['lifelink', 'firstStrike'],
    power: 2,
    toughness: 3,
  },
  {
    kind: 'creature',
    id: 'slc-windrider-drake',
    name: 'Windrider Drake',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 4 },
    manaCost: { generic: 2, U: 1 },
    colors: ['U'],
    subtypes: ['Drake'],
    keywords: ['flying'],
    power: 2,
    toughness: 2,
  },
  {
    kind: 'instant',
    id: 'slc-dissolving-word',
    name: 'Dissolving Word',
    rarity: 'uncommon',
    set: { code: SET_CODE, collectorNumber: 5 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    effects: [{ kind: 'counterSpell' }, { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
  },
  {
    kind: 'instant',
    id: 'slc-frostbind-current',
    name: 'Frostbind Current',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 6 },
    manaCost: { U: 1 },
    colors: ['U'],
    effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
  },
  {
    kind: 'instant',
    id: 'slc-undertow-snare',
    name: 'Undertow Snare',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 7 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    effects: [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }],
  },
  {
    kind: 'creature',
    id: 'slc-graveblade-stalker',
    name: 'Graveblade Stalker',
    rarity: 'uncommon',
    set: { code: SET_CODE, collectorNumber: 8 },
    manaCost: { generic: 2, B: 1 },
    colors: ['B'],
    subtypes: ['Human', 'Assassin'],
    keywords: ['deathtouch', 'menace'],
    power: 2,
    toughness: 2,
  },
  {
    kind: 'sorcery',
    id: 'slc-mortal-verdict',
    name: 'Mortal Verdict',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 9 },
    manaCost: { generic: 2, B: 1 },
    colors: ['B'],
    effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
  },
  {
    kind: 'sorcery',
    id: 'slc-grasping-mire',
    name: 'Grasping Mire',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 10 },
    manaCost: { generic: 1, B: 1 },
    colors: ['B'],
    effects: [{ kind: 'millCards', count: 4, target: { kind: 'targetPlayer' } }],
  },
  {
    kind: 'creature',
    id: 'slc-emberflow-raider',
    name: 'Emberflow Raider',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 11 },
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    subtypes: ['Goblin', 'Warrior'],
    keywords: ['haste'],
    power: 2,
    toughness: 1,
  },
  {
    kind: 'instant',
    id: 'slc-lightning-lash',
    name: 'Lightning Lash',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 12 },
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }],
  },
  {
    kind: 'creature',
    id: 'slc-thornhide-guardian',
    name: 'Thornhide Guardian',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 13 },
    manaCost: { generic: 3, G: 1 },
    colors: ['G'],
    subtypes: ['Beast'],
    keywords: ['reach', 'trample'],
    power: 3,
    toughness: 5,
  },
  {
    kind: 'sorcery',
    id: 'slc-wild-summons',
    name: 'Wild Summons',
    rarity: 'rare',
    set: { code: SET_CODE, collectorNumber: 14 },
    manaCost: { generic: 3, G: 1 },
    colors: ['G'],
    effects: [
      {
        kind: 'createToken',
        count: 2,
        token: { name: 'Bear', power: 2, toughness: 2, colors: ['G'], subtypes: ['Bear'] },
      },
    ],
  },
  {
    kind: 'creature',
    id: 'slc-ironclad-golem',
    name: 'Ironclad Golem',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 15 },
    manaCost: { generic: 4 },
    artifact: true,
    subtypes: ['Golem'],
    power: 3,
    toughness: 3,
  },
  {
    kind: 'artifact',
    id: 'slc-bronze-monument',
    name: 'Bronze Monument',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 16 },
    manaCost: { generic: 2 },
  },
  {
    kind: 'sorcery',
    id: 'slc-heartwood-graft',
    name: 'Heartwood Graft',
    rarity: 'common',
    set: { code: SET_CODE, collectorNumber: 17 },
    manaCost: { generic: 3, G: 1 },
    colors: ['G'],
    effects: [
      { kind: 'putCounters', counter: 'plusOnePlusOne', count: 2, target: { kind: 'targetCreature' } },
    ],
  },
];

/** The 17 non-land fixtures, validated at import time. */
export const EXAMPLE_CARDS: readonly Card[] = EXAMPLE_CARD_INPUTS.map(parseCard);

/** Builds a basic land for the given type; the deck builder needs all five. */
export function basicLand(type: BasicLandType, setCode: string, collectorNumber: number): Card {
  return parseCard({
    kind: 'land',
    id: `${setCode.toLowerCase()}-${type.toLowerCase()}`,
    name: type,
    rarity: 'common',
    set: { code: setCode, collectorNumber },
    supertypes: ['basic'],
    basicLandType: type,
    producesMana: [BASIC_LAND_COLOR[type]],
  } satisfies CardInput);
}

/** The five basic lands of the slice set, collector numbers 18-22. */
export const BASIC_LANDS: readonly Card[] = BASIC_LAND_TYPES.map((type, index) =>
  basicLand(type, SET_CODE, 18 + index),
);

/** Every fixture card, spells and lands, in collector-number order. */
export const EXAMPLE_SET: readonly Card[] = [...EXAMPLE_CARDS, ...BASIC_LANDS];

const BY_ID = new Map(EXAMPLE_SET.map((card) => [card.id, card]));

/** Fixture lookup; throws when the id is unknown so typos fail loudly in tests. */
export function exampleCard(id: string): Card {
  const card = BY_ID.get(id);
  if (card === undefined) throw new Error(`unknown example card: ${id}`);
  return card;
}

/** Read-only view of the fixture index. */
export const EXAMPLE_CARDS_BY_ID: ReadonlyMap<string, Card> = BY_ID;

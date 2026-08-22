/**
 * Seeded pool generation for the property-style tests.
 *
 * Cards are authored as DSL schema *input* and pushed through `parseCard`, so a
 * generator that drifts out of the legal DSL fails loudly at construction
 * rather than quietly feeding the builder cards the kernel could not run.
 *
 * The RNG is mulberry32: 32 bits of state, no dependencies, identical output
 * for identical seeds across runs and platforms.
 *
 * These pools are wider than any set the generator prints, on purpose: they
 * draw from every keyword and every effect primitive, and one card in five is
 * rare at a density no real set prints, and rarer still where the set is under
 * the 123 cards `SLICE_RARITIES` needs before it allocates the tier at all
 * (`@mtg/design-data`). Sampling the DSL's legal space is the point — the
 * builder has to hold for cards a future set may print. The rarities are inert
 * besides: nothing in `src` reads rarity outside `openSealedPool`, which is
 * tested against the real generated set rather than against these.
 */
import type { Card, CardInput, Color, EffectInput, Keyword, ManaCostInput, TokenSpec } from '@mtg/dsl';
import { COLORS, EXAMPLE_CARDS, KEYWORDS, parseCard } from '@mtg/dsl';

export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick: empty list');
  return item;
}

function pickMany<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const remaining = [...items];
  const chosen: T[] = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    const index = Math.floor(rng() * remaining.length);
    const [taken] = remaining.splice(index, 1);
    if (taken !== undefined) chosen.push(taken);
  }
  return chosen;
}

const SUBTYPES = ['Beast', 'Soldier', 'Wizard', 'Goblin', 'Bird', 'Elemental'] as const;

function makeToken(rng: Rng, colors: readonly Color[]): TokenSpec {
  return {
    name: pick(rng, SUBTYPES),
    power: intBetween(rng, 1, 3),
    toughness: intBetween(rng, 1, 3),
    colors: [...colors],
    subtypes: [],
    keywords: [],
  };
}

function makeEffect(rng: Rng, colors: readonly Color[]): EffectInput {
  const roll = rng();
  if (roll < 0.22) {
    return {
      kind: 'dealDamage',
      amount: intBetween(rng, 1, 5),
      target: { kind: pick(rng, ['anyTarget', 'targetCreature', 'targetPlayer'] as const) },
    };
  }
  if (roll < 0.34) return { kind: 'destroyPermanent', target: { kind: 'targetCreature' } };
  if (roll < 0.48) {
    return {
      kind: 'pumpUntilEndOfTurn',
      power: intBetween(rng, 1, 4),
      toughness: intBetween(rng, 1, 4),
      target: { kind: 'targetCreature' },
    };
  }
  if (roll < 0.6) {
    return {
      kind: 'drawCards',
      count: intBetween(rng, 1, 3),
      target: { kind: pick(rng, ['noTarget', 'targetPlayer'] as const) },
    };
  }
  if (roll < 0.7) {
    return { kind: 'gainLife', amount: intBetween(rng, 1, 5), target: { kind: 'noTarget' } };
  }
  if (roll < 0.78) return { kind: 'counterSpell' };
  if (roll < 0.86) {
    return { kind: 'createToken', count: intBetween(rng, 1, 2), token: makeToken(rng, colors) };
  }
  if (roll < 0.92) return { kind: 'tapPermanent', target: { kind: 'targetCreature' } };
  if (roll < 0.97) return { kind: 'returnToHand', target: { kind: 'targetCreature' } };
  return {
    kind: 'millCards',
    count: intBetween(rng, 2, 6),
    target: { kind: pick(rng, ['noTarget', 'targetPlayer'] as const) },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface CardContext {
  readonly rng: Rng;
  readonly index: number;
  readonly setCode: string;
  readonly palette: readonly Color[];
}

function baseFields(context: CardContext): Pick<CardInput, 'id' | 'name' | 'rarity' | 'set'> {
  const { rng, index, setCode } = context;
  return {
    id: `syn-${index}`,
    name: `Synthetic ${index}`,
    rarity: pick(rng, ['common', 'common', 'common', 'uncommon', 'rare'] as const),
    set: { code: setCode, collectorNumber: index + 1 },
  };
}

function colorCost(color: Color, generic: number, pips: number): ManaCostInput {
  const cost: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  cost[color] = pips;
  return { generic, ...cost };
}

function makeCardInput(context: CardContext): CardInput {
  const { rng, palette } = context;
  const manaValue = intBetween(rng, 1, 7);
  const color = pick(rng, palette);
  const pips = manaValue >= 4 ? intBetween(rng, 1, 2) : 1;
  const coloredCost = colorCost(color, manaValue - pips, pips);
  const roll = rng();

  if (roll < 0.5) {
    const keywordCount = rng() < 0.45 ? intBetween(rng, 1, 2) : 0;
    return {
      ...baseFields(context),
      kind: 'creature',
      manaCost: coloredCost,
      colors: [color],
      subtypes: [pick(rng, SUBTYPES)],
      keywords: pickMany<Keyword>(rng, KEYWORDS, keywordCount),
      power: clamp(manaValue + intBetween(rng, -1, 1), 0, 20),
      toughness: clamp(manaValue + intBetween(rng, -1, 1), 1, 20),
    };
  }
  if (roll < 0.82) {
    const spell = {
      ...baseFields(context),
      manaCost: coloredCost,
      colors: [color],
      effects: [makeEffect(rng, [color])],
    };
    return roll < 0.68 ? { ...spell, kind: 'instant' } : { ...spell, kind: 'sorcery' };
  }
  if (roll < 0.92) {
    return {
      ...baseFields(context),
      kind: 'creature',
      manaCost: { generic: manaValue },
      artifact: true,
      subtypes: ['Golem'],
      power: clamp(manaValue - 1, 0, 20),
      toughness: clamp(manaValue - 1, 1, 20),
    };
  }
  return { ...baseFields(context), kind: 'artifact', manaCost: { generic: manaValue } };
}

export interface PoolOptions {
  /** Non-land cards to generate. A sealed pool is roughly 90. */
  readonly size?: number;
  readonly setCode?: string;
  /** Colors the generator may use; narrow it to force a color-starved pool. */
  readonly palette?: readonly Color[];
}

/** A deterministic pool of legal DSL cards for a given seed. */
export function makeSyntheticPool(seed: number, options: PoolOptions = {}): readonly Card[] {
  const rng = makeRng(seed);
  const size = options.size ?? 90;
  const setCode = options.setCode ?? 'SYN';
  const palette = options.palette ?? COLORS;
  return Array.from({ length: size }, (_unused, index) =>
    parseCard(makeCardInput({ rng, index, setCode, palette })),
  );
}

/**
 * A synthetic pool with the DSL's hand-authored fixtures mixed in, so the
 * builder is exercised against the same cards the rest of the lab uses.
 */
export function makeMixedPool(seed: number, options: PoolOptions = {}): readonly Card[] {
  return [...EXAMPLE_CARDS, ...makeSyntheticPool(seed, options)];
}

/**
 * Opening packs from a printing's own collation.
 *
 * `sealed.ts` derives a recipe from what a card list prints — nine commons,
 * three uncommons, a rare-or-mythic — because a generated set has nothing else
 * to offer: the sheets a real printing was collated on do not exist for a set
 * this repository invented. That derivation is right there and wrong for a real
 * printing twice over. M11 opens fifteen cards, not thirteen: a basic, ten
 * commons, three uncommons and a rare-or-mythic, or nine commons and a foil, one
 * configuration weighted 31 against the other's 9. And a sheet weights its own
 * cards — M11's rare sheet gives a rare twice a mythic's weight — where a rarity
 * recipe draws every card of a rarity at even odds.
 *
 * So a caller that *has* the sheets deals from them, and a caller that does not
 * keeps `openSealedPool` exactly as it was. Two functions rather than one option
 * on one function: the inputs share no field, the failures are different
 * sentences, and an option would leave every existing caller reading a parameter
 * it will never pass.
 *
 * # What this is not
 *
 * It is not the reduction, and it never reads one. `@mtg/data` owns the reduced
 * artifact and the rekeying of its sheets onto card ids, because that is where
 * the printing's uuids are; what arrives here is a list of sheets keyed by card
 * id, which is a sampler's input and nothing more. This package depends on
 * `@mtg/dsl` alone, which is what lets a browser bundle it.
 *
 * # A card may repeat across sheets, and that is the printing
 *
 * Distinctness is per slot, not per pack. One pack never holds a card twice off
 * one sheet, which is what `drawDistinct` already means in `sealed.ts`; a pack
 * whose foil sheet deals the same card its common sheet dealt is a real pack,
 * because those are two physical cards. The DSL has no foil, so the duplicate
 * arrives as a duplicate, which is the honest outcome — the alternative is to
 * refuse to deal a pack that a printing deals every day.
 */
import type { Card } from '@mtg/dsl';
import { nextInt, seedRng } from './rng';
import type { Rng } from './rng';
import { SealedPoolError } from './sealed';
import type { SealedPool } from './sealed';

/** One sheet: which cards it deals, and at what relative odds. */
export interface CollationSheet {
  readonly name: string;
  /** Card id to weight. Positive integers; the totals are summed here. */
  readonly weights: Readonly<Record<string, number>>;
}

/** One booster configuration: how many cards it draws off each named sheet. */
export interface CollationBooster {
  readonly contents: Readonly<Record<string, number>>;
  /** Its odds against the other configurations. */
  readonly weight: number;
}

export interface PackCollation {
  readonly sheets: readonly CollationSheet[];
  readonly boosters: readonly CollationBooster[];
}

/** Six packs, the same sealed pool `DEFAULT_BOOSTER_COUNT` opens. */
export const DEFAULT_COLLATED_BOOSTER_COUNT = 6;

export interface CollatedOptions {
  readonly seed?: string;
  readonly boosters?: number;
}

/** One sheet, resolved against the set and ready to draw from. */
interface ResolvedSheet {
  readonly name: string;
  readonly entries: readonly (readonly [Card, number])[];
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Resolves every sheet against the set and every slot against its sheet, before
 * a single pack is opened.
 *
 * All of it up front, for `assertPoolFits`'s reason: a collation that does not
 * describe this card list is a staging mistake, and finding it on the fourth
 * pack would hand somebody a pool that is three packs of a set and one of an
 * error. Each refusal names the sheet and the thing that was wrong with it,
 * because the caller staging this is looking at two files and needs to know
 * which one moved.
 */
function resolve(set: readonly Card[], collation: PackCollation): ReadonlyMap<string, ResolvedSheet> {
  const byId = new Map(set.map((card) => [card.id, card] as const));
  const sheets = new Map<string, ResolvedSheet>();
  for (const sheet of collation.sheets) {
    if (sheets.has(sheet.name)) {
      throw new SealedPoolError(`a collation cannot carry the sheet ${sheet.name} twice`);
    }
    const entries: (readonly [Card, number])[] = [];
    for (const [id, weight] of Object.entries(sheet.weights)) {
      const card = byId.get(id);
      if (card === undefined) {
        throw new SealedPoolError(`sheet ${sheet.name} names ${id}, which this set does not print`);
      }
      if (!positiveInteger(weight)) {
        throw new SealedPoolError(
          `sheet ${sheet.name} weights ${id} at ${String(weight)}, which is not a positive whole number`,
        );
      }
      entries.push([card, weight]);
    }
    if (entries.length === 0) throw new SealedPoolError(`sheet ${sheet.name} deals no card at all`);
    sheets.set(sheet.name, { name: sheet.name, entries });
  }
  if (collation.boosters.length === 0) {
    throw new SealedPoolError('this set carries no booster configuration that can be opened');
  }
  for (const booster of collation.boosters) {
    if (!positiveInteger(booster.weight)) {
      throw new SealedPoolError(
        `a booster configuration is weighted ${String(booster.weight)}, which is not a positive whole number`,
      );
    }
    let size = 0;
    for (const [name, count] of Object.entries(booster.contents)) {
      const sheet = sheets.get(name);
      if (sheet === undefined) {
        throw new SealedPoolError(`a booster configuration deals from ${name}, which is not a sheet here`);
      }
      if (!positiveInteger(count)) {
        throw new SealedPoolError(`a booster configuration asks for ${String(count)} cards off ${name}`);
      }
      if (count > sheet.entries.length) {
        throw new SealedPoolError(
          `a booster needs ${String(count)} distinct ${name} cards but that sheet holds ` +
            `${String(sheet.entries.length)}`,
        );
      }
      size += count;
    }
    if (size === 0) throw new SealedPoolError('a booster configuration deals no cards at all');
  }
  return sheets;
}

/** Draws `count` distinct cards off one sheet, weighted, without replacement. */
function drawSheet(sheet: ResolvedSheet, count: number, rng: Rng): readonly [readonly Card[], Rng] {
  const remaining = [...sheet.entries];
  const drawn: Card[] = [];
  let current = rng;
  for (let taken = 0; taken < count; taken += 1) {
    const total = remaining.reduce((sum, [, weight]) => sum + weight, 0);
    if (!Number.isSafeInteger(total) || total <= 0) {
      throw new SealedPoolError(`sheet ${sheet.name} weights exceed the supported range`);
    }
    const [roll, advanced] = nextInt(current, total);
    current = advanced;
    let cursor = roll;
    let index = 0;
    for (; index < remaining.length - 1; index += 1) {
      const entry = remaining[index];
      if (entry === undefined) continue;
      cursor -= entry[1];
      if (cursor < 0) break;
    }
    const [entry] = remaining.splice(index, 1);
    if (entry !== undefined) drawn.push(entry[0]);
  }
  return [drawn, current];
}

/**
 * Which configuration this pack is, rolled per pack.
 *
 * Per pack rather than per pool, because that is what the weights mean: M11's
 * foil configuration is 9 in 40 of the packs opened, not 9 in 40 of the boxes.
 */
function chooseBooster(boosters: readonly CollationBooster[], rng: Rng): readonly [CollationBooster, Rng] {
  const total = boosters.reduce((sum, booster) => sum + booster.weight, 0);
  const [roll, advanced] = nextInt(rng, total);
  let cursor = roll;
  for (const booster of boosters) {
    cursor -= booster.weight;
    if (cursor < 0) return [booster, advanced];
  }
  const last = boosters[boosters.length - 1];
  if (last === undefined) throw new SealedPoolError('this set carries no booster configuration');
  return [last, advanced];
}

/**
 * Opens `boosters` packs from a set, dealt off the collation's own sheets.
 *
 * Deterministic in the seed, exactly as `openSealedPool` is: the configuration
 * roll and every card draw come off one stream, so one string is the whole
 * record of a pool.
 *
 * Slots are dealt in the order the configuration lists them, which is the order
 * the document was written in. Nothing downstream reads pack order — a pool is a
 * bag — but a stable order is what makes the seed mean one thing.
 */
export function openCollatedPool(
  set: readonly Card[],
  collation: PackCollation,
  options: CollatedOptions = {},
): SealedPool {
  const count = options.boosters ?? DEFAULT_COLLATED_BOOSTER_COUNT;
  if (!Number.isInteger(count) || count <= 0) {
    throw new SealedPoolError(`booster count must be a positive integer, got ${String(count)}`);
  }
  const sheets = resolve(set, collation);
  const seed = options.seed ?? 'collated/v0';
  let rng = seedRng(seed);
  const opened: (readonly Card[])[] = [];
  for (let pack = 0; pack < count; pack += 1) {
    const [booster, afterChoice] = chooseBooster(collation.boosters, rng);
    rng = afterChoice;
    const cards: Card[] = [];
    for (const [name, slot] of Object.entries(booster.contents)) {
      const sheet = sheets.get(name);
      if (sheet === undefined) throw new SealedPoolError(`sheet ${name} vanished between checks`);
      const [drawn, advanced] = drawSheet(sheet, slot, rng);
      rng = advanced;
      cards.push(...drawn);
    }
    opened.push(cards);
  }
  return { seed, boosters: opened, cards: opened.flat() };
}

/** How many cards one configuration puts in a pack. */
export function collatedBoosterSize(booster: CollationBooster): number {
  return Object.values(booster.contents).reduce((total, count) => total + count, 0);
}

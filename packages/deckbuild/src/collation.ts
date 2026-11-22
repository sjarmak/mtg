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
 * # A slot may repeat a card the pack already dealt, and that is the printing
 *
 * **Settled 2026-08-27 (`mtg-vvio`).** Distinctness is per slot, never per pack.
 * One pack never holds a card twice off one sheet, which is what `drawDistinct`
 * already means in `sealed.ts`. Two sheets are two physical sheets, and a
 * printing that runs a card on both deals it off both.
 *
 * M11 is the case that settles it, and its overlap is total rather than
 * incidental: the foil sheet is the whole set. Measured over the imported M11
 * collation, that sheet runs 29,040 weight across all 249 cards, and every card
 * on every other sheet is on it — 101 of 101 commons, 60 of 60 uncommons, 68 of
 * 68 rare-and-mythic, 20 of 20 basics. M13's is the same shape and the same
 * numbers. So in the 9-in-40 configuration that swaps a common for a foil, the
 * foil slot can deal a second copy of anything the other four slots dealt, and a
 * pack holding a foil Llanowar Elves beside a non-foil one is an ordinary pack
 * rather than a defect.
 *
 * Refusing the duplicate is not the free tidy-up it looks like. It means either
 * rejection-sampling the whole pack until nothing repeats, which bends every
 * sheet's weights away from the cards its neighbors carry, or drawing the later
 * slot off its sheet minus the pack, which is the same distortion applied once.
 * Either one misreports the distribution this sampler exists to get right, and
 * `partial.ts` is where that distribution is already stated card by card.
 *
 * The DSL has no foil, so the duplicate arrives as a plain duplicate. Which copy
 * came off which sheet is `SealedPool.provenance`, closed by `mtg-11yd`: the
 * answer belongs to the pool that did the dealing rather than to the card, and
 * it does not change what a pack should hold.
 */
import { isBasicLand } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import type { PoolProvenance, SheetSlot } from './provenance';
import { nextInt, seedRng } from './rng';
import type { Rng } from './rng';
import { SealedPoolError } from './sealed';
import type { SealedPool } from './sealed';
import { drawWeightedEntries } from './weighted-sheet';
import {
  assertColorBalancedSheet,
  drawColorBalancedSheet,
  type CollationColors,
} from './color-balanced-sheet';

/** One sheet: which cards it deals, and at what relative odds. */
export interface CollationSheet {
  readonly balanceColors?: boolean | undefined;
  readonly name: string;
  /** Card id to weight. Positive integers; the totals are summed here. */
  readonly weights: Readonly<Record<string, number>>;
  /**
   * Whether the printing calls this a foil sheet. Absent means it did not say.
   *
   * Optional because a staged document written before the flag was carried
   * through carries no such key, and absent is not `false`: a pool dealt off
   * those sheets reports its foil provenance as unknown rather than as none.
   * `@mtg/data`'s `ReducedSheet.foil` is where the boolean comes from, and it is
   * MTGJSON's own, so nothing here reads the sheet's name to decide.
   */
  readonly foil?: boolean | undefined;
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

export interface CollatedOptions<CardType = Card> {
  readonly seed?: string;
  readonly boosters?: number;
  readonly colorsOf?: CollationColors<CardType>;
}

/** One sheet, resolved against the set and ready to draw from. */
interface ResolvedSheet<CardType> {
  readonly balanceColors: boolean;
  readonly name: string;
  readonly foil: boolean | null;
  readonly entries: readonly (readonly [CardType, number])[];
}

/** The existing sampler draws a 32-bit value; larger totals make entries unreachable. */
const MAX_DRAW_WEIGHT = 2 ** 32;

function assertWeightTotal(total: number, subject: string): void {
  if (!positiveInteger(total) || total > MAX_DRAW_WEIGHT) {
    throw new SealedPoolError(`${subject} weights exceed the supported range`);
  }
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
function resolve<CardType extends { readonly id: string }>(
  set: readonly CardType[],
  collation: PackCollation,
  colorsOf: CollationColors<CardType> | undefined,
): ReadonlyMap<string, ResolvedSheet<CardType>> {
  const byId = new Map(set.map((card) => [card.id, card] as const));
  if (byId.size !== set.length) throw new SealedPoolError('a collation set contains a duplicate card id');
  const sheets = new Map<string, ResolvedSheet<CardType>>();
  for (const sheet of collation.sheets) {
    if (sheets.has(sheet.name)) {
      throw new SealedPoolError(`a collation cannot carry the sheet ${sheet.name} twice`);
    }
    const entries: (readonly [CardType, number])[] = [];
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
    assertWeightTotal(
      entries.reduce((sum, [, weight]) => sum + weight, 0),
      `sheet ${sheet.name}`,
    );
    sheets.set(sheet.name, {
      name: sheet.name,
      foil: sheet.foil ?? null,
      entries,
      balanceColors: sheet.balanceColors ?? false,
    });
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
      if (sheet.balanceColors) assertColorBalancedSheet(sheet.entries, count, colorsOf);
      size += count;
    }
    if (size === 0) throw new SealedPoolError('a booster configuration deals no cards at all');
  }
  assertWeightTotal(
    collation.boosters.reduce((sum, booster) => sum + booster.weight, 0),
    'booster',
  );
  return sheets;
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
 *
 * **Seats draw independently, not off a shared stream.** Every call seeds a
 * fresh `Rng` from its own string and nothing survives the return, so two seats
 * at one table are two calls under two seeds derived from the table's
 * (`@mtg/netplay`'s `poolSeedFor` spells that derivation, and it is the only
 * spelling). A seat's pool is therefore a function of its own seed alone: it
 * does not move when the other seat is opened first, opened twice or not opened
 * at all. The alternative — one stream advanced across both seats — would hand
 * two players pools correlated through draw order, and nothing downstream
 * inspects a pool closely enough to notice.
 */
export function openCollatedPool<CardType extends { readonly id: string }>(
  set: readonly CardType[],
  collation: PackCollation,
  options: CollatedOptions<CardType> = {},
): SealedPool<CardType> {
  const count = options.boosters ?? DEFAULT_COLLATED_BOOSTER_COUNT;
  if (!Number.isInteger(count) || count <= 0) {
    throw new SealedPoolError(`booster count must be a positive integer, got ${String(count)}`);
  }
  const sheets = resolve(set, collation, options.colorsOf);
  const seed = options.seed ?? 'collated/v0';
  let rng = seedRng(seed);
  const opened: (readonly CardType[])[] = [];
  const slots: (readonly SheetSlot[])[] = [];
  for (let pack = 0; pack < count; pack += 1) {
    const [booster, afterChoice] = chooseBooster(collation.boosters, rng);
    rng = afterChoice;
    const cards: CardType[] = [];
    const dealtOff: SheetSlot[] = [];
    for (const [name, slot] of Object.entries(booster.contents)) {
      const sheet = sheets.get(name);
      if (sheet === undefined) throw new SealedPoolError(`sheet ${name} vanished between checks`);
      const [drawn, advanced] = sheet.balanceColors
        ? drawColorBalancedSheet(sheet.entries, slot, rng, options.colorsOf!)
        : drawWeightedEntries(sheet.entries, slot, rng);
      rng = advanced;
      cards.push(...drawn);
      dealtOff.push(...drawn.map(() => ({ sheet: sheet.name, foil: sheet.foil })));
    }
    opened.push(cards);
    slots.push(dealtOff);
  }
  const provenance: PoolProvenance = { kind: 'sheets', slots };
  return { seed, boosters: opened, cards: opened.flat(), provenance };
}

/** How many cards one configuration puts in a pack. */
export function collatedBoosterSize(booster: CollationBooster): number {
  return Object.values(booster.contents).reduce((total, count) => total + count, 0);
}

/**
 * What taking the basic lands out of a printing's packs cost it.
 *
 * Counts and names rather than sentences, because the surface that says this is
 * the one that dealt the pack and it words it for its own reader. Every field is
 * derived from the sheets it was handed; nothing here is read off a document.
 */
export interface BasicLandRemoval {
  /** Sheets that held nothing but basic lands. Every slot dealing off one is gone. */
  readonly droppedSheets: readonly string[];
  /** Sheets that held basics beside real cards and now deal only the rest. */
  readonly thinnedSheets: readonly string[];
  /** Configurations that can no longer be dealt once the basics are off. */
  readonly unfillableBoosters: number;
  /** The sizes the printing collates its packs at, ascending and distinct. */
  readonly printedPackSizes: readonly number[];
  /** The sizes packs are dealt at here, ascending and distinct. Empty when none fills. */
  readonly dealtPackSizes: readonly number[];
}

/** Ascending, distinct, and never a zero. */
function packSizes(boosters: readonly CollationBooster[]): readonly number[] {
  return [...new Set(boosters.map(collatedBoosterSize))].filter((size) => size > 0).sort((a, b) => a - b);
}

/**
 * The same collation with its basic lands taken out, and what that cost.
 *
 * **`mtg-5of3`, the playtester: "there shouldn't be any basic lands in the draft
 * packs."** Measured over the reduced M11 and M13 before this existed, 24 packs
 * each: 25 basics in M11's 360 cards and 24 in M13's, so every fifteen-card pack
 * spent one of its picks on a Swamp.
 *
 * # Why this is a transform rather than a fix to the record
 *
 * M11's retail draft booster really did hold a basic land in 2010, and
 * `@mtg/data`'s `partial.ts` builds the block straight off MTGJSON's
 * `set.draftBooster.sheets` under a docblock promising that "nothing is
 * approximated, simplified, substituted or renamed". Deleting the land slot
 * inside the reduction would make the artifact stop describing the printing in
 * the one place it most loudly promises it does. So the divergence lives at the
 * dealing seam, and the record keeps saying fifteen.
 *
 * # Two sources, and a fix that handles one leaves the other
 *
 * A dedicated basic sheet is the obvious one: both of M11's configurations draw
 * 1 off a sheet of exactly the 20 basic positions. The second is quieter — the
 * foil sheet is the *whole card list*, basics included, so the foil slot deals a
 * basic about one pack in eight. Hence two rules:
 *
 * - a sheet that is nothing but basics is dropped, and so is every slot on it
 * - a sheet holding basics beside real cards keeps dealing, minus the basics
 *
 * # Read off the cards, never off a sheet name
 *
 * `basic` is M11's spelling and nothing guarantees the next printing spells it
 * that way, so membership comes from `isBasicLand` over the card list. A sheet
 * naming an id this set does not print is left exactly as it was, so
 * `openCollatedPool` still refuses it with the message it always did: this
 * removes basics, and it is not a second validator.
 *
 * # A slot too deep for its thinned sheet takes its configuration with it
 *
 * Thinning can leave a sheet shallower than a slot drawing off it, and
 * `drawSheet` deals without replacement. Clamping the slot would quietly deal a
 * shorter pack, so the configuration is dropped whole and counted. Every real
 * reference printing keeps both of its configurations; this is the arm that
 * keeps a thin one honest rather than short.
 */
export function withoutBasicLands(
  set: readonly Card[],
  collation: PackCollation,
): readonly [PackCollation, BasicLandRemoval] {
  const basics = new Set(set.filter(isBasicLand).map((card) => card.id));
  return withoutBasicLandIds(collation, basics);
}

/** The same policy for printed catalogs, whose basic-land facts are supplied by their adapter. */
export function withoutBasicLandIds(
  collation: PackCollation,
  basics: ReadonlySet<string>,
): readonly [PackCollation, BasicLandRemoval] {
  const droppedSheets: string[] = [];
  const thinnedSheets: string[] = [];
  const kept: CollationSheet[] = [];
  const depth = new Map<string, number>();
  for (const sheet of collation.sheets) {
    const entries = Object.entries(sheet.weights).filter(([id]) => !basics.has(id));
    if (entries.length === Object.keys(sheet.weights).length) {
      kept.push(sheet);
      depth.set(sheet.name, entries.length);
      continue;
    }
    if (entries.length === 0) {
      droppedSheets.push(sheet.name);
      continue;
    }
    thinnedSheets.push(sheet.name);
    kept.push({ ...sheet, weights: Object.fromEntries(entries) });
    depth.set(sheet.name, entries.length);
  }

  const dropped = new Set(droppedSheets);
  const boosters: CollationBooster[] = [];
  let unfillableBoosters = 0;
  for (const booster of collation.boosters) {
    const contents: Record<string, number> = {};
    let fills = true;
    for (const [name, count] of Object.entries(booster.contents)) {
      if (dropped.has(name)) continue;
      const remaining = depth.get(name);
      if (remaining !== undefined && remaining < count) {
        fills = false;
        break;
      }
      contents[name] = count;
    }
    if (!fills || Object.keys(contents).length === 0) {
      unfillableBoosters += 1;
      continue;
    }
    boosters.push({ contents, weight: booster.weight });
  }

  return [
    { sheets: kept, boosters },
    {
      droppedSheets,
      thinnedSheets,
      unfillableBoosters,
      printedPackSizes: packSizes(collation.boosters),
      dealtPackSizes: packSizes(boosters),
    },
  ];
}

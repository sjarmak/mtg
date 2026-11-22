/**
 * Where each card in an opened pool came from (`mtg-11yd`).
 *
 * A pack is dealt slot by slot and then flattened, and until this existed the
 * flattening was lossy: `SealedPool` handed a surface fifteen cards and no way
 * to say which one came off the foil sheet. The card itself cannot carry the
 * answer. A `Card` is the printing-independent object the kernel runs and the
 * generator emits, and foil is a property of one physical copy; a `foil` field
 * on it would make two objects that differ in nothing the rules can see, and the
 * kernel would have to carry the difference through every zone change to no end.
 *
 * So the provenance belongs to the pool, which is the thing that actually did
 * the dealing.
 *
 * # Two arms, because there are two samplers
 *
 * `openSealedPool` derives a recipe from what a card list prints and deals by
 * rarity; `openCollatedPool` deals off a printing's own named sheets. They are
 * deliberately two functions rather than one function with an option, and the
 * provenance follows them rather than flattening them back together.
 *
 * The distinction is not decoration. Asked whether a sealed pool holds a foil,
 * the answer is not "no" — it is that a rarity recipe **has no foil slot at
 * all**, so nothing was dealt as one and nothing could have been. `Rarity` is a
 * closed union, so on the `rarities` arm that is a fact the type states rather
 * than a search that came back empty. A single shared shape would have had to
 * answer with `false`, which is a measurement this sampler never took.
 *
 * # `foil` is the printing's word, not a name match
 *
 * MTGJSON marks a sheet as a foil sheet with a boolean, which survives the
 * reduction as `ReducedSheet.foil`. That boolean is what `SheetSlot.foil`
 * carries. Nothing here reads the sheet's *name*: `foil` is what both reference
 * printings happen to call theirs, and keying a treatment off that string would
 * be a guess about every printing that calls it something else.
 *
 * `null` is the third answer and it is a real one: a staged document written
 * before the flag was carried through says nothing about its sheets, and
 * reporting `false` for those would be inventing the measurement. `foilSlots`
 * refuses to answer at all in that case rather than answering half of it.
 */
import type { Rarity } from '@mtg/dsl';

/** One dealt card's slot, on a pool dealt off a printing's named sheets. */
export interface SheetSlot {
  /** The printing's own name for the sheet, unchanged. */
  readonly sheet: string;
  /**
   * Whether the printing calls that sheet a foil sheet, or `null` where the
   * collation this pool was dealt from did not say.
   */
  readonly foil: boolean | null;
}

/**
 * Which slot every dealt card came off, pack by pack.
 *
 * Both arms carry one entry per card, in the order the pack holds them, so
 * `slots[pack][index]` describes `boosters[pack][index]`.
 */
export type PoolProvenance =
  | { readonly kind: 'sheets'; readonly slots: readonly (readonly SheetSlot[])[] }
  | { readonly kind: 'rarities'; readonly slots: readonly (readonly Rarity[])[] };

/**
 * The positions a pool dealt off a foil sheet, or `null` where it cannot say.
 *
 * `null` covers both ways of not knowing, because a caller drawing a treatment
 * has to do the same thing in either: a rarity recipe has no foil slot to deal
 * off, and a collation that never stated the flag leaves every slot unmeasured.
 * A pool where even one slot is unstated answers `null` for the whole pool
 * rather than reporting the stated half as if it were all of it.
 */
export function foilSlots(provenance: PoolProvenance): readonly (readonly number[])[] | null {
  if (provenance.kind === 'rarities') return null;
  if (provenance.slots.some((pack) => pack.some((slot) => slot.foil === null))) return null;
  return provenance.slots.map((pack) => pack.flatMap((slot, index) => (slot.foil === true ? [index] : [])));
}

/**
 * The same answer against the flat pool: positions in `SealedPool.cards`.
 *
 * `cards` is `boosters.flat()`, and the provenance is aligned with `boosters`
 * pack for pack and position for position, so the flattening is the same walk
 * over `slots`. It is here rather than at each surface because that alignment is
 * this package's invariant to keep: a caller that re-derived the offsets would
 * be a second place the two lists could drift apart, which is the defect
 * `foilSlots` above exists to close rather than to reproduce one layer up.
 *
 * `null` for the same two reasons and with the same force. A surface drawing a
 * treatment has to know the difference between "no card here is a foil" and
 * "this pool never measured it", because the second is not a pool to draw a
 * foil-vs-not distinction on at all.
 */
export function foilPositions(provenance: PoolProvenance): readonly number[] | null {
  const packs = foilSlots(provenance);
  if (packs === null) return null;
  const positions: number[] = [];
  let offset = 0;
  for (const [pack, foilAt] of packs.entries()) {
    for (const index of foilAt) positions.push(offset + index);
    offset += provenance.slots[pack]?.length ?? 0;
  }
  return positions;
}

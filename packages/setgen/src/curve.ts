/**
 * Where a noncreature slot's mana value comes from when its role does not fix
 * one.
 *
 * Two pools, two shapes. A *colored* spell slot reads a weighted curve, and the
 * bomb tier walks that curve from the expensive end. A *colorless* noncreature
 * permanent reads a rotation of windows, which has no ends to walk, so the bomb
 * tier states a list of its own; the census that list is derived from is below.
 *
 * Shared by the allocator (which stamps the window onto the slot) and the
 * archetype reservation pass (which has to know what a role would have cost
 * before deciding whether to convert it into a body). Two copies of this
 * arithmetic would be two answers to "what does this slot cost".
 */
import { apportion } from '@mtg/dsl';
import { seatFromTop } from '@mtg/design-data';
import type { ManaValueRange } from './roles';

export const SPELL_CURVE: readonly ManaValueRange[] = [
  { min: 1, max: 1 },
  { min: 2, max: 2 },
  { min: 3, max: 3 },
  { min: 4, max: 5 },
];

/** Curve mass at 2-4, per the Limited composition norms (set-design section 6.3). */
export const SPELL_CURVE_WEIGHTS: readonly number[] = [1, 3, 3, 2];

/**
 * The mana-value window of each of a group's `spells` spell slots, in slot order.
 *
 * `bomb` is whether this group is at or above the profile's `bombsMinRarity`,
 * and it changes one thing, only when the group holds fewer spells than the
 * curve has buckets: which end of the curve gets dropped. Apportionment drops
 * the smallest weights, which are the ends, so a group with one spell slot came
 * out at the mode of the curve — mana value 2. At every tier below the bomb line
 * that is right, and at the bomb tier it prints a two-mana rare. Measured on the
 * flagship at 249 after `mtg-j3bp`: blue's, red's and green's rare spells were
 * all two-mana sorceries that make a token, which is a common.
 *
 * So a bomb-tier group too small for its curve is seated from the expensive end
 * down instead, by the same `seatFromTop` walk `topOfCurve` already applies to
 * the creature curve at the same tier for the same reason. The creatures were
 * fixed and the spells were not, and they are one curve away from each other:
 * an inert spell slot is converted into a body at the mana value the spell would
 * have cost.
 *
 * Every caller states the tier rather than defaulting it. Three passes ask this
 * question — the allocator, the archetype reservation and the required-card
 * settlement — and a caller that did not say would let a body converted out of a
 * bomb-tier spell slot inherit a window the allocator would never have printed.
 */
export function spellCurve(spells: number, bomb: boolean): ManaValueRange[] {
  if (spells <= 0) return [];
  const counts =
    bomb && spells < SPELL_CURVE.length
      ? seatFromTop(spells, SPELL_CURVE_WEIGHTS)
      : apportion(spells, [...SPELL_CURVE_WEIGHTS]);
  return SPELL_CURVE.flatMap((range, index) =>
    Array.from({ length: counts[index] ?? 0 }, () => ({ min: range.min, max: range.max })),
  );
}

/**
 * Cost windows for the colorless noncreature slots whose role the table gives no
 * effects to.
 *
 * They print vanilla artifacts unless `reserveAbilitySlots` hands one an ability
 * kind, which a brief whose mechanic names no colors does: the DSL prints
 * abilities now, and a bodiless colorless artifact is exactly where a set's
 * parts and chests live. The window is the same either way, which is why one
 * table serves both.
 *
 * This is the list every tier below the bomb line rotates over, and it is the
 * list this module shipped with. `mtg-tqkc` did not touch a number in it.
 */
export const COLORLESS_PERMANENT_MV: readonly ManaValueRange[] = [
  { min: 2, max: 2 },
  { min: 3, max: 3 },
  { min: 4, max: 4 },
];

/**
 * What real sets print a colorless noncreature permanent at, by mana value.
 *
 * Read once out of the ingested card store (`data/store/mtg.sqlite`, the 38,623
 * oracle cards and 38,623 printings `packages/data` ingests) and recorded here
 * rather than queried, because the store is gitignored and a gate that skips
 * itself when a 656 MB file is missing is a gate that passes having read
 * nothing. The query it came from, verbatim:
 *
 * ```sql
 * select p.rarity as rarity, cast(o.mana_value as integer) as mv,
 *        count(distinct o.oracle_id) as cards
 *   from oracle_card o
 *   join printing p on p.oracle_id = o.oracle_id
 *  where o.colors = '' and o.color_identity = ''
 *    and o.type_line like '%Artifact%'
 *    and o.type_line not like '%Creature%'
 *    and o.type_line not like '%Land%'
 *    and o.layout = 'normal'
 *    and p.lang = 'en' and p.digital = 0
 *    and json_extract(p.raw_json, '$.booster') = 1
 *    and json_extract(p.raw_json, '$.set_type') in ('core', 'expansion')
 *  group by p.rarity, mv
 * ```
 *
 * Every clause is the population this allocator is choosing for, and nothing
 * else: a colorless *noncreature permanent* (so no colored mana anywhere on the
 * card, no creature, no land), single-faced, that a player could actually open
 * in a booster of a *set* — supplemental products print colorless artifacts at
 * costs no draft environment ever has to survive, so Commander and Masters
 * releases are out.
 *
 * `cards` is the rare and mythic halves of that answer, merged; the two tiers
 * are what `bombsMinRarity` means ("Magic needs its bombs, and to keep from
 * ruining Limited these bombs are kept to rare and mythic rare"). The tiers
 * below, recorded here because they are the comparison that makes the shift
 * real: common is n=144 with a median of 2, uncommon n=316 with a median of 2,
 * rare alone n=314 with a median of 3, mythic alone n=32 with a median of 4.
 * The distribution moves up a mana as the rarity does, and one rotation for
 * every tier cannot.
 */
export const COLORLESS_PERMANENT_CENSUS = {
  store: 'data/store/mtg.sqlite',
  population:
    'colorless single-faced nonland noncreature artifacts printed at rare or mythic ' +
    'in an English paper booster of a core or expansion set',
  cards: { 0: 3, 1: 27, 2: 69, 3: 82, 4: 82, 5: 44, 6: 29, 7: 4, 8: 4, 9: 1, 10: 1 },
} as const;

/**
 * The same question at the tier a set may print a card that wins the game on its
 * own, and the one number in this module that had to be decided rather than
 * derived from a curve already published.
 *
 * `mtg-tqkc`. `topOfCurve` fixed the creature curve at this tier and `spellCurve`
 * above fixed the spell curve, both by the same move: apportionment drops the
 * ends, at this tier the end to drop is the cheap one, so the group is seated
 * from the dear end down. The colorless pool cannot be fixed that way, because a
 * rotation is not an apportionment — it has no ends. Read backwards it still
 * visits every window, so `[4, 3, 2]` prints the same two-mana rare one slot
 * later. The tier has to state a list.
 *
 * So the list is stated, and it is stated as the same rule applied to a
 * distribution instead of to a curve: **drop the cheap end.** The cheap end of
 * `COLORLESS_PERMANENT_CENSUS` is everything below its median, which is mana
 * value 3 — 99 of 346 cards, 28.6% of the population, and the half the tiers
 * below the bomb line already print. What is left is the dear 247, and the three
 * mana values real sets print most of within it are 3 (82 cards), 4 (82) and 5
 * (44): 84.2% of that half and 60.1% of the whole population. Those three are
 * the list. Dropping mythic and re-running the same derivation over the 314 rare
 * printings alone answers 3, 4 and 5 again, so the answer is not 32 mythics.
 *
 * Two things it fixes, both measured on the flagship at 249 before the change.
 * The tier's four pieces of gear came out at mana value 2, 3, 4, 2 — a rotation
 * of three over four slots gives the first window double weight, so half the
 * tier sat at two mana while real sets put 19.9% of the population there. And
 * the rotation's ceiling was 4, which is also the *common* pool's ceiling: the
 * tier defined as the one that may print a game-winning card could not print
 * anything dearer than a common. Both ends were wrong, which is why the list
 * moves at both ends.
 */
export const BOMB_COLORLESS_PERMANENT_MV: readonly ManaValueRange[] = [
  { min: 3, max: 3 },
  { min: 4, max: 4 },
  { min: 5, max: 5 },
];

/**
 * The window a colorless noncreature permanent slot takes when its role fixes
 * none.
 *
 * `bomb` is required rather than defaulted, for the reason `spellCurve`'s is: a
 * caller that does not state the tier is the bug, and a defaulted `false` would
 * make the tier-blind reading the quiet one again.
 */
export function colorlessPermanentWindow(ordinal: number, bomb: boolean): ManaValueRange {
  const windows = bomb ? BOMB_COLORLESS_PERMANENT_MV : COLORLESS_PERMANENT_MV;
  return windows[ordinal % windows.length] ?? { min: 3, max: 3 };
}

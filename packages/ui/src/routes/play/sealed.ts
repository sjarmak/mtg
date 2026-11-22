/**
 * Sealed deckbuilding state.
 *
 * A pool is a list of cards, and identity within it is the *index*, not the
 * card id: six boosters routinely open the same common three times, and three
 * copies of one card are three separate things a builder includes or cuts
 * independently. Everything here therefore selects by index.
 *
 * The division of labor is the project's ZFC line, and it runs through the mana
 * base as well as the spells. Which cards to play is judgment and belongs to the
 * person; `@mtg/deckbuild` supplies a suggestion they can take or ignore. Which
 * basics back those cards up is the same kind of decision — a splash is paid for
 * in consistency, and how much is worth paying is not a sum — so it is offered
 * the same way. `deckFor` apportions a base from the picks until the person
 * counts one out; from then on theirs stands, and `resuggestBasics` gives the
 * computed one back exactly as `resuggest` gives back the suggested spells.
 *
 * What is never asked of them is the arithmetic underneath: what a base
 * supports, and which colors it leaves short. That stays in `buildFromSpells`.
 */
import type { Card, Color } from '@mtg/dsl';
import { buildDeck, buildFromSpells, foilPositions, openCollatedPool, openSealedPool } from '@mtg/deckbuild';
import type { BasicLandCounts, ManualDeck, PackCollation, SealedPool } from '@mtg/deckbuild';

export interface SealedBuild {
  readonly pool: readonly Card[];
  /** Pool indices the builder has included, ascending. */
  readonly chosen: readonly number[];
  /** The basics the builder counted out, or null while the computed base stands. */
  readonly basics: BasicLandCounts | null;
  /**
   * The set the pool was opened from, which is what backs its mana base.
   *
   * A pool is six boosters and a set is the printing behind them, and the
   * difference is `mtg-aqxi.9`: the mana base is built by looking for a printed
   * Swamp, and looking in six boosters finds one or does not depending on the
   * seed. When it does not, the builder mints `m11-swamp`, the art manifest is
   * keyed by the set's `m11-238`, and the board draws a pending frame on every
   * Swamp for the whole game. So the build carries the set and hands it to
   * `@mtg/deckbuild` rather than letting the pool stand in for it.
   *
   * `null` for a build whose caller has no set to name, which falls back to the
   * pool exactly as before.
   */
  readonly set: readonly Card[] | null;
  /**
   * Pool positions dealt off a foil sheet, or `null` where the pool cannot say.
   *
   * Positions rather than cards, for the reason the whole module indexes by
   * position: a foil and an ordinary copy of one card are the same `Card`, and
   * the difference between them is entirely which slot dealt them. That is what
   * `mtg-11yd` settled and what a `foil` field on the card would have thrown
   * away.
   *
   * `null` is not "no foils here". `@mtg/deckbuild`'s `foilPositions` declines
   * for a rarity recipe, which has no foil slot to deal off, and for a collation
   * that never stated the flag, and a surface has to tell those apart from an
   * empty list: a pool that took no measurement is not a pool to draw a
   * foil-versus-ordinary distinction on. A remote room's pool arrives as cards
   * with no provenance behind them and is `null` for the first reason.
   */
  readonly foils: readonly number[] | null;
}

export interface OpenSealedOptions {
  /**
   * The printing's own sheets, when the staged document carried them.
   *
   * Without it the pool is dealt from what the card list prints, which is all a
   * generated set can offer and is the wrong pack for a real printing: M11 opens
   * a basic, ten commons, three uncommons and a rare-or-mythic, sometimes
   * swapping a common for a foil, and it weights its rare sheet card by card.
   * `@mtg/deckbuild`'s `collation.ts` argues the split; the decision to use one
   * or the other is made here, once, on whether the document said.
   */
  readonly collation?: PackCollation;
}

/** Opens a pool and returns it alongside the builder's suggested 23 spells. */
export function openSealed(set: readonly Card[], seed: string, options: OpenSealedOptions = {}): SealedBuild {
  const pool: SealedPool =
    options.collation === undefined
      ? openSealedPool(set, { seed })
      : openCollatedPool(set, options.collation, { seed });
  return {
    pool: pool.cards,
    chosen: suggestSelection(pool.cards),
    basics: null,
    set,
    foils: foilPositions(pool.provenance),
  };
}

/**
 * The indices `buildDeck` would play out of this pool.
 *
 * `buildDeck` returns cards, and a pool with duplicates cannot be matched back
 * by id alone, so copies are consumed greedily: each suggested card claims the
 * lowest pool index of that card not already claimed. Lands the builder
 * synthesized are skipped, since the mana base is a separate choice with its own
 * suggestion rather than part of the selection.
 */
export function suggestSelection(pool: readonly Card[]): readonly number[] {
  const suggestion = buildDeck(pool);
  const taken = new Set<number>();
  for (const spell of suggestion.spells) {
    const index = pool.findIndex((card, at) => !taken.has(at) && card.id === spell.id);
    if (index >= 0) taken.add(index);
  }
  return [...taken].sort((a, b) => a - b);
}

export function toggle(build: SealedBuild, index: number): SealedBuild {
  if (index < 0 || index >= build.pool.length) return build;
  const chosen = build.chosen.includes(index)
    ? build.chosen.filter((entry) => entry !== index)
    : [...build.chosen, index].sort((a, b) => a - b);
  return { ...build, chosen };
}

export function clearSelection(build: SealedBuild): SealedBuild {
  return { ...build, chosen: [] };
}

export function resuggest(build: SealedBuild): SealedBuild {
  return { ...build, chosen: suggestSelection(build.pool) };
}

/**
 * Adds or removes one basic of a color.
 *
 * The first adjustment starts from whatever base is in the deck right now, which
 * on an untouched build is the computed one. Editing a suggestion is the whole
 * gesture — starting from an empty mana base because somebody clicked once would
 * throw away seventeen lands to add one.
 */
export function adjustBasics(build: SealedBuild, color: Color, delta: number): SealedBuild {
  const current = basicsFor(build);
  return { ...build, basics: { ...current, [color]: Math.max(0, current[color] + delta) } };
}

/** Hands the deck back to the computed mana base, the way `resuggest` does spells. */
export function resuggestBasics(build: SealedBuild): SealedBuild {
  return { ...build, basics: null };
}

/** The basics in the deck as it stands, chosen or computed, all five colors listed. */
export function basicsFor(build: SealedBuild): Readonly<Record<Color, number>> {
  return deckFor(build).manaBase.landsByColor;
}

export function chosenCards(build: SealedBuild): readonly Card[] {
  return build.chosen.map((index) => build.pool[index]).filter((card): card is Card => card !== undefined);
}

/** The deck the current selection makes, mana base included. */
export function deckFor(build: SealedBuild): ManualDeck {
  const spells = chosenCards(build);
  const config = { set: build.set };
  return build.basics === null
    ? buildFromSpells(spells, build.pool, config)
    : buildFromSpells(spells, build.pool, config, build.basics);
}

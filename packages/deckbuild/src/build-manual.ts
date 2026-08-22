/**
 * A deck from the spells a person actually chose, and the mana base they either
 * chose or asked for.
 *
 * `buildDeck` answers "what is the best deck in this pool". This answers a
 * different question: "I have picked these cards, now give me a legal deck".
 * A sealed builder needs the second, because the whole point of letting a human
 * override the suggestion is that their picks are the input rather than the
 * output.
 *
 * The split is the project's ZFC line drawn through deck construction, and it
 * runs one step further than it used to. Which cards to play is judgment. So is
 * the mana base: how a splash gets paid for is a decision with a cost either
 * way, not a sum with an answer. Both belong to whoever is building, human or
 * model. What stays here is the arithmetic — pip demand, source counts,
 * Karsten-style castability — and the validation: deck size, and every color the
 * picks lean on harder than the base pays for.
 *
 * So this function computes and reports; it no longer decides. Handed no base it
 * apportions one across every color the picks demand, which is a suggestion.
 * Handed a base it prints that one, splash and all. The version before this
 * ranked the ten color pairs and built for the winning two, which meant a
 * three-color deck was not expressible at any selection of cards: the third
 * color's lands were never printed and its shortfall was never reported, because
 * the color had been dropped before either could happen.
 */
import type { Card, Color } from '@mtg/dsl';
import { COLORS } from '@mtg/dsl';
import { resolveConfig } from './config';
import type { DeckBuildConfig, DeckBuildConfigInput } from './config';
import { evaluatePool } from './evaluate';
import type { PoolCard } from './evaluate';
import { copyExcesses } from './constructed';
import type { CopyExcess } from './constructed';
import { buildChosenManaBase, buildManaBase, demandedColors, measureDemand } from './mana-base';
import type { BasicLandCounts, ManaBase } from './mana-base';
import type { Shortfall } from './shortfall';

export interface ManualDeck {
  /** Chosen spells first, then the mana base. */
  readonly deck: readonly Card[];
  readonly spells: readonly Card[];
  readonly lands: readonly Card[];
  /** The colors the chosen spells demand, WUBRG order. Three is a normal answer. */
  readonly colors: readonly Color[];
  readonly manaBase: ManaBase;
  readonly shortfalls: readonly Shortfall[];
  /**
   * Every card played over `config.copyLimit`, by name, Basic lands exempt.
   *
   * Separate from `shortfalls` because a shortfall is something missing and
   * every variant of it carries a `missing` count. Too many copies is the
   * opposite, and forcing it into that union would have made `missing` a
   * negative number on one arm. Empty in Limited, where the limit is `null`.
   */
  readonly excesses: readonly CopyExcess[];
  /** Spells chosen, and how many the deck still has room for. */
  readonly spellCount: number;
  readonly spellTarget: number;
  /**
   * True when the deck is a legal `deckSize` cards with no card played over the
   * copy limit.
   *
   * Shortfalls do not veto. A three-color base cannot floor every color out of
   * seventeen lands, and a person who wants that deck anyway is making a
   * playable deck with a known weakness, not an illegal one — so the weakness is
   * reported in `shortfalls` and the deck still starts. An excess is not that
   * kind of weakness: a fifth copy is against the rules of the format rather
   * than against the odds, so it does veto.
   */
  readonly complete: boolean;
  readonly config: DeckBuildConfig;
}

/**
 * Too few spells is a `spellSlots` shortfall, which is exactly what that
 * variant means. Too many is not a shortfall at all, so it is reported through
 * `spellCount` and `complete` rather than forced into a union of things that
 * are missing.
 *
 * Neither case trims or pads. Silently cutting a player's 24th spell would be
 * the worst possible behavior here: they chose it, and a builder that quietly
 * disagrees about that is one they cannot trust with the other 23.
 */
function sizeShortfalls(spells: readonly Card[], target: number): readonly Shortfall[] {
  if (spells.length >= target) return [];
  return [
    {
      kind: 'spellSlots',
      target,
      achieved: spells.length,
      missing: target - spells.length,
    },
  ];
}

/**
 * The mana base for a selection nobody has counted lands for yet.
 *
 * Every color the picks demand gets sources, in proportion to what it demands.
 * A selection with no colored pips at all demands nothing, so no color is
 * preferred and the basics spread across all five: an arbitrary split is the
 * honest answer to a deck that can cast everything off anything, and inventing a
 * preference for white would not be.
 */
function suggestManaBase(
  evaluations: readonly PoolCard[],
  colors: readonly Color[],
  pool: readonly Card[],
  config: DeckBuildConfig,
): ManaBase {
  return buildManaBase(evaluations, colors.length > 0 ? colors : COLORS, pool, config);
}

/**
 * Builds a legal deck around an exact spell list.
 *
 * `pool` is the wider card pool, used only to find real basic-land cards to
 * print; the spells come from `spells` and nothing else is added to them.
 * `basics` is the mana base the builder counted out — leave it off and one is
 * apportioned from the picks instead.
 *
 * The spell target follows the lands rather than the config, because once the
 * land count is somebody's to choose, `deckSize - landCount` is a statement
 * about a deck nobody is building. Eighteen lands leaves room for twenty-two
 * spells and the report says so.
 */
export function buildFromSpells(
  spells: readonly Card[],
  pool: readonly Card[],
  input: DeckBuildConfigInput = {},
  basics?: BasicLandCounts,
): ManualDeck {
  const config = resolveConfig(input);
  const evaluations: readonly PoolCard[] = evaluatePool(spells, config.weights);
  const colors = demandedColors(measureDemand(evaluations, config.manaBase));
  const manaBase =
    basics === undefined
      ? suggestManaBase(evaluations, colors, pool, config)
      : buildChosenManaBase(evaluations, basics, pool, config);
  const target = Math.max(0, config.deckSize - manaBase.lands.length);
  const shortfalls: readonly Shortfall[] = [...sizeShortfalls(spells, target), ...manaBase.shortfalls];
  const deck = [...spells, ...manaBase.lands];
  const excesses = copyExcesses(deck, config.copyLimit);

  return {
    deck,
    spells,
    lands: manaBase.lands,
    colors,
    manaBase,
    shortfalls,
    excesses,
    spellCount: spells.length,
    spellTarget: target,
    complete: deck.length === config.deckSize && excesses.length === 0,
    config,
  };
}

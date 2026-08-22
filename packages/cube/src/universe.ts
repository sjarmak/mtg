/**
 * The structural half: every card the cube's restrictions allow.
 *
 * There is no cube-specific SQL here and there should not be. What a cube
 * restricts structurally — format legality, a per-card price ceiling, and the
 * layouts that are not a card you can put in a list — is exactly what
 * `@mtg/decklab`'s `selectUniverse` already computes, tested against the real
 * schema, and a second query would be a second set of edge cases (basics, split
 * cards, digital-only printings, cards with no price) to keep in step by hand.
 * This file is the projection from cube criteria onto that query, and nothing
 * else.
 *
 * The universe is a *validation set*, never a shortlist. `candidates.ts` in
 * `@mtg/decklab` argues why at length and the argument is unchanged at cube
 * scale: "modern, priced under a dollar" is 19,022 cards, nothing that size
 * fits in a prompt, and any cap imposed to make it fit is a ranking — a quality
 * judgment made in code over exactly the cards the model was supposed to be
 * judging. So the model proposes names from what it knows and code checks each
 * one against this set.
 */
import type { DataStore } from '@mtg/data';
import type { CandidateUniverse, DeckCriteria } from '@mtg/decklab';
import { loadKnownNames, selectUniverse } from '@mtg/decklab';
import type { Card } from '@mtg/dsl';
import type { CubeCriteria } from './criteria';
import { cubeCopyLimit } from './criteria';

/** The legal pool plus the whole store's names, which is what a proposal is checked against. */
export interface CubePool {
  readonly universe: CandidateUniverse;
  /**
   * Every real card name in the store, normalized. It is what tells an invented
   * card apart from a real card the restrictions exclude, and the two need
   * different feedback: "stop making cards up" versus "that one is illegal
   * here, pick another".
   */
  readonly knownNames: ReadonlySet<string>;
  /**
   * The DSL card behind each candidate, keyed by `oracleId`, when there is one.
   *
   * A cube cut from a generated set can be drafted, because the draft runtime
   * and the deck builder both take DSL cards; a cube cut from the card store
   * holds real printings whose rules text the kernel cannot run, so it has no
   * map and `measureAvailability` says so. Nothing else in the package reads
   * this — the construction loop still never learns which pool it was handed.
   */
  readonly draftable?: ReadonlyMap<string, Card>;
}

/**
 * The cube's restrictions in the shape `selectUniverse` reads.
 *
 * `colors` is empty because a cube spans the whole pie, and empty means
 * unconstrained. There is no `maxManaValue`: a cube's curve is a distribution
 * the finished list is measured against, not a ceiling on what may enter it.
 * `budget` is passed only when a ceiling was stated — an always-present budget
 * would silently add `selectUniverse`'s "priced cards only" guard and drop
 * every card the store has no USD price for from cubes that never mentioned
 * money.
 */
export function toPoolQuery(criteria: CubeCriteria): DeckCriteria {
  return {
    prompt: criteria.prompt,
    format: criteria.format,
    colors: [],
    size: criteria.size,
    maxCopies: cubeCopyLimit(criteria),
    themes: [],
    ...(criteria.maxCardUsd === undefined
      ? {}
      : { budget: { maxCardUsd: criteria.maxCardUsd, allowUnpriced: false } }),
  };
}

export function selectCubePool(store: DataStore, criteria: CubeCriteria): CubePool {
  return { universe: selectUniverse(store, toPoolQuery(criteria)), knownNames: loadKnownNames(store) };
}

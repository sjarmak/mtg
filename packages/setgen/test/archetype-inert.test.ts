/**
 * The inert budget, in the units it is written in.
 *
 * `ARCHETYPE_INERT_GLUT` is the one floor here that is ours rather than canon's:
 * DSL v0 has no activated, triggered or static abilities, so a counterspell, a
 * mill spell or a raw cantrip resolves without ever touching the battlefield and
 * there is no payoff in the set for it to feed. The budget was two, held against
 * the pool the whole table drafts from, and `mtg-gud1` is the bug that a tally
 * against a pool says nothing at scale: the 371-card flagship earned the error
 * over four commons that rank in the bottom thirty of a 114-card pool and appear
 * in no deck the builder assembles for any pair.
 *
 * The budget now reads what `inDeck` projects, the way the answer floors already
 * did. The number does not move -- the derivation beside `DEFAULT_ARCHETYPE_FLOORS`
 * is that the evidence reads the same in either unit -- so what is checked here
 * is that the comparison is a density rather than a tally, that the pool
 * `mtg-bc2.36` measured as unplayable still trips it, and that the sentence the
 * error carries is unchanged, because three recorded llm fixtures are keyed on
 * that prompt.
 *
 * Contributions are synthesized for the reason `archetype-bodies.test.ts`
 * synthesizes them: `playableIn` and `inert` are the only fields this question
 * depends on, and building them by hand is what lets a pool state a density and
 * a size independently.
 */
import { describe, expect, it } from 'vitest';
import type { Color } from '@mtg/dsl';
import { spellCount, DEFAULT_DECK_BUILD_CONFIG } from '@mtg/deckbuild';
import {
  assessPair,
  CURRENT_GENERATION_SEMANTICS_VERSION,
  DEFAULT_ARCHETYPE_FLOORS,
  inDeck,
  LEGACY_GENERATION_SEMANTICS_VERSION,
  planArchetypes,
} from '@mtg/setgen';
import type { ArchetypePlan, Contribution } from '@mtg/setgen';
import { briefFromFile } from './helpers';

const plans = planArchetypes(briefFromFile('tideglass-reach.json'));

function planFor(pair: string): ArchetypePlan {
  const plan = plans.find((item) => item.pair === pair);
  if (plan === undefined) throw new Error(`no plan for ${pair}`);
  return plan;
}

function contribution(index: number, colors: readonly Color[], inert: boolean): Contribution {
  return {
    slotId: `C${index}`,
    colors,
    manaValueMin: 3,
    manaValueMax: 3,
    creature: !inert,
    removal: false,
    inert,
    archetypes: [],
    signpost: false,
    subjects: [],
  };
}

/** A pool of `size` cards castable in `colors`, `inert` of them resolving and leaving. */
function pool(size: number, inert: number, colors: readonly Color[]): Contribution[] {
  return Array.from({ length: size }, (_, index) => contribution(index, colors, index < inert));
}

function inertShortfall(contributions: readonly Contribution[], pair: string) {
  return assessPair(contributions, planFor(pair)).shortfalls.find((item) => item.kind === 'inert');
}

describe('the inert budget is a density, not a tally', () => {
  it('states the budget in deck units, at the number it has always been', () => {
    expect(DEFAULT_ARCHETYPE_FLOORS.inertBudget).toBe(2);
    expect(DEFAULT_ARCHETYPE_FLOORS.playables).toBe(spellCount(DEFAULT_DECK_BUILD_CONFIG));
  });

  it('clears a pool whose raw inert count is many times the budget', () => {
    // Thirteen inert cards in a 170-card pool, which is the flagship's worst
    // pair. It is six times the old tally and projects to two in a 23-spell
    // deck: at budget, not over it. This is the case `mtg-gud1` names.
    const flagship = pool(170, 13, ['U', 'B']);
    expect(inDeck(13, 170, DEFAULT_ARCHETYPE_FLOORS.playables)).toBe(2);
    expect(inertShortfall(flagship, 'UB')).toBeUndefined();
  });

  it('can replay the pre-density tally without changing the current default', () => {
    const flagship = pool(170, 13, ['U', 'B']);
    const current = assessPair(
      flagship,
      planFor('UB'),
      DEFAULT_ARCHETYPE_FLOORS,
      CURRENT_GENERATION_SEMANTICS_VERSION,
    );
    const legacy = assessPair(
      flagship,
      planFor('UB'),
      DEFAULT_ARCHETYPE_FLOORS,
      LEGACY_GENERATION_SEMANTICS_VERSION,
    );

    expect(current.shortfalls.find((item) => item.kind === 'inert')).toBeUndefined();
    expect(legacy.shortfalls.find((item) => item.kind === 'inert')?.found).toBe(13);
  });

  it('fails the density that mtg-bc2.36 measured as an unplayable archetype', () => {
    // Blue spent 5 of its 17 skeleton cards on roles that resolve and leave,
    // which is 5 in a blue pair's 39-card pool. UR won 30.7% of its games.
    const dead = pool(39, 5, ['U', 'R']);
    expect(inDeck(5, 39, DEFAULT_ARCHETYPE_FLOORS.playables)).toBe(3);
    const shortfall = inertShortfall(dead, 'UR');
    expect(shortfall?.wanted).toBe(2);
    // `wanted` and `found` in one unit, the way the creature floor reads.
    expect(shortfall?.found).toBe(3);
  });

  it('turns over between the two, so the budget is where the derivation put it', () => {
    // 2.95 rounds up and 2.36 rounds down: the margin is one card, and the
    // derivation says so rather than claiming more separation than it has.
    expect(inertShortfall(pool(39, 4, ['U', 'R']), 'UR')).toBeUndefined();
    expect(inertShortfall(pool(39, 5, ['U', 'R']), 'UR')).toBeDefined();
  });

  it('reports the projection beside the count it was projected from', () => {
    const report = assessPair(pool(170, 13, ['U', 'B']), planFor('UB'));
    expect(report.inert).toBe(13);
    expect(report.inertInDeck).toBe(2);
  });
});

describe('the sentence the error carries', () => {
  // Not cosmetic. `ARCHETYPE_INERT_GLUT` is an error that names slots, so its
  // text is the correction the retry loop hands the model, and three recorded
  // llm fixtures hold a run that tripped it. It counts pool cards on purpose:
  // pool cards are what the model can rewrite.
  it('still counts the pool, not the deck, and still names every slot', () => {
    const shortfall = inertShortfall(pool(39, 5, ['U', 'R']), 'UR');
    expect(shortfall?.detail).toContain('5 playables resolve without touching the battlefield');
    for (const slot of ['C0', 'C1', 'C2', 'C3', 'C4']) {
      expect(shortfall?.detail).toContain(slot);
    }
  });
});

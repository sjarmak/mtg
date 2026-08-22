/**
 * A modal spell (CR 700.2) through the bot policies that read a card's own
 * effects at cast time.
 *
 * `be1b33b` fixed four sites in `dsl`, `deckbuild` and `forge-export`; this
 * file is `packages/sim`'s half of the survey `mtg-xu2q` closes.
 * `packages/kernel`'s `legal.ts`/`stack.ts` already resolve a modal cast
 * through a chosen mode (`castOptions`, `modeOptionsFor`, `effectsFor(card,
 * entry.mode)`), so a policy that scores or times a cast is a genuine
 * runtime site with a mode to resolve — the "resolve the chosen mode" verdict,
 * via `@mtg/dsl`'s `effectsFor(card, mode)`, not "render every mode" (there is
 * a game in progress here) and not "refuse" (the kernel always hands the
 * policy a real mode for a modal card's `castSpell` option).
 */
import { describe, expect, it } from 'vitest';
import type { Effect } from '@mtg/dsl';
import { mana, parseCard } from '@mtg/dsl';
import type { Action, AgentView, GameState } from '@mtg/kernel';
import { objectId, scenario } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG } from '@mtg/sim';
import { bestTargetingPerCard, castTimingAllows } from '../src/policies/cast';
import { scoreTargets } from '../src/policies/target';

type CastAction = Extract<Action, { type: 'castSpell' }>;

const config = DEFAULT_GREEDY_CONFIG;

const BOLT: Effect = { kind: 'dealDamage', amount: 3, target: { kind: 'targetOpponent' } };
const GAIN: Effect = { kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } };
const PUMP: Effect = {
  kind: 'pumpUntilEndOfTurn',
  power: 2,
  toughness: 2,
  target: { kind: 'targetCreature' },
};
const DRAW: Effect = { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } };

/** A modal spell, built the same way `@mtg/dsl`'s `modal.ts` requires it. */
function modalSpell(kind: 'sorcery' | 'instant', modes: readonly { readonly effects: readonly Effect[] }[]) {
  return parseCard({
    id: 'tst-fork-in-the-road',
    name: 'Fork in the Road',
    kind,
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['R'],
    manaCost: mana({ generic: 2, R: 1 }),
    effects: [],
    modes,
  });
}

function board(): GameState {
  return scenario({ life: [20, 20] }).state;
}

describe('a modal spell reaching the targeting score (target.ts)', () => {
  it("scores the chosen mode's own effects, not always the same value regardless of mode", () => {
    const card = modalSpell('instant', [{ effects: [BOLT] }, { effects: [GAIN] }]);
    const state = board();

    const boltScore = scoreTargets(
      state,
      0,
      card,
      [{ kind: 'player', player: 1 }],
      config.cast,
      config.target,
      config.race,
      0,
      0,
    );
    const gainScore = scoreTargets(state, 0, card, [null], config.cast, config.target, config.race, 0, 1);

    expect(boltScore).toBeCloseTo(3 * config.target.faceDamageWeight);
    expect(gainScore).toBeCloseTo(3 * config.target.lifeGainValue);
    expect(boltScore).not.toBeCloseTo(gainScore);
  });

  it('refuses rather than silently scoring zero when no mode is chosen for a modal card', () => {
    const card = modalSpell('instant', [{ effects: [BOLT] }, { effects: [GAIN] }]);
    const state = board();
    expect(() =>
      scoreTargets(
        state,
        0,
        card,
        [{ kind: 'player', player: 1 }],
        config.cast,
        config.target,
        config.race,
        0,
        null,
      ),
    ).toThrow(/mode/);
  });
});

describe('a modal spell reaching the cast-timing policy (cast.ts)', () => {
  it('holds a pump mode for combat while its sibling mode is unaffected, instead of never recognizing either as a trick', () => {
    const card = modalSpell('sorcery', [{ effects: [PUMP] }, { effects: [DRAW] }]);
    const state = board();
    expect(state.combat.attacks).toStrictEqual([]);

    // Mode 0 is a combat trick with no combat to trick: held.
    expect(castTimingAllows(state, 0, card, 0, config.cast)).toBe(false);
    // Mode 1 prints no trick at all, so the trick-holding rule never applies
    // to it; a sorcery has no other timing restriction, so it is allowed.
    expect(castTimingAllows(state, 0, card, 1, config.cast)).toBe(true);
  });

  it('recognizes the trick once there is a combat to trick', () => {
    const card = modalSpell('sorcery', [{ effects: [PUMP] }, { effects: [DRAW] }]);
    const attacking = board();
    const withAttack: GameState = {
      ...attacking,
      combat: { ...attacking.combat, attacks: [{ oid: objectId(0), defender: 1 }] },
    };
    expect(castTimingAllows(withAttack, 0, card, 0, config.cast)).toBe(true);
  });

  /**
   * `bestTargetingPerCard` enumerates one `castSpell` option per mode (the
   * kernel's `modeOptionsFor`) and used to key its timing cache by object id
   * alone, so the first mode evaluated decided every other mode's verdict too.
   * A held pump mode evaluated before its untricky sibling would hide a
   * perfectly castable draw mode behind the pump mode's "hold it" verdict.
   */
  it("does not let one mode's held-for-combat verdict hide a sibling mode that has nothing to hold", () => {
    const card = modalSpell('sorcery', [{ effects: [PUMP] }, { effects: [DRAW] }]);
    const state = scenario({ life: [20, 20], hands: [[card], []] }).state;
    const oid = state.players[0].hand[0];
    if (oid === undefined) throw new Error('scenario did not place the modal card in hand');

    const pumpOption: CastAction = { type: 'castSpell', player: 0, oid, targets: [null], mode: 0 };
    const drawOption: CastAction = { type: 'castSpell', player: 0, oid, targets: [null], mode: 1 };
    const view: AgentView = {
      state,
      player: 0,
      decision: { kind: 'priority', player: 0, complete: false, options: [pumpOption, drawOption] },
    };
    const candidates = bestTargetingPerCard(view, config);
    // Mode 1 (draw) has nothing to hold and must survive; if the timing cache
    // were still keyed by oid alone, mode 0's "hold it" verdict would also
    // suppress mode 1 and this card would offer no candidate at all.
    expect(candidates.map((c) => c.action.mode)).toContain(1);
  });
});

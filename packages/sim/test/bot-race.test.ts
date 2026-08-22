/**
 * Race-awareness unit tests: the global "who is winning" term the tier-1 bots
 * gained under bead `mtg-bc2.35`.
 *
 * Each case states a position where the *local* heuristic on its own gives the
 * wrong answer, and asserts the race term corrects it. A failure here names the
 * heuristic that broke rather than a win-rate wobble three thousand games later.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ObjectId, PlayerId } from '@mtg/kernel';
import { eligibleAttackers, scenario } from '@mtg/kernel';
import { DEFAULT_GREEDY_CONFIG, greedyConfig } from '@mtg/sim';
import {
  attackContext,
  attackValue,
  chooseAttackers,
  holdBackBlockers,
  lethalSwing,
} from '../src/policies/attack';
import { blockThreshold } from '../src/policies/block';
import { damageThroughBestBlocks } from '../src/policies/combat';
import { assessRace } from '../src/policies/race';
import { scoreTargets } from '../src/policies/target';
import { creature, sorcery } from './cards';

const config = DEFAULT_GREEDY_CONFIG;
const defaultRace = config.race;

function byName(state: GameState, name: string): ObjectId {
  for (const [oid, object] of Object.entries(state.objects)) {
    if (object.zone === 'battlefield' && object.card.name === name) return oid;
  }
  throw new Error(`no battlefield object named ${name}`);
}

function names(state: GameState, oids: readonly ObjectId[]): readonly string[] {
  return oids.map((oid) => state.objects[oid]?.card.name ?? '?');
}

function attackerNames(state: GameState, me: PlayerId = 0): readonly string[] {
  return names(
    state,
    chooseAttackers(state, me, eligibleAttackers(state), config).map((declaration) => declaration.oid),
  );
}

describe('race assessment', () => {
  it('reads both clocks off attack-capable power against life', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [10, 12],
      battlefield: [
        { card: creature('Ours', 4, 4), controller: 0 },
        { card: creature('Theirs', 5, 5), controller: 1 },
      ],
    });
    const assessment = assessRace(state, 0, defaultRace);
    expect(assessment.ourPower).toBe(4);
    expect(assessment.theirPower).toBe(5);
    expect(assessment.ourClock).toBe(3); // 12 life / 4 power
    expect(assessment.theirClock).toBe(2); // 10 life / 5 power
    expect(assessment.losing).toBe(true);
    expect(assessment.winning).toBe(false);
  });

  it('counts a tapped attacker as a threat, because it untaps before it swings again', () => {
    const { state } = scenario({
      active: 1,
      step: 'declareAttackers',
      life: [6, 20],
      battlefield: [
        { card: creature('Blocker', 2, 2), controller: 0 },
        { card: creature('Raider', 4, 4), controller: 1, tapped: true },
      ],
    });
    // Tapped and not attacking: nothing is coming at us this combat.
    expect(assessRace(state, 0, defaultRace).theirPower).toBe(0);

    const attacking: GameState = {
      ...state,
      combat: { ...state.combat, attacks: [{ oid: byName(state, 'Raider'), defender: 0 }] },
    };
    // Tapped *because it is attacking*: an untapped-only count would read the
    // player being attacked as facing no threat at all.
    expect(assessRace(attacking, 0, defaultRace).theirPower).toBe(4);
    expect(assessRace(attacking, 0, defaultRace).losing).toBe(true);
  });

  it('treats an opponent with no creatures as a race we win', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [{ card: creature('Ours', 3, 3), controller: 0 }],
    });
    const assessment = assessRace(state, 0, defaultRace);
    expect(assessment.theirClock).toBe(Number.POSITIVE_INFINITY);
    expect(assessment.winning).toBe(true);
    expect(assessment.losing).toBe(false);
  });

  it('never calls it winning when we have no clock at all', () => {
    const { state } = scenario({ active: 0, step: 'declareAttackers', battlefield: [] });
    const assessment = assessRace(state, 0, defaultRace);
    expect(assessment.ourClock).toBe(Number.POSITIVE_INFINITY);
    expect(assessment.winning).toBe(false);
  });

  it('demands daylight when the profile asks for a margin', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [10, 10],
      battlefield: [
        { card: creature('Ours', 5, 5), controller: 0 },
        { card: creature('Theirs', 5, 5), controller: 1 },
      ],
    });
    expect(assessRace(state, 0, greedyConfig({ race: { winningMargin: 0 } }).race).winning).toBe(true);
    expect(assessRace(state, 0, greedyConfig({ race: { winningMargin: 1 } }).race).winning).toBe(false);
  });
});

describe('lethal recognition', () => {
  it('sees lethal through a blocker that can only stop one attacker', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [20, 5],
      battlefield: [
        { card: creature('Swing A', 3, 3), controller: 0 },
        { card: creature('Swing B', 3, 3), controller: 0 },
        { card: creature('Swing C', 3, 3), controller: 0 },
        { card: creature('Chump', 1, 1), controller: 1 },
      ],
    });
    // Six damage gets through the one block; they are at five.
    expect(lethalSwing(attackContext(state, 0, eligibleAttackers(state)))).toBe(true);
    expect(attackerNames(state)).toHaveLength(3);
  });

  it('does not call it lethal when the blocks actually save them', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [20, 5],
      battlefield: [
        { card: creature('Swing A', 3, 3), controller: 0 },
        { card: creature('Swing B', 3, 3), controller: 0 },
        { card: creature('Guard A', 1, 1), controller: 1 },
        { card: creature('Guard B', 1, 1), controller: 1 },
      ],
    });
    expect(lethalSwing(attackContext(state, 0, eligibleAttackers(state)))).toBe(false);
  });

  it('prices trample into the lethal check: a chump only stops lethal damage', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [20, 4],
      battlefield: [
        { card: creature('Stampeder', 6, 6, ['trample']), controller: 0 },
        { card: creature('Whelp', 1, 1), controller: 1 },
      ],
    });
    // 6 trample over a 1/1 leaves 5, and they are at 4.
    expect(lethalSwing(attackContext(state, 0, eligibleAttackers(state)))).toBe(true);
  });

  it('needs two bodies to blunt a menace attacker', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [20, 3],
      battlefield: [
        { card: creature('Stalker', 3, 3, ['menace']), controller: 0 },
        { card: creature('Lone Guard', 4, 4), controller: 1 },
      ],
    });
    expect(damageThroughBestBlocks(state, [byName(state, 'Stalker')], [byName(state, 'Lone Guard')])).toBe(3);
    expect(lethalSwing(attackContext(state, 0, eligibleAttackers(state)))).toBe(true);
  });
});

describe('attack value against blocks the defender would decline', () => {
  it('scores an attacker as damage when every block loses for the defender', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: creature('Bruiser', 4, 4), controller: 0 },
        { card: creature('Whelp', 1, 1), controller: 1 },
      ],
    });
    const context = attackContext(state, 0, eligibleAttackers(state));
    // The 1/1 block is a straight loss for them, so the swing is worth its
    // damage rather than an exchange they would never choose to make.
    expect(attackValue(context, byName(state, 'Bruiser'), config)).toBeCloseTo(
      4 * config.attack.unblockedDamageValue,
      6,
    );
  });

  it('still respects a block the defender would happily make', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      battlefield: [
        { card: creature('Runt', 2, 2), controller: 0 },
        { card: creature('Colossus', 4, 4), controller: 1 },
      ],
    });
    const context = attackContext(state, 0, eligibleAttackers(state));
    expect(attackValue(context, byName(state, 'Runt'), config)).toBeLessThan(0);
    expect(attackerNames(state)).toEqual([]);
  });
});

describe('the race guard', () => {
  it('keeps back only the bodies survival needs, not one per attacker', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [8, 20],
      battlefield: [
        { card: creature('Charger A', 3, 3), controller: 0 },
        { card: creature('Charger B', 3, 3), controller: 0 },
        { card: creature('Charger C', 3, 3), controller: 0 },
        { card: creature('Raider A', 3, 3), controller: 1 },
        { card: creature('Raider B', 3, 3), controller: 1 },
        { card: creature('Raider C', 3, 3), controller: 1 },
      ],
    });
    // Nine power against eight life: one blocker at home takes the return swing
    // to six, which we survive. The old policy kept one body per opposing
    // creature — three — and neither side ever attacked again.
    const context = attackContext(state, 0, eligibleAttackers(state));
    expect(assessRace(state, 0, defaultRace).losing).toBe(true);
    expect(holdBackBlockers(context, eligibleAttackers(state), config)).toHaveLength(2);
  });

  it('does not hold anything back while we are ahead on the clock', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [6, 5],
      battlefield: [
        { card: creature('Charger A', 3, 3), controller: 0 },
        { card: creature('Charger B', 3, 3), controller: 0 },
        { card: creature('Raider', 6, 6), controller: 1 },
      ],
    });
    // They kill us in one swing; we kill them in one, and we swing first.
    expect(assessRace(state, 0, defaultRace).winning).toBe(true);
    const context = attackContext(state, 0, eligibleAttackers(state));
    expect(holdBackBlockers(context, eligibleAttackers(state), config)).toHaveLength(2);
  });

  it('lets the profile force the old hold-back-while-winning behavior back on', () => {
    const { state } = scenario({
      active: 0,
      step: 'declareAttackers',
      life: [6, 5],
      battlefield: [
        { card: creature('Charger A', 3, 3), controller: 0 },
        { card: creature('Charger B', 3, 3), controller: 0 },
        { card: creature('Raider', 6, 6), controller: 1 },
      ],
    });
    const context = attackContext(state, 0, eligibleAttackers(state));
    const stubborn = greedyConfig({ race: { holdBackWhileWinning: true } });
    expect(holdBackBlockers(context, eligibleAttackers(state), stubborn)).toHaveLength(1);
  });

  it('accepts a worse trade while winning the race than while losing it', () => {
    const board = (life: readonly [number, number]): GameState =>
      scenario({
        active: 0,
        step: 'declareAttackers',
        life: [life[0] ?? 20, life[1] ?? 20],
        battlefield: [
          { card: creature('Runt', 2, 2), controller: 0 },
          { card: creature('Warden', 2, 4), controller: 1 },
        ],
      }).state;
    // The same attack into the same blocker. Only the race differs: at 3 life
    // they are one swing from dead, so the losing trade is the winning play.
    const generous = greedyConfig({
      attack: { acceptableTradeLoss: 3 },
      race: { racingTradeLoss: 4 },
    });
    const behind = board([10, 20]);
    const ahead = board([20, 3]);
    expect(assessRace(behind, 0, defaultRace).winning).toBe(false);
    expect(assessRace(ahead, 0, defaultRace).winning).toBe(true);
    const attack = (state: GameState): readonly string[] =>
      names(
        state,
        chooseAttackers(state, 0, eligibleAttackers(state), generous).map((declaration) => declaration.oid),
      );
    expect(attack(behind)).toEqual([]);
    expect(attack(ahead)).toEqual(['Runt']);
  });
});

describe('race-aware blocking', () => {
  function threshold(life: readonly [number, number], theirPower: number): number {
    const { state } = scenario({
      active: 1,
      step: 'declareAttackers',
      life: [life[0] ?? 20, life[1] ?? 20],
      battlefield: [
        { card: creature('Ours', 5, 5), controller: 0 },
        { card: creature('Theirs', theirPower, 3), controller: 1 },
      ],
    });
    return blockThreshold(state, 0, config.block, defaultRace);
  }

  it('demands more of a block while we are winning the race', () => {
    // Our 5 power against their 6 life is two swings; their 1 power against our
    // 20 is twenty. We are the aggressor, so our bodies are the clock.
    expect(threshold([20, 6], 1)).toBeCloseTo(
      config.block.minimumBlockValue + defaultRace.racingBlockPremium,
      6,
    );
  });

  it('forgives a worse block while we are losing it', () => {
    expect(threshold([4, 40], 9)).toBeCloseTo(
      config.block.minimumBlockValue - defaultRace.losingBlockDiscount,
      6,
    );
  });
});

describe('removal aimed at the creature that threatens the win', () => {
  const bolt = sorcery('Bolt', [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }], { R: 1 }, [
    'R',
  ]);

  function killScore(state: GameState, name: string): number {
    return scoreTargets(
      state,
      0,
      bolt,
      [{ kind: 'permanent', oid: byName(state, name) }],
      config.cast,
      config.target,
      defaultRace,
    );
  }

  it('values the same creature more once it is a larger share of our life', () => {
    const board = (ourLife: number): GameState =>
      scenario({
        active: 1,
        step: 'declareAttackers',
        life: [ourLife, 20],
        battlefield: [{ card: creature('Raider', 3, 3), controller: 1 }],
      }).state;
    // Identical body, identical kill: only what it means to us has changed.
    const low = killScore(board(6), 'Raider');
    const high = killScore(board(20), 'Raider');
    expect(low - high).toBeCloseTo(defaultRace.threatWeight * (3 / 6 - 3 / 20), 6);
  });

  it('prefers the attacker over an identical creature sitting at home', () => {
    const { state } = scenario({
      active: 1,
      step: 'declareAttackers',
      life: [10, 20],
      battlefield: [
        { card: creature('Charging', 3, 3), controller: 1 },
        { card: creature('Idle', 3, 3), controller: 1 },
      ],
    });
    const attacking: GameState = {
      ...state,
      combat: { ...state.combat, attacks: [{ oid: byName(state, 'Charging'), defender: 0 }] },
    };
    expect(killScore(attacking, 'Charging') - killScore(attacking, 'Idle')).toBeCloseTo(
      defaultRace.attackerRemovalBonus,
      6,
    );
  });

  it('pays extra to clear a blocker only while we are the one racing', () => {
    const racing = scenario({
      active: 0,
      step: 'precombatMain',
      life: [20, 5],
      battlefield: [
        { card: creature('Ours', 5, 5), controller: 0 },
        { card: creature('Wall', 0, 3), controller: 1 },
      ],
    }).state;
    const stalled = scenario({
      active: 0,
      step: 'precombatMain',
      life: [20, 40],
      battlefield: [
        { card: creature('Ours', 5, 5), controller: 0 },
        { card: creature('Wall', 0, 3), controller: 1 },
        { card: creature('Titan', 10, 10), controller: 1 },
      ],
    }).state;
    // Same wall, same 0 power, same 20 life on our side: the only difference is
    // whether clearing it is clearing the road or just trading resources.
    expect(assessRace(racing, 0, defaultRace).winning).toBe(true);
    expect(assessRace(stalled, 0, defaultRace).winning).toBe(false);
    expect(killScore(racing, 'Wall') - killScore(stalled, 'Wall')).toBeCloseTo(
      defaultRace.blockerRemovalBonus,
      6,
    );
  });
});

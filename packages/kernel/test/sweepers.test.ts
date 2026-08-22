/**
 * The four sweepers resolving: a scoped `dealDamage`, `destroyPermanent`,
 * `pumpUntilEndOfTurn` and `tapPermanent`.
 *
 * Each is one primitive with two arms, and the arms are not the same shape,
 * because the rule each one has to keep is different:
 *
 *   - damage builds every instance and hands them to `applyDamage` in one call,
 *     because CR 120.3 says the damage is dealt simultaneously and because
 *     lifelink over a group is one life gain rather than one per creature;
 *   - destroying and tapping run the group member by member, so each member
 *     spends its own regeneration shield, emits its own event and fires its own
 *     death trigger;
 *   - the pump is one continuous effect over a list of object ids fixed at
 *     resolution (CR 609.2), on one timestamp, so the whole group expires
 *     together at cleanup.
 *
 * The assertions below are about those three sentences and about the thing they
 * share: the *player* is the target and the creatures are not (CR 115.1), so a
 * sweeper reaches a creature no targeted spell could have named.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import type { Action, GameState, Target } from '@mtg/kernel';
import { characteristicsOf, playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { creature, FOREST, ISLAND, MOUNTAIN, PLAINS, sorcery } from './cards';

function pass(state: GameState): Action {
  const priority = state.turn.priority;
  if (priority === null) throw new Error('nobody has priority');
  return { type: 'passPriority', player: priority };
}

/** Casts the only card in player 0's hand and lets it resolve. */
function castAndResolve(start: GameState, targets: readonly (Target | null)[]): GameState {
  const oid = playerOf(start, 0).hand[0] ?? '';
  const cast = reduce(start, { type: 'castSpell', player: 0, oid, targets });
  return reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
}

function oidNamed(state: GameState, name: string): string {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

function basics(card: Card, count: number, controller: 0 | 1): { card: Card; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card, controller }));
}

const AT_OPPONENT: Target = { kind: 'player', player: 1 };
const SWEEP = 'creaturesThatPlayerControls' as const;

describe('a one-sided wrath', () => {
  /**
   * The whole point of the scope: one spell, one target, every one of that
   * player's creatures gone, and the caster's board untouched.
   */
  it("destroys every creature the targeted player controls and none of the caster's", () => {
    const wrath = sorcery(
      'Calamity Below',
      [{ kind: 'destroyPermanent', scope: SWEEP, target: { kind: 'targetPlayer' } }],
      { generic: 3, W: 1 },
    );
    const start = scenario({
      battlefield: [
        ...basics(PLAINS, 4, 0),
        { card: creature('Mine', 2, 2), controller: 0 },
        { card: creature('Theirs', 2, 2), controller: 1 },
        { card: creature('Theirs Too', 4, 4), controller: 1 },
      ],
      hands: [[wrath], []],
    });
    const mine = oidNamed(start.state, 'Mine');
    const after = castAndResolve(start.state, [AT_OPPONENT]);

    expect(after.battlefield).toContain(mine);
    expect(after.battlefield.filter((oid) => after.objects[oid]?.controller === 1)).toHaveLength(0);
    expect(playerOf(after, 1).graveyard).toHaveLength(2);
  });

  /**
   * Each member dies its own death, which is what running the group through the
   * per-member destroy buys over a single bulk state edit. the flagship set's
   * economy is built on death triggers, so a sweeper that skipped them would
   * quietly be the strongest card in the set.
   */
  it('fires each dying creature its own death trigger', () => {
    const dropper = (name: string) =>
      creature(name, 1, 1, {
        abilities: [
          {
            kind: 'triggered',
            condition: 'selfDies',
            effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
          },
        ],
      });
    const wrath = sorcery(
      'Calamity Below',
      [{ kind: 'destroyPermanent', scope: SWEEP, target: { kind: 'targetPlayer' } }],
      { generic: 3, W: 1 },
    );
    const start = scenario({
      battlefield: [
        ...basics(PLAINS, 4, 0),
        { card: dropper('First Fallen'), controller: 1 },
        { card: dropper('Second Fallen'), controller: 1 },
      ],
      hands: [[wrath], []],
      libraries: [[], [PLAINS, PLAINS, PLAINS]],
    });
    const before = playerOf(start.state, 1).hand.length;
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: playerOf(start.state, 0).hand[0] ?? '',
      targets: [AT_OPPONENT],
    });
    const settled = reduceAll(cast.state, [pass(cast.state), { type: 'passPriority', player: 1 }]).state;
    const after = reduceAll(settled, [
      { type: 'passPriority', player: settled.turn.priority ?? 0 },
      { type: 'passPriority', player: settled.turn.priority === 0 ? 1 : 0 },
      { type: 'passPriority', player: 0 },
      { type: 'passPriority', player: 1 },
    ]).state;

    expect(playerOf(after, 1).hand.length).toBe(before + 2);
  });
});

describe('a scoped burn spell', () => {
  /**
   * Damage is marked, not dealt as destruction, so the toughness question is
   * asked once by state-based actions afterwards. Two damage kills the 2/2 and
   * leaves the 4/4 standing with two marked on it.
   */
  it('marks its amount on each member and lets state-based actions sort them out', () => {
    const rain = sorcery(
      'Ember Rain',
      [{ kind: 'dealDamage', amount: 2, scope: SWEEP, target: { kind: 'targetOpponent' } }],
      { generic: 2, R: 1 },
    );
    const start = scenario({
      battlefield: [
        ...basics(MOUNTAIN, 3, 0),
        { card: creature('Kindling', 2, 2), controller: 1 },
        { card: creature('Bulwark', 4, 4), controller: 1 },
      ],
      hands: [[rain], []],
    });
    const bulwark = oidNamed(start.state, 'Bulwark');
    const after = castAndResolve(start.state, [AT_OPPONENT]);

    expect(after.battlefield).toContain(bulwark);
    expect(after.objects[bulwark]?.damage).toBe(2);
    expect(playerOf(after, 1).graveyard).toHaveLength(1);
  });

  /**
   * The targeted player takes none of it. A scope reading
   * `creaturesThatPlayerControls` names the creatures and stops, and the player
   * is only the handle it reads them off — which is exactly the distinction the
   * Forge line preserves by leaving `ValidPlayers$` off the sweep.
   */
  it('leaves the targeted player at the life total they started with', () => {
    const rain = sorcery(
      'Ember Rain',
      [{ kind: 'dealDamage', amount: 2, scope: SWEEP, target: { kind: 'targetOpponent' } }],
      { generic: 2, R: 1 },
    );
    const start = scenario({
      battlefield: [...basics(MOUNTAIN, 3, 0), { card: creature('Kindling', 2, 2), controller: 1 }],
      hands: [[rain], []],
    });
    const before = playerOf(start.state, 1).life;
    const after = castAndResolve(start.state, [AT_OPPONENT]);

    expect(playerOf(after, 1).life).toBe(before);
  });

  /**
   * A sweep with nothing to sweep is a legal resolution, not a crash and not a
   * fizzle: the target is the player and the player is still there, so the
   * spell resolves and does nothing.
   */
  it('resolves into no damage at all when the player controls no creatures', () => {
    const rain = sorcery(
      'Ember Rain',
      [{ kind: 'dealDamage', amount: 2, scope: SWEEP, target: { kind: 'targetOpponent' } }],
      { generic: 2, R: 1 },
    );
    const start = scenario({ battlefield: [...basics(MOUNTAIN, 3, 0)], hands: [[rain], []] });
    const after = castAndResolve(start.state, [AT_OPPONENT]);

    expect(after.stack).toHaveLength(0);
    expect(playerOf(after, 1).life).toBe(playerOf(start.state, 1).life);
  });
});

describe('a scoped pump', () => {
  /**
   * One continuous effect for the whole group rather than one per member. The
   * group is fixed when the spell resolves (CR 609.2), so a creature that
   * arrives afterwards is not in it, and the single id is what lets the whole
   * group expire on one `continuousEffectsExpired`.
   */
  it('registers one continuous effect over the group it read at resolution', () => {
    const rally = sorcery(
      'Rally the Vale',
      [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 2,
          toughness: 2,
          scope: SWEEP,
          target: { kind: 'targetPlayer' },
        },
      ],
      { generic: 1, G: 1 },
    );
    const start = scenario({
      battlefield: [
        ...basics(FOREST, 2, 0),
        { card: creature('First', 1, 1), controller: 0 },
        { card: creature('Second', 3, 3), controller: 0 },
        { card: creature('Untouched', 1, 1), controller: 1 },
      ],
      hands: [[rally], []],
    });
    const after = castAndResolve(start.state, [{ kind: 'player', player: 0 }]);

    expect(after.continuous).toHaveLength(1);
    expect(characteristicsOf(after, oidNamed(after, 'First')).power).toBe(3);
    expect(characteristicsOf(after, oidNamed(after, 'Second')).toughness).toBe(5);
    expect(characteristicsOf(after, oidNamed(after, 'Untouched')).power).toBe(1);
  });

  /** A pump with no members registers nothing, rather than an effect over none. */
  it('registers nothing when the group is empty', () => {
    const rally = sorcery(
      'Rally the Vale',
      [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 2,
          toughness: 2,
          scope: SWEEP,
          target: { kind: 'targetPlayer' },
        },
      ],
      { generic: 1, G: 1 },
    );
    const start = scenario({ battlefield: [...basics(FOREST, 2, 0)], hands: [[rally], []] });
    const after = castAndResolve(start.state, [{ kind: 'player', player: 0 }]);

    expect(after.continuous).toHaveLength(0);
  });
});

describe('a scoped tap', () => {
  /**
   * Tapping is a status a permanent has (CR 110.5), and the sweep sets it on
   * each member and on nobody else's board.
   */
  it('taps every creature the targeted player controls', () => {
    const tide = sorcery(
      'Slack Tide',
      [{ kind: 'tapPermanent', scope: SWEEP, target: { kind: 'targetOpponent' } }],
      { generic: 2, U: 1 },
    );
    const start = scenario({
      battlefield: [
        ...basics(ISLAND, 3, 0),
        { card: creature('Mine', 2, 2), controller: 0 },
        { card: creature('Theirs', 2, 2), controller: 1 },
        { card: creature('Theirs Too', 1, 1), controller: 1 },
      ],
      hands: [[tide], []],
    });
    const after = castAndResolve(start.state, [AT_OPPONENT]);

    expect(after.objects[oidNamed(after, 'Theirs')]?.tapped).toBe(true);
    expect(after.objects[oidNamed(after, 'Theirs Too')]?.tapped).toBe(true);
    expect(after.objects[oidNamed(after, 'Mine')]?.tapped).toBe(false);
  });

  /** An already-tapped member is left tapped rather than double-counted. */
  it('leaves an already-tapped creature tapped', () => {
    const tide = sorcery(
      'Slack Tide',
      [{ kind: 'tapPermanent', scope: SWEEP, target: { kind: 'targetOpponent' } }],
      { generic: 2, U: 1 },
    );
    const start = scenario({
      battlefield: [
        ...basics(ISLAND, 3, 0),
        { card: creature('Already', 2, 2), controller: 1, tapped: true },
        { card: creature('Not Yet', 2, 2), controller: 1 },
      ],
      hands: [[tide], []],
    });
    const after = castAndResolve(start.state, [AT_OPPONENT]);

    expect(after.objects[oidNamed(after, 'Already')]?.tapped).toBe(true);
    expect(after.objects[oidNamed(after, 'Not Yet')]?.tapped).toBe(true);
  });
});

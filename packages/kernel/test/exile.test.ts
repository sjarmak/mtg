/**
 * CR 701.20, exile, in the kernel.
 *
 * `exileTarget` is `destroyPermanent`'s arm with one word changed, so the tests
 * worth writing are the ones about what that word costs and what it does not.
 * Three of the four below are about consequences nobody wrote code for: no
 * death trigger, an exiled token that stays put, and the continuous effect a
 * leaving permanent drops. All three are `moveObject`'s doing, and all three
 * would be silent if they broke — a death trigger that fired anyway is a set
 * whose central mechanic has no answer, and that is the reason this primitive
 * exists.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState, Target } from '@mtg/kernel';
import { playerOf, reduce, reduceAll, scenario } from '@mtg/kernel';
import { creature, PLAINS, sorcery } from './cards';

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

function plains(count: number, controller: 0 | 1): { card: typeof PLAINS; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: PLAINS, controller }));
}

function banish(): ReturnType<typeof sorcery> {
  return sorcery('Banish to the Void', [{ kind: 'exileTarget', target: { kind: 'targetCreature' } }], {
    generic: 2,
    W: 1,
  });
}

describe('exile', () => {
  it('puts the creature in exile rather than in a graveyard', () => {
    const bear = creature('Void Bear', 2, 2, { cost: { generic: 1, G: 1 } });
    const start = scenario({
      battlefield: [...plains(3, 0), { card: bear, controller: 1 }],
      hands: [[banish()], []],
    });
    const victim = oidNamed(start.state, 'Void Bear');
    const after = castAndResolve(start.state, [{ kind: 'permanent', oid: victim }]);

    expect(after.exile).toContain(victim);
    expect(after.objects[victim]?.zone).toBe('exile');
    expect(after.battlefield).not.toContain(victim);
    expect(playerOf(after, 1).graveyard).not.toContain(victim);
  });

  /**
   * The reason the primitive exists. `selfDies` is derived from a
   * battlefield-to-graveyard move and from nothing else (`triggers.ts`), so a
   * creature exiled instead of destroyed never dies and its drop never happens.
   * the flagship set's economy is built on that trigger, which makes this the
   * one removal spell that does not pay the opponent on the way past.
   */
  it('does not fire a death trigger, because nothing died', () => {
    const dropper = creature('Void Hollow', 2, 2, {
      cost: { generic: 1, B: 1 },
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDies',
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const start = scenario({
      battlefield: [...plains(3, 0), { card: dropper, controller: 1 }],
      hands: [[banish()], []],
    });
    const victim = oidNamed(start.state, 'Void Hollow');
    const before = playerOf(start.state, 1).hand.length;
    const after = castAndResolve(start.state, [{ kind: 'permanent', oid: victim }]);

    expect(after.objects[victim]?.zone).toBe('exile');
    expect(after.stack).toHaveLength(0);
    expect(playerOf(after, 1).hand).toHaveLength(before);
  });

  /**
   * CR 111.7 / 704.5d. A token that leaves the battlefield ceases to exist, and
   * the state-based action that ends it skips exile deliberately (`sba.ts`):
   * a token there has nowhere further to go, and sweeping it again is a pass
   * that reports a change and moves nothing, which is how that loop misses its
   * fixed point and throws. So an exiled token stays an object in exile.
   */
  it('leaves an exiled token sitting in exile rather than sweeping it again', () => {
    const spirit = creature('Void Spirit', 1, 1);
    const start = scenario({
      battlefield: [...plains(3, 0), { card: spirit, controller: 1, token: true }],
      hands: [[banish()], []],
    });
    const victim = oidNamed(start.state, 'Void Spirit');
    const after = castAndResolve(start.state, [{ kind: 'permanent', oid: victim }]);

    expect(after.objects[victim]?.zone).toBe('exile');
    expect(after.exile).toContain(victim);
  });

  /**
   * CR 604.3: a printed static exists exactly while its source is on the
   * battlefield, and `moveObject` drops the effect on every zone change rather
   * than on a destruction. The anthem's beneficiary shrinking is what proves
   * the exile went through the same choke point.
   */
  it('ends the static ability the exiled permanent had registered', () => {
    const lord = creature('Void Warden', 2, 2, {
      cost: { generic: 2, W: 1 },
      abilities: [
        {
          kind: 'static',
          scope: 'otherCreaturesYouControl',
          subtype: null,
          modification: { kind: 'statBonus', power: 2, toughness: 2 },
        },
      ],
    });
    const bear = creature('Void Cub', 1, 1);
    const start = scenario({
      battlefield: [...plains(3, 0), { card: lord, controller: 1 }, { card: bear, controller: 1 }],
      hands: [[banish()], []],
    });
    const warden = oidNamed(start.state, 'Void Warden');
    const cub = oidNamed(start.state, 'Void Cub');
    expect(start.state.continuous).toHaveLength(1);

    const after = castAndResolve(start.state, [{ kind: 'permanent', oid: warden }]);
    expect(after.objects[warden]?.zone).toBe('exile');
    expect(after.continuous).toHaveLength(0);
    expect(after.objects[cub]?.card.power).toBe(1);
  });
});

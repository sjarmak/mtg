/**
 * Resolution coverage for the effect primitives that no other kernel test
 * exercises end to end.
 *
 * `dealDamage`, `pumpUntilEndOfTurn`, `drawCards`, `gainLife` and
 * `counterSpell` are covered by the priority/stack, SBA and layers suites. The
 * remaining five reach the battlefield only through `@mtg/sim`'s generated
 * games, where a silent no-op would look like an ordinary quiet turn. Each
 * test below casts the spell for real and asserts the zone or flag it is
 * supposed to change.
 */
import { describe, expect, it } from 'vitest';
import type { Action, GameState, Target } from '@mtg/kernel';
import { legalActions, playerOf, reduce, reduceAll, scenario, validateAction } from '@mtg/kernel';
import { creature, instant, ISLAND, MOUNTAIN, sorcery } from './cards';

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

function lands(count: number, controller: 0 | 1): { card: typeof MOUNTAIN; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller }));
}

function islands(count: number, controller: 0 | 1): { card: typeof ISLAND; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: ISLAND, controller }));
}

describe('effect resolution', () => {
  it('destroyPermanent moves the targeted creature to the graveyard', () => {
    const bear = creature('Resolution Bear', 2, 2, { cost: { generic: 1, G: 1 } });
    const kill = sorcery(
      'Resolution Kill',
      [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
      {
        generic: 1,
        R: 1,
      },
    );
    const start = scenario({
      battlefield: [...lands(2, 0), { card: bear, controller: 1 }],
      hands: [[kill], []],
    });
    const victim = oidNamed(start.state, 'Resolution Bear');
    const after = castAndResolve(start.state, [{ kind: 'permanent', oid: victim }]);

    expect(after.battlefield).not.toContain(victim);
    expect(after.objects[victim]?.zone).toBe('graveyard');
  });

  it('tapPermanent taps the targeted creature', () => {
    const bear = creature('Tapped Bear', 2, 2, { cost: { generic: 1, G: 1 } });
    const tapper = instant('Resolution Tap', [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }], {
      generic: 1,
      U: 1,
    });
    const start = scenario({
      battlefield: [...islands(2, 0), { card: bear, controller: 1 }],
      hands: [[tapper], []],
    });
    const victim = oidNamed(start.state, 'Tapped Bear');
    expect(start.state.objects[victim]?.tapped).toBe(false);

    const after = castAndResolve(start.state, [{ kind: 'permanent', oid: victim }]);
    expect(after.objects[victim]?.tapped).toBe(true);
  });

  it('createToken puts one body per count on the battlefield, keywords included', () => {
    const make = sorcery(
      'Resolution Tokens',
      [
        {
          kind: 'createToken',
          count: 2,
          token: {
            name: 'Resolution Bird',
            power: 1,
            toughness: 1,
            colors: ['R'],
            subtypes: ['Bird'],
            keywords: ['flying'],
          },
        },
      ],
      { generic: 1, R: 1 },
    );
    const start = scenario({ battlefield: lands(2, 0), hands: [[make], []] });
    const before = start.state.battlefield.length;

    const after = castAndResolve(start.state, [null]);
    const tokens = after.battlefield.filter((oid) => after.objects[oid]?.card.name === 'Resolution Bird');
    expect(after.battlefield.length).toBe(before + 2);
    expect(tokens).toHaveLength(2);
    expect(after.objects[tokens[0] ?? '']?.card.keywords).toContain('flying');
    expect(after.objects[tokens[0] ?? '']?.token).toBe(true);
  });

  it('millCards moves exactly count cards from library to graveyard', () => {
    const mill = sorcery(
      'Resolution Mill',
      [{ kind: 'millCards', count: 3, target: { kind: 'targetPlayer' } }],
      { generic: 1, U: 1 },
    );
    const start = scenario({ battlefield: islands(2, 0), hands: [[mill], []] });
    const libraryBefore = playerOf(start.state, 1).library.length;
    const graveBefore = playerOf(start.state, 1).graveyard.length;

    const after = castAndResolve(start.state, [{ kind: 'player', player: 1 }]);
    expect(playerOf(after, 1).library.length).toBe(libraryBefore - 3);
    expect(playerOf(after, 1).graveyard.length).toBe(graveBefore + 3);
  });

  it('a distinct second slot never reuses the first slot target, and kills two creatures', () => {
    const bears = ['Twin Verdict Bear', 'Twin Verdict Boar', 'Twin Verdict Bull'].map((name) =>
      creature(name, 2, 2, { cost: { generic: 1, G: 1 } }),
    );
    const twinVerdict = sorcery(
      'Twin Verdict',
      [
        { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
        { kind: 'destroyPermanent', target: { kind: 'targetCreature', distinct: true } },
      ],
      { generic: 2, R: 1 },
    );
    const start = scenario({
      battlefield: [...lands(3, 0), ...bears.map((card) => ({ card, controller: 1 as const }))],
      hands: [[twinVerdict], []],
    });

    // Three creatures, two slots: nine ordered pairs, of which the three that
    // aim both slots at the same body are not choices the card offers. The nine
    // is what the enumeration is asked for, because `DEFAULT_ENUMERATION_CAP` is
    // one global constant over every enumeration in the kernel and the width
    // this fixture needs is a fact about three creatures in two slots — the cap
    // bounds the target product before the distinct rule thins it.
    const casts = legalActions(start.state, bears.length ** 2).filter(
      (action) => action.type === 'castSpell',
    );
    expect(casts).toHaveLength(bears.length * (bears.length - 1));
    for (const cast of casts) {
      expect(cast.targets[0]).not.toStrictEqual(cast.targets[1]);
    }

    const first = oidNamed(start.state, 'Twin Verdict Bear');
    const second = oidNamed(start.state, 'Twin Verdict Boar');
    const oid = playerOf(start.state, 0).hand[0] ?? '';
    const doubled: Action = {
      type: 'castSpell',
      player: 0,
      oid,
      targets: [
        { kind: 'permanent', oid: first },
        { kind: 'permanent', oid: first },
      ],
    };
    // An agent that builds its own declaration is checked just as hard as the
    // enumerated list; enumeration alone would leave the constraint bypassable.
    expect(validateAction(start.state, doubled)).toBe('illegal target for effect 1');

    const after = castAndResolve(start.state, [
      { kind: 'permanent', oid: first },
      { kind: 'permanent', oid: second },
    ]);
    expect(after.objects[first]?.zone).toBe('graveyard');
    expect(after.objects[second]?.zone).toBe('graveyard');
    expect(after.battlefield.filter((id) => after.objects[id]?.card.kind === 'creature')).toHaveLength(1);
  });

  it('returnToHand returns the targeted creature to its owner hand', () => {
    const bear = creature('Bounced Bear', 2, 2, { cost: { generic: 1, G: 1 } });
    const bounce = instant(
      'Resolution Bounce',
      [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }],
      {
        generic: 1,
        U: 1,
      },
    );
    const start = scenario({
      battlefield: [...islands(2, 0), { card: bear, controller: 1 }],
      hands: [[bounce], []],
    });
    const victim = oidNamed(start.state, 'Bounced Bear');
    const handBefore = playerOf(start.state, 1).hand.length;

    const after = castAndResolve(start.state, [{ kind: 'permanent', oid: victim }]);
    expect(after.battlefield).not.toContain(victim);
    expect(playerOf(after, 1).hand.length).toBe(handBefore + 1);
    expect(after.objects[victim]?.zone).toBe('hand');
  });
});

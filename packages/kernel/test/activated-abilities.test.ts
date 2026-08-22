/**
 * CR 602 activated abilities, driven through the reducer.
 *
 * The assertions read the enumeration, the stack and the event log rather than
 * the effect's outcome, because "the opponent lost a life" is also what a spell
 * does. What is being proved is which machinery answered: the kernel offered
 * the activation as a legal option, took payment for it in mana and in the tap
 * symbol, put an object with an `ab` id on the stack, and resolved that object
 * against targets it rechecked.
 *
 * An activation emits `abilityActivated`, and it has to. The events the kernel
 * already had describe the payment and the resolution — the mana left the pool
 * (`manaPaid`), the source turned sideways (`permanentTapped`), an object whose
 * id is not a card's began resolving (`resolutionBegan` on `ab<n>`) — but none
 * of them says "a player activated something", and the replay-superset log has
 * a column that counts exactly that (`packages/sim/src/log/collect.ts`). A
 * column counted off no event reports zero forever, which is how it came to be
 * documented as structurally zero while the bots were paying for abilities
 * every game.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card } from '@mtg/dsl';
import type { Action, GameState, ObjectId, ReduceResult, StackEntry } from '@mtg/kernel';
import {
  eventsOfType,
  isCreatureObject,
  legalActions,
  pendingDecision,
  reduce,
  scenario,
  simpleAgent,
  validateAction,
} from '@mtg/kernel';
import { artifact, creature, instant, MOUNTAIN } from './cards';
import { apply, oidOf } from './helpers';

/** `{1}, {T}: CARDNAME deals 1 damage to any target.` */
const PING: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: true },
  effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
};

/** `{1}: Target creature gets +1/+1 until end of turn.` No tap: repeatable. */
const PUMP: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: false },
  effects: [{ kind: 'pumpUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'targetCreature' } }],
};

/** `{T}: You gain 1 life.` Free but not repeatable, and it needs no target. */
const TAP_FOR_LIFE: AbilityInput = {
  kind: 'activated',
  cost: { mana: {}, tapSelf: true },
  effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
};

/**
 * `{1}: Tap target creature. Tap another target creature.`
 *
 * The only ability in this checkout whose second slot carries
 * `target.distinct`, and it exists because that flag is what the acceptance
 * criterion rests on: the enumeration must never offer an action the kernel
 * would reject, and the two halves of that promise (the filter in
 * `activationOptions`, the check in `validateActivation`) were each deletable
 * with the whole suite still green. Tapping is chosen over damage so the board
 * does not change size mid-assertion.
 */
const DOUBLE_TAP: AbilityInput = {
  kind: 'activated',
  cost: { mana: { generic: 1 }, tapSelf: false },
  effects: [
    { kind: 'tapPermanent', target: { kind: 'targetCreature' } },
    { kind: 'tapPermanent', target: { kind: 'targetCreature', distinct: true } },
  ],
};

function beacon(): Card {
  return artifact('Ashen Beacon', { generic: 2 }, [PING]);
}

function binder(): Card {
  return artifact('Twinned Binding', { generic: 2 }, [DOUBLE_TAP]);
}

function lands(count: number, controller: 0 | 1): { card: Card; controller: 0 | 1 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller }));
}

function activations(state: GameState): readonly Extract<Action, { type: 'activateAbility' }>[] {
  const found: Extract<Action, { type: 'activateAbility' }>[] = [];
  for (const option of legalActions(state)) {
    if (option.type === 'activateAbility') found.push(option);
  }
  return found;
}

function abilitiesOnStack(state: GameState): readonly StackEntry[] {
  return state.stack.filter((entry) => entry.ability !== null);
}

function untappedLands(state: GameState, player: 0 | 1): number {
  return state.battlefield.filter((oid) => {
    const object = state.objects[oid];
    return (
      object !== undefined && object.controller === player && object.card.kind === 'land' && !object.tapped
    );
  }).length;
}

/** Passes priority back and forth until the stack is empty again. */
function letItResolve(start: ReduceResult, limit = 8): ReduceResult {
  let current = start;
  for (let guard = 0; guard < limit; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision === null || decision.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the stack did not empty');
}

describe('enumeration', () => {
  it('offers one option per legal target, carrying the ability index', () => {
    const start = scenario({
      battlefield: [
        { card: beacon(), controller: 0 },
        { card: creature('Brigand', 1, 1), controller: 1 },
        ...lands(2, 0),
      ],
    });
    const options = activations(start.state);
    // Two players plus the one creature on the battlefield: `anyTarget`.
    expect(options).toHaveLength(3);
    expect(new Set(options.map((option) => option.abilityIndex))).toEqual(new Set([0]));
    expect(options.map((option) => option.oid)).toEqual(
      Array.from({ length: 3 }, () => oidOf(start.state, 'Ashen Beacon')),
    );
    expect(options.some((option) => option.targets[0]?.kind === 'player')).toBe(true);
    expect(options.some((option) => option.targets[0]?.kind === 'permanent')).toBe(true);
  });

  it('offers nothing when the mana cost cannot be paid', () => {
    const start = scenario({ battlefield: [{ card: beacon(), controller: 0 }] });
    expect(activations(start.state)).toEqual([]);
  });

  it('offers nothing for a source somebody else controls', () => {
    const start = scenario({
      battlefield: [{ card: beacon(), controller: 1 }, ...lands(2, 0)],
    });
    expect(activations(start.state)).toEqual([]);
    const beaconOid = oidOf(start.state, 'Ashen Beacon');
    expect(
      validateAction(start.state, {
        type: 'activateAbility',
        player: 0,
        oid: beaconOid,
        abilityIndex: 0,
        targets: [{ kind: 'player', player: 1 }],
        sacrifices: [],
      }),
    ).toBe('you do not control that source');
  });

  it('offers nothing for a source that is already tapped', () => {
    const start = scenario({
      battlefield: [{ card: beacon(), controller: 0, tapped: true }, ...lands(2, 0)],
    });
    expect(activations(start.state)).toEqual([]);
  });

  /**
   * CR 302.6, and the reason `isCreatureObject` is asked rather than
   * `card.kind`: the rule is about what the permanent *is* right now, so an
   * animated artifact would be sick and a creature that lost its type would
   * not. The artifact beside it is the control: the same ability, the same
   * turn, and it activates, so what stops the creature is the rule and not the
   * board.
   */
  it('refuses a tap cost on a creature that has not been controlled since the turn began', () => {
    const start = scenario({
      battlefield: [
        { card: creature('Emberkin Smith', 2, 2, { abilities: [PING] }), controller: 0, summoningSick: true },
        { card: beacon(), controller: 0 },
        ...lands(4, 0),
      ],
    });
    const smith = oidOf(start.state, 'Emberkin Smith');
    expect(activations(start.state).map((option) => option.oid)).not.toContain(smith);
    expect(activations(start.state).length).toBeGreaterThan(0);
    expect(
      validateAction(start.state, {
        type: 'activateAbility',
        player: 0,
        oid: smith,
        abilityIndex: 0,
        targets: [{ kind: 'player', player: 1 }],
        sacrifices: [],
      }),
    ).toBe('that creature has not been under your control since your turn began');
  });

  /**
   * CR 702.10c. Haste does not clear summoning sickness — the flag stays set
   * and the keyword waives what the flag forbids, which is why this is asked
   * where the cost is checked rather than where the flag is written. The
   * assertion is deliberately the pair: the enumeration offers it *and*
   * `validateAction` accepts it, because a rule enforced in one of those two
   * and not the other is how a bot and a player come to disagree about a legal
   * play. Its twin for attacking is `eligibleAttackers` (CR 702.10b), which had
   * the check from the start; this half did not, so a hasted creature could
   * swing and could not tap.
   */
  it('CR 702.10c: haste pays a tap cost the turn the creature arrives', () => {
    const start = scenario({
      battlefield: [
        {
          card: creature('Hasty Smith', 2, 2, { abilities: [PING], keywords: ['haste'] }),
          controller: 0,
          summoningSick: true,
        },
        ...lands(4, 0),
      ],
    });
    const smith = oidOf(start.state, 'Hasty Smith');
    expect(activations(start.state).map((option) => option.oid)).toContain(smith);
    expect(
      validateAction(start.state, {
        type: 'activateAbility',
        player: 0,
        oid: smith,
        abilityIndex: 0,
        targets: [{ kind: 'player', player: 1 }],
        sacrifices: [],
      }),
    ).toBe(null);
  });

  it('offers it on a creature that has been controlled since the turn began', () => {
    const start = scenario({
      battlefield: [
        { card: creature('Emberkin Smith', 2, 2, { abilities: [PING] }), controller: 0 },
        ...lands(2, 0),
      ],
    });
    const smith = oidOf(start.state, 'Emberkin Smith');
    expect(activations(start.state).map((option) => option.oid)).toContain(smith);
  });

  it('offers nothing for a static or a triggered ability', () => {
    const trigger: AbilityInput = {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    };
    const start = scenario({
      battlefield: [
        { card: artifact('Ashen Slate', { generic: 2 }, [trigger]), controller: 0 },
        ...lands(2, 0),
      ],
    });
    expect(activations(start.state)).toEqual([]);
  });

  it('offers nothing when a target slot has no legal choice at all', () => {
    // `activationOptions` carries no early-out for an empty slot, and this is
    // the position that says it does not need one: the board holds no creature,
    // so both of the binder's slots are empty and `cartesian` yields no tuple
    // rather than one tuple of nulls. An early-out here would only restate the
    // next line, and a guard no position can reach is a guard nobody can check.
    const start = scenario({ battlefield: [{ card: binder(), controller: 0 }, ...lands(2, 0)] });
    expect(start.state.battlefield.some((oid) => isCreatureObject(start.state, oid))).toBe(false);
    expect(activations(start.state)).toEqual([]);
    // And the cost was payable, so the empty slot is the only reason.
    expect(
      pendingDecision(start.state)?.options.some((option) => option.type === 'activateManaAbility'),
    ).toBe(true);
  });

  /**
   * The acceptance criterion in one assertion: every activation the kernel
   * offers is one it will also accept, and one it can actually reduce. The
   * guard is `validateAction`, which re-derives legality from state rather than
   * from the list it just produced.
   */
  it('reports truncation when the activations alone overrun the cap', () => {
    // `complete` is `casts.complete && activations.complete`, and the second
    // half survived deletion: every position with a truncating activation also
    // had a truncating cast. This one has an empty hand, so only the
    // activations can overrun, and a surface that showed 2 of 4 targets while
    // claiming the list was whole would be lying about the game.
    const start = scenario({
      battlefield: [
        { card: beacon(), controller: 0 },
        { card: creature('Brigand', 1, 1), controller: 1 },
        { card: creature('Marauder', 2, 2), controller: 1 },
        ...lands(2, 0),
      ],
    });
    expect(start.state.players[0].hand).toEqual([]);
    const capped = pendingDecision(start.state, 2);
    expect(capped?.complete).toBe(false);
    expect(pendingDecision(start.state, 512)?.complete).toBe(true);
  });

  it('offers only actions it validates and can reduce', () => {
    const start = scenario({
      battlefield: [
        { card: beacon(), controller: 0 },
        { card: creature('Brigand', 1, 1), controller: 1 },
        { card: creature('Sylvanok', 1, 1), controller: 0 },
        ...lands(3, 0),
      ],
    });
    const options = activations(start.state);
    expect(options.length).toBeGreaterThan(3);
    for (const option of options) {
      expect(validateAction(start.state, option), JSON.stringify(option.targets)).toBeNull();
      expect(() => reduce(start.state, option)).not.toThrow();
    }
  });
});

describe('paying for it', () => {
  it('taps a land for the mana and the source for the tap symbol', () => {
    const start = scenario({
      battlefield: [{ card: beacon(), controller: 0 }, ...lands(2, 0)],
    });
    const beaconOid = oidOf(start.state, 'Ashen Beacon');
    expect(untappedLands(start.state, 0)).toBe(2);

    const after = apply(start, {
      type: 'activateAbility',
      player: 0,
      oid: beaconOid,
      abilityIndex: 0,
      targets: [{ kind: 'player', player: 1 }],
      sacrifices: [],
    });

    expect(untappedLands(after.state, 0)).toBe(1);
    expect(after.state.objects[beaconOid]?.tapped).toBe(true);
    expect(eventsOfType(after.events, 'manaPaid')).toHaveLength(1);
    expect(eventsOfType(after.events, 'manaPaid')[0]?.cost.generic).toBe(1);
    // Nothing has happened yet: the ability is on the stack, not resolved.
    expect(after.state.players[1].life).toBe(20);
  });

  it('puts an object on the stack whose id is not a card, and keeps priority', () => {
    const start = scenario({
      battlefield: [{ card: beacon(), controller: 0 }, ...lands(2, 0)],
    });
    const beaconOid = oidOf(start.state, 'Ashen Beacon');
    const after = apply(start, {
      type: 'activateAbility',
      player: 0,
      oid: beaconOid,
      abilityIndex: 0,
      targets: [{ kind: 'player', player: 1 }],
      sacrifices: [],
    });

    const entries = abilitiesOnStack(after.state);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.oid.startsWith('ab')).toBe(true);
    expect(after.state.objects[entry?.oid ?? '']).toBeUndefined();
    expect(entry?.ability).toEqual({ sourceOid: beaconOid, index: 0 });
    expect(entry?.controller).toBe(0);
    expect(entry?.targets).toEqual([{ kind: 'player', player: 1 }]);
    expect(after.state.turn.priority).toBe(0);

    // One event per activation, naming both ids: the stack object it minted and
    // the permanent it was printed on. `@mtg/sim` counts these into 17lands'
    // `abilities` column, so an activation that emitted nothing would be an
    // activation the replay-superset log reports as never having happened.
    const activated = eventsOfType(after.events, 'abilityActivated');
    expect(activated).toHaveLength(1);
    expect(activated[0]?.oid).toBe(entry?.oid);
    expect(activated[0]?.source).toBe(beaconOid);
    expect(activated[0]?.player).toBe(0);
    expect(activated[0]?.index).toBe(0);
    expect(activated[0]?.targets).toEqual([{ kind: 'player', player: 1 }]);
  });

  it('emits no activation event for a mana ability, which uses no stack', () => {
    // CR 605.1, and the line 17lands draws in the same place: tapping a land is
    // not an activation anybody counts, and `abilityActivated` is what the sim
    // log counts.
    const start = scenario({ battlefield: lands(1, 0) });
    const after = apply(start, {
      type: 'activateManaAbility',
      player: 0,
      oid: oidOf(start.state, 'Mountain'),
      color: 'R',
    });
    expect(eventsOfType(after.events, 'abilityActivated')).toEqual([]);
    expect(eventsOfType(after.events, 'manaProduced')).toHaveLength(1);
  });

  it('resolves into the effect the printed ability names', () => {
    const start = scenario({
      battlefield: [{ card: beacon(), controller: 0 }, ...lands(2, 0)],
    });
    const beaconOid = oidOf(start.state, 'Ashen Beacon');
    const activated = apply(start, {
      type: 'activateAbility',
      player: 0,
      oid: beaconOid,
      abilityIndex: 0,
      targets: [{ kind: 'player', player: 1 }],
      sacrifices: [],
    });
    const resolved = letItResolve(activated);

    expect(resolved.state.stack).toEqual([]);
    expect(resolved.state.players[1].life).toBe(19);
    const damage = eventsOfType(resolved.events, 'damageDealt');
    expect(damage).toHaveLength(1);
    expect(damage[0]?.sourceOid).toBe(beaconOid);
    expect(damage[0]?.combat).toBe(false);
    const began = eventsOfType(resolved.events, 'resolutionBegan').filter((event) =>
      event.oid.startsWith('ab'),
    );
    expect(began).toHaveLength(1);
  });

  /**
   * A mana-only cost is repeatable, which is what firebreathing is, and the
   * kernel stops offering it exactly when the mana runs out rather than by
   * counting activations.
   */
  it('offers a mana-only ability again until the mana is gone', () => {
    const start = scenario({
      battlefield: [
        { card: creature('Draveth', 2, 2, { abilities: [PUMP] }), controller: 0 },
        ...lands(2, 0),
      ],
    });
    const draveth = oidOf(start.state, 'Draveth');
    const target = { kind: 'permanent' as const, oid: draveth };
    const once = apply(start, {
      type: 'activateAbility',
      player: 0,
      oid: draveth,
      abilityIndex: 0,
      targets: [target],
      sacrifices: [],
    });
    expect(once.state.objects[draveth]?.tapped).toBe(false);
    expect(activations(once.state)).toHaveLength(1);

    const twice = apply(once, {
      type: 'activateAbility',
      player: 0,
      oid: draveth,
      abilityIndex: 0,
      targets: [target],
      sacrifices: [],
    });
    expect(untappedLands(twice.state, 0)).toBe(0);
    expect(activations(twice.state)).toEqual([]);
    expect(abilitiesOnStack(twice.state)).toHaveLength(2);
  });

  it('takes a free tap cost with no mana at all', () => {
    const start = scenario({
      battlefield: [{ card: artifact('Sunlit Fountain', { generic: 2 }, [TAP_FOR_LIFE]), controller: 0 }],
    });
    const fountain = oidOf(start.state, 'Sunlit Fountain');
    const options = activations(start.state);
    expect(options).toHaveLength(1);
    expect(options[0]?.targets).toEqual([null]);
    const resolved = letItResolve(apply(start, options[0] as Action));
    expect(resolved.state.players[0].life).toBe(21);
    expect(resolved.state.objects[fountain]?.tapped).toBe(true);
  });
});

describe('responding to it', () => {
  /**
   * CR 608.2: the ability resolves even though the permanent that made it is
   * gone. This is the property that makes an ability an object rather than a
   * message from its source, and it is what Fuse will need — the part
   * sacrifices itself to pay, and the counter still lands.
   */
  it('resolves after its source has left the battlefield', () => {
    const bolt = instant('Bomb Arrow', [
      { kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } },
    ]);
    const start = scenario({
      battlefield: [
        { card: creature('Emberkin Smith', 2, 2, { abilities: [PING] }), controller: 0 },
        ...lands(2, 0),
        ...lands(2, 1),
      ],
      hands: [[], [bolt]],
    });
    const smith = oidOf(start.state, 'Emberkin Smith');
    const activated = apply(start, {
      type: 'activateAbility',
      player: 0,
      oid: smith,
      abilityIndex: 0,
      targets: [{ kind: 'player', player: 1 }],
      sacrifices: [],
    });
    const passed = apply(activated, { type: 'passPriority', player: 0 });
    const boltOid = passed.state.players[1].hand[0] as ObjectId;
    const answered = apply(passed, {
      type: 'castSpell',
      player: 1,
      oid: boltOid,
      targets: [{ kind: 'permanent', oid: smith }],
    });
    const resolved = letItResolve(answered, 12);

    expect(resolved.state.objects[smith]?.zone).toBe('graveyard');
    // The source is dead and the ability still dealt its damage.
    expect(resolved.state.players[1].life).toBe(19);
  });

  /**
   * CR 608.2b, the other half: a target that has become illegal is not hit, and
   * an ability whose every target went away does nothing at all. The skipped
   * index is in the log, so the reason is readable rather than inferred from an
   * effect that did not happen.
   */
  it('skips an effect whose target became illegal, and applies nothing else', () => {
    const bolt = instant('Bomb Arrow', [
      { kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } },
    ]);
    const start = scenario({
      battlefield: [
        { card: beacon(), controller: 0 },
        { card: creature('Brigand', 1, 1), controller: 1 },
        ...lands(2, 0),
        ...lands(2, 1),
      ],
      hands: [[], [bolt]],
    });
    const beaconOid = oidOf(start.state, 'Ashen Beacon');
    const brigand = oidOf(start.state, 'Brigand');
    const activated = apply(start, {
      type: 'activateAbility',
      player: 0,
      oid: beaconOid,
      abilityIndex: 0,
      targets: [{ kind: 'permanent', oid: brigand }],
      sacrifices: [],
    });
    const passed = apply(activated, { type: 'passPriority', player: 0 });
    const boltOid = passed.state.players[1].hand[0] as ObjectId;
    const answered = apply(passed, {
      type: 'castSpell',
      player: 1,
      oid: boltOid,
      targets: [{ kind: 'permanent', oid: brigand }],
    });
    const resolved = letItResolve(answered, 12);

    expect(resolved.state.objects[brigand]?.zone).toBe('graveyard');
    const skipped = eventsOfType(resolved.events, 'effectSkipped').filter((event) =>
      event.oid.startsWith('ab'),
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.index).toBe(0);
    // The one damage the ability would have dealt never landed anywhere else.
    expect(resolved.state.players[0].life).toBe(20);
    expect(resolved.state.players[1].life).toBe(20);
  });

  /**
   * "Counter target spell" is what the card says, and an activated ability is
   * not a spell (CR 113.7a). The same exclusion the trigger slice put in
   * `targetChoicesFor` covers it, because both kinds are `entry.ability !== null`.
   */
  it('is not a legal target for a spell that counters spells', () => {
    const counter = instant('Ashen Nullifier', [{ kind: 'counterSpell' }], { generic: 1 });
    const start = scenario({
      battlefield: [{ card: beacon(), controller: 0 }, ...lands(2, 0), ...lands(2, 1)],
      hands: [[], [counter]],
    });
    const beaconOid = oidOf(start.state, 'Ashen Beacon');
    const activated = apply(start, {
      type: 'activateAbility',
      player: 0,
      oid: beaconOid,
      abilityIndex: 0,
      targets: [{ kind: 'player', player: 1 }],
      sacrifices: [],
    });
    const passed = apply(activated, { type: 'passPriority', player: 0 });
    expect(abilitiesOnStack(passed.state)).toHaveLength(1);
    const casts = legalActions(passed.state).filter((option) => option.type === 'castSpell');
    expect(casts).toEqual([]);
  });
});

describe('validation of a constructed action', () => {
  const start = scenario({
    battlefield: [{ card: beacon(), controller: 0 }, ...lands(2, 0)],
  });
  const beaconOid = oidOf(start.state, 'Ashen Beacon');

  function reason(overrides: Partial<Extract<Action, { type: 'activateAbility' }>>): string | null {
    return validateAction(start.state, {
      type: 'activateAbility',
      player: 0,
      oid: beaconOid,
      abilityIndex: 0,
      targets: [{ kind: 'player', player: 1 }],
      sacrifices: [],
      ...overrides,
    });
  }

  it('rejects an index past the end of the printed list', () => {
    expect(reason({ abilityIndex: 4 })).toBe('that permanent has no activated ability there');
  });

  it('rejects an index naming an ability nobody can activate', () => {
    const withStatic = scenario({
      battlefield: [
        {
          card: creature('Merfolk Marshal', 2, 2, {
            abilities: [
              {
                kind: 'static',
                scope: 'creaturesYouControl',
                subtype: null,
                modification: { kind: 'statBonus', power: 1, toughness: 0 },
              },
            ],
          }),
          controller: 0,
        },
        ...lands(2, 0),
      ],
    });
    expect(
      validateAction(withStatic.state, {
        type: 'activateAbility',
        player: 0,
        oid: oidOf(withStatic.state, 'Merfolk Marshal'),
        abilityIndex: 0,
        targets: [],
        sacrifices: [],
      }),
    ).toBe('that permanent has no activated ability there');
  });

  it('rejects a target list that is not one slot per effect', () => {
    expect(reason({ targets: [] })).toBe('one target slot per effect is required');
  });

  it('rejects a target the effect cannot legally have', () => {
    expect(reason({ targets: [{ kind: 'permanent', oid: beaconOid }] })).toBe('illegal target for effect 0');
  });

  it('rejects a source that exists but is not on the battlefield', () => {
    // The printed ability is real and the index finds it; what stops this is
    // the zone. A card in hand has not started being a permanent yet.
    const inHand = scenario({ battlefield: lands(2, 0), hands: [[beacon()], []] });
    const handOid = inHand.state.players[0].hand[0] as ObjectId;
    expect(
      validateAction(inHand.state, {
        type: 'activateAbility',
        player: 0,
        oid: handOid,
        abilityIndex: 0,
        targets: [{ kind: 'player', player: 1 }],
        sacrifices: [],
      }),
    ).toBe('source is not on the battlefield');
  });

  it('rejects an id no object carries', () => {
    expect(reason({ oid: 'o999' })).toBe('that permanent has no activated ability there');
  });
});

/**
 * `TargetSpec.distinct` on an ability's second slot, checked on both sides.
 *
 * The acceptance criterion is that the enumeration never offers an action the
 * kernel would reject, which only means something where the two could disagree.
 * `distinct` is that place: the filter in `activationOptions` and the check in
 * `validateActivation` are separate lines of code enforcing one rule, so each
 * one is asserted against the other's absence.
 */
describe('a slot that must not repeat a target', () => {
  function board(): ReduceResult {
    return scenario({
      battlefield: [
        { card: binder(), controller: 0 },
        { card: creature('Brigand', 1, 1), controller: 1 },
        { card: creature('Marauder', 2, 2), controller: 1 },
        ...lands(2, 0),
      ],
    });
  }

  it('enumerates only the tuples that use two different creatures', () => {
    const start = board();
    const options = activations(start.state);
    // Two creatures on the board, two slots: the cartesian product is four and
    // the two self-pairs are the ones the distinct-slot filter removes.
    expect(options).toHaveLength(2);
    for (const option of options) {
      const [first, second] = option.targets;
      expect(first?.kind).toBe('permanent');
      expect(second?.kind).toBe('permanent');
      expect(first).not.toEqual(second);
    }
  });

  it('offers nothing at all when only one creature is on the board', () => {
    const start = scenario({
      battlefield: [
        { card: binder(), controller: 0 },
        { card: creature('Brigand', 1, 1), controller: 1 },
        ...lands(2, 0),
      ],
    });
    expect(activations(start.state)).toEqual([]);
  });

  it('rejects a hand-built action that aims both slots at one creature', () => {
    // Rejected at the offending slot rather than by a tuple-level sweep:
    // `isTargetStillLegal` is handed the whole tuple so that slot 1 can see
    // slot 0's choice, which is why `validateActivation` needs no second pass.
    const start = board();
    const brigand = oidOf(start.state, 'Brigand');
    const target = { kind: 'permanent', oid: brigand } as const;
    expect(
      validateAction(start.state, {
        type: 'activateAbility',
        player: 0,
        oid: oidOf(start.state, 'Twinned Binding'),
        abilityIndex: 0,
        targets: [target, target],
        sacrifices: [],
      }),
    ).toBe('illegal target for effect 1');
  });

  it('taps both creatures when the two slots differ', () => {
    const start = board();
    const brigand = oidOf(start.state, 'Brigand');
    const marauder = oidOf(start.state, 'Marauder');
    const resolved = letItResolve(
      apply(start, {
        type: 'activateAbility',
        player: 0,
        oid: oidOf(start.state, 'Twinned Binding'),
        abilityIndex: 0,
        targets: [
          { kind: 'permanent', oid: brigand },
          { kind: 'permanent', oid: marauder },
        ],
        sacrifices: [],
      }),
    );
    expect(resolved.state.objects[brigand]?.tapped).toBe(true);
    expect(resolved.state.objects[marauder]?.tapped).toBe(true);
  });
});

/**
 * CR 608.2b, with the effect held to the same standard as the event.
 *
 * `resolveAbility` emits `effectSkipped` for a target that has gone and then
 * applies only what survived, and only the first half was asserted: keeping the
 * emission while applying every printed effect regardless left the whole suite
 * green. It survived because every skipped effect in the existing fixtures does
 * nothing when it is applied to a target that is already gone.
 *
 * `counterSpell` is the one that does something. `applyEffect`'s arm does not
 * re-check the stack: handed a spell that has already been countered it emits a
 * second `spellCountered` and moves the card again. So two activations aimed at
 * one spell separate the halves — the first to resolve counters it, and the
 * second must skip rather than counter it twice.
 */
describe('an ability whose target has left the stack', () => {
  /** `{1}: Counter target spell.` Mana-only, so one stone answers twice. */
  const NULLIFY: AbilityInput = {
    kind: 'activated',
    cost: { mana: { generic: 1 }, tapSelf: false },
    effects: [{ kind: 'counterSpell' }],
  };

  it('counters the spell once, and the second activation applies nothing', () => {
    const bolt = instant('Brigand Bolt', [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }], {
      generic: 1,
    });
    const start = scenario({
      battlefield: [
        { card: artifact('Ashen Nullstone', { generic: 2 }, [NULLIFY]), controller: 0 },
        ...lands(3, 0),
        ...lands(2, 1),
      ],
      hands: [[], [bolt]],
    });

    const handedOver = apply(start, { type: 'passPriority', player: 0 });
    const boltOid = handedOver.state.players[1].hand[0] as ObjectId;
    const cast = apply(handedOver, {
      type: 'castSpell',
      player: 1,
      oid: boltOid,
      targets: [{ kind: 'player', player: 0 }],
    });
    const backToMe = apply(cast, { type: 'passPriority', player: 1 });

    const stone = oidOf(backToMe.state, 'Ashen Nullstone');
    const spellTarget = { kind: 'spell', oid: boltOid } as const;
    const first = apply(backToMe, {
      type: 'activateAbility',
      player: 0,
      oid: stone,
      abilityIndex: 0,
      targets: [spellTarget],
      sacrifices: [],
    });
    const second = apply(first, {
      type: 'activateAbility',
      player: 0,
      oid: stone,
      abilityIndex: 0,
      targets: [spellTarget],
      sacrifices: [],
    });
    expect(second.state.stack).toHaveLength(3);

    const resolved = letItResolve(second, 24);
    expect(resolved.state.objects[boltOid]?.zone).toBe('graveyard');
    expect(resolved.state.players[0].life).toBe(20);

    // One counter, not two: the second activation found its target gone and
    // applied nothing, which is the half of CR 608.2b that is not an event.
    expect(eventsOfType(resolved.events, 'spellCountered')).toHaveLength(1);
    const skipped = eventsOfType(resolved.events, 'effectSkipped').filter((event) =>
      event.oid.startsWith('ab'),
    );
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.index).toBe(0);
  });
});

/**
 * CR 117.3c: taking an action resets the pass count.
 *
 * `retainPriority` does two things and only one of them was asserted. Priority
 * coming back to the activating player is visible in a one-sided test and was
 * already true without the call; the pass count is the half that matters and it
 * only shows itself when the opponent has already passed. Drop the call and the
 * activating player's next pass is the second pass, so the ability they just
 * paid for resolves without the opponent ever seeing it on the stack.
 */
describe('priority after an activation', () => {
  function facingFonts(): ReduceResult {
    return scenario({
      battlefield: [
        { card: artifact('Spring Font', { generic: 2 }, [TAP_FOR_LIFE]), controller: 0 },
        { card: artifact('Autumn Font', { generic: 2 }, [TAP_FOR_LIFE]), controller: 1 },
      ],
    });
  }

  it('resets the pass count, so the opponent is asked again', () => {
    // Walk to the one position where the two halves differ: the opponent has
    // passed, priority is back with the active player, and the active player
    // then acts. Anywhere else `passes` is already 0 and the call is invisible.
    const start = facingFonts();
    const handedOver = apply(start, { type: 'passPriority', player: 0 });
    const theirs = apply(handedOver, {
      type: 'activateAbility',
      player: 1,
      oid: oidOf(handedOver.state, 'Autumn Font'),
      abilityIndex: 0,
      targets: [null],
      sacrifices: [],
    });
    const backToMe = apply(theirs, { type: 'passPriority', player: 1 });
    expect(backToMe.state.turn.passes).toBe(1);
    expect(backToMe.state.turn.priority).toBe(0);

    const answered = apply(backToMe, {
      type: 'activateAbility',
      player: 0,
      oid: oidOf(backToMe.state, 'Spring Font'),
      abilityIndex: 0,
      targets: [null],
      sacrifices: [],
    });
    expect(answered.state.turn.passes).toBe(0);
    expect(answered.state.turn.priority).toBe(0);
    expect(answered.state.stack).toHaveLength(2);

    // One pass is the first pass again: the opponent is asked about the ability
    // that just went on the stack, and nothing resolves until they answer.
    const passedOnce = apply(answered, { type: 'passPriority', player: 0 });
    expect(passedOnce.state.turn.priority).toBe(1);
    expect(passedOnce.state.stack).toHaveLength(2);
    expect(passedOnce.state.players[0].life).toBe(20);
    expect(passedOnce.state.players[1].life).toBe(20);
  });
});

/**
 * `simpleAgent` is named in this slice's contents list, and its arm was a
 * constant nothing read: returning -1 instead of 20 left 816 tests green. The
 * number is a rank, so the assertions are the two comparisons it encodes.
 */
describe('the reference agent', () => {
  const agent = simpleAgent('reference');

  function chooseFor(state: GameState): Action {
    const decision = pendingDecision(state);
    if (decision === null) throw new Error('no decision pending');
    return agent.decide({ state, player: decision.player, decision });
  }

  it('pays for an ability rather than passing with the mana unspent', () => {
    const start = scenario({
      battlefield: [{ card: beacon(), controller: 0 }, ...lands(2, 0)],
    });
    const chosen = chooseFor(start.state);
    expect(chosen.type).toBe('activateAbility');
    expect(validateAction(start.state, chosen)).toBeNull();
  });

  it('still casts first, and never spends a spell to activate', () => {
    const start = scenario({
      battlefield: [{ card: beacon(), controller: 0 }, ...lands(2, 0)],
      hands: [[creature('Brigand', 1, 1)], []],
    });
    expect(chooseFor(start.state).type).toBe('castSpell');
  });
});

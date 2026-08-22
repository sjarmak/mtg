/** Aura casting and blanket enchantments through the public reducer. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import {
  attachmentOf,
  canBlock,
  checkStateBasedActions,
  controlledBy,
  controllerOf,
  eligibleAttackers,
  eligibleBlockers,
  eventsOfType,
  fork,
  objectFilter,
  hasKeyword,
  pendingDecision,
  keywordAbilitiesOf,
  legalActions,
  moveObject,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  stateFingerprint,
  toughnessOf,
  validateAction,
  type Action,
  type ContinuousEffect,
  type GameState,
  type ObjectId,
  type ReduceResult,
  type Target,
} from '@mtg/kernel';
import { beginTrace } from '@mtg/kernel';
import { attachAuraTo } from '../src/attach';
import { creature, FOREST, lands, MOUNTAIN, PLAINS } from './cards';
import { apply } from './helpers';

const BEAR = creature('Runeclaw Bear', 2, 2, { cost: { generic: 1 } });
const SQUIRE = creature('Opponent Squire', 1, 1, { cost: { generic: 1 } });

function aura(
  name: string,
  modifications: readonly Record<string, unknown>[],
  abilities: readonly Record<string, unknown>[] = [],
): Card {
  return parseCard({
    kind: 'enchantment',
    id: `test-${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { W: 1 },
    colors: ['W'],
    subtypes: ['Aura'],
    aura: { enchant: 'creature', modifications },
    abilities,
  });
}

const HOLY = aura('Holy Strength', [{ kind: 'statBonus', power: 1, toughness: 2 }]);
const MARK = aura('Mark of the Vampire', [
  { kind: 'statBonus', power: 2, toughness: 2 },
  { kind: 'grantKeyword', keyword: 'lifelink' },
]);
const PACIFISM = aura('Pacifism', [{ kind: 'cantAttack' }, { kind: 'cantBlock' }]);
const TRICKS = aura('Tricks of the Trade', [
  { kind: 'statBonus', power: 2, toughness: 0 },
  { kind: 'cantBeBlocked' },
]);
const DIVINE = aura(
  'Divine Favor',
  [{ kind: 'statBonus', power: 1, toughness: 3 }],
  [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } }],
    },
  ],
);
const CHILL = aura('Bitter Chill', [{ kind: 'doesNotUntap' }]);
const DRYAD = aura("Dryad's Favor", [{ kind: 'grantLandwalk', landType: 'Forest' }]);
const MIND = aura('Mind Control', [{ kind: 'gainControl' }]);
const VOLCANIC = aura('Volcanic Strength', [
  { kind: 'statBonus', power: 2, toughness: 2 },
  { kind: 'grantLandwalk', landType: 'Mountain' },
]);

const FERVOR = parseCard({
  kind: 'enchantment',
  id: 'test-fervor',
  name: 'Fervor',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  abilities: [
    {
      kind: 'static',
      scope: 'creaturesYouControl',
      subtype: null,
      modification: { kind: 'grantKeyword', keyword: 'haste' },
    },
  ],
});

const PASSES: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function named(state: GameState, name: string, controller?: 0 | 1): ObjectId {
  const oid = state.battlefield.find(
    (candidate) =>
      state.objects[candidate]?.card.name === name &&
      (controller === undefined || state.objects[candidate]?.controller === controller),
  );
  if (oid === undefined) throw new Error(`no ${name} on battlefield`);
  return oid;
}

function castAura(start: GameState, card: Card, target: ObjectId): ReduceResult {
  const oid = start.players[0].hand.find((candidate) => start.objects[candidate]?.card.id === card.id);
  if (oid === undefined) throw new Error(`no ${card.name} in hand`);
  const cast = reduce(start, {
    type: 'castSpell',
    player: 0,
    oid,
    targets: [{ kind: 'permanent', oid: target }],
  });
  const resolved = reduceAll(cast.state, PASSES);
  return { state: resolved.state, events: [...cast.events, ...resolved.events] };
}

function board(hand: readonly Card[]): GameState {
  return scenario({
    battlefield: [
      { card: BEAR, controller: 0, summoningSick: true },
      { card: SQUIRE, controller: 1, summoningSick: false },
      ...lands(PLAINS, 8).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[...hand], []],
  }).state;
}

/** The same board with the opponent's creature already tapped. */
function frozenBoard(hand: readonly Card[]): GameState {
  return scenario({
    battlefield: [
      { card: BEAR, controller: 0, summoningSick: false },
      { card: SQUIRE, controller: 1, summoningSick: false, tapped: true },
      ...lands(PLAINS, 8).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[...hand], []],
  }).state;
}

/** Idles forward: passes priority and takes the first option on every other decision. */
function passUntilTurn(from: ReduceResult, turn: number): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 400; guard += 1) {
    if (current.state.turn.number >= turn) return current;
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('the game ended before the turn arrived');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`no option offered for ${decision.kind}`);
    current = apply(current, option);
  }
  throw new Error(`never reached turn ${String(turn)}`);
}

describe('Aura spells', () => {
  it('offers every creature regardless of controller and rejects noncreature and malformed targets', () => {
    const start = board([HOLY]);
    const bear = named(start, 'Runeclaw Bear');
    const squire = named(start, 'Opponent Squire');
    const auraOid = start.players[0].hand[0] ?? '';
    const choices = legalActions(start)
      .filter(
        (action): action is Extract<Action, { type: 'castSpell' }> =>
          action.type === 'castSpell' && action.oid === auraOid,
      )
      .flatMap((action) => action.targets)
      .filter((target): target is Extract<Target, { kind: 'permanent' }> => target?.kind === 'permanent')
      .map((target) => target.oid);
    expect(choices).toEqual(expect.arrayContaining([bear, squire]));
    expect(validateAction(start, { type: 'castSpell', player: 0, oid: auraOid, targets: [] })).toMatch(
      /target/i,
    );
    const land = start.battlefield.find((oid) => start.objects[oid]?.card.kind === 'land') ?? '';
    expect(
      validateAction(start, {
        type: 'castSpell',
        player: 0,
        oid: auraOid,
        targets: [{ kind: 'permanent', oid: land }],
      }),
    ).toMatch(/target/i);
  });

  it('enters attached, applies layer 7c and layer 6, and binds replay state deterministically', () => {
    const start = board([MARK]);
    const bear = named(start, 'Runeclaw Bear');
    const result = castAura(start, MARK, bear);
    const mark = named(result.state, 'Mark of the Vampire');
    expect(attachmentOf(result.state, mark)).toBe(bear);
    expect(powerOf(result.state, bear)).toBe(4);
    expect(toughnessOf(result.state, bear)).toBe(4);
    expect(hasKeyword(result.state, bear, 'lifelink')).toBe(true);
    expect(
      result.state.continuous.filter((effect) => effect.sourceOid === mark).map((effect) => effect.layer),
    ).toEqual(['7c', '6']);
    const forked = fork(result.state);
    expect(stateFingerprint(forked)).toBe(stateFingerprint(result.state));
    expect(attachmentOf(forked, mark)).toBe(bear);
    const copied = structuredClone(result.state);
    expect(stateFingerprint(copied)).toBe(stateFingerprint(result.state));
    expect(attachmentOf(copied, mark)).toBe(bear);
  });

  it('resolves an enters trigger after attachment and gives life to the Aura controller', () => {
    const start = board([DIVINE]);
    const squire = named(start, 'Opponent Squire');
    const entered = castAura(start, DIVINE, squire);
    const trigger = entered.state.stack.at(-1);
    expect(attachmentOf(entered.state, named(entered.state, 'Divine Favor'))).toBe(squire);
    expect(trigger?.ability).not.toBeNull();
    const resolved = reduceAll(entered.state, PASSES);
    expect(resolved.state.players[0].life).toBe(23);
    expect(resolved.state.players[1].life).toBe(20);
  });

  it('fizzles into its owner graveyard when the target has left before resolution', () => {
    const start = board([HOLY]);
    const bear = named(start, 'Runeclaw Bear');
    const auraOid = start.players[0].hand[0] ?? '';
    const cast = reduce(start, {
      type: 'castSpell',
      player: 0,
      oid: auraOid,
      targets: [{ kind: 'permanent', oid: bear }],
    });
    const removed = moveObject(beginTrace(cast.state), bear, 'graveyard');
    const resolved = reduceAll(removed.state, PASSES);
    expect(resolved.state.objects[auraOid]?.zone).toBe('graveyard');
    expect(eventsOfType(resolved.events, 'spellFizzled').map((event) => event.oid)).toContain(auraOid);
  });

  it('puts an unattached or illegally attached Aura into its owner graveyard as an SBA', () => {
    const stated = scenario({ battlefield: [{ card: HOLY, controller: 0 }] });
    const auraOid = Object.values(stated.state.objects).find(
      (object) => object.card.name === 'Holy Strength',
    )?.oid;
    expect(auraOid).toBeDefined();
    if (auraOid === undefined) return;
    expect(stated.state.objects[auraOid]?.zone).toBe('graveyard');

    const start = board([HOLY]);
    const attached = castAura(start, HOLY, named(start, 'Runeclaw Bear'));
    const host = named(attached.state, 'Runeclaw Bear');
    const killed = checkStateBasedActions(moveObject(beginTrace(attached.state), host, 'graveyard'));
    const aura = Object.values(killed.state.objects).find((object) => object.card.name === 'Holy Strength');
    expect(aura?.zone).toBe('graveyard');
    expect(aura?.attachedTo).toBeUndefined();

    const secondStart = board([HOLY]);
    const reattached = castAura(secondStart, HOLY, named(secondStart, 'Runeclaw Bear'));
    const retypedHost = named(reattached.state, 'Runeclaw Bear');
    const typeChange: ContinuousEffect = {
      kind: 'typeChange',
      layer: '4',
      id: 'test-aura-illegal-host-type',
      timestamp: reattached.state.nextId,
      sourceOid: retypedHost,
      duration: 'permanent',
      affects: objectFilter({ oids: [retypedHost] }),
      enabledWhile: null,
      addTypes: [],
      removeTypes: ['creature'],
      addSubtypes: [],
      removeAllSubtypes: true,
    };
    const illegal = checkStateBasedActions({
      state: { ...reattached.state, continuous: [...reattached.state.continuous, typeChange] },
      events: [],
    });
    const invalidAura = Object.values(illegal.state.objects).find(
      (object) => object.card.name === 'Holy Strength',
    );
    expect(invalidAura?.zone).toBe('graveyard');
    expect(invalidAura?.attachedTo).toBeUndefined();
  });

  it('drops an Aura and all attachment effects when the Aura itself leaves', () => {
    const start = board([HOLY]);
    const bear = named(start, 'Runeclaw Bear');
    const attached = castAura(start, HOLY, bear);
    const auraOid = named(attached.state, 'Holy Strength');
    expect(powerOf(attached.state, bear)).toBe(3);
    const gone = moveObject(beginTrace(attached.state), auraOid, 'graveyard');
    expect(attachmentOf(gone.state, auraOid)).toBeUndefined();
    expect(powerOf(gone.state, bear)).toBe(2);
    expect(gone.state.continuous.some((effect) => effect.sourceOid === auraOid)).toBe(false);
  });
});

describe('Aura combat modifications', () => {
  it('Pacifism removes its host from attack and block eligibility', () => {
    const start = board([PACIFISM]);
    const attacking = castAura(start, PACIFISM, named(start, 'Runeclaw Bear'));
    const bear = named(attacking.state, 'Runeclaw Bear');
    expect(eligibleAttackers(attacking.state)).not.toContain(bear);

    const defending: GameState = {
      ...attacking.state,
      turn: { ...attacking.state.turn, active: 1 },
    };
    expect(eligibleBlockers(defending)).not.toContain(bear);
  });

  it("Tricks of the Trade's host cannot be blocked", () => {
    const start = board([TRICKS]);
    const bear = named(start, 'Runeclaw Bear');
    const squire = named(start, 'Opponent Squire');
    const attached = castAura(start, TRICKS, bear);
    expect(powerOf(attached.state, bear)).toBe(4);
    expect(canBlock(attached.state, squire, bear)).toBe(false);
  });

  it('grants exact basic landwalk to the host only while attached', () => {
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 0, summoningSick: false },
        { card: SQUIRE, controller: 1, summoningSick: false },
        { card: FOREST, controller: 1 },
        ...lands(PLAINS, 8).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[DRYAD], []],
    }).state;
    const bear = named(start, 'Runeclaw Bear');
    const squire = named(start, 'Opponent Squire');
    const attached = castAura(start, DRYAD, bear);
    const dryad = named(attached.state, "Dryad's Favor");

    expect(keywordAbilitiesOf(attached.state, bear)).toContainEqual({
      kind: 'landwalk',
      landType: 'Forest',
    });
    expect(keywordAbilitiesOf(attached.state, dryad)).toEqual([]);
    expect(attached.state.objects[dryad]?.card.keywordAbilities).toBeUndefined();
    expect(canBlock(attached.state, squire, bear)).toBe(false);

    const sourceGone = moveObject(beginTrace(attached.state), dryad, 'graveyard');
    expect(keywordAbilitiesOf(sourceGone.state, bear)).not.toContainEqual({
      kind: 'landwalk',
      landType: 'Forest',
    });
    expect(canBlock(sourceGone.state, squire, bear)).toBe(true);
  });

  it('preserves Volcanic Strength stats and reads the defending player Mountain', () => {
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 0, summoningSick: false },
        { card: SQUIRE, controller: 1, summoningSick: false },
        { card: MOUNTAIN, controller: 1 },
        ...lands(PLAINS, 8).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[VOLCANIC], []],
    }).state;
    const bear = named(start, 'Runeclaw Bear');
    const squire = named(start, 'Opponent Squire');
    const attached = castAura(start, VOLCANIC, bear);
    expect(powerOf(attached.state, bear)).toBe(4);
    expect(toughnessOf(attached.state, bear)).toBe(4);
    expect(canBlock(attached.state, squire, bear)).toBe(false);

    const mountainOid = named(attached.state, 'Mountain', 1);
    const noMountain = moveObject(beginTrace(attached.state), mountainOid, 'graveyard');
    expect(canBlock(noMountain.state, squire, bear)).toBe(true);
  });

  it('moves the grant with reattachment and survives source or host control changes', () => {
    const start = board([DRYAD]);
    const bear = named(start, 'Runeclaw Bear');
    const squire = named(start, 'Opponent Squire');
    const attached = castAura(start, DRYAD, bear);
    const dryad = named(attached.state, "Dryad's Favor");
    const sourceControl: ContinuousEffect = {
      kind: 'control',
      layer: '2',
      id: 'test-dryad-source-control',
      timestamp: attached.state.nextId,
      sourceOid: dryad,
      duration: 'permanent',
      affects: objectFilter({ oids: [dryad] }),
      enabledWhile: null,
      controller: 1,
    };
    const hostControl: ContinuousEffect = {
      kind: 'control',
      layer: '2',
      id: 'test-dryad-host-control',
      timestamp: attached.state.nextId + 1,
      sourceOid: dryad,
      duration: 'permanent',
      affects: objectFilter({ oids: [bear] }),
      enabledWhile: null,
      controller: 1,
    };
    const controlled = {
      ...attached.state,
      continuous: [...attached.state.continuous, sourceControl, hostControl],
    };
    expect(keywordAbilitiesOf(controlled, bear)).toContainEqual({ kind: 'landwalk', landType: 'Forest' });

    const moved = attachAuraTo(beginTrace(controlled), dryad, squire);
    expect(keywordAbilitiesOf(moved.state, bear)).not.toContainEqual({
      kind: 'landwalk',
      landType: 'Forest',
    });
    expect(keywordAbilitiesOf(moved.state, squire)).toContainEqual({
      kind: 'landwalk',
      landType: 'Forest',
    });
  });

  /**
   * CR 613.1b through the one reader, and the point of the test is that no new
   * reader was needed. `ControlEffect` and `controllerOf` predate any card that
   * could take control of anything, so what this asserts is the wiring: an
   * Aura clause reaching the layer-2 record the kernel already walks, and every
   * control-sensitive answer in the engine moving with it because they all come
   * off `controllerOf`.
   *
   * The reversal is asserted for the same reason the landwalk cases assert it.
   * `duration: 'whileAttached'` is what hands the creature back when the Aura
   * dies, and a control effect that outlived its Aura would be the one failure
   * here that a game would not surface until several turns later.
   */
  it("hands the enchanted creature to the Aura's controller and back when it leaves", () => {
    const start = board([MIND]);
    const squire = named(start, 'Opponent Squire');
    expect(controllerOf(start, squire)).toBe(1);

    const attached = castAura(start, MIND, squire);
    expect(controllerOf(attached.state, squire)).toBe(0);
    expect(controlledBy(attached.state, 0)).toContain(squire);
    expect(controlledBy(attached.state, 1)).not.toContain(squire);

    const auraOid = named(attached.state, 'Mind Control');
    const gone = moveObject(beginTrace(attached.state), auraOid, 'graveyard');
    expect(controllerOf(gone.state, squire)).toBe(1);
    expect(controlledBy(gone.state, 0)).not.toContain(squire);
  });

  it('keeps one of multiple grants when the other Aura leaves and clones deterministically', () => {
    const start = board([DRYAD, DRYAD]);
    const bear = named(start, 'Runeclaw Bear');
    const first = castAura(start, DRYAD, bear);
    const second = castAura(first.state, DRYAD, bear);
    const auras = second.state.battlefield.filter(
      (oid) => second.state.objects[oid]?.card.name === "Dryad's Favor",
    );
    expect(auras).toHaveLength(2);
    expect(keywordAbilitiesOf(second.state, bear)).toContainEqual({ kind: 'landwalk', landType: 'Forest' });
    expect(stateFingerprint(fork(second.state))).toBe(stateFingerprint(second.state));
    expect(stateFingerprint(structuredClone(second.state))).toBe(stateFingerprint(second.state));

    const firstGone = moveObject(beginTrace(second.state), auras[0] ?? '', 'graveyard');
    expect(keywordAbilitiesOf(firstGone.state, bear)).toContainEqual({
      kind: 'landwalk',
      landType: 'Forest',
    });
  });

  it('removes attached landwalk when the host becomes illegal under state-based actions', () => {
    const start = board([DRYAD]);
    const bear = named(start, 'Runeclaw Bear');
    const attached = castAura(start, DRYAD, bear);
    const dryad = named(attached.state, "Dryad's Favor");
    const typeChange: ContinuousEffect = {
      kind: 'typeChange',
      layer: '4',
      id: 'test-dryad-illegal-host-type',
      timestamp: attached.state.nextId,
      sourceOid: bear,
      duration: 'permanent',
      affects: objectFilter({ oids: [bear] }),
      enabledWhile: null,
      addTypes: [],
      removeTypes: ['creature'],
      addSubtypes: [],
      removeAllSubtypes: true,
    };
    const illegal = checkStateBasedActions({
      state: { ...attached.state, continuous: [...attached.state.continuous, typeChange] },
      events: [],
    });
    expect(illegal.state.objects[dryad]?.zone).toBe('graveyard');
    expect(keywordAbilitiesOf(illegal.state, bear)).not.toContainEqual({
      kind: 'landwalk',
      landType: 'Forest',
    });
  });
});

/**
 * CR 302.6 as a schedule rather than a resolution.
 *
 * Nothing about the hold is visible at the moment the Aura resolves — the
 * creature was already tapped, no continuous effect is registered, and the
 * board reads exactly as it did. It is visible one untap step later, and the
 * difference from the `tapPermanent` rider is only visible two: the rider is a
 * debt owed to one untap step and this is owed to every one of them, so the
 * test plays turns until the second untap step has passed.
 *
 * The Aura enchants the *opponent's* creature, which is both what the printed
 * cards do and what makes the assertion mean something — the untap step reads
 * the attachment relation off the permanent it is untapping, not off whoever
 * controls the Aura.
 */
describe('an Aura that holds its host tapped', () => {
  it('costs its host every untap step for as long as it stays attached', () => {
    const start = frozenBoard([CHILL]);
    const squire = named(start, 'Opponent Squire');
    const attached = castAura(start, CHILL, squire);
    const chill = named(attached.state, 'Bitter Chill');
    expect(attachmentOf(attached.state, chill)).toBe(squire);
    // The clause registers nothing in layers: CR 613 changes characteristics,
    // and whether a permanent untaps is not one of them.
    expect(attached.state.continuous.filter((effect) => effect.sourceOid === chill)).toEqual([]);
    expect(attached.state.objects[squire]?.tapped).toBe(true);

    const held = passUntilTurn({ state: attached.state, events: [] }, 3);
    expect(held.state.objects[squire]?.tapped).toBe(true);
    expect(eventsOfType(held.events, 'untapSkipped').map((event) => event.oid)).toContain(squire);
    expect(eventsOfType(held.events, 'permanentUntapped').map((event) => event.oid)).not.toContain(squire);

    // Nothing spends it, so the second untap step reads exactly like the first.
    const stillHeld = passUntilTurn({ state: held.state, events: [] }, 5);
    expect(stillHeld.state.objects[squire]?.tapped).toBe(true);
    expect(eventsOfType(stillHeld.events, 'untapSkipped').map((event) => event.oid)).toContain(squire);
    expect(stillHeld.state.objects[squire]?.skipsNextUntap).toBeUndefined();
  });

  it('hands the untap step back the moment the Aura leaves', () => {
    const start = frozenBoard([CHILL]);
    const squire = named(start, 'Opponent Squire');
    const attached = castAura(start, CHILL, squire);
    const chill = named(attached.state, 'Bitter Chill');
    const gone = moveObject(beginTrace(attached.state), chill, 'graveyard');
    expect(gone.state.objects[squire]?.tapped).toBe(true);

    const untapped = passUntilTurn({ state: gone.state, events: [] }, 3);
    expect(untapped.state.objects[squire]?.tapped).toBe(false);
    expect(eventsOfType(untapped.events, 'permanentUntapped').map((event) => event.oid)).toContain(squire);
    expect(eventsOfType(untapped.events, 'untapSkipped').map((event) => event.oid)).not.toContain(squire);
  });

  it('follows a dead host to the graveyard under CR 704.5m', () => {
    const start = frozenBoard([CHILL]);
    const squire = named(start, 'Opponent Squire');
    const attached = castAura(start, CHILL, squire);
    const chill = named(attached.state, 'Bitter Chill');
    const killed = checkStateBasedActions(moveObject(beginTrace(attached.state), squire, 'graveyard'));
    expect(killed.state.objects[chill]?.zone).toBe('graveyard');
    expect(killed.state.objects[chill]?.attachedTo).toBeUndefined();
    expect(attachmentOf(killed.state, chill)).toBeUndefined();
  });
});

describe('blanket enchantments', () => {
  it('Fervor grants haste only to creatures its current controller controls', () => {
    const state = scenario({
      battlefield: [
        { card: FERVOR, controller: 0 },
        { card: BEAR, controller: 0, summoningSick: true },
        { card: SQUIRE, controller: 1, summoningSick: true },
      ],
    }).state;
    const bear = named(state, 'Runeclaw Bear');
    const squire = named(state, 'Opponent Squire');
    expect(hasKeyword(state, bear, 'haste')).toBe(true);
    expect(hasKeyword(state, squire, 'haste')).toBe(false);
    expect(eligibleAttackers(state)).toContain(bear);
    expect(eligibleAttackers(state)).not.toContain(squire);

    const fervor = named(state, 'Fervor');
    const controlChange: ContinuousEffect = {
      kind: 'control',
      layer: '2',
      id: 'test-fervor-control-change',
      timestamp: state.nextId,
      sourceOid: fervor,
      duration: 'permanent',
      affects: objectFilter({ oids: [fervor] }),
      enabledWhile: null,
      controller: 1,
    };
    const changed = { ...state, continuous: [...state.continuous, controlChange] };
    expect(hasKeyword(changed, bear, 'haste')).toBe(false);
    expect(hasKeyword(changed, squire, 'haste')).toBe(true);
  });
});

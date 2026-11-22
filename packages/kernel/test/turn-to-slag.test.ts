/** Turn to Slag resolves damage before a live query over attached Equipment. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  createRegenerationShield,
  moveObject,
  pendingDecision,
  reduce,
  scenario,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { creature, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const TURN_TO_SLAG = parseCard({
  kind: 'sorcery',
  id: 'm13-turn-to-slag-kernel',
  name: 'Turn to Slag',
  rarity: 'common',
  set: { code: 'M13', collectorNumber: 153 },
  manaCost: { generic: 3, R: 2 },
  colors: ['R'],
  effects: [
    { kind: 'dealDamage', amount: 5, target: { kind: 'targetCreature' } },
    {
      kind: 'destroyAttachedPermanents',
      target: { kind: 'thatCreature' },
      filter: { subtypes: ['Equipment'] },
    },
  ],
} as unknown as CardInput);

const SURVIVOR = creature('Slag Survivor', 2, 8);
const LETHAL_TARGET = creature('Slag Lethal Target', 2, 4);
const OTHER = creature('Slag Other Creature', 2, 8);

function equipment(name: string, indestructible = false): Card {
  return parseCard({
    kind: 'artifact',
    id: `slag-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: name.length },
    manaCost: { generic: 1 },
    subtypes: ['Equipment'],
    ...(indestructible ? { keywordAbilities: [{ kind: 'indestructible' as const }] } : {}),
  });
}

const FIRST_EQUIPMENT = equipment('First Equipment');
const SECOND_EQUIPMENT = equipment('Second Equipment');
const INDESTRUCTIBLE_EQUIPMENT = equipment('Indestructible Equipment', true);
const REGENERATING_EQUIPMENT = equipment('Regenerating Equipment');
const NON_EQUIPMENT: Card = parseCard({
  kind: 'artifact',
  id: 'slag-control-relic',
  name: 'Slag Control Relic',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 99 },
  manaCost: { generic: 1 },
});

function lands(count: number): readonly { card: Card; controller: 0 }[] {
  return Array.from({ length: count }, () => ({ card: MOUNTAIN, controller: 0 as const }));
}

function attach(state: GameState, attachment: ObjectId, host: ObjectId): GameState {
  const object = state.objects[attachment];
  if (object === undefined) throw new Error(`missing attachment ${attachment}`);
  return {
    ...state,
    objects: { ...state.objects, [attachment]: { ...object, attachedTo: host } },
  };
}

function resolveStack(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 20 && current.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error(`resolution paused at ${decision?.kind ?? 'nothing'}`);
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  if (current.state.stack.length > 0) throw new Error('Turn to Slag did not resolve');
  return current;
}

function castAt(state: GameState, target: ObjectId): ReduceResult {
  return reduce(state, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(state, 0, TURN_TO_SLAG.name),
    targets: [{ kind: 'permanent', oid: target }, null],
  });
}

function zone(state: GameState, oid: ObjectId): string | undefined {
  return state.objects[oid]?.zone;
}

describe('Turn to Slag', () => {
  it('destroys every attached Equipment and no attached non-Equipment', () => {
    const opened = scenario({
      battlefield: [
        ...lands(5),
        { card: SURVIVOR, controller: 1 },
        { card: FIRST_EQUIPMENT, controller: 1 },
        { card: SECOND_EQUIPMENT, controller: 1 },
        { card: NON_EQUIPMENT, controller: 1 },
      ],
      hands: [[TURN_TO_SLAG], []],
    });
    const victim = oidOf(opened.state, SURVIVOR.name);
    const first = oidOf(opened.state, FIRST_EQUIPMENT.name);
    const second = oidOf(opened.state, SECOND_EQUIPMENT.name);
    const nonEquipment = oidOf(opened.state, NON_EQUIPMENT.name);
    const attached = attach(
      attach(attach(opened.state, first, victim), second, victim),
      nonEquipment,
      victim,
    );
    const after = resolveStack(castAt(attached, victim));

    expect(after.state.objects[victim]?.damage).toBe(5);
    expect(zone(after.state, first)).toBe('graveyard');
    expect(zone(after.state, second)).toBe('graveyard');
    expect(zone(after.state, nonEquipment)).toBe('battlefield');
  });

  it('finds Equipment before state-based actions remove a lethally damaged host', () => {
    const opened = scenario({
      battlefield: [
        ...lands(5),
        { card: LETHAL_TARGET, controller: 1 },
        { card: FIRST_EQUIPMENT, controller: 1 },
      ],
      hands: [[TURN_TO_SLAG], []],
    });
    const victim = oidOf(opened.state, LETHAL_TARGET.name);
    const weapon = oidOf(opened.state, FIRST_EQUIPMENT.name);
    const after = resolveStack(castAt(attach(opened.state, weapon, victim), victim));

    expect(zone(after.state, victim)).toBe('graveyard');
    expect(zone(after.state, weapon)).toBe('graveyard');
  });

  it('queries attachment relationships at resolution rather than announcement', () => {
    const opened = scenario({
      battlefield: [
        ...lands(5),
        { card: SURVIVOR, controller: 1 },
        { card: OTHER, controller: 1 },
        { card: FIRST_EQUIPMENT, controller: 1 },
        { card: SECOND_EQUIPMENT, controller: 1 },
      ],
      hands: [[TURN_TO_SLAG], []],
    });
    const victim = oidOf(opened.state, SURVIVOR.name);
    const other = oidOf(opened.state, OTHER.name);
    const movedAway = oidOf(opened.state, FIRST_EQUIPMENT.name);
    const movedOnto = oidOf(opened.state, SECOND_EQUIPMENT.name);
    const cast = castAt(attach(opened.state, movedAway, victim), victim);
    const changed: ReduceResult = {
      state: attach(attach(cast.state, movedAway, other), movedOnto, victim),
      events: cast.events,
    };
    const after = resolveStack(changed);

    expect(zone(after.state, movedAway)).toBe('battlefield');
    expect(after.state.objects[movedAway]?.attachedTo).toBe(other);
    expect(zone(after.state, movedOnto)).toBe('graveyard');
  });

  it('uses ordinary destruction so indestructible and regeneration still apply', () => {
    const opened = scenario({
      battlefield: [
        ...lands(5),
        { card: SURVIVOR, controller: 1 },
        { card: INDESTRUCTIBLE_EQUIPMENT, controller: 1 },
        { card: REGENERATING_EQUIPMENT, controller: 1 },
        { card: FIRST_EQUIPMENT, controller: 1 },
      ],
      hands: [[TURN_TO_SLAG], []],
    });
    const victim = oidOf(opened.state, SURVIVOR.name);
    const indestructible = oidOf(opened.state, INDESTRUCTIBLE_EQUIPMENT.name);
    const regenerating = oidOf(opened.state, REGENERATING_EQUIPMENT.name);
    const ordinary = oidOf(opened.state, FIRST_EQUIPMENT.name);
    const attached = attach(
      attach(attach(opened.state, indestructible, victim), regenerating, victim),
      ordinary,
      victim,
    );
    const cast = castAt(attached, victim);
    const shielded = createRegenerationShield(beginTrace(cast.state), regenerating, 1);
    const after = resolveStack({ state: shielded.state, events: cast.events });

    expect(zone(after.state, indestructible)).toBe('battlefield');
    expect(zone(after.state, regenerating)).toBe('battlefield');
    expect(after.state.objects[regenerating]?.tapped).toBe(true);
    expect(zone(after.state, ordinary)).toBe('graveyard');
  });

  it('fizzles when its only target is illegal and leaves Equipment alone', () => {
    const opened = scenario({
      battlefield: [...lands(5), { card: SURVIVOR, controller: 1 }, { card: FIRST_EQUIPMENT, controller: 1 }],
      hands: [[TURN_TO_SLAG], []],
    });
    const victim = oidOf(opened.state, SURVIVOR.name);
    const weapon = oidOf(opened.state, FIRST_EQUIPMENT.name);
    const cast = castAt(attach(opened.state, weapon, victim), victim);
    const removed = moveObject(beginTrace(cast.state), victim, 'graveyard');
    const after = resolveStack({ state: removed.state, events: cast.events });

    expect(zone(after.state, weapon)).toBe('battlefield');
  });
});

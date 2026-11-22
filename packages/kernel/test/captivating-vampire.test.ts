/** Captivating Vampire: pay with five bodies now, keep two independent layers later. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  characteristicsOf,
  controllerOf,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  powerOf,
  reduce,
  sameAction,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import {
  controlledBy as controlChange,
  copies,
  onlyObject,
  retype,
  withContinuous,
} from './continuous-helpers';
import { artifact, creature, FOREST } from './cards';
import { oidOf } from './helpers';

const CAPTIVATING_VAMPIRE_INPUT = {
  kind: 'creature',
  id: 'm11-87',
  name: 'Captivating Vampire',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 87 },
  colors: ['B'],
  manaCost: { generic: 1, B: 2 },
  subtypes: ['Vampire'],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: 'Vampire',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
    {
      kind: 'activated',
      cost: { mana: {}, tapMatching: { count: 5, filter: { subtypes: ['Vampire'] } } },
      effects: [
        { kind: 'gainControl', target: { kind: 'targetCreature' } },
        {
          kind: 'addSubtype',
          subtype: 'Vampire',
          target: { kind: 'thatCreature' },
        },
      ],
    },
  ],
} as const;

const CAPTIVATING = parseCard(CAPTIVATING_VAMPIRE_INPUT);
const TARGET = creature('Target Bear', 2, 2, { subtypes: ['Bear'] });
const SECOND_TARGET = creature('Second Target', 3, 3, { subtypes: ['Warrior'] });

type TapActivation = Extract<Action, { readonly type: 'activateAbility' }> & {
  readonly taps?: readonly ObjectId[];
};

function vampire(name: string): Card {
  return creature(name, 1, 1, { subtypes: ['Vampire'] });
}

function apply(current: ReduceResult, action: Action): ReduceResult {
  const next = reduce(current.state, action);
  return { state: next.state, events: [...current.events, ...next.events] };
}

function activations(state: GameState, source: ObjectId): readonly TapActivation[] {
  return legalActions(state).filter(
    (action): action is Extract<Action, { readonly type: 'activateAbility' }> =>
      action.type === 'activateAbility' && action.oid === source,
  ) as readonly TapActivation[];
}

function aimedAt(state: GameState, source: ObjectId, target: ObjectId): TapActivation {
  const action = activations(state, source).find(
    (candidate) => candidate.targets[0]?.kind === 'permanent' && candidate.targets[0].oid === target,
  );
  if (action === undefined) throw new Error('Captivating Vampire did not offer the expected activation');
  return action;
}

function resolveTop(current: ReduceResult): ReduceResult {
  let next = current;
  for (let guard = 0; guard < 4 && next.state.stack.length > 0; guard += 1) {
    const decision = pendingDecision(next.state);
    if (decision?.kind !== 'priority') throw new Error('ability lost priority while resolving');
    next = apply(next, { type: 'passPriority', player: decision.player });
  }
  return next;
}

function cohortBoard(): ReduceResult {
  return scenario({
    battlefield: [
      { card: CAPTIVATING, controller: 0, summoningSick: true },
      { card: vampire('Vampire One'), controller: 0, summoningSick: true },
      { card: vampire('Vampire Two'), controller: 0 },
      { card: vampire('Vampire Three'), controller: 0 },
      { card: vampire('Vampire Four'), controller: 0 },
      { card: vampire('Tapped Vampire'), controller: 0, tapped: true },
      { card: vampire('Enemy Vampire'), controller: 1 },
      { card: TARGET, controller: 1 },
      { card: SECOND_TARGET, controller: 1 },
    ],
  });
}

describe('a matching cohort tap activation cost', () => {
  it('uses five distinct untapped Vampires controlled by the activator, including sick creatures and the source', () => {
    const start = cohortBoard();
    const source = oidOf(start.state, CAPTIVATING.name);
    const target = oidOf(start.state, TARGET.name);
    const action = aimedAt(start.state, source, target);
    const names = (action.taps ?? []).map((oid) => start.state.objects[oid]?.card.name).sort();

    expect(names).toEqual(
      [CAPTIVATING.name, 'Vampire One', 'Vampire Two', 'Vampire Three', 'Vampire Four'].sort(),
    );
    expect(names).not.toContain('Tapped Vampire');
    expect(names).not.toContain('Enemy Vampire');
    expect(
      sameAction(action as Action, { ...action, taps: [...(action.taps ?? [])].reverse() } as Action),
    ).toBe(true);
  });

  it('refuses duplicates, tapped permanents, opponents permanents, and a missing payment without changing the input state', () => {
    const start = cohortBoard();
    const source = oidOf(start.state, CAPTIVATING.name);
    const target = oidOf(start.state, TARGET.name);
    const valid = aimedAt(start.state, source, target);
    const [first] = valid.taps ?? [];
    if (first === undefined) throw new Error('the activation carried no tap payment');
    const tapped = oidOf(start.state, 'Tapped Vampire');
    const enemy = oidOf(start.state, 'Enemy Vampire');
    const replacement = (oid: ObjectId): TapActivation => ({
      ...valid,
      taps: [first, ...(valid.taps ?? []).slice(1, 4), oid],
    });

    expect(validateAction(start.state, { ...valid, taps: [] } as Action)).toContain('taps 5');
    expect(validateAction(start.state, replacement(first) as Action)).toContain('offered twice');
    expect(validateAction(start.state, replacement(tapped) as Action)).toContain('untapped');
    expect(validateAction(start.state, replacement(enemy) as Action)).toContain('you control');
    expect(() => reduce(start.state, replacement(tapped) as Action)).toThrow();
    for (const oid of valid.taps ?? []) expect(start.state.objects[oid]?.tapped).toBe(false);
  });

  it('reads current layer-4 characteristics when it enumerates the cohort', () => {
    const short = scenario({
      battlefield: [
        { card: CAPTIVATING, controller: 0 },
        { card: vampire('Layer Vampire One'), controller: 0 },
        { card: vampire('Layer Vampire Two'), controller: 0 },
        { card: vampire('Layer Vampire Three'), controller: 0 },
        { card: creature('Layer Bear', 2, 2), controller: 0 },
        { card: TARGET, controller: 1 },
      ],
    });
    const source = oidOf(short.state, CAPTIVATING.name);
    const target = oidOf(short.state, TARGET.name);
    expect(activations(short.state, source)).toEqual([]);

    const bear = oidOf(short.state, 'Layer Bear');
    const changed = withContinuous(short.state, [retype(onlyObject(bear), { addSubtypes: ['Vampire'] })]);
    expect(aimedAt(changed, source, target).taps).toContain(bear);
  });

  it('lets a layer-1 copy of the source activate the copied ability and pay as a Vampire', () => {
    const opened = scenario({
      battlefield: [
        { card: CAPTIVATING, controller: 0 },
        { card: vampire('Copy Kin One'), controller: 0 },
        { card: vampire('Copy Kin Two'), controller: 0 },
        { card: vampire('Copy Kin Three'), controller: 0 },
        { card: creature('Copy Candidate', 1, 1), controller: 0 },
        { card: TARGET, controller: 1 },
      ],
    });
    const printed = oidOf(opened.state, CAPTIVATING.name);
    const copy = oidOf(opened.state, 'Copy Candidate');
    const target = oidOf(opened.state, TARGET.name);
    const copied = withContinuous(opened.state, [copies(onlyObject(copy), printed)]);
    const action = aimedAt(copied, copy, target);

    expect(action.taps).toContain(copy);
    expect(action.taps).toHaveLength(5);
    const resolved = resolveTop({ state: reduce(copied, action as Action).state, events: [] });
    expect(controllerOf(resolved.state, target)).toBe(0);
    expect(characteristicsOf(resolved.state, target).subtypes).toEqual(['Bear', 'Vampire']);
  });

  it('does not spend a chosen cohort permanent again while auto-paying mana', () => {
    const sourceCard = artifact('Cohort Reservoir', {}, [
      {
        kind: 'activated',
        cost: {
          mana: { generic: 1 },
          tapMatching: { count: 1, filter: { cardTypes: ['land'] } },
        },
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      },
    ]);
    const short = scenario({
      battlefield: [
        { card: sourceCard, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
    });
    expect(activations(short.state, oidOf(short.state, sourceCard.name))).toEqual([]);

    const payable = scenario({
      battlefield: [
        { card: sourceCard, controller: 0 },
        { card: FOREST, controller: 0 },
        { card: FOREST, controller: 0 },
      ],
    });
    const options = activations(payable.state, oidOf(payable.state, sourceCard.name));
    expect(options).toHaveLength(2);
    const paid = reduce(payable.state, options[0] as Action);
    expect(payable.state.battlefield.filter((oid) => paid.state.objects[oid]?.tapped)).toHaveLength(2);
  });
});

describe('Captivating Vampire resolution', () => {
  it('taps the cohort before priority, then permanently controls the legal target and adds Vampire', () => {
    let current = cohortBoard();
    const source = oidOf(current.state, CAPTIVATING.name);
    const target = oidOf(current.state, TARGET.name);
    const action = aimedAt(current.state, source, target);

    const activated = reduce(current.state, action as Action);
    current = { state: activated.state, events: [...current.events, ...activated.events] };
    expect(current.state.stack).toHaveLength(1);
    for (const oid of action.taps ?? []) expect(current.state.objects[oid]?.tapped).toBe(true);
    expect(eventsOfType(activated.events, 'permanentTapped').map((event) => event.oid)).toEqual(
      [...(action.taps ?? [])].sort(),
    );
    expect(controllerOf(current.state, target)).toBe(1);

    current = resolveTop(current);
    expect(controllerOf(current.state, target)).toBe(0);
    expect(characteristicsOf(current.state, target).subtypes).toEqual(['Bear', 'Vampire']);
    // It is now another Vampire controlled beside the source, so the existing
    // static lord machinery sees the layer-4 result and applies in layer 7c.
    expect(powerOf(current.state, target)).toBe(3);
    expect(eventsOfType(current.events, 'controlEffectAdded')).toEqual([
      expect.objectContaining({ targetOid: target, controller: 0, layer: '2' }),
    ]);
    expect(eventsOfType(current.events, 'subtypeAdded')).toEqual([
      expect.objectContaining({ targetOid: target, subtype: 'Vampire', layer: '4' }),
    ]);
    expect(
      current.state.continuous.filter(
        (effect) =>
          effect.affects.oids?.includes(target) === true && effect.duration === 'whileSubjectRemains',
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'control', layer: '2' }),
        expect.objectContaining({ kind: 'typeChange', layer: '4', addSubtypes: ['Vampire'] }),
      ]),
    );
  });

  it('keeps the paid taps but counters the ability when its sole target leaves in response', () => {
    let current = cohortBoard();
    const source = oidOf(current.state, CAPTIVATING.name);
    const target = oidOf(current.state, TARGET.name);
    const action = aimedAt(current.state, source, target);
    current = apply(current, action as Action);
    const response = moveObject(beginTrace(current.state), target, 'hand');
    current = { state: response.state, events: [...current.events, ...response.events] };
    current = resolveTop(current);

    for (const oid of action.taps ?? []) expect(current.state.objects[oid]?.tapped).toBe(true);
    expect(eventsOfType(current.events, 'effectSkipped')).toEqual([
      expect.objectContaining({ index: 0, why: 'target is no longer legal' }),
    ]);
    expect(current.state.stack).toEqual([]);
    expect(eventsOfType(current.events, 'controlEffectAdded')).toEqual([]);
    expect(current.state.continuous.some((effect) => effect.affects.oids?.includes(target) === true)).toBe(
      false,
    );
  });

  it('resolves after its source departs and expires both grants at the target incarnation boundary', () => {
    let current = cohortBoard();
    const source = oidOf(current.state, CAPTIVATING.name);
    const target = oidOf(current.state, TARGET.name);
    current = apply(current, aimedAt(current.state, source, target) as Action);
    const response = moveObject(beginTrace(current.state), source, 'graveyard');
    current = { state: response.state, events: [...current.events, ...response.events] };
    current = resolveTop(current);

    expect(controllerOf(current.state, target)).toBe(0);
    expect(characteristicsOf(current.state, target).subtypes).toEqual(['Bear', 'Vampire']);
    expect(powerOf(current.state, target)).toBe(2);

    const left = moveObject(beginTrace(current.state), target, 'hand');
    const returned = moveObject(left, target, 'battlefield', { controller: 1 });
    expect(controllerOf(returned.state, target)).toBe(1);
    expect(characteristicsOf(returned.state, target).subtypes).toEqual(['Bear']);
  });

  it('obeys later control and type effects while surviving a later layer-1 copy', () => {
    let current = cohortBoard();
    const source = oidOf(current.state, CAPTIVATING.name);
    const target = oidOf(current.state, TARGET.name);
    const second = oidOf(current.state, SECOND_TARGET.name);
    current = resolveTop(apply(current, aimedAt(current.state, source, target) as Action));

    const copied = withContinuous(current.state, [
      copies(onlyObject(target), second, { ts: current.state.nextId + 1 }),
    ]);
    expect(characteristicsOf(copied, target).subtypes).toEqual(['Warrior', 'Vampire']);

    const earlierWipe = withContinuous(current.state, [
      retype(onlyObject(target), { removeAllSubtypes: true, addSubtypes: ['Dragon'] }, { ts: 0 }),
    ]);
    expect(characteristicsOf(earlierWipe, target).subtypes).toEqual(['Dragon', 'Vampire']);

    const later = withContinuous(current.state, [
      controlChange(onlyObject(target), 1, { ts: current.state.nextId + 2 }),
      retype(
        onlyObject(target),
        { removeAllSubtypes: true, addSubtypes: ['Dragon'] },
        { ts: current.state.nextId + 3 },
      ),
    ]);
    expect(controllerOf(later, target)).toBe(1);
    expect(characteristicsOf(later, target).subtypes).toEqual(['Dragon']);
  });
});

import { describe, expect, it } from 'vitest';
import { parseCard, type Card } from '@mtg/dsl';
import {
  counterCount,
  applyDamage,
  beginTrace,
  controllerOf,
  eventsOfType,
  legalActions,
  pendingDecision,
  moveObject,
  resolveTop,
  spellCardByOid,
  onlyObject,
  reduce,
  scenario,
  settle,
  validateAction,
} from '@mtg/kernel';
import { creature, instant, MOUNTAIN } from './cards';
import {
  controlledBy,
  copies,
  damageToPermanent,
  replacement,
  withContinuous,
  withReplacements,
} from './continuous-helpers';
import { apply, oidOf } from './helpers';
import { counterStackEntry } from '../src/counter';

function battle(name = 'Open Front', defense = 4): Card {
  return parseCard({
    kind: 'battle',
    id: `tst-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: defense },
    manaCost: { generic: 2, R: 1 },
    colors: ['R'],
    defense,
  });
}

function siege(name = 'Invasion of Tests', defense = 2): Card {
  return parseCard({
    kind: 'battle',
    id: `tst-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: defense + 20 },
    manaCost: { generic: 2, R: 1 },
    colors: ['R'],
    subtypes: ['Siege'],
    defense,
    backFace: {
      kind: 'creature',
      name: 'Victorious Test',
      colors: ['R'],
      subtypes: ['Warrior'],
      keywords: ['haste'],
      power: 4,
      toughness: 4,
    },
  });
}

function defense(state: ReturnType<typeof scenario>['state'], oid: string): number {
  const object = state.objects[oid];
  if (object === undefined) throw new Error(`missing ${oid}`);
  return counterCount(object.counters, 'defense');
}

describe('non-Siege Battle core', () => {
  it('enters with printed defense and persists its controller as protector', () => {
    const card = battle();
    const start = scenario({ battlefield: [{ card, controller: 0 }] });
    const oid = oidOf(start.state, card.name);
    expect(defense(start.state, oid)).toBe(4);
    expect(start.state.objects[oid]?.protector).toBe(0);
  });

  it('is a legal single any-target recipient and loses defense rather than marking damage', () => {
    const bolt = instant('Battle Bolt', [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }]);
    const card = battle();
    const start = scenario({
      battlefield: [
        { card, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[bolt], []],
    });
    const target = oidOf(start.state, card.name);
    const cast = legalActions(start.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === target,
    );
    expect(cast).toBeDefined();
    if (cast === undefined) return;
    let current = apply(start, cast);
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    expect(defense(current.state, target)).toBe(2);
    expect(current.state.objects[target]?.damage).toBe(0);
    expect(eventsOfType(current.events, 'countersChanged').at(-1)?.defense).toBe(2);
  });

  it('moves a zero-defense non-Siege Battle to its owner graveyard', () => {
    const card = battle('Brief Front', 2);
    const bolt = instant('Exact Bolt', [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }]);
    const start = scenario({
      battlefield: [
        { card, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[bolt], []],
    });
    const target = oidOf(start.state, card.name);
    const cast = legalActions(start.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === target,
    );
    if (cast === undefined) throw new Error('missing Battle target');
    let current = apply(start, cast);
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    expect(current.state.objects[target]?.zone).toBe('graveyard');
  });

  it('can be attacked only by a player whose opponent protects it', () => {
    const card = battle();
    const start = scenario({
      battlefield: [
        { card: creature('Attacker', 2, 2), controller: 0 },
        { card, controller: 1 },
      ],
      step: 'declareAttackers',
    });
    const attacker = oidOf(start.state, 'Attacker');
    const target = oidOf(start.state, card.name);
    const decision = pendingDecision(start.state);
    expect(decision?.kind).toBe('declareAttackers');
    if (decision?.kind !== 'declareAttackers') return;
    const attack = decision.options.find(
      (option) =>
        option.type === 'declareAttackers' &&
        option.attackers.some(
          (entry) =>
            entry.oid === attacker &&
            typeof entry.defender !== 'number' &&
            entry.defender.kind === 'battle' &&
            entry.defender.oid === target,
        ),
    );
    expect(attack).toBeDefined();
    if (attack === undefined) return;
    expect(validateAction(start.state, attack)).toBeNull();
    const declared = reduce(start.state, attack);
    expect(eventsOfType(declared.events, 'attackersDeclared')[0]?.attacks).toEqual([
      { oid: attacker, defender: { kind: 'battle', oid: target } },
    ]);
  });

  it('keeps its chosen protector when control changes', () => {
    const card = battle();
    const opened = scenario({ battlefield: [{ card, controller: 0 }] });
    const target = oidOf(opened.state, card.name);
    const changed = withContinuous(opened.state, [controlledBy(onlyObject(target), 1)]);
    expect(controllerOf(changed, target)).toBe(1);
    expect(changed.objects[target]?.protector).toBe(0);
  });

  it('gives a newly entering copy printed defense instead of copying the source counters', () => {
    const sourceCard = battle('Copied Front', 5);
    const blank = parseCard({
      kind: 'artifact',
      id: 'tst-battle-copy',
      name: 'Battle Double',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 9 },
      manaCost: { generic: 1 },
      colors: [],
    });
    const opened = scenario({
      battlefield: [
        { card: sourceCard, controller: 0, defense: 2 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[blank], []],
    });
    const source = oidOf(opened.state, sourceCard.name);
    const copyOid = opened.state.players[0].hand.find(
      (oid) => opened.state.objects[oid]?.card.name === blank.name,
    );
    if (copyOid === undefined) throw new Error('missing copy spell');
    let current = {
      ...opened,
      state: withContinuous(opened.state, [copies(onlyObject(copyOid), source)]),
    };
    const cast = legalActions(current.state).find(
      (action) => action.type === 'castSpell' && action.oid === copyOid,
    );
    if (cast === undefined) throw new Error('missing copy cast');
    current = apply(current, cast);
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    expect(defense(current.state, source)).toBe(2);
    expect(defense(current.state, copyOid)).toBe(5);
    expect(current.state.objects[copyOid]?.protector).toBe(0);
  });
});

function defeatSiege(front = siege()): ReturnType<typeof scenario> {
  const bolt = instant('Siege Bolt', [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }]);
  let current = scenario({
    battlefield: [
      { card: front, controller: 1 },
      { card: MOUNTAIN, controller: 0 },
    ],
    hands: [[bolt], []],
  });
  const target = oidOf(current.state, front.name);
  const cast = legalActions(current.state).find(
    (action) =>
      action.type === 'castSpell' &&
      action.targets[0]?.kind === 'permanent' &&
      action.targets[0].oid === target,
  );
  if (cast === undefined) throw new Error('missing Siege target');
  current = apply(current, cast);
  current = apply(current, { type: 'passPriority', player: 0 });
  current = apply(current, { type: 'passPriority', player: 1 });
  return current;
}

describe('Siege defeat', () => {
  it('applies damage prevention before removing defense counters', () => {
    const front = siege('Protected Invasion', 2);
    const opened = scenario({ battlefield: [{ card: front, controller: 1 }] });
    const target = oidOf(opened.state, front.name);
    const shielded = withReplacements(opened.state, [
      replacement(damageToPermanent(target), { kind: 'preventDamage', amount: 1 }),
    ]);
    const damaged = applyDamage(beginTrace(shielded), [
      {
        sourceOid: 'probe-source',
        controller: 0,
        recipient: { kind: 'permanent', oid: target },
        amount: 2,
        deathtouch: false,
        lifelink: false,
        combat: false,
        preventable: true,
      },
    ]);

    expect(defense(damaged.state, target)).toBe(1);
    expect(eventsOfType(damaged.events, 'damagePrevented')[0]?.amount).toBe(1);
    expect(eventsOfType(damaged.events, 'battleDefeated')).toHaveLength(0);
  });

  it('queues one intrinsic trigger for each Siege defeated in one damage batch', () => {
    const first = siege('First Invasion', 1);
    const second = siege('Second Invasion', 1);
    const opened = scenario({
      battlefield: [
        { card: first, controller: 1 },
        { card: second, controller: 1 },
      ],
    });
    const firstOid = oidOf(opened.state, first.name);
    const secondOid = oidOf(opened.state, second.name);
    const damaged = applyDamage(
      beginTrace(opened.state),
      [firstOid, secondOid].map((oid) => ({
        sourceOid: 'probe-source',
        controller: 0 as const,
        recipient: { kind: 'permanent' as const, oid },
        amount: 1,
        deathtouch: false,
        lifelink: false,
        combat: false,
        preventable: true,
      })),
    );
    const settled = settle(damaged);

    expect(eventsOfType(settled.events, 'battleDefeated').map((event) => event.oid)).toEqual([
      firstOid,
      secondOid,
    ]);
    expect(settled.state.stack.filter((entry) => entry.siegeDefeat === true)).toHaveLength(2);
    expect([firstOid, secondOid].map((oid) => defense(settled.state, oid))).toEqual([0, 0]);
  });

  it('holds at zero defense, exiles on its intrinsic trigger, and casts its back face for free', () => {
    let current = defeatSiege();
    const target = oidOf(current.state, 'Invasion of Tests');
    expect(current.state.objects[target]?.zone).toBe('battlefield');
    expect(defense(current.state, target)).toBe(0);
    expect(current.state.objects[target]?.protector).toBe(0);
    expect(current.state.stack.at(-1)?.ability?.sourceOid).toBe(target);

    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    const decision = pendingDecision(current.state);
    expect(decision?.kind).toBe('freeCast');
    expect(current.state.objects[target]?.zone).toBe('exile');
    const cast = decision?.options.find((action) => action.type === 'castSpell');
    expect(cast).toMatchObject({ player: 1, oid: target, castingCost: 'withoutMana' });
    if (cast?.type !== 'castSpell') throw new Error('missing transformed cast');

    current = apply(current, cast);
    expect(spellCardByOid(current.state, target)?.name).toBe('Victorious Test');
    const firstPriority = pendingDecision(current.state);
    if (firstPriority?.kind !== 'priority') throw new Error('transformed spell opened no response window');
    current = apply(current, { type: 'passPriority', player: firstPriority.player });
    const secondPriority = pendingDecision(current.state);
    if (secondPriority?.kind !== 'priority') throw new Error('transformed spell opened only one response');
    current = apply(current, { type: 'passPriority', player: secondPriority.player });

    expect(current.state.objects[target]?.zone).toBe('battlefield');
    expect(current.state.objects[target]?.faceCard?.name).toBe('Victorious Test');
  });

  it('lets the controller decline the transformed cast and leaves the physical card in exile', () => {
    let current = defeatSiege();
    const target = oidOf(current.state, 'Invasion of Tests');
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'freeCast') throw new Error('Siege cast was not offered');
    const decline = decision.options.find((action) => action.type === 'declineFreeCast');
    if (decline?.type !== 'declineFreeCast') throw new Error('Siege decline was not offered');
    current = apply(current, decline);

    expect(current.state.objects[target]?.zone).toBe('exile');
    expect(current.state.pendingFreeCast).toBeUndefined();
  });

  it('uses the transformed face when checking whether the back-face spell can be countered', () => {
    const base = siege('Unstoppable Invasion');
    if (base.kind !== 'battle' || base.backFace === undefined) throw new Error('missing Siege back face');
    const front = parseCard({
      ...base,
      backFace: { ...base.backFace, cannotBeCountered: true },
    });
    let current = defeatSiege(front);
    const target = oidOf(current.state, front.name);
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'freeCast') throw new Error('Siege cast was not offered');
    const cast = decision.options.find((action) => action.type === 'castSpell');
    if (cast?.type !== 'castSpell') throw new Error('missing transformed cast');
    current = apply(current, cast);

    const countered = counterStackEntry(beginTrace(current.state), target, 'probe-counter');
    expect(countered.state.stack.some((entry) => entry.oid === target)).toBe(true);
    expect(eventsOfType(countered.events, 'spellCountered')).toHaveLength(0);
  });

  it('clears the defeat marker when the intrinsic trigger is countered so SBAs bury the Siege', () => {
    const current = defeatSiege();
    const target = oidOf(current.state, 'Invasion of Tests');
    const trigger = current.state.stack.at(-1)?.oid;
    if (trigger === undefined) throw new Error('missing Siege trigger');
    const countered = counterStackEntry(beginTrace(current.state), trigger, 'probe-counter');
    const settled = settle(countered);

    expect(eventsOfType(settled.events, 'abilityCountered')).toHaveLength(1);
    expect(settled.state.objects[target]?.zone).toBe('graveyard');
  });

  it('does not exile a later incarnation after the defeated Siege leaves before resolution', () => {
    const current = defeatSiege();
    const target = oidOf(current.state, 'Invasion of Tests');
    const left = moveObject(beginTrace(current.state), target, 'exile');
    const returned = moveObject(left, target, 'battlefield', { controller: 1 });
    const resolved = resolveTop(returned);

    expect(resolved.state.objects[target]?.zone).toBe('battlefield');
    expect(defense(resolved.state, target)).toBe(2);
    expect(resolved.state.pendingFreeCast).toBeUndefined();
  });

  it('exiles a copied Siege but cannot cast a back face the physical card does not have', () => {
    const front = siege('Copied Invasion', 1);
    const shell = parseCard({
      kind: 'artifact',
      id: 'tst-siege-copy-shell',
      name: 'Copy Shell',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 44 },
      manaCost: { generic: 1 },
      colors: [],
    });
    const bolt = instant('Copy Siege Bolt', [
      { kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } },
    ]);
    const opened = scenario({
      battlefield: [
        { card: shell, controller: 1 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[bolt], []],
    });
    const copy = oidOf(opened.state, shell.name);
    let current = {
      ...opened,
      state: {
        ...opened.state,
        objects: {
          ...opened.state.objects,
          [copy]: {
            ...opened.state.objects[copy]!,
            copiableCard: front,
            protector: 0 as const,
            counters: { plusOnePlusOne: 0, minusOneMinusOne: 0, defense: 1 },
          },
        },
      },
    };
    const cast = legalActions(current.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === copy,
    );
    if (cast === undefined) throw new Error('missing copied Siege target');
    current = apply(current, cast);
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });
    current = apply(current, { type: 'passPriority', player: 0 });
    current = apply(current, { type: 'passPriority', player: 1 });

    expect(current.state.objects[copy]?.zone).toBe('exile');
    expect(current.state.pendingFreeCast).toBeUndefined();
  });

  it('triggers defeat when an activation cost removes the last defense counter', () => {
    const front = parseCard({
      ...(siege('Counter-Fed Invasion', 1) as Extract<Card, { kind: 'battle' }>),
      abilities: [
        {
          kind: 'activated',
          cost: { mana: {}, removeCounter: { counter: 'defense', count: 1 } },
          effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const opened = scenario({ battlefield: [{ card: front, controller: 0 }] });
    const source = oidOf(opened.state, front.name);
    const activation = legalActions(opened.state).find(
      (action) => action.type === 'activateAbility' && action.oid === source,
    );
    if (activation?.type !== 'activateAbility') throw new Error('missing defense-cost activation');
    const activated = apply(opened, activation);

    expect(defense(activated.state, source)).toBe(0);
    expect(eventsOfType(activated.events, 'battleDefeated')).toHaveLength(1);
    expect(activated.state.objects[source]?.zone).toBe('battlefield');
    expect(activated.state.stack.some((entry) => entry.siegeDefeat === true)).toBe(true);
  });
});

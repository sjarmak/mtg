/** Resolution-time target replacement and non-cast spell copying. */
import { describe, expect, it } from 'vitest';
import { parseCard, type AbilityInput } from '@mtg/dsl';
import type { Action, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  copySpellOnStack,
  eventsOfType,
  legalActions,
  pendingDecision,
  scenario,
  validateAction,
} from '@mtg/kernel';
import { changeSpellTargetsOnStack } from '../src/stack-spell-targets';
import { creature, instant, ISLAND, lands, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const REDIRECT = instant('Redirect', [{ kind: 'changeSpellTargets' }], { U: 2 });
const REVERBERATE = instant(
  'Reverberate',
  [{ kind: 'copySpell', spellFilter: { cardTypes: ['instant', 'sorcery'] } }],
  { R: 2 },
);
const SPARK = instant('Forked Spark', [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }], {});
const GEYSER = instant(
  'Variable Geyser',
  [{ kind: 'dealDamage', amount: { kind: 'chosenX' }, target: { kind: 'anyTarget' } }],
  { R: 1, hasX: true },
);
const CANCEL = instant('Cancel the Redirected Spell', [{ kind: 'counterSpell' }], { U: 3 });
const MANY_TARGETS = instant(
  'Many Targets',
  [{ kind: 'tapPermanent', target: { kind: 'targetCreature', count: 2 } }],
  {},
);
const SACRIFICE_WHEN_TARGETED: AbilityInput = {
  kind: 'triggered',
  condition: 'selfBecomesTarget',
  effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfCreature' } }],
};
const AURA = parseCard({
  kind: 'enchantment',
  id: 'redirect-aura',
  name: 'Redirect Aura',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 901 },
  manaCost: {},
  colors: [],
  subtypes: ['Aura'],
  aura: { enchant: 'creature', modifications: [{ kind: 'statBonus', power: 1, toughness: 1 }] },
});

function pass(from: ReduceResult): ReduceResult {
  const decision = pendingDecision(from.state);
  if (decision?.kind !== 'priority') throw new Error('priority is not available');
  return apply(from, { type: 'passPriority', player: decision.player });
}

function resolveTop(from: ReduceResult): ReduceResult {
  return pass(pass(from));
}

function replacementAction(from: ReduceResult, playerTarget: 0 | 1): Action {
  const decision = pendingDecision(from.state) as {
    readonly kind: 'spellTargets';
    readonly options: readonly Action[];
  } | null;
  if (decision?.kind !== 'spellTargets') throw new Error('no spell is choosing new targets');
  const action = decision.options.find(
    (option) =>
      option.type === 'chooseSpellTargets' &&
      'targets' in option &&
      option.targets[0]?.kind === 'player' &&
      option.targets[0].player === playerTarget,
  );
  if (action === undefined) throw new Error('the requested replacement target was not offered');
  return action;
}

describe('Redirect', () => {
  it('can target a spell on the stack and replace any legal subset of its targets', () => {
    const start = scenario({
      battlefield: lands(ISLAND, 2).map((card) => ({ card, controller: 0 as const })),
      hands: [[SPARK, REDIRECT], []],
    });
    const spark = handOidOf(start.state, 0, SPARK.name);
    const redirected = handOidOf(start.state, 0, REDIRECT.name);
    let current = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: spark,
      targets: [{ kind: 'player', player: 0 }],
    });

    const offered = legalActions(current.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.oid === redirected &&
        action.targets[0]?.kind === 'spell' &&
        action.targets[0].oid === spark,
    );
    expect(offered).toBeDefined();
    if (offered === undefined || offered.type !== 'castSpell') return;

    current = apply(current, offered);
    current = resolveTop(current);
    expect(pendingDecision(current.state)).toMatchObject({ kind: 'spellTargets', player: 0, oid: spark });
    expect(
      validateAction(current.state, {
        type: 'chooseSpellTargets',
        player: 0,
        oid: spark,
        targets: [],
      }),
    ).toBe('a target change cannot alter the number of target slots');
    expect(
      validateAction(current.state, {
        type: 'chooseSpellTargets',
        player: 0,
        oid: spark,
        targets: [{ kind: 'spell', oid: spark }],
      }),
    ).toBe('replacement target 0 is not legal for that spell');

    current = apply(current, replacementAction(current, 1));
    const entry = current.state.stack.find((candidate) => candidate.oid === spark);
    expect(entry?.targets).toEqual([{ kind: 'player', player: 1 }]);

    current = resolveTop(current);
    expect(current.state.players.map((player) => player.life)).toEqual([20, 18]);
  });

  it('retargets an Aura spell using the Aura target rule rather than an effect list', () => {
    const first = creature('First Host', 2, 2);
    const second = creature('Second Host', 2, 2);
    const start = scenario({
      battlefield: [
        { card: first, controller: 0 },
        { card: second, controller: 0 },
        ...lands(ISLAND, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[AURA, REDIRECT], []],
    });
    const firstHost = oidOf(start.state, first.name);
    const secondHost = oidOf(start.state, second.name);
    const aura = handOidOf(start.state, 0, AURA.name);
    let current = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: aura,
      targets: [{ kind: 'permanent', oid: firstHost }],
    });

    const redirect = handOidOf(current.state, 0, REDIRECT.name);
    const offered = legalActions(current.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.oid === redirect &&
        action.targets[0]?.kind === 'spell' &&
        action.targets[0].oid === aura,
    );
    expect(offered).toBeDefined();
    if (offered === undefined) return;
    current = apply(current, offered);
    current = resolveTop(current);
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'spellTargets') throw new Error('Redirect did not ask for Aura targets');
    const retarget = decision.options.find(
      (action) =>
        action.type === 'chooseSpellTargets' &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === secondHost,
    );
    expect(retarget).toBeDefined();
    if (retarget === undefined) return;
    current = apply(current, retarget);
    current = resolveTop(current);
    expect(current.state.objects[aura]?.attachedTo).toBe(secondHost);
  });

  it('fizzles without asking when its target spell left the stack first', () => {
    const start = scenario({
      battlefield: lands(ISLAND, 5).map((card) => ({ card, controller: 0 as const })),
      hands: [[SPARK, REDIRECT, CANCEL], []],
    });
    const spark = handOidOf(start.state, 0, SPARK.name);
    let current = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: spark,
      targets: [{ kind: 'player', player: 0 }],
    });
    const redirect = handOidOf(current.state, 0, REDIRECT.name);
    const redirectCast = legalActions(current.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.oid === redirect &&
        action.targets[0]?.kind === 'spell' &&
        action.targets[0].oid === spark,
    );
    if (redirectCast === undefined) throw new Error('Redirect was not offered');
    current = apply(current, redirectCast);
    const cancel = handOidOf(current.state, 0, CANCEL.name);
    const cancelCast = legalActions(current.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.oid === cancel &&
        action.targets[0]?.kind === 'spell' &&
        action.targets[0].oid === spark,
    );
    if (cancelCast === undefined) throw new Error('Cancel was not offered');
    current = apply(current, cancelCast);
    current = resolveTop(current);
    current = resolveTop(current);
    expect(pendingDecision(current.state)?.kind).toBe('priority');
    expect(eventsOfType(current.events, 'spellFizzled').map((event) => event.oid)).toContain(redirect);
    expect(eventsOfType(current.events, 'spellTargetsChanged')).toEqual([]);
  });

  it('does not report an old target as newly acquired when two target positions swap', () => {
    const creatures = [creature('Plural One', 1, 1), creature('Plural Two', 1, 1)];
    const twoTargets = instant(
      'Many Targets',
      [
        { kind: 'tapPermanent', target: { kind: 'targetCreature' } },
        {
          kind: 'pumpUntilEndOfTurn',
          power: 1,
          toughness: 1,
          target: { kind: 'targetCreature' },
        },
      ],
      {},
    );
    const start = scenario({
      battlefield: creatures.map((card) => ({ card, controller: 0 as const })),
      hands: [[twoTargets], []],
    });
    const oids = creatures.map((card) => oidOf(start.state, card.name));
    const original = handOidOf(start.state, 0, twoTargets.name);
    const cast = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: original,
      targets: [
        { kind: 'permanent', oid: oids[0] ?? '' },
        { kind: 'permanent', oid: oids[1] ?? '' },
      ],
    });
    const changed = changeSpellTargetsOnStack(beginTrace(cast.state), 0, original, {
      targets: [
        { kind: 'permanent', oid: oids[1] ?? '' },
        { kind: 'permanent', oid: oids[0] ?? '' },
      ],
    });

    expect(eventsOfType(changed.events, 'spellTargetsChanged')).toEqual([]);
  });
});

describe('Reverberate', () => {
  it('creates a copy controlled by its caster, preserves X, and emits no cast event for it', () => {
    const start = scenario({
      active: 1,
      battlefield: [
        ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
        ...lands(MOUNTAIN, 4).map((card) => ({ card, controller: 1 as const })),
      ],
      hands: [[REVERBERATE], [GEYSER]],
    });
    const original = handOidOf(start.state, 1, GEYSER.name);
    let current = apply(start, {
      type: 'castSpell',
      player: 1,
      oid: original,
      targets: [{ kind: 'player', player: 0 }],
      x: 3,
    });
    current = pass(current);

    const reverberate = handOidOf(current.state, 0, REVERBERATE.name);
    const offered = legalActions(current.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.oid === reverberate &&
        action.targets[0]?.kind === 'spell' &&
        action.targets[0].oid === original,
    );
    expect(offered).toBeDefined();
    if (offered === undefined || offered.type !== 'castSpell') return;
    current = apply(current, offered);
    current = resolveTop(current);

    current = apply(current, replacementAction(current, 1));
    const copy = current.state.stack.at(-1);
    expect(copy).toMatchObject({ controller: 0, x: 3, targets: [{ kind: 'player', player: 1 }] });
    expect(copy?.copiedSpell).toMatchObject({ copiedFrom: original });
    expect(eventsOfType(current.events, 'spellCast').map((event) => event.oid)).toEqual([
      original,
      reverberate,
    ]);
    expect(eventsOfType(current.events, 'spellCopied')).toHaveLength(1);

    current = resolveTop(current);
    current = resolveTop(current);
    expect(current.state.players.map((player) => player.life)).toEqual([17, 17]);
  });

  it('preserves plural target cardinality and rejects a constructed shorter tuple', () => {
    const creatures = [
      creature('Plural One', 1, 1),
      creature('Plural Two', 1, 1),
      creature('Plural Three', 1, 1),
    ];
    const start = scenario({
      battlefield: [
        ...creatures.map((card) => ({ card, controller: 0 as const })),
        ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[MANY_TARGETS, REVERBERATE], []],
    });
    const oids = creatures.map((card) => oidOf(start.state, card.name));
    const original = handOidOf(start.state, 0, MANY_TARGETS.name);
    let current = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: original,
      targets: [null],
      multiTargets: {
        0: [
          { kind: 'permanent', oid: oids[0] ?? '' },
          { kind: 'permanent', oid: oids[1] ?? '' },
        ],
      },
    });
    const reverberate = handOidOf(current.state, 0, REVERBERATE.name);
    const cast = legalActions(current.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.oid === reverberate &&
        action.targets[0]?.kind === 'spell' &&
        action.targets[0].oid === original,
    );
    if (cast === undefined) throw new Error('Reverberate was not offered');
    current = apply(current, cast);
    current = resolveTop(current);
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'spellTargets') throw new Error('the copy asked no target question');
    expect(
      validateAction(current.state, {
        type: 'chooseSpellTargets',
        player: 0,
        oid: original,
        targets: [null],
        multiTargets: { 0: [{ kind: 'permanent', oid: oids[2] ?? '' }] },
      }),
    ).toBe('a target change cannot alter target count');
    const changed = decision.options.find(
      (action) =>
        action.type === 'chooseSpellTargets' &&
        (action.multiTargets?.[0] ?? []).some(
          (target) => target.kind === 'permanent' && target.oid === oids[2],
        ),
    );
    expect(changed).toBeDefined();
    if (changed === undefined) return;
    current = apply(current, changed);
    expect(current.state.stack.at(-1)?.multiTargets?.[0]).toHaveLength(2);
  });

  it('can target and copy an existing spell copy', () => {
    const start = scenario({
      active: 1,
      battlefield: lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
      hands: [[REVERBERATE], [SPARK]],
    });
    const original = handOidOf(start.state, 1, SPARK.name);
    const cast = apply(start, {
      type: 'castSpell',
      player: 1,
      oid: original,
      targets: [{ kind: 'player', player: 1 }],
    });
    const copied = copySpellOnStack(beginTrace(cast.state), original);
    const firstCopy = copied.state.stack.at(-1)?.oid;
    if (firstCopy === undefined) throw new Error('the first copy was not created');
    let current: ReduceResult = { state: copied.state, events: [...cast.events, ...copied.events] };
    current = pass(current);
    const reverberate = handOidOf(current.state, 0, REVERBERATE.name);
    const offered = legalActions(current.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.oid === reverberate &&
        action.targets[0]?.kind === 'spell' &&
        action.targets[0].oid === firstCopy,
    );
    expect(offered).toBeDefined();
    if (offered === undefined) return;
    current = apply(current, offered);
    current = resolveTop(current);
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'spellTargets') throw new Error('the copied spell did not ask for targets');
    expect(decision.oid).toBe(firstCopy);
    const keep = decision.options.find(
      (action) => action.type === 'chooseSpellTargets' && action.oid === firstCopy,
    );
    if (keep === undefined) throw new Error('the existing copy had no legal target tuple');
    current = apply(current, keep);
    expect(current.state.stack.at(-1)?.copiedSpell?.copiedFrom).toBe(firstCopy);
  });

  it('preserves a copy target trigger through a later scry pause', () => {
    const phantom = creature('Phantom Beast', 4, 5, { abilities: [SACRIFICE_WHEN_TARGETED] });
    const copyThenScry = instant(
      'Reverberate',
      [
        { kind: 'copySpell', spellFilter: { cardTypes: ['instant', 'sorcery'] } },
        { kind: 'scry', count: 1 },
      ],
      { R: 2 },
    );
    const start = scenario({
      battlefield: [
        { card: phantom, controller: 1 },
        ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[SPARK, copyThenScry], []],
    });
    const beast = oidOf(start.state, phantom.name);
    const original = handOidOf(start.state, 0, SPARK.name);
    let current = apply(start, {
      type: 'castSpell',
      player: 0,
      oid: original,
      targets: [{ kind: 'player', player: 1 }],
    });
    const copySpell = handOidOf(current.state, 0, copyThenScry.name);
    const cast = legalActions(current.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.oid === copySpell &&
        action.targets[0]?.kind === 'spell' &&
        action.targets[0].oid === original,
    );
    if (cast === undefined) throw new Error('the copy-and-scry spell was not offered');
    current = apply(current, cast);
    current = resolveTop(current);
    const targets = pendingDecision(current.state);
    if (targets?.kind !== 'spellTargets') throw new Error('the copy did not ask for targets');
    const atBeast = targets.options.find(
      (action) =>
        action.type === 'chooseSpellTargets' &&
        action.targets[0]?.kind === 'permanent' &&
        action.targets[0].oid === beast,
    );
    if (atBeast === undefined) throw new Error('Phantom Beast was not offered as a new target');
    current = apply(current, atBeast);
    const scry = pendingDecision(current.state);
    expect(scry?.kind).toBe('scry');
    if (scry?.kind !== 'scry') return;
    const answer = scry.options[0];
    if (answer === undefined) throw new Error('the scry had no answer');
    current = apply(current, answer);
    expect(
      eventsOfType(current.events, 'abilityTriggered').filter(
        (event) => event.source === beast && event.condition === 'selfBecomesTarget',
      ),
    ).toHaveLength(1);
  });
});

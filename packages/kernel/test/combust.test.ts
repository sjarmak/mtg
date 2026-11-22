/** Native countering, prevention, replacement, and target-filter proofs for M11 Combust. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  copySpellOnStack,
  eventsOfType,
  getObject,
  pendingDecision,
  playerOf,
  reduce,
  scenario,
  targetChoicesFor,
  type DamageInstance,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { counterStackEntry } from '../src/counter';
import { ISLAND, MOUNTAIN, instant, lands } from './cards';
import { apply, handOidOf, oidOf } from './helpers';
import { damageToPermanent, damageToPlayer, replacement, withReplacements } from './continuous-helpers';

const COMBUST = parseCard({
  kind: 'instant',
  id: 'm11-130-combust-kernel',
  name: 'Combust',
  rarity: 'uncommon',
  set: { code: 'M11', collectorNumber: 130 },
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  cannotBeCountered: true,
  effects: [
    {
      kind: 'dealDamage',
      amount: 5,
      target: { kind: 'targetCreature', filter: { colors: ['W', 'U'] } },
      preventable: false,
    },
  ],
} as unknown as CardInput);

const COUNTER = instant('Combust Probe Counter', [{ kind: 'counterSpell' }], { generic: 1, U: 1 });

function coloredCreature(name: string, color: 'W' | 'U' | 'G', toughness = 6): Card {
  return parseCard({
    kind: 'creature',
    id: `combust-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: color === 'W' ? 1 : color === 'U' ? 2 : 3 },
    manaCost: { [color]: 1 },
    colors: [color],
    power: 0,
    toughness,
  });
}

const WHITE_TARGET = coloredCreature('Combust White Target', 'W');
const BLUE_TARGET = coloredCreature('Combust Blue Target', 'U', 12);
const GREEN_TARGET = coloredCreature('Combust Green Control', 'G');

const FROSTY_TARGET = parseCard({
  kind: 'creature',
  id: 'combust-frosty-target',
  name: 'Combust Frosty Target',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 4 },
  manaCost: { generic: 4, U: 2 },
  colors: ['U'],
  power: 6,
  toughness: 6,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfBecomesTargetByOpponent',
      effects: [],
      counterTriggeringSpellOrAbilityUnless: { cost: { generic: 2 } },
    },
  ],
});

function passUntilStackSettles(from: ReduceResult): ReduceResult {
  let current = from;
  for (let guard = 0; guard < 40; guard += 1) {
    if (current.state.stack.length === 0) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') {
      throw new Error(`Combust stack paused at ${decision?.kind ?? 'no decision'}`);
    }
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('Combust stack did not settle');
}

function castCombust(state: GameState, target: ObjectId): ReduceResult {
  return reduce(state, {
    type: 'castSpell',
    player: 0,
    oid: playerOf(state, 0).hand[0] ?? '',
    targets: [{ kind: 'permanent', oid: target }],
  });
}

describe("Combust's legal targets", () => {
  it('offers white and blue creatures but not a green creature', () => {
    const start = scenario({
      battlefield: [
        { card: WHITE_TARGET, controller: 1 },
        { card: BLUE_TARGET, controller: 1 },
        { card: GREEN_TARGET, controller: 1 },
      ],
      hands: [[COMBUST], []],
    });
    const choices = targetChoicesFor(start.state, COMBUST, 0, handOidOf(start.state, 0, COMBUST.name))[0];

    expect(choices).toContainEqual({ kind: 'permanent', oid: oidOf(start.state, WHITE_TARGET.name) });
    expect(choices).toContainEqual({ kind: 'permanent', oid: oidOf(start.state, BLUE_TARGET.name) });
    expect(choices).not.toContainEqual({ kind: 'permanent', oid: oidOf(start.state, GREEN_TARGET.name) });
  });
});

describe("Combust's counter prohibition", () => {
  it('survives an ordinary counterspell and resolves normally', () => {
    const start = scenario({
      battlefield: [
        ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
        ...lands(ISLAND, 2).map((card) => ({ card, controller: 1 as const })),
        { card: WHITE_TARGET, controller: 1 },
      ],
      hands: [[COMBUST], [COUNTER]],
    });
    const target = oidOf(start.state, WHITE_TARGET.name);
    const cast = castCombust(start.state, target);
    const passed = apply(cast, { type: 'passPriority', player: 0 });
    const countered = apply(passed, {
      type: 'castSpell',
      player: 1,
      oid: handOidOf(passed.state, 1, COUNTER.name),
      targets: [{ kind: 'spell', oid: handOidOf(start.state, 0, COMBUST.name) }],
    });
    const done = passUntilStackSettles(countered);

    expect(eventsOfType(done.events, 'spellCountered')).toEqual([]);
    expect(getObject(done.state, target).damage).toBe(5);
  });

  it('survives an unaffordable counter-unless trigger', () => {
    const start = scenario({
      battlefield: [
        ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
        { card: FROSTY_TARGET, controller: 1 },
      ],
      hands: [[COMBUST], []],
    });
    const target = oidOf(start.state, FROSTY_TARGET.name);
    const done = passUntilStackSettles(castCombust(start.state, target));

    expect(eventsOfType(done.events, 'spellCountered')).toEqual([]);
    expect(getObject(done.state, target).damage).toBe(5);
  });

  it('retains the prohibition on copied spells', () => {
    const start = scenario({
      battlefield: [
        ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
        { card: WHITE_TARGET, controller: 1 },
      ],
      hands: [[COMBUST], []],
    });
    const cast = castCombust(start.state, oidOf(start.state, WHITE_TARGET.name));
    const original = cast.state.stack[0]?.oid;
    if (original === undefined) throw new Error('Combust did not reach the stack');
    const copied = copySpellOnStack(beginTrace(cast.state), original);
    const copy = copied.state.stack.find((entry) => entry.copiedSpell !== undefined)?.oid;
    if (copy === undefined) throw new Error('Combust copy did not reach the stack');

    const copyAttempt = counterStackEntry(copied, copy, 'probe-counter');
    const originalAttempt = counterStackEntry(copyAttempt, original, 'probe-counter');

    expect(originalAttempt.state.stack.map((entry) => entry.oid)).toEqual([original, copy]);
    expect(eventsOfType(originalAttempt.events, 'spellCountered')).toEqual([]);
  });
});

describe("Combust's unpreventable damage", () => {
  it('uses the copied spell card as the source of ordinary damage', () => {
    const blueDamage = parseCard({
      kind: 'instant',
      id: 'copied-blue-damage',
      name: 'Copied Blue Damage',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 6 },
      manaCost: { U: 1 },
      colors: ['U'],
      effects: [
        { kind: 'scry', count: 1 },
        {
          kind: 'dealDamage',
          amount: 1,
          scope: 'allPermanents',
          scopeFilter: { cardTypes: ['creature'] },
          target: { kind: 'noTarget' },
        },
      ],
    });
    const protectedTarget = parseCard({
      kind: 'creature',
      id: 'copy-protection-target',
      name: 'Copy Protection Target',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 7 },
      manaCost: { G: 1 },
      colors: ['G'],
      power: 0,
      toughness: 6,
      keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'U' } }],
    });
    const start = scenario({
      battlefield: [
        { card: protectedTarget, controller: 1 },
        { card: ISLAND, controller: 0 },
      ],
      hands: [[blueDamage], []],
      libraries: [[protectedTarget], []],
    });
    const target = oidOf(start.state, protectedTarget.name);
    const cast = reduce(start.state, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(start.state, 0, blueDamage.name),
      targets: [null, null],
    });
    const original = cast.state.stack[0]?.oid;
    if (original === undefined) throw new Error('blue damage did not reach the stack');
    const copied = copySpellOnStack(beginTrace(cast.state), original);
    let paused = apply({ state: copied.state, events: copied.events }, { type: 'passPriority', player: 0 });
    paused = apply(paused, { type: 'passPriority', player: 1 });
    const decision = pendingDecision(paused.state);
    if (decision?.kind !== 'scry') throw new Error('the copied spell did not pause for scry');
    const answer = decision.options[0];
    if (answer === undefined) throw new Error('the copied spell offered no scry answer');
    const resolved = apply(paused, answer);

    expect(getObject(resolved.state, target).damage).toBe(0);
    expect(eventsOfType(resolved.events, 'damagePrevented')).toHaveLength(1);
  });

  it('skips prevention but still applies a damage multiplier', () => {
    const start = scenario({
      battlefield: [
        ...lands(MOUNTAIN, 2).map((card) => ({ card, controller: 0 as const })),
        { card: BLUE_TARGET, controller: 1 },
      ],
      hands: [[COMBUST], []],
    });
    const target = oidOf(start.state, BLUE_TARGET.name);
    const state = withReplacements(start.state, [
      replacement(damageToPermanent(target), { kind: 'preventDamage', amount: 'all' }, { id: 'shield' }),
      replacement(damageToPermanent(target), { kind: 'multiplyDamage', factor: 2 }, { id: 'double' }),
    ]);
    const done = passUntilStackSettles(castCombust(state, target));

    expect(getObject(done.state, target).damage).toBe(10);
    expect(eventsOfType(done.events, 'replacementApplied').map((event) => event.id)).toEqual(['double']);
    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([]);
    expect(done.state.replacements.map((effect) => effect.id)).toContain('shield');
  });

  it('bypasses protection prevention after the target was legally chosen', () => {
    const protectedTarget = parseCard({
      kind: 'creature',
      id: 'combust-protection-target',
      name: 'Combust Protection Target',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 5 },
      manaCost: { U: 1 },
      colors: ['U'],
      power: 0,
      toughness: 6,
      keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'R' } }],
    });
    const start = scenario({ battlefield: [{ card: protectedTarget, controller: 1 }] });
    const target = oidOf(start.state, protectedTarget.name);
    const dealt = applyDamage(beginTrace(start.state), [
      {
        sourceOid: 'combust-copy',
        sourceCard: COMBUST,
        controller: 0,
        recipient: { kind: 'permanent', oid: target },
        amount: 5,
        deathtouch: false,
        lifelink: false,
        combat: false,
        preventable: false,
      } satisfies DamageInstance,
    ]);

    expect(getObject(dealt.state, target).damage).toBe(5);
    expect(eventsOfType(dealt.events, 'damagePrevented')).toEqual([]);
  });

  it('leaves ordinary damage preventable', () => {
    const start = scenario({ life: [20, 20] });
    const state = withReplacements(start.state, [
      replacement(damageToPlayer(1), { kind: 'preventDamage', amount: 'all' }, { id: 'shield' }),
    ]);
    const dealt = applyDamage(beginTrace(state), [
      {
        sourceOid: 'ordinary-damage',
        controller: 0,
        recipient: { kind: 'player', player: 1 },
        amount: 5,
        deathtouch: false,
        lifelink: false,
        combat: false,
        preventable: true,
      } satisfies DamageInstance,
    ]);

    expect(dealt.state.players[1].life).toBe(20);
    expect(eventsOfType(dealt.events, 'damagePrevented')).toHaveLength(1);
  });
});

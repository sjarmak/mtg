/** Native execution for the four RTR cast-event cards. */
import { describe, expect, it } from 'vitest';
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  copySpellOnStack,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  powerOf,
  scenario,
  toughnessOf,
  type ReduceResult,
} from '@mtg/kernel';
import { instant, ISLAND, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const NO_TARGET = { kind: 'noTarget' } as const;
const SELF = { kind: 'selfCreature' } as const;
const SPELL_EFFECT = [{ kind: 'gainLife' as const, amount: 1, target: NO_TARGET }];

function castEventCard(input: Record<string, unknown>): Card {
  return parseCard(input as CardInput);
}

const GUTTERSNIPE = castEventCard({
  kind: 'creature',
  id: 'rtr-98',
  name: 'Guttersnipe',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 98 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  subtypes: ['Goblin', 'Shaman'],
  keywords: [],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'youCastInstantOrSorcery',
      effects: [{ kind: 'dealDamage', amount: 2, players: 'eachOpponent', target: NO_TARGET }],
    },
  ],
});

const LOBBER_CREW = castEventCard({
  kind: 'creature',
  id: 'rtr-99',
  name: 'Lobber Crew',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 99 },
  manaCost: { generic: 2, R: 1 },
  colors: ['R'],
  subtypes: ['Goblin', 'Warrior'],
  keywords: [],
  keywordAbilities: [{ kind: 'defender' }],
  power: 0,
  toughness: 4,
  abilities: [
    {
      kind: 'activated',
      printedSourceReference: 'thisCreature',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'dealDamage', amount: 1, players: 'eachOpponent', target: NO_TARGET }],
    },
    {
      kind: 'triggered',
      condition: 'youCastSpell',
      spellIsMulticolored: true,
      effects: [{ kind: 'untapPermanent', target: SELF }],
    },
  ],
});

const PYROCONVERGENCE = castEventCard({
  kind: 'enchantment',
  id: 'rtr-103',
  name: 'Pyroconvergence',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 103 },
  manaCost: { generic: 4, R: 1 },
  colors: ['R'],
  subtypes: [],
  abilities: [
    {
      kind: 'triggered',
      condition: 'youCastSpell',
      spellIsMulticolored: true,
      effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
    },
  ],
});

const BLISTERCOIL = castEventCard({
  kind: 'creature',
  id: 'rtr-211',
  name: 'Blistercoil Weird',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 211 },
  manaCost: { hybrid: { 'U/R': 1 } },
  colors: ['U', 'R'],
  subtypes: ['Weird'],
  keywords: [],
  power: 1,
  toughness: 1,
  abilities: [
    {
      kind: 'triggered',
      condition: 'youCastInstantOrSorcery',
      effects: [
        { kind: 'pumpUntilEndOfTurn', power: 1, toughness: 1, target: SELF },
        { kind: 'untapPermanent', target: SELF },
      ],
    },
  ],
});

function settle(start: ReduceResult, targetPlayer: 0 | 1 = 1): ReduceResult {
  let current = start;
  for (let guard = 0; guard < 60; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision === null) return current;
    if (decision.kind === 'triggerTargets') {
      const choice = decision.options.find(
        (option) =>
          option.type === 'chooseTriggerTargets' &&
          option.targets[0]?.kind === 'player' &&
          option.targets[0].player === targetPlayer,
      );
      if (choice === undefined) throw new Error('targeted cast trigger offered no requested player');
      current = apply(current, choice);
      continue;
    }
    if (decision.kind !== 'priority')
      throw new Error(`unexpected ${decision.kind} while settling cast trigger`);
    if (current.state.stack.length === 0) return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('cast-event stack did not settle');
}

function castNamed(current: ReduceResult, name: string): ReduceResult {
  return apply(current, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(current.state, 0, name),
    targets: [null],
  });
}

describe('RTR cast-event cards', () => {
  it('Guttersnipe damages the opponent after its controller casts an instant', () => {
    const spark = instant('Probe Spark', SPELL_EFFECT, { R: 1 });
    const opened = scenario({
      battlefield: [
        { card: GUTTERSNIPE, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[spark], []],
    });
    const result = settle(castNamed({ state: opened.state, events: [...opened.events] }, spark.name));
    expect(result.state.players.map((player) => player.life)).toEqual([21, 18]);
  });

  it('keeps the cast trigger when the spell is countered', () => {
    const spark = instant('Countered Probe Spark', SPELL_EFFECT, { R: 1 });
    const counter = instant('Cast Event Counter', [{ kind: 'counterSpell' }], { U: 1 });
    const opened = scenario({
      battlefield: [
        { card: GUTTERSNIPE, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
        { card: ISLAND, controller: 1 },
      ],
      hands: [[spark], [counter]],
    });
    const original = handOidOf(opened.state, 0, spark.name);
    let current = castNamed({ state: opened.state, events: [...opened.events] }, spark.name);
    current = apply(current, { type: 'passPriority', player: 0 });
    const answer = legalActions(current.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.oid === handOidOf(current.state, 1, counter.name) &&
        action.targets[0]?.kind === 'spell' &&
        action.targets[0].oid === original,
    );
    if (answer?.type !== 'castSpell') throw new Error('counterspell did not name the cast spell');
    current = settle(apply(current, answer));

    expect(current.state.players.map((player) => player.life)).toEqual([20, 18]);
    expect(current.state.objects[original]?.zone).toBe('graveyard');
  });

  it('does not trigger for a copied instant', () => {
    const spark = instant('Copied Probe Spark', SPELL_EFFECT, { R: 1 });
    const opened = scenario({
      battlefield: [
        { card: GUTTERSNIPE, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[spark], []],
    });
    const original = handOidOf(opened.state, 0, spark.name);
    const cast = castNamed({ state: opened.state, events: [...opened.events] }, spark.name);
    const copied = copySpellOnStack(beginTrace(cast.state), original);
    const result = settle({ state: copied.state, events: [...cast.events, ...copied.events] });

    expect(eventsOfType(result.events, 'spellCast')).toHaveLength(1);
    expect(eventsOfType(result.events, 'abilityTriggered')).toHaveLength(1);
    expect(result.state.players.map((player) => player.life)).toEqual([22, 18]);
  });

  it('resolves a banked cast trigger after Guttersnipe leaves', () => {
    const spark = instant('Departure Probe Spark', SPELL_EFFECT, { R: 1 });
    const opened = scenario({
      battlefield: [
        { card: GUTTERSNIPE, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[spark], []],
    });
    const source = oidOf(opened.state, GUTTERSNIPE.name);
    const cast = castNamed({ state: opened.state, events: [...opened.events] }, spark.name);
    const departed = moveObject(beginTrace(cast.state), source, 'hand');
    const result = settle({ state: departed.state, events: [...cast.events, ...departed.events] });

    expect(result.state.objects[source]?.zone).toBe('hand');
    expect(result.state.players.map((player) => player.life)).toEqual([21, 18]);
  });

  it('Lobber Crew pings, stays tapped for a monocolored cast, then untaps for a multicolored cast', () => {
    const mono = instant('Mono Probe', SPELL_EFFECT, { R: 1 });
    const multi = instant('Multicolor Probe', SPELL_EFFECT, { U: 1, R: 1 });
    const opened = scenario({
      battlefield: [
        { card: LOBBER_CREW, controller: 0 },
        ...[MOUNTAIN, MOUNTAIN, ISLAND].map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[mono, multi], []],
    });
    const oid = oidOf(opened.state, LOBBER_CREW.name);
    const activation = legalActions(opened.state).find(
      (action) => action.type === 'activateAbility' && action.oid === oid,
    );
    if (activation?.type !== 'activateAbility') throw new Error('Lobber Crew activation missing');
    let current = settle(apply({ state: opened.state, events: [...opened.events] }, activation));
    expect(current.state.objects[oid]?.tapped).toBe(true);
    expect(current.state.players[1].life).toBe(19);
    current = settle(castNamed(current, mono.name));
    expect(current.state.objects[oid]?.tapped).toBe(true);
    current = settle(castNamed(current, multi.name));
    expect(current.state.objects[oid]?.tapped).toBe(false);
  });

  it('Pyroconvergence chooses its target as the multicolored trigger is stacked', () => {
    const multi = instant('Pyro Probe', SPELL_EFFECT, { U: 1, R: 1 });
    const opened = scenario({
      battlefield: [
        { card: PYROCONVERGENCE, controller: 0 },
        { card: ISLAND, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[multi], []],
    });
    const result = settle(castNamed({ state: opened.state, events: [...opened.events] }, multi.name), 1);
    expect(result.state.players.map((player) => player.life)).toEqual([21, 18]);
  });

  it('Blistercoil Weird cumulatively pumps and untaps for successive instant casts', () => {
    const first = instant('First Probe', SPELL_EFFECT, { R: 1 });
    const second = instant('Second Probe', SPELL_EFFECT, { R: 1 });
    const opened = scenario({
      battlefield: [
        { card: BLISTERCOIL, controller: 0, tapped: true },
        { card: MOUNTAIN, controller: 0 },
        { card: MOUNTAIN, controller: 0 },
      ],
      hands: [[first, second], []],
    });
    const oid = oidOf(opened.state, BLISTERCOIL.name);
    let current = settle(castNamed({ state: opened.state, events: [...opened.events] }, first.name));
    expect([
      powerOf(current.state, oid),
      toughnessOf(current.state, oid),
      current.state.objects[oid]?.tapped,
    ]).toEqual([2, 2, false]);
    current = settle(castNamed(current, second.name));
    expect([powerOf(current.state, oid), toughnessOf(current.state, oid)]).toEqual([3, 3]);
  });
});

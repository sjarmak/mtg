/**
 * `chooseFromGraveyard`: the fourth resolution that stops to ask, and the first
 * whose question names cards both seats can already see.
 *
 * `searchLibrary` and the two discards stop for the same structural reason this
 * one does — which card leaves a zone is a judgment, and the kernel neither
 * guesses nor holds a callback — so the continuation assertions here are
 * `library.test.ts`'s: the effects printed after the pause still run, and the
 * spell still reaches its graveyard afterwards. What is new is the concealment
 * answer, and it is the opposite one: a graveyard is a public zone (CR 400.2),
 * so the pending record is *not* stripped from the seat that is not being asked
 * and the cards stay identifiable to both. A test is the only thing that keeps
 * that from being quietly "fixed" into the search's rule.
 */
import { describe, expect, it } from 'vitest';
import type { Action, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  characteristicsOf,
  controllerOf,
  eventsOfType,
  hasSubtype,
  pendingDecision,
  scenario,
  seatState,
  validateAction,
} from '@mtg/kernel';
import { creature, lands, sorcery, SWAMP } from './cards';
import { apply, handOidOf, playCombat } from './helpers';

function resolveSpell(start: ReduceResult, name: string, slots = 1): ReduceResult {
  let current = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(start.state, 0, name),
    targets: Array.from({ length: slots }, () => null),
  });
  current = apply(current, { type: 'passPriority', player: 0 });
  return apply(current, { type: 'passPriority', player: 1 });
}

const DISENTOMB = sorcery(
  'Disentomb',
  [{ kind: 'chooseFromGraveyard', whose: 'you', filter: { cardTypes: ['creature'] }, destination: 'hand' }],
  { B: 1 },
);

function graveyardScenario(spell = DISENTOMB): ReduceResult {
  return scenario({
    battlefield: lands(SWAMP, 2).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[spell], []],
    graveyards: [
      [creature('Mine', 2, 2), sorcery('Spent', [{ kind: 'shuffleLibrary' }], { U: 1 })],
      [creature('Theirs', 3, 3)],
    ],
    libraries: [[creature('Deck', 1, 1)], [creature('Their Deck', 1, 1)]],
    seed: 'graveyard/choice',
  });
}

function names(result: ReduceResult, oids: readonly ObjectId[]): readonly string[] {
  return oids.map((oid) => result.state.objects[oid]?.card.name ?? '?');
}

describe('chooseFromGraveyard', () => {
  it('offers every matching card in the named graveyard and the option to take none', () => {
    const asked = resolveSpell(graveyardScenario(), DISENTOMB.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'graveyardChoice') throw new Error('a graveyard choice was not pending');
    expect(decision.player).toBe(0);
    expect(names(asked, decision.cards)).toEqual(['Mine']);
    expect(decision.options).toEqual([
      { type: 'chooseFromGraveyard', player: 0, chosen: decision.cards[0] },
      { type: 'chooseFromGraveyard', player: 0, chosen: null },
    ]);
  });

  it('moves the chosen card to its owner hand and reports the move', () => {
    const asked = resolveSpell(graveyardScenario(), DISENTOMB.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'graveyardChoice') throw new Error('a graveyard choice was not pending');
    const chosen = decision.cards[0];
    if (chosen === undefined) throw new Error('the rig put no creature in the graveyard');

    const done = apply(asked, { type: 'chooseFromGraveyard', player: 0, chosen });

    expect(done.state.objects[chosen]?.zone).toBe('hand');
    expect(done.state.players[0].hand).toContain(chosen);
    expect(done.state.players[0].graveyard).not.toContain(chosen);
    expect(eventsOfType(done.events, 'zoneChanged').some((event) => event.oid === chosen)).toBe(true);
  });

  it('accepts taking nothing and leaves every graveyard as it was', () => {
    const asked = resolveSpell(graveyardScenario(), DISENTOMB.name);
    const before = asked.state.players[0].graveyard;
    const done = apply(asked, { type: 'chooseFromGraveyard', player: 0, chosen: null });
    // The spell itself lands in the graveyard on the way out, so the ledger
    // grows by exactly one and loses nothing.
    expect(done.state.players[0].graveyard.slice(0, before.length)).toEqual(before);
    expect(done.state.players[0].hand).toHaveLength(0);
  });

  it('does not stop at all when the graveyard holds nothing the filter matches', () => {
    const spell = sorcery(
      'Vain Recall',
      [
        {
          kind: 'chooseFromGraveyard',
          whose: 'you',
          filter: { cardTypes: ['enchantment'] },
          destination: 'hand',
        },
      ],
      { B: 1 },
    );
    const done = resolveSpell(graveyardScenario(spell), spell.name);
    expect(pendingDecision(done.state)?.kind).not.toBe('graveyardChoice');
  });

  it('reaches both graveyards when the card says a graveyard rather than yours', () => {
    const spell = sorcery(
      'Vile Rebirth',
      [
        {
          kind: 'chooseFromGraveyard',
          whose: 'each',
          filter: { cardTypes: ['creature'] },
          destination: 'exile',
        },
      ],
      { B: 1 },
    );
    const asked = resolveSpell(graveyardScenario(spell), spell.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'graveyardChoice') throw new Error('a graveyard choice was not pending');
    expect(names(asked, decision.cards)).toEqual(['Mine', 'Theirs']);

    const theirs = decision.cards[1];
    if (theirs === undefined) throw new Error('the rig put no creature across the table');
    const done = apply(asked, { type: 'chooseFromGraveyard', player: 0, chosen: theirs });
    expect(done.state.objects[theirs]?.zone).toBe('exile');
    expect(done.state.players[1].graveyard).not.toContain(theirs);
  });

  it("returns a reanimated card under its owner's control, never the caster's", () => {
    const spell = sorcery(
      'Rise Halfway',
      [
        {
          kind: 'chooseFromGraveyard',
          whose: 'each',
          filter: { cardTypes: ['creature'] },
          destination: 'battlefield',
        },
      ],
      { B: 1 },
    );
    const asked = resolveSpell(graveyardScenario(spell), spell.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'graveyardChoice') throw new Error('a graveyard choice was not pending');
    const theirs = decision.cards[1];
    if (theirs === undefined) throw new Error('the rig put no creature across the table');

    const done = apply(asked, { type: 'chooseFromGraveyard', player: 0, chosen: theirs });
    expect(done.state.objects[theirs]?.zone).toBe('battlefield');
    expect(done.state.objects[theirs]?.controller).toBe(1);
  });

  it('resumes the effects printed after the choice', () => {
    const spell = sorcery(
      'Gravedigger Errand',
      [
        {
          kind: 'chooseFromGraveyard',
          whose: 'you',
          filter: { cardTypes: ['creature'] },
          destination: 'hand',
        },
        { kind: 'gainLife', amount: 3, target: { kind: 'noTarget' } },
      ],
      { B: 1 },
    );
    const asked = resolveSpell(graveyardScenario(spell), spell.name, 2);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'graveyardChoice') throw new Error('a graveyard choice was not pending');
    const done = apply(asked, { type: 'chooseFromGraveyard', player: 0, chosen: null });
    expect(done.state.players[0].life).toBe(23);
    expect(names(done, done.state.players[0].graveyard)).toContain(spell.name);
  });

  it('refuses a card the filter misses, one in the wrong graveyard, and the wrong seat', () => {
    const asked = resolveSpell(graveyardScenario(), DISENTOMB.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'graveyardChoice') throw new Error('a graveyard choice was not pending');
    const spent = asked.state.players[0].graveyard.find(
      (oid) => asked.state.objects[oid]?.card.name === 'Spent',
    );
    const theirs = asked.state.players[1].graveyard[0];
    if (spent === undefined || theirs === undefined) throw new Error('the rig was built wrong');
    const invalid: readonly Extract<Action, { type: 'chooseFromGraveyard' }>[] = [
      { type: 'chooseFromGraveyard', player: 0, chosen: spent },
      { type: 'chooseFromGraveyard', player: 0, chosen: theirs },
      { type: 'chooseFromGraveyard', player: 1, chosen: null },
    ];
    for (const action of invalid) expect(validateAction(asked.state, action)).not.toBeNull();
  });

  it('hides nothing from the seat that is not choosing, because a graveyard is public', () => {
    const asked = resolveSpell(graveyardScenario(), DISENTOMB.name);
    const decision = pendingDecision(asked.state);
    if (decision?.kind !== 'graveyardChoice') throw new Error('a graveyard choice was not pending');
    const mine = seatState(asked.state, 0, 'chooser');
    const theirs = seatState(asked.state, 1, 'watcher');
    for (const oid of decision.cards) {
      expect(mine.objects[oid]?.card.name).toBe('Mine');
      expect(theirs.objects[oid]?.card.name).toBe('Mine');
    }
    expect(theirs.pendingGraveyardChoice?.cards).toEqual(decision.cards);
  });
});

/**
 * Rise from the Grave: the reanimation clause the effect could not print until
 * `control` existed, and the CR 613 grant that rides in with it.
 *
 * The card is "Put target creature card from a graveyard onto the battlefield
 * under your control. That creature is a black Zombie in addition to its other
 * colors and types." The half that matters is the first sentence, and a
 * controller field reading `0` is not proof of it — a field can be right while
 * the creature is still unable to do anything for the seat that spent five mana
 * on it. So the run below reanimates the *other* seat's creature and then
 * attacks that seat with it, and reads a real combat `damageDealt` off the
 * result. Every other assertion here is a step on the way to that one.
 *
 * The subject is deliberately a green Elf rather than a vanilla colorless body:
 * "in addition to its other colors and types" is a claim about what survives,
 * and a creature with nothing to keep cannot fail the way this went wrong.
 */
const THEIR_ELF = creature('Grove Elf', 3, 3, { cost: { G: 1 }, subtypes: ['Elf'] });

/** The kill spell the last case needs, so the departure is a real one. */
const MURDER = sorcery('Murder', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }], {
  generic: 1,
  B: 1,
});

const RISE_FROM_THE_GRAVE = sorcery(
  'Rise from the Grave',
  [
    {
      kind: 'chooseFromGraveyard',
      whose: 'each',
      filter: { cardTypes: ['creature'] },
      destination: 'battlefield',
      control: 'you',
      alsoBecomes: { colors: ['B'], subtypes: ['Zombie'] },
    },
  ],
  { generic: 4, B: 1 },
);

function riseScenario(spell = RISE_FROM_THE_GRAVE): ReduceResult {
  return scenario({
    battlefield: lands(SWAMP, 7).map((land) => ({ card: land, controller: 0 as const })),
    hands: [[spell, MURDER], []],
    graveyards: [[], [THEIR_ELF]],
    libraries: [[creature('Deck', 1, 1)], [creature('Their Deck', 1, 1)]],
    seed: 'graveyard/rise',
  });
}

/** Casts the spell and takes the one creature the other seat's graveyard holds. */
function reanimateTheirs(spell = RISE_FROM_THE_GRAVE): {
  readonly done: ReduceResult;
  readonly oid: ObjectId;
} {
  const asked = resolveSpell(riseScenario(spell), spell.name);
  const decision = pendingDecision(asked.state);
  if (decision?.kind !== 'graveyardChoice') throw new Error('a graveyard choice was not pending');
  const theirs = decision.cards[0];
  if (theirs === undefined) throw new Error('the rig put no creature across the table');
  return { done: apply(asked, { type: 'chooseFromGraveyard', player: 0, chosen: theirs }), oid: theirs };
}

/** Idles forward to the caster's next declare-attackers step. */
function passToNextAttack(from: ReduceResult): ReduceResult {
  const target = from.state.turn.number + 2;
  let current = from;
  for (let guard = 0; guard < 400; guard += 1) {
    const { number, step } = current.state.turn;
    if (number >= target && step === 'declareAttackers') return current;
    const decision = pendingDecision(current.state);
    if (decision === null) throw new Error('the game ended early');
    const option =
      decision.kind === 'priority'
        ? { type: 'passPriority' as const, player: decision.player }
        : decision.options[0];
    if (option === undefined) throw new Error(`no option offered for ${decision.kind}`);
    current = apply(current, option);
  }
  throw new Error('never reached the next declare-attackers step');
}

describe("chooseFromGraveyard under the chooser's control", () => {
  it("puts the other seat's creature onto the battlefield under the caster", () => {
    const { done, oid } = reanimateTheirs();
    expect(done.state.objects[oid]?.zone).toBe('battlefield');
    expect(done.state.objects[oid]?.card.name).toBe('Grove Elf');
    expect(done.state.battlefield).toContain(oid);
    expect(controllerOf(done.state, oid)).toBe(0);
    expect(done.state.players[1].graveyard).not.toContain(oid);
  });

  it('leaves the owner where it was, because control and ownership are two properties', () => {
    const { done, oid } = reanimateTheirs();
    expect(done.state.objects[oid]?.owner).toBe(1);
  });

  it('adds the color and the creature type without taking the printed ones away', () => {
    const { done, oid } = reanimateTheirs();
    const derived = characteristicsOf(done.state, oid);
    expect([...derived.colors].sort()).toEqual(['B', 'G']);
    expect(hasSubtype(done.state, oid, 'Zombie')).toBe(true);
    expect(hasSubtype(done.state, oid, 'Elf')).toBe(true);
    // The printed card is untouched. The grant is two records in the layer
    // walk, so a reader that went to the card instead of through the walk sees
    // the creature as it was printed, which is what "in addition" requires of
    // every later effect that reads it.
    expect(done.state.objects[oid]?.card.colors).toEqual(['G']);
    expect(done.state.objects[oid]?.card.subtypes).toEqual(['Elf']);
  });

  it('attacks its own owner with it, which is the only proof the control clause worked', () => {
    const { done, oid } = reanimateTheirs();
    const ready = passToNextAttack(done);
    expect(controllerOf(ready.state, oid)).toBe(0);
    const fought = playCombat(ready, { attackers: [oid], blocks: [] });
    const landed = eventsOfType(fought.events, 'damageDealt').filter(
      (event) =>
        event.sourceOid === oid &&
        event.combat &&
        event.target.kind === 'player' &&
        event.target.player === 1,
    );
    expect(landed).toHaveLength(1);
    expect(landed[0]?.amount).toBe(3);
    expect(fought.state.players[1].life).toBe(17);
  });

  it('drops the grant when the creature leaves, because what comes back is a new object', () => {
    const { done, oid } = reanimateTheirs();
    const pinned = done.state.continuous.filter((effect) => effect.duration === 'whileSubjectRemains');
    expect(pinned.map((effect) => effect.layer).sort()).toEqual(['4', '5']);
    expect(pinned.every((effect) => effect.affects.oids?.[0] === oid)).toBe(true);

    const killed = apply(done, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(done.state, 0, 'Murder'),
      targets: [{ kind: 'permanent', oid }],
    });
    const dead = apply(apply(killed, { type: 'passPriority', player: 0 }), {
      type: 'passPriority',
      player: 1,
    });
    expect(dead.state.objects[oid]?.zone).toBe('graveyard');
    // CR 108.4 again, from the other end: the creature the caster controlled
    // goes to the graveyard of the seat that owns it.
    expect(dead.state.players[1].graveyard).toContain(oid);
    expect(dead.state.continuous.filter((effect) => effect.duration === 'whileSubjectRemains')).toEqual([]);
    expect(eventsOfType(dead.events, 'continuousEffectsExpired')).not.toHaveLength(0);
  });
});

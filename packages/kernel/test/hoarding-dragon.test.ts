/** Native source-linked exile execution, including source-incarnation boundaries. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { GameState, ObjectId, ReduceResult } from '@mtg/kernel';
import {
  beginTrace,
  destroyPermanent,
  eventsOfType,
  moveObject,
  pendingDecision,
  scenario,
  settle,
} from '@mtg/kernel';
import { artifact, MOUNTAIN } from './cards';
import { apply, handOidOf, oidOf } from './helpers';

const DRAGON = parseCard({
  kind: 'creature',
  id: 'm11-144-hoarding-dragon-kernel',
  name: 'Hoarding Dragon',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 144 },
  manaCost: { generic: 3, R: 2 },
  colors: ['R'],
  subtypes: ['Dragon'],
  keywords: ['flying'],
  power: 4,
  toughness: 4,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [
        {
          kind: 'searchLibrary',
          filter: { cardTypes: ['artifact'] },
          destination: 'sourceLinkedExile',
        },
      ],
      optional: true,
    },
    {
      kind: 'triggered',
      condition: 'selfDies',
      effects: [{ kind: 'moveSourceLinkedExile', destination: 'hand' }],
      optional: true,
    },
  ],
});

const RELIC = artifact('Dragon Relic');
const DECOY = artifact('Unrelated Exile');

const LOOPING_RITE = parseCard({
  kind: 'sorcery',
  id: 'tst-looping-rite',
  name: 'Looping Rite',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 1, R: 1 },
  colors: ['R'],
  effects: [
    {
      kind: 'chooseFromGraveyard',
      whose: 'you',
      filter: { cardTypes: ['creature'] },
      destination: 'battlefield',
    },
    { kind: 'sacrificePermanent', target: { kind: 'targetPlayer' } },
    {
      kind: 'returnFromGraveyard',
      scope: 'creatureCardsInPlayerGraveyard',
      target: { kind: 'targetPlayer' },
    },
  ],
});

function passUntilChoice(start: ReduceResult, limit = 20): ReduceResult {
  let current = start;
  for (let guard = 0; guard < limit; guard += 1) {
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') return current;
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('priority did not reach a real decision');
}

function answerOptional(start: ReduceResult, accept: boolean): ReduceResult {
  const decision = pendingDecision(start.state);
  if (decision?.kind !== 'optionalTrigger') throw new Error('an optional trigger was not offered');
  return apply(start, {
    type: 'answerOptionalTrigger',
    player: decision.player,
    oid: decision.oid,
    accept,
  });
}

function acceptOptional(start: ReduceResult): ReduceResult {
  return answerOptional(start, true);
}

function passUntilAbilityOnStack(start: ReduceResult, limit = 10): ReduceResult {
  let current = start;
  for (let guard = 0; guard < limit; guard += 1) {
    const top = current.state.stack[current.state.stack.length - 1];
    if (top?.ability !== null && top?.ability !== undefined) return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') throw new Error('the spell did not resolve to a triggered ability');
    current = apply(current, { type: 'passPriority', player: decision.player });
  }
  throw new Error('the spell did not put its enters trigger on the stack');
}

function castAndLink(): {
  readonly current: ReduceResult;
  readonly dragon: ObjectId;
  readonly relic: ObjectId;
  readonly decoy: ObjectId;
} {
  const opened = scenario({
    battlefield: Array.from({ length: 5 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
    hands: [[DRAGON], []],
    libraries: [[RELIC], [DECOY]],
    active: 0,
  });
  const decoy = opened.state.players[1].library[0];
  if (decoy === undefined) throw new Error('the unrelated exile fixture disappeared');
  const prepared = settle(moveObject(beginTrace(opened.state), decoy, 'exile'));
  const cast = apply(prepared, {
    type: 'castSpell',
    player: 0,
    oid: handOidOf(opened.state, 0, DRAGON.name),
    targets: [],
  });
  const offered = passUntilChoice(cast);
  const searching = acceptOptional(offered);
  const decision = pendingDecision(searching.state);
  if (decision?.kind !== 'searchLibrary') throw new Error('the artifact search was not offered');
  const relic = decision.cards[0];
  if (relic === undefined) throw new Error('the artifact search had no artifact');
  const linked = apply(searching, { type: 'searchLibrary', player: 0, found: relic });
  return { current: linked, dragon: oidOf(linked.state, DRAGON.name), relic, decoy };
}

function killAndAccept(start: ReduceResult, dragon: ObjectId): ReduceResult {
  const killed = settle(destroyPermanent(beginTrace(start.state), dragon, 'destroyEffect'));
  const offered = passUntilChoice({ state: killed.state, events: killed.events });
  return acceptOptional(offered);
}

function zoneOf(state: GameState, oid: ObjectId): string | undefined {
  return state.objects[oid]?.zone;
}

describe('Hoarding Dragon source-linked exile', () => {
  it('exiles the searched artifact, then returns that card and no unrelated exile when the source dies', () => {
    const linked = castAndLink();
    expect(zoneOf(linked.current.state, linked.relic)).toBe('exile');

    const done = killAndAccept(linked.current, linked.dragon);
    expect(zoneOf(done.state, linked.relic)).toBe('hand');
    expect(done.state.players[0].hand).toContain(linked.relic);
    expect(done.state.exile).toContain(linked.decoy);
    expect(eventsOfType(done.events, 'zoneChanged')).toContainEqual({
      type: 'zoneChanged',
      oid: linked.relic,
      from: 'exile',
      to: 'hand',
      owner: 0,
    });
  });

  it('does nothing when the linked card left exile before the death trigger resolved', () => {
    const linked = castAndLink();
    const moved = settle(moveObject(beginTrace(linked.current.state), linked.relic, 'hand'));
    const done = killAndAccept(moved, linked.dragon);
    expect(done.state.players[0].hand.filter((oid) => oid === linked.relic)).toHaveLength(1);
  });

  it('does not recognize a new exile incarnation as the card its search exiled', () => {
    const linked = castAndLink();
    const left = moveObject(beginTrace(linked.current.state), linked.relic, 'hand');
    const reexiled = settle(moveObject(left, linked.relic, 'exile'));

    const done = killAndAccept(reexiled, linked.dragon);
    expect(zoneOf(done.state, linked.relic)).toBe('exile');
    expect(done.state.exile).toContain(linked.relic);
  });

  it('does not attach an old enters trigger to a blinked source incarnation', () => {
    const opened = scenario({
      battlefield: Array.from({ length: 5 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      hands: [[DRAGON], []],
      libraries: [[RELIC], []],
      active: 0,
    });
    const cast = apply(opened, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(opened.state, 0, DRAGON.name),
      targets: [],
    });
    const oldTrigger = passUntilAbilityOnStack(cast);
    const dragon = oidOf(oldTrigger.state, DRAGON.name);
    const left = moveObject(beginTrace(oldTrigger.state), dragon, 'hand');
    const blinked = settle(moveObject(left, dragon, 'battlefield'));

    const newOffer = passUntilChoice(blinked);
    const oldOffer = passUntilChoice(answerOptional(newOffer, false));
    const searching = acceptOptional(oldOffer);
    const search = pendingDecision(searching.state);
    if (search?.kind !== 'searchLibrary') throw new Error('the old enters trigger did not offer its search');
    const relic = search.cards[0];
    if (relic === undefined) throw new Error('the old enters trigger had no artifact to find');
    const resolved = apply(searching, { type: 'searchLibrary', player: 0, found: relic });

    expect(zoneOf(resolved.state, relic)).toBe('exile');
    expect(resolved.state.objects[dragon]?.linkedExile).toBeUndefined();

    const done = killAndAccept(resolved, dragon);
    expect(zoneOf(done.state, relic)).toBe('exile');
  });

  it('does not attach a deferred enters trigger after its source left and returned before reaching the stack', () => {
    const opened = scenario({
      battlefield: Array.from({ length: 2 }, () => ({ card: MOUNTAIN, controller: 0 as const })),
      hands: [[LOOPING_RITE], []],
      graveyards: [[DRAGON], []],
      libraries: [[RELIC], []],
      active: 0,
    });
    const cast = apply(opened, {
      type: 'castSpell',
      player: 0,
      oid: handOidOf(opened.state, 0, LOOPING_RITE.name),
      targets: [null, { kind: 'player', player: 0 }, { kind: 'player', player: 0 }],
    });
    const graveyardChoice = passUntilChoice(cast);
    const choice = pendingDecision(graveyardChoice.state);
    if (choice?.kind !== 'graveyardChoice') throw new Error('the first return did not ask for a creature');
    const dragon = choice.cards.find((oid) => graveyardChoice.state.objects[oid]?.card.name === DRAGON.name);
    if (dragon === undefined) throw new Error('the graveyard choice did not contain Hoarding Dragon');
    const returned = apply(graveyardChoice, {
      type: 'chooseFromGraveyard',
      player: choice.player,
      chosen: dragon,
    });

    const newEnter = passUntilChoice(returned);
    const death = passUntilChoice(answerOptional(newEnter, false));
    const oldEnter = passUntilChoice(answerOptional(death, false));
    const searching = acceptOptional(oldEnter);
    const search = pendingDecision(searching.state);
    if (search?.kind !== 'searchLibrary') throw new Error('the old enters trigger did not offer its search');
    const relic = search.cards[0];
    if (relic === undefined) throw new Error('the old enters trigger had no artifact to find');
    const resolved = apply(searching, { type: 'searchLibrary', player: search.player, found: relic });

    expect(zoneOf(resolved.state, relic)).toBe('exile');
    expect(resolved.state.objects[dragon]?.zone).toBe('battlefield');
    expect(resolved.state.objects[dragon]?.linkedExile).toBeUndefined();
  });
});

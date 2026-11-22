/** Rest in Peace sweeps both graveyards and replaces every later entry. */
import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  getObject,
  moveObject,
  resolveTop,
  scenario,
  settle,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { creature } from './cards';
import { handOidOf, oidOf } from './helpers';

const REST_IN_PEACE = parseCard({
  kind: 'enchantment',
  id: 'rtr-018-rest-in-peace-kernel',
  name: 'Rest in Peace',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 18 },
  manaCost: { generic: 1, W: 1 },
  colors: ['W'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisEnchantment',
      effects: [{ kind: 'exileGraveyard', whose: 'each' }],
    },
    {
      kind: 'staticPlayerRule',
      players: 'eachPlayer',
      rule: 'cardsOrTokensToGraveyardAreExiled',
    },
  ],
});

const OWN_CARD = creature('Rest in Peace Own Card', 2, 2);
const OTHER_CARD = creature('Rest in Peace Other Card', 2, 2);
const OWN_GRAVE = creature('Rest in Peace Own Grave', 1, 1);
const OTHER_GRAVE = creature('Rest in Peace Other Grave', 1, 1);
const TOKEN = creature('Rest in Peace Token', 1, 1);

function cardOid(state: GameState, id: string): ObjectId {
  const found = Object.values(state.objects).find((object) => object.card.id === id);
  if (found === undefined) throw new Error(`missing object for ${id}`);
  return found.oid;
}

describe('Rest in Peace in the kernel', () => {
  it('exiles both graveyards when its entry trigger resolves', () => {
    const start = scenario({
      hands: [[REST_IN_PEACE], []],
      graveyards: [[OWN_GRAVE], [OTHER_GRAVE]],
    }).state;
    const source = handOidOf(start, 0, REST_IN_PEACE.name);
    const entered = settle(moveObject(beginTrace(start), source, 'battlefield'));
    const resolved = resolveTop(entered);

    expect(getObject(resolved.state, cardOid(resolved.state, OWN_GRAVE.id)).zone).toBe('exile');
    expect(getObject(resolved.state, cardOid(resolved.state, OTHER_GRAVE.id)).zone).toBe('exile');
    expect(resolved.state.players.map((player) => player.graveyard)).toEqual([[], []]);
  });

  it('replaces card and token moves for both owners, then stops after source departure', () => {
    const start = scenario({
      battlefield: [
        { card: REST_IN_PEACE, controller: 0 },
        { card: TOKEN, controller: 1, token: true },
      ],
      hands: [[OWN_CARD], [OTHER_CARD]],
    }).state;
    const source = oidOf(start, REST_IN_PEACE.name);
    const token = oidOf(start, TOKEN.name);
    const own = handOidOf(start, 0, OWN_CARD.name);
    const other = handOidOf(start, 1, OTHER_CARD.name);

    let moved = moveObject(beginTrace(start), own, 'graveyard');
    moved = moveObject(moved, other, 'graveyard');
    moved = moveObject(moved, token, 'graveyard');
    expect([own, other, token].map((oid) => getObject(moved.state, oid).zone)).toEqual([
      'exile',
      'exile',
      'exile',
    ]);

    const departed = moveObject(moved, source, 'graveyard');
    expect(getObject(departed.state, source).zone).toBe('exile');
    const returned = moveObject(departed, own, 'hand');
    const afterDeparture = moveObject(returned, own, 'graveyard');
    expect(getObject(afterDeparture.state, own).zone).toBe('graveyard');
    expect(eventsOfType(afterDeparture.events, 'replacementApplied')).toHaveLength(4);
  });
});

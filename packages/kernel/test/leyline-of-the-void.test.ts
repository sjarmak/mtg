/** Live, typed CR 614 zone-change replacement for Leyline of the Void. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  getObject,
  moveObject,
  onlyObject,
  scenario,
  type GameState,
  type ObjectId,
  type Trace,
  type ZoneId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import {
  abilities,
  controlledBy,
  copies,
  replacement,
  withContinuous,
  withReplacements,
} from './continuous-helpers';
import { creature } from './cards';
import { oidOf } from './helpers';

const LEYLINE = parseCard({
  kind: 'enchantment',
  id: 'm11-101-leyline-of-the-void-kernel',
  name: 'Leyline of the Void',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 101 },
  manaCost: { generic: 2, B: 2 },
  colors: ['B'],
  openingHandAction: { kind: 'beginOnBattlefield' },
  abilities: [
    {
      kind: 'staticPlayerRule',
      players: 'eachOpponent',
      rule: 'cardsToGraveyardAreExiled',
    },
  ],
});

const BLANK = creature('Void Blank', 1, 1);
const OWN_BATTLEFIELD = creature('Void Own Battlefield', 2, 2);
const OPPONENT_BATTLEFIELD = creature('Void Opponent Battlefield', 2, 2);
const OPPONENT_TOKEN = creature('Void Opponent Token', 1, 1);
const OWN_HAND = creature('Void Own Hand', 2, 2);
const OPPONENT_HAND = creature('Void Opponent Hand', 2, 2);
const OPPONENT_LIBRARY = creature('Void Opponent Library', 2, 2);
const OPPONENT_STACK = creature('Void Opponent Stack', 2, 2);
const OPPONENT_EXILE = creature('Void Opponent Exile', 2, 2);
const OPPONENT_GRAVEYARD = creature('Void Opponent Graveyard', 2, 2);

function objectOid(state: GameState, card: Card): ObjectId {
  const matches = Object.values(state.objects).filter((object) => object.card.id === card.id);
  const first = matches[0];
  if (first === undefined) throw new Error(`no object for ${card.name}`);
  if (matches.length !== 1) throw new Error(`${matches.length} objects for ${card.name}`);
  return first.oid;
}

function expectZone(trace: Trace, card: Card, zone: ZoneId): void {
  expect(getObject(trace.state, objectOid(trace.state, card)).zone).toBe(zone);
}

function baseState(): GameState {
  return scenario({
    battlefield: [
      { card: LEYLINE, controller: 0 },
      { card: BLANK, controller: 0 },
      { card: OWN_BATTLEFIELD, controller: 0 },
      { card: OPPONENT_BATTLEFIELD, controller: 1 },
      { card: OPPONENT_TOKEN, controller: 1, token: true },
    ],
    hands: [[OWN_HAND], [OPPONENT_HAND, OPPONENT_STACK, OPPONENT_EXILE]],
    libraries: [[], [OPPONENT_LIBRARY]],
    graveyards: [[], [OPPONENT_GRAVEYARD]],
  }).state;
}

describe('Leyline of the Void in the kernel', () => {
  it('replaces opponent-owned card moves from battlefield, hand, and library but not its own cards or tokens', () => {
    let current = beginTrace(baseState());
    for (const card of [OPPONENT_BATTLEFIELD, OPPONENT_HAND, OPPONENT_LIBRARY]) {
      current = moveObject(current, objectOid(current.state, card), 'graveyard');
      expectZone(current, card, 'exile');
    }
    current = moveObject(current, objectOid(current.state, OWN_BATTLEFIELD), 'graveyard');
    current = moveObject(current, objectOid(current.state, OWN_HAND), 'graveyard');
    current = moveObject(current, objectOid(current.state, OPPONENT_TOKEN), 'graveyard');

    expectZone(current, OWN_BATTLEFIELD, 'graveyard');
    expectZone(current, OWN_HAND, 'graveyard');
    expectZone(current, OPPONENT_TOKEN, 'graveyard');
    expect(eventsOfType(current.events, 'replacementApplied').map((event) => event.event)).toEqual([
      'zoneChange',
      'zoneChange',
      'zoneChange',
    ]);
  });

  it('replaces moves from the stack and exile, including a replacement that leaves the card in exile', () => {
    let current = beginTrace(baseState());
    const stackCard = objectOid(current.state, OPPONENT_STACK);
    const exileCard = objectOid(current.state, OPPONENT_EXILE);
    current = moveObject(current, stackCard, 'stack');
    current = moveObject(current, stackCard, 'graveyard');
    expectZone(current, OPPONENT_STACK, 'exile');

    current = moveObject(current, exileCard, 'exile');
    const mark = current.events.length;
    current = moveObject(current, exileCard, 'graveyard');
    expectZone(current, OPPONENT_EXILE, 'exile');
    expect(eventsOfType(current.events.slice(mark), 'replacementApplied')).toHaveLength(1);
    expect(eventsOfType(current.events.slice(mark), 'zoneChanged')).toEqual([]);
  });

  it('rechecks the Leyline after another replacement redirects a move into a graveyard', () => {
    const start = baseState();
    const card = objectOid(start, OPPONENT_HAND);
    const redirected = withReplacements(start, [
      replacement(
        {
          kind: 'zoneChange',
          owner: 1,
          from: 'hand',
          destination: 'exile',
          cardOnly: true,
        },
        { kind: 'moveToZone', destination: 'graveyard' },
        { id: 'redirect-into-graveyard', ts: -1 },
      ),
    ]);

    const moved = moveObject(beginTrace(redirected), card, 'exile');

    expectZone(moved, OPPONENT_HAND, 'exile');
    expect(eventsOfType(moved.events, 'replacementApplied').map((event) => event.id)).toEqual([
      'redirect-into-graveyard',
      expect.stringContaining('graveyard-exile'),
    ]);
  });

  it('does not invent an event when the requested destination is already the current zone', () => {
    const state = baseState();
    const unchanged = moveObject(beginTrace(state), objectOid(state, OPPONENT_GRAVEYARD), 'graveyard');

    expectZone(unchanged, OPPONENT_GRAVEYARD, 'graveyard');
    expect(unchanged.events).toEqual([]);
  });

  it('uses ownership rather than the permanent controller to select the destination graveyard', () => {
    const state = baseState();
    const theirs = objectOid(state, OPPONENT_BATTLEFIELD);
    const ours = objectOid(state, OWN_BATTLEFIELD);
    const controlled = withContinuous(state, [
      controlledBy(onlyObject(theirs), 0),
      controlledBy(onlyObject(ours), 1),
    ]);
    const first = moveObject(beginTrace(controlled), theirs, 'graveyard');
    const second = moveObject(first, ours, 'graveyard');

    expectZone(second, OPPONENT_BATTLEFIELD, 'exile');
    expectZone(second, OWN_BATTLEFIELD, 'graveyard');
  });

  it('recomputes the affected opponent through control, copy, ability loss, and departure', () => {
    const state = baseState();
    const leyline = oidOf(state, LEYLINE.name);
    const blank = oidOf(state, BLANK.name);

    const stolen = withContinuous(state, [controlledBy(onlyObject(leyline), 1)]);
    const theirCard = moveObject(beginTrace(stolen), objectOid(stolen, OPPONENT_HAND), 'graveyard');
    const ourCard = moveObject(theirCard, objectOid(theirCard.state, OWN_HAND), 'graveyard');
    expectZone(ourCard, OPPONENT_HAND, 'graveyard');
    expectZone(ourCard, OWN_HAND, 'exile');

    const copied = withContinuous(state, [
      copies(onlyObject(blank), leyline),
      abilities(onlyObject(leyline), { removeAll: true }),
    ]);
    const copiedMove = moveObject(beginTrace(copied), objectOid(copied, OPPONENT_LIBRARY), 'graveyard');
    expectZone(copiedMove, OPPONENT_LIBRARY, 'exile');

    const stripped = withContinuous(copied, [abilities(onlyObject(blank), { removeAll: true })]);
    const strippedMove = moveObject(beginTrace(stripped), objectOid(stripped, OPPONENT_LIBRARY), 'graveyard');
    expectZone(strippedMove, OPPONENT_LIBRARY, 'graveyard');

    const departed = moveObject(beginTrace(state), leyline, 'graveyard');
    const afterDeparture = moveObject(departed, objectOid(departed.state, OPPONENT_LIBRARY), 'graveyard');
    expectZone(afterDeparture, OPPONENT_LIBRARY, 'graveyard');
  });

  it('uses the source at the last possible moment and applies only one of several matching Leylines', () => {
    const stolenSource = scenario({
      battlefield: [{ card: LEYLINE, controller: 1 }],
      libraries: [[], []],
    }).state;
    const leyline = oidOf(stolenSource, LEYLINE.name);
    const controlled = withContinuous(stolenSource, [controlledBy(onlyObject(leyline), 0)]);
    const exiledSource = moveObject(beginTrace(controlled), leyline, 'graveyard');
    expectZone(exiledSource, LEYLINE, 'exile');
    expect(eventsOfType(exiledSource.events, 'replacementApplied')).toHaveLength(1);

    const doubled = scenario({
      battlefield: [
        { card: LEYLINE, controller: 0 },
        { card: LEYLINE, controller: 0 },
      ],
      hands: [[], [OPPONENT_HAND]],
      libraries: [[], []],
    }).state;
    const moved = moveObject(beginTrace(doubled), objectOid(doubled, OPPONENT_HAND), 'graveyard');
    expectZone(moved, OPPONENT_HAND, 'exile');
    expect(eventsOfType(moved.events, 'replacementApplied')).toHaveLength(1);
  });
});

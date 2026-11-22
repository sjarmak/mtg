import { expect, it } from 'vitest';
import { PROJECTION_VERSION, type ObjectView, type SeatView, type TableView } from '@mtg/engine';
import { auditSeatPayloads } from '../src/hidden-information';

const object = {
  oid: 'token',
  name: 'token',
  typeLine: 'creature',
  power: 4,
  toughness: 4,
  tapped: false,
  attacking: false,
  damage: 0,
  controller: 0,
  counters: {},
  characteristics: { colors: ['B'], manaCost: null, token: true },
} as const;

function view(publicCard: ObjectView): TableView {
  const seat = {
    id: 0 as const,
    name: 'player',
    life: 20,
    hand: [],
    handSize: 0,
    librarySize: 30,
    graveyard: [],
    exile: [],
    battlefield: [publicCard],
  };
  return {
    version: PROJECTION_VERSION,
    turn: { number: 1, active: 0, phase: 'main', step: 'main' },
    priority: 0,
    stack: [],
    seats: [seat, { ...seat, id: 1, battlefield: [] }],
  };
}

/** What seat one's view says, for the two things a view may disagree about: a card and a seat. */
function findings(publicCard: ObjectView, seatZero: Partial<SeatView> = {}) {
  const table = view(object);
  return auditSeatPayloads(
    {
      view: (viewer) => {
        const projected = view(viewer === 0 ? object : publicCard);
        return {
          ...projected,
          seats: [
            { ...projected.seats[0], ...(viewer === 0 ? {} : seatZero), hand: viewer === 0 ? [] : null },
            { ...projected.seats[1], hand: viewer === 1 ? [] : null },
          ],
        };
      },
      events: () => [],
      decision: () => null,
    },
    table,
    null,
    'opening',
    null,
    null,
  ).findings;
}

it('accepts equal public characteristics in concealed seat views', () => {
  expect(findings(object)).toEqual([]);
});

it.each([
  { colors: ['W'], manaCost: null, token: true },
  { colors: ['B'], manaCost: '{0}', token: true },
  { colors: ['B'], manaCost: null, token: false },
] as const)('detects disagreement about public characteristics: %j', (characteristics) => {
  expect(
    findings({ ...object, characteristics })
      .map((one) => one.detail)
      .join('\n'),
  ).toContain('disagrees about the public position');
});

/**
 * `keywords`, `pairedWith`, `poison` and `playerCounters` are all public, so a
 * seat's view that reports different ones is playing a different game.
 */
it.each([
  ['keywords', { keywords: ['flying'] }],
  ['pairedWith', { pairedWith: 'other' }],
] as const)("detects disagreement about a public card's %s", (_name, extra) => {
  expect(
    findings({ ...object, ...extra })
      .map((one) => one.detail)
      .join('\n'),
  ).toContain('disagrees about the public position');
});

it.each([
  ['poison', { poison: 3 }],
  ['playerCounters', { playerCounters: { ENERGY: 2 } }],
] as const)("detects disagreement about a seat's %s", (_name, seat) => {
  expect(
    findings(object, seat)
      .map((one) => one.detail)
      .join('\n'),
  ).toContain('disagrees about the public position');
});

import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { scenario } from '@mtg/kernel';
import { boardPosition } from '../../src/routes/play/position';
import { boardFrame } from '../../src/routes/replay/frame';
import type { LogSnapshot } from '../../src/routes/replay/log-schema';
import type { ReplayGameLog } from '../../src/routes/replay/read-log';

const WALKER = parseCard({
  kind: 'planeswalker',
  id: 'ui-loyalty-walker',
  name: 'Visible Arbiter',
  rarity: 'rare',
  set: { code: 'UIX', collectorNumber: 1 },
  manaCost: { generic: 3 },
  colors: [],
  supertypes: ['legendary'],
  subtypes: ['Tactician'],
  startingLoyalty: 3,
});

const EMPTY_POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } as const;

describe('planeswalker loyalty on boards', () => {
  it('projects current loyalty onto the live board', () => {
    const state = scenario({ battlefield: [{ card: WALKER, controller: 1 }] }).state;
    const permanent = boardPosition(state, 0, ['You', 'Bot']).opponent.battlefield.permanents[0];
    expect(permanent?.card.name).toBe(WALKER.name);
    expect(permanent?.loyalty).toBe(3);
  });

  it('projects recorded loyalty rather than the printed starting value onto replay', () => {
    const oid = 'o-walker';
    const game: ReplayGameLog = {
      index: 0,
      seed: 'ui/replay/loyalty',
      startingPlayer: 0,
      maximumTurns: 1,
      seats: [
        { bot: 'one', deck: 'one' },
        { bot: 'two', deck: 'two' },
      ],
      result: { winner: null, loser: null, reason: 'turnLimit', endedOnTurn: 1 },
      objects: new Map([[oid, { oid, card: WALKER, owner: 1, token: false }]]),
      steps: [],
    };
    const seat = { life: 20, hand: [], library: 0, graveyard: [], pool: EMPTY_POOL, lost: false };
    const snapshot: LogSnapshot = {
      seats: [seat, seat],
      battlefield: [
        {
          oid,
          controller: 1,
          tapped: false,
          summoningSick: false,
          damage: 0,
          plusCounters: 0,
          minusCounters: 0,
          loyalty: 2,
          power: null,
          toughness: null,
          attachedTo: null,
          attacking: false,
          blocking: false,
        },
      ],
      exile: [],
      stack: [],
    };
    const names = {
      player: (player: 0 | 1): string => (player === 0 ? 'One' : 'Two'),
      card: (): string => WALKER.name,
      target: (): string => `Two's ${WALKER.name}`,
    };
    const permanent = boardFrame(game, snapshot, 0, null, names).opponent.battlefield.permanents[0];
    expect(permanent?.loyalty).toBe(2);
  });
});

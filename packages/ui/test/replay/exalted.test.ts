/** A replay preserves exalted's referent without presenting it as a target. */
import { describe, expect, it } from 'vitest';
import { exaltedAbility, parseCard } from '@mtg/dsl';
import { boardFrame } from '../../src/routes/replay/frame';
import { SnapshotSchema } from '../../src/routes/replay/log-schema';
import type { ReplayGameLog } from '../../src/routes/replay/read-log';
import type { ReplayNames } from '../../src/routes/replay/narrate';

const ATTACKER = parseCard({
  kind: 'creature',
  id: 'replay-exalted-attacker',
  name: 'Lone Attacker',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 1 },
  power: 2,
  toughness: 2,
});

const SOURCE = parseCard({
  kind: 'creature',
  id: 'replay-exalted-source',
  name: 'Exalted Source',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { generic: 1 },
  power: 1,
  toughness: 1,
  abilities: [exaltedAbility()],
});

const pool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } as const;
const snapshot = SnapshotSchema.parse({
  seats: [
    { life: 20, hand: [], library: 20, graveyard: [], pool, lost: false },
    { life: 20, hand: [], library: 20, graveyard: [], pool, lost: false },
  ],
  battlefield: [
    {
      oid: 'o1',
      controller: 0,
      tapped: true,
      summoningSick: false,
      damage: 0,
      plusCounters: 0,
      minusCounters: 0,
      power: 2,
      toughness: 2,
      attachedTo: null,
      attacking: true,
      blocking: false,
    },
    {
      oid: 'o2',
      controller: 0,
      tapped: false,
      summoningSick: false,
      damage: 0,
      plusCounters: 0,
      minusCounters: 0,
      power: 1,
      toughness: 1,
      attachedTo: null,
      attacking: false,
      blocking: false,
    },
  ],
  exile: [],
  stack: [
    {
      oid: 'ab3',
      controller: 0,
      card: 'o2',
      source: 'o2',
      copiedFrom: null,
      chosenX: null,
      triggerContext: {
        kind: 'controlledCreatureAttacksAlone',
        triggeringCreature: 'o1',
      },
      sourceCharacteristics: null,
      targets: [],
    },
  ],
});

const game: ReplayGameLog = {
  index: 0,
  seed: 'replay/exalted',
  startingPlayer: 0,
  maximumTurns: 1,
  seats: [
    { bot: 'none', deck: 'Alpha' },
    { bot: 'none', deck: 'Beta' },
  ],
  result: { winner: null, loser: null, reason: 'turnLimit', endedOnTurn: 1 },
  objects: new Map([
    ['o1', { oid: 'o1', card: ATTACKER, owner: 0, token: false }],
    ['o2', { oid: 'o2', card: SOURCE, owner: 0, token: false }],
  ]),
  steps: [],
};

const names: ReplayNames = {
  player: (player) => (player === 0 ? 'Alpha' : 'Beta'),
  card: (oid) => game.objects.get(oid)?.card.name ?? oid,
  target: (oid) => game.objects.get(oid)?.card.name ?? oid,
};

describe('exalted in a replay frame', () => {
  it('draws neither a target arrow nor a reticle from retained trigger context', () => {
    const frame = boardFrame(game, snapshot, 0, null, names);
    expect(frame.stack.entries).toHaveLength(1);
    expect(frame.stack.entries[0]?.targetLabel).toBeUndefined();
    expect(frame.stack.entries[0]?.onBoard).toBeUndefined();
    const permanents = [...frame.you.battlefield.permanents, ...frame.opponent.battlefield.permanents];
    expect(permanents.every((permanent) => permanent.targetedBy === undefined)).toBe(true);
  });
});

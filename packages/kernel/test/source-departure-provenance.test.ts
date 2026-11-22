/** Exact source provenance for triggers fired by battlefield departures. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import type { GameState, ObjectId, ZoneId } from '@mtg/kernel';
import { beginTrace, moveObject, scenario, settle } from '@mtg/kernel';
import { oidOf } from './helpers';

const DEPARTING = parseCard({
  kind: 'creature',
  id: 'test-departing-source',
  name: 'Departing Source',
  rarity: 'rare',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { generic: 1, G: 1 },
  colors: ['G'],
  subtypes: ['Beast'],
  keywords: [],
  power: 2,
  toughness: 2,
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfLeavesBattlefield',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'targetPlayer' } }],
    },
    {
      kind: 'triggered',
      condition: 'selfPutIntoGraveyardFromBattlefield',
      effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'targetPlayer' } }],
    },
  ],
});

function moveTo(destination: Exclude<ZoneId, 'battlefield' | 'stack'>): {
  readonly state: GameState;
  readonly source: ObjectId;
} {
  const opened = scenario({ battlefield: [{ card: DEPARTING, controller: 1 }] });
  const source = oidOf(opened.state, DEPARTING.name);
  const moved = settle(moveObject(beginTrace(opened.state), source, destination));
  return { state: moved.state, source };
}

describe('source-departure trigger provenance', () => {
  it.each(['hand', 'graveyard', 'exile', 'library'] as const)(
    'fires the leaves trigger after moving to %s and retains that destination incarnation',
    (destination) => {
      const { state, source } = moveTo(destination);
      const entries = state.stack.filter((entry) => entry.ability?.sourceOid === source);

      expect(entries.some((entry) => entry.ability?.index === 0)).toBe(true);
      expect(entries.every((entry) => entry.controller === 1)).toBe(true);
      expect(entries.every((entry) => entry.sourceIncarnationAtStackCreation === 1)).toBe(true);
    },
  );

  it('fires the graveyard-specific trigger only for a battlefield-to-graveyard move', () => {
    expect(moveTo('graveyard').state.stack.some((entry) => entry.ability?.index === 1)).toBe(true);
    expect(moveTo('hand').state.stack.some((entry) => entry.ability?.index === 1)).toBe(false);
  });
});

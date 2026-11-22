import { parseCard } from '@mtg/dsl';
import {
  beginTrace,
  enterStep,
  eventsOfType,
  moveObject,
  scenario,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { FOREST, ISLAND } from './cards';
import { handOidOf, oidOf } from './helpers';

const URBAN_BURGEONING = parseCard({
  kind: 'enchantment',
  id: 'rtr-138-urban-burgeoning-kernel',
  name: 'Urban Burgeoning',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 138 },
  manaCost: { G: 1 },
  colors: ['G'],
  subtypes: ['Aura'],
  aura: {
    enchant: 'land',
    modifications: [],
    untapsDuringEachOtherPlayersUntapStep: true,
  },
});

function attachedBoard(
  active: 0 | 1,
  hostController: 0 | 1,
): {
  readonly state: GameState;
  readonly host: ObjectId;
  readonly control: ObjectId;
  readonly aura: ObjectId;
} {
  const start = scenario({
    active,
    battlefield: [
      { card: FOREST, controller: hostController, tapped: true },
      { card: ISLAND, controller: hostController, tapped: true },
    ],
    hands: hostController === 0 ? [[], [URBAN_BURGEONING]] : [[URBAN_BURGEONING], []],
  }).state;
  const host = oidOf(start, 'Forest');
  const control = oidOf(start, 'Island');
  const auraController = hostController === 0 ? 1 : 0;
  const aura = handOidOf(start, auraController, URBAN_BURGEONING.name);
  const entered = moveObject(beginTrace(start), aura, 'battlefield', {
    controller: auraController,
    auraHost: host,
  });
  return { state: entered.state, host, control, aura };
}

describe('Urban Burgeoning in the kernel', () => {
  it("untaps only its host during another player's untap step", () => {
    const { state, host, control } = attachedBoard(0, 1);
    const untapped = enterStep(beginTrace(state), 'untap');

    expect(untapped.state.objects[host]?.tapped).toBe(false);
    expect(untapped.state.objects[control]?.tapped).toBe(true);
    expect(eventsOfType(untapped.events, 'permanentUntapped').map((event) => event.oid)).toEqual([host]);
  });

  it('leaves the ordinary controller untap intact even when the Aura has another controller', () => {
    const { state, host, control } = attachedBoard(1, 1);
    const untapped = enterStep(beginTrace(state), 'untap');

    expect(untapped.state.objects[host]?.tapped).toBe(false);
    expect(untapped.state.objects[control]?.tapped).toBe(false);
  });

  it('stops applying as soon as the Aura leaves', () => {
    const { state, host, aura } = attachedBoard(0, 1);
    const gone = moveObject(beginTrace(state), aura, 'graveyard');
    const untapped = enterStep(gone, 'untap');

    expect(untapped.state.objects[host]?.tapped).toBe(true);
    expect(eventsOfType(untapped.events, 'permanentUntapped')).toEqual([]);
  });
});

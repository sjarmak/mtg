/** Reliquary Tower through the live player-rule seam and CR 514.1 cleanup. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  moveObject,
  pendingDecision,
  reduce,
  scenario,
  type GameState,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { abilities, controlledBy, copies, onlyObject, withContinuous } from './continuous-helpers';
import { oidOf } from './helpers';

function tower(name = 'Reliquary Tower'): Card {
  return parseCard({
    kind: 'land',
    id: `tst-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'uncommon',
    set: { code: 'M13', collectorNumber: 227 },
    producesMana: ['C'],
    abilities: [{ kind: 'staticPlayerRule', players: 'controller', rule: 'noMaximumHandSize' }],
  });
}

const RELIQUARY_TOWER = tower();
const OTHER_RULE_SOURCE = tower('Endless Archive');
const BLANK_TOWER = parseCard({
  kind: 'land',
  id: 'tst-blank-reliquary-tower',
  name: 'Reliquary Tower',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 1 },
  producesMana: ['C'],
});
const FILLER = parseCard({
  kind: 'creature',
  id: 'tst-tower-filler',
  name: 'Tower Filler',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { generic: 1 },
  power: 1,
  toughness: 1,
});

function cleanupBoard(cards: readonly Card[] = []): ReduceResult {
  return scenario({
    active: 0,
    step: 'end',
    battlefield: cards.map((card) => ({ card, controller: 0 as const })),
    hands: [Array.from({ length: 8 }, () => FILLER), []],
  });
}

function finishEndStep(from: ReduceResult | GameState): ReduceResult {
  let current = 'state' in from ? from : { state: from, events: [] };
  for (let guard = 0; guard < 4; guard += 1) {
    if (current.state.turn.step !== 'end') return current;
    const decision = pendingDecision(current.state);
    if (decision?.kind !== 'priority') return current;
    const step = reduce(current.state, { type: 'passPriority', player: decision.player });
    current = { state: step.state, events: [...current.events, ...step.events] };
  }
  throw new Error('Reliquary Tower cleanup probe did not leave the end step');
}

function expectCleanupDiscard(state: GameState): void {
  const result = finishEndStep(state);
  expect(pendingDecision(result.state)).toEqual(
    expect.objectContaining({ kind: 'discard', player: 0, count: 1 }),
  );
}

function expectCleanupSkipped(state: GameState): void {
  const result = finishEndStep(state);
  expect(result.state.turn.active).toBe(1);
  expect(result.state.players[0].hand).toHaveLength(8);
  expect(
    result.state.players[0].graveyard.some((oid) => result.state.objects[oid]?.card.id === FILLER.id),
  ).toBe(false);
  expect(pendingDecision(result.state)?.kind).toBe('priority');
}

describe('Reliquary Tower in the kernel', () => {
  it('offers the normal CR 514.1 discard above seven cards', () => {
    expectCleanupDiscard(cleanupBoard().state);
  });

  it('skips cleanup discard while its controller has the live rule', () => {
    expectCleanupSkipped(cleanupBoard([RELIQUARY_TOWER]).state);
  });

  it('restores cleanup discard on source departure, control loss, or ability loss', () => {
    const start = cleanupBoard([RELIQUARY_TOWER]);
    const source = oidOf(start.state, RELIQUARY_TOWER.name);

    expectCleanupDiscard(moveObject(beginTrace(start.state), source, 'graveyard').state);
    expectCleanupDiscard(withContinuous(start.state, [controlledBy(onlyObject(source), 1)]));
    expectCleanupDiscard(withContinuous(start.state, [abilities(onlyObject(source), { removeAll: true })]));
  });

  it('composes multiple live sources and survives until the last rule leaves', () => {
    const start = cleanupBoard([RELIQUARY_TOWER, OTHER_RULE_SOURCE]);
    const first = oidOf(start.state, RELIQUARY_TOWER.name);
    const second = oidOf(start.state, OTHER_RULE_SOURCE.name);

    expectCleanupSkipped(moveObject(beginTrace(start.state), first, 'graveyard').state);
    const bothGone = moveObject(beginTrace(start.state), first, 'graveyard');
    expectCleanupDiscard(moveObject(bothGone, second, 'graveyard').state);
  });

  it('reads copied abilities and never branches on the printed card name', () => {
    const copiedStart = cleanupBoard([RELIQUARY_TOWER, BLANK_TOWER]);
    const source = copiedStart.state.battlefield.find(
      (oid) => copiedStart.state.objects[oid]?.card.id === RELIQUARY_TOWER.id,
    );
    const blank = copiedStart.state.battlefield.find(
      (oid) => copiedStart.state.objects[oid]?.card.id === BLANK_TOWER.id,
    );
    if (source === undefined || blank === undefined) throw new Error('copy probe lost a land');
    const copied = withContinuous(copiedStart.state, [
      copies(onlyObject(blank), source),
      abilities(onlyObject(source), { removeAll: true }),
    ]);
    expectCleanupSkipped(copied);

    expectCleanupSkipped(cleanupBoard([OTHER_RULE_SOURCE]).state);
    expectCleanupDiscard(cleanupBoard([BLANK_TOWER]).state);
  });
});

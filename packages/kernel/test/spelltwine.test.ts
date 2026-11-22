/** Native card-copy casting, target recheck, and cleanup proofs for M13 Spelltwine. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import {
  beginTrace,
  eventsOfType,
  legalActions,
  moveObject,
  pendingDecision,
  reduce,
  scenario,
  type Action,
  type GameState,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { instant, ISLAND, lands, sorcery } from './cards';
import { apply, handOidOf } from './helpers';

const SPELLTWINE = parseCard({
  kind: 'sorcery',
  id: 'm13-072-spelltwine-kernel',
  name: 'Spelltwine',
  rarity: 'rare',
  set: { code: 'M13', collectorNumber: 72 },
  manaCost: { generic: 5, U: 1 },
  colors: ['U'],
  effects: [
    {
      kind: 'exileTarget',
      target: { kind: 'targetCardInYourGraveyard', filter: { cardTypes: ['instant', 'sorcery'] } },
    },
    {
      kind: 'exileTarget',
      target: { kind: 'targetCardInOpponentsGraveyard', filter: { cardTypes: ['instant', 'sorcery'] } },
    },
    { kind: 'castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts' },
    { kind: 'exileThisSpell' },
  ],
} as CardInput);

const OWN_SPELL = sorcery('Spelltwine Own Spell', [
  { kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } },
]);
const OTHER_COUNTER = instant('Spelltwine Other Counter', [{ kind: 'counterSpell' }]);
const OTHER_SPELL = instant('Spelltwine Other Spell', [
  { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } },
]);

function opening(other = OTHER_COUNTER): ReduceResult {
  return scenario({
    battlefield: lands(ISLAND, 6).map((card) => ({ card, controller: 0 as const })),
    hands: [[SPELLTWINE], []],
    graveyards: [[OWN_SPELL], [other]],
  });
}

function cardOid(state: GameState, player: 0 | 1): ObjectId {
  const oid = state.players[player].graveyard[0];
  if (oid === undefined) throw new Error('Spelltwine probe lost its graveyard card');
  return oid;
}

function cast(start: ReduceResult): { readonly result: ReduceResult; readonly source: ObjectId } {
  const source = handOidOf(start.state, 0, SPELLTWINE.name);
  const own = cardOid(start.state, 0);
  const other = cardOid(start.state, 1);
  const result = apply(start, {
    type: 'castSpell',
    player: 0,
    oid: source,
    targets: [{ kind: 'card', oid: own }, { kind: 'card', oid: other }, null, null],
  });
  return { result, source };
}

function beginResolution(start: ReduceResult): ReduceResult {
  return apply(apply(start, { type: 'passPriority', player: 0 }), { type: 'passPriority', player: 1 });
}

function castAction(state: GameState, oid: ObjectId): Extract<Action, { type: 'castSpell' }> {
  const action = legalActions(state).find(
    (candidate) => candidate.type === 'castSpell' && candidate.oid === oid,
  );
  if (action?.type !== 'castSpell') throw new Error(`Spelltwine did not offer ${oid}`);
  return action;
}

describe('Spelltwine in the kernel', () => {
  it('offers either currently castable copy first', () => {
    const start = opening(OTHER_SPELL);
    const own = cardOid(start.state, 0);
    const other = cardOid(start.state, 1);
    const { result: casted } = cast(start);
    const paused = beginResolution(casted);

    expect(
      new Set(
        legalActions(paused.state).flatMap((action) => (action.type === 'castSpell' ? [action.oid] : [])),
      ),
    ).toEqual(new Set([own, other]));
  });

  it('reports a zero-cap copied-card cast decision as incomplete', () => {
    const { result: casted } = cast(opening(OTHER_SPELL));
    const paused = beginResolution(casted);

    expect(pendingDecision(paused.state, 0)).toMatchObject({
      kind: 'freeCast',
      options: [],
      complete: false,
    });
  });

  it('reevaluates the second copy so it can target the first copy on the stack', () => {
    const start = opening();
    const own = cardOid(start.state, 0);
    const other = cardOid(start.state, 1);
    const { result: casted, source } = cast(start);
    const paused = beginResolution(casted);

    expect(pendingDecision(paused.state)?.kind).toBe('freeCast');
    expect(
      legalActions(paused.state)
        .filter((action) => action.type === 'castSpell')
        .map((action) => action.oid),
    ).toEqual([own]);
    expect(paused.state.objects[own]?.zone).toBe('exile');
    expect(paused.state.objects[other]?.zone).toBe('exile');

    const first = reduce(paused.state, castAction(paused.state, own));
    const firstCopy = first.state.stack.at(-1)?.oid;
    if (firstCopy === undefined) throw new Error('first copied card did not become a spell');
    const counter = legalActions(first.state).find(
      (action) =>
        action.type === 'castSpell' &&
        action.oid === other &&
        action.targets[0]?.kind === 'spell' &&
        action.targets[0].oid === firstCopy,
    );
    if (counter?.type !== 'castSpell') throw new Error('second copy could not target the first copy');
    const second = reduce(first.state, counter);

    expect(second.state.pendingFreeCast).toBeUndefined();
    expect(second.state.objects[source]?.zone).toBe('exile');
    expect(second.state.objects[own]?.zone).toBe('exile');
    expect(second.state.objects[other]?.zone).toBe('exile');
    expect(second.state.stack).toHaveLength(2);
    expect(second.state.stack.every((entry) => entry.copiedSpell !== undefined)).toBe(true);
    expect(eventsOfType(second.events, 'spellCast')).toHaveLength(1);
  });

  it('keeps resolving through one illegal graveyard target and never copies that card', () => {
    const start = opening();
    const own = cardOid(start.state, 0);
    const other = cardOid(start.state, 1);
    const { result: casted, source } = cast(start);
    const removed = moveObject(beginTrace(casted.state), other, 'hand');
    const paused = beginResolution({ state: removed.state, events: casted.events });

    expect(
      legalActions(paused.state)
        .filter((action) => action.type === 'castSpell')
        .map((action) => action.oid),
    ).toEqual([own]);
    const done = reduce(paused.state, castAction(paused.state, own));
    expect(done.state.objects[source]?.zone).toBe('exile');
    expect(done.state.objects[other]?.zone).toBe('hand');
    expect(done.state.stack).toHaveLength(1);
  });
});

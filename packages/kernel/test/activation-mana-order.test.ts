/** A presentation-only activation pip order cannot change legality or payment. */
import { parseCard, type Card, type CardInput } from '@mtg/dsl';
import { legalActions, reduce, scenario, type Action, type GameState } from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { FOREST, PLAINS } from './cards';
import { oidOf } from './helpers';

function source(name: string, printedManaPips?: ['G', 'W']): Card {
  return parseCard({
    kind: 'artifact',
    id: `tst-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: printedManaPips === undefined ? 1 : 2 },
    colors: [],
    manaCost: { generic: 2 },
    abilities: [
      {
        kind: 'activated',
        cost: {
          mana: { generic: 2, G: 1, W: 1 },
          ...(printedManaPips === undefined ? {} : { printedManaPips }),
        },
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ],
  } as CardInput);
}

function activation(state: GameState, card: Card): Extract<Action, { type: 'activateAbility' }> {
  const oid = oidOf(state, card.name);
  const action = legalActions(state).find(
    (candidate): candidate is Extract<Action, { type: 'activateAbility' }> =>
      candidate.type === 'activateAbility' && candidate.oid === oid,
  );
  if (action === undefined) throw new Error(`${card.name} activation was not payable`);
  return action;
}

function paidState(card: Card): { readonly tappedLands: number; readonly stackDepth: number } {
  const start = scenario({
    battlefield: [
      { card, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: FOREST, controller: 0 },
      { card: PLAINS, controller: 0 },
      { card: PLAINS, controller: 0 },
    ],
  });
  const paid = reduce(start.state, activation(start.state, card));
  return {
    tappedLands: paid.state.battlefield.filter((oid) => {
      const object = paid.state.objects[oid];
      return object?.card.kind === 'land' && object.tapped;
    }).length,
    stackDepth: paid.state.stack.length,
  };
}

describe('activation mana pip presentation order in the kernel', () => {
  it('charges the same structured mana with and without the printed-order override', () => {
    expect(paidState(source('Canonical Source'))).toEqual({ tappedLands: 4, stackDepth: 1 });
    expect(paidState(source('Ordered Source', ['G', 'W']))).toEqual({ tappedLands: 4, stackDepth: 1 });
  });
});

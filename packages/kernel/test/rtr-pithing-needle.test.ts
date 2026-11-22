/** Retained-name lifecycle and live activation legality for RTR Pithing Needle. */
import { parseCard, type Card } from '@mtg/dsl';
import {
  beginTrace,
  getObject,
  legalActions,
  moveObject,
  onlyObject,
  reduce,
  scenario,
  validateAction,
  type Action,
  type GameState,
  type ObjectId,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { handOidOf, oidOf } from './helpers';
import { abilities, withContinuous } from './continuous-helpers';

const NEEDLE = parseCard({
  kind: 'artifact',
  id: 'rtr-231-pithing-needle-kernel',
  name: 'Pithing Needle',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 231 },
  manaCost: { generic: 1 },
  colors: [],
  entryReplacement: { kind: 'chooseCardName' },
  abilities: [{ kind: 'staticActivationRule', rule: 'chosenNameNonManaAbilitiesCantActivate' }],
});

function device(id: string, name: string, mana: boolean): Card {
  return parseCard({
    kind: 'artifact',
    id,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: id.length },
    manaCost: { generic: 1 },
    colors: [],
    abilities: mana
      ? [
          {
            kind: 'activated',
            cost: { mana: {}, tapSelf: true },
            effects: [{ kind: 'addMana', amount: 1, produces: ['G'] }],
          },
        ]
      : [
          {
            kind: 'activated',
            cost: { mana: {}, tapSelf: true },
            effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
          },
        ],
  });
}

const LOCKED = device('needle-locked-device', 'Named Device', false);
const MANA = device('needle-mana-device', 'Named Device', true);
const OTHER = device('needle-other-device', 'Other Device', false);

function enterNeedle(name: string): { readonly state: GameState; readonly needle: ObjectId } {
  const start = scenario({
    battlefield: [
      { card: LOCKED, controller: 0 },
      { card: MANA, controller: 0 },
      { card: OTHER, controller: 0 },
    ],
    hands: [[NEEDLE], []],
  });
  const needle = handOidOf(start.state, 0, NEEDLE.name);
  const pending = moveObject(beginTrace(start.state), needle, 'battlefield');
  expect(getObject(pending.state, needle).zone).toBe('hand');
  expect(pending.state.turn.awaiting).toBe('cardName');
  expect(validateAction(pending.state, { type: 'chooseCardName', player: 0, name })).toBeNull();
  return { state: reduce(pending.state, { type: 'chooseCardName', player: 0, name }).state, needle };
}

function activation(oid: ObjectId): Extract<Action, { type: 'activateAbility' }> {
  return {
    type: 'activateAbility',
    player: 0,
    oid,
    abilityIndex: 0,
    targets: [null],
    sacrifices: [],
  };
}

describe('Pithing Needle in the kernel', () => {
  it('retains an arbitrary nonempty card name before entering', () => {
    const result = enterNeedle('Named Device');
    expect(getObject(result.state, result.needle)).toMatchObject({
      zone: 'battlefield',
      chosenCardName: 'Named Device',
    });
  });

  it('locks only non-mana activations of sources with the chosen name', () => {
    const { state } = enterNeedle('Named Device');
    const locked = state.battlefield.find((oid) => getObject(state, oid).card.id === LOCKED.id);
    const mana = state.battlefield.find((oid) => getObject(state, oid).card.id === MANA.id);
    const other = oidOf(state, OTHER.name);
    if (locked === undefined) throw new Error('locked device missing');
    if (mana === undefined) throw new Error('mana device missing');

    expect(validateAction(state, activation(locked))).toMatch(/chosen name|can't be activated/i);
    expect(validateAction(state, activation(other))).toBeNull();
    expect(
      validateAction(state, { type: 'activateManaAbility', player: 0, oid: mana, color: 'G' }),
    ).toBeNull();
    expect(
      legalActions(state).some((action) => action.type === 'activateAbility' && action.oid === locked),
    ).toBe(false);
  });

  it('ends the rule and clears the retained name when the Needle leaves', () => {
    const entered = enterNeedle('Named Device');
    const locked = entered.state.battlefield.find(
      (oid) => getObject(entered.state, oid).card.id === LOCKED.id,
    );
    if (locked === undefined) throw new Error('locked device missing');
    const gone = moveObject(beginTrace(entered.state), entered.needle, 'graveyard');
    expect(getObject(gone.state, entered.needle).chosenCardName).toBeUndefined();
    expect(validateAction(gone.state, activation(locked))).toBeNull();
  });

  it("reads the rule from the Needle's live layer-6 abilities", () => {
    const entered = enterNeedle('Named Device');
    const locked = entered.state.battlefield.find(
      (oid) => getObject(entered.state, oid).card.id === LOCKED.id,
    );
    if (locked === undefined) throw new Error('locked device missing');
    const stripped = withContinuous(entered.state, [
      abilities(onlyObject(entered.needle), { removeAll: true }),
    ]);
    expect(validateAction(stripped, activation(locked))).toBeNull();
  });
});

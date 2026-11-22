/** Entry-color lifecycle and retained overlap probes for RTR Tablet of the Guilds. */
import { parseCard, type Card, type Color } from '@mtg/dsl';
import {
  beginTrace,
  collectTriggers,
  getObject,
  legalActions,
  moveObject,
  putTriggersOnStack,
  reduce,
  resolveTop,
  scenario,
  type ObjectId,
  type ReduceResult,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { pushSpell } from '../src/stack';
import { handOidOf } from './helpers';

const TABLET = parseCard({
  kind: 'artifact',
  id: 'rtr-235-tablet-of-the-guilds-kernel',
  name: 'Tablet of the Guilds',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 235 },
  manaCost: { generic: 2 },
  colors: [],
  entryReplacement: { kind: 'chooseTwoColors' },
  abilities: [
    {
      kind: 'triggered',
      condition: 'youCastSpell',
      spellSharesChosenColors: true,
      printedSourceReference: 'thisArtifact',
      effects: [
        {
          kind: 'gainLife',
          amount: { kind: 'triggeringSpellChosenColorCount' },
          target: { kind: 'noTarget' },
        },
      ],
    },
  ],
});

function spell(name: string, colors: readonly Color[]): Card {
  const slug = name.toLowerCase().replaceAll(' ', '-');
  return parseCard({
    kind: 'instant',
    id: `tablet-probe-${slug}`,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: colors.length + name.length },
    manaCost: Object.fromEntries(colors.map((color) => [color, 1])),
    colors,
    effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
  });
}

function enter(
  colors: readonly [Color, Color],
  card?: Card,
  caster: 0 | 1 = 0,
): { readonly run: ReduceResult; readonly tablet: ObjectId } {
  const start = scenario({
    hands: caster === 0 ? [[TABLET, ...(card === undefined ? [] : [card])], []] : [[TABLET], [card!]],
  });
  const tablet = handOidOf(start.state, 0, TABLET.name);
  const pending = moveObject(beginTrace(start.state), tablet, 'battlefield');
  const choice = legalActions(pending.state).find(
    (action) =>
      action.type === 'chooseEntryColors' &&
      action.colors.length === 2 &&
      action.colors[0] === colors[0] &&
      action.colors[1] === colors[1],
  );
  if (choice === undefined) throw new Error(`entry offered no ${colors.join('')} color pair`);
  return { run: reduce(pending.state, choice), tablet };
}

function castAndResolve(run: ReduceResult, card: Card, caster: 0 | 1 = 0): ReduceResult {
  const oid = handOidOf(run.state, caster, card.name);
  const cast = pushSpell(beginTrace(run.state), caster, oid, [null], null, null);
  const fired = collectTriggers(cast, 0);
  return fired.length === 0
    ? { state: cast.state, events: cast.events }
    : resolveTop(putTriggersOnStack(cast, fired));
}

describe('Tablet of the Guilds in the kernel', () => {
  it('offers exactly the ten canonical distinct WUBRG pairs before entry', () => {
    const start = scenario({ hands: [[TABLET], []] });
    const oid = handOidOf(start.state, 0, TABLET.name);
    const pending = moveObject(beginTrace(start.state), oid, 'battlefield');
    const choices = legalActions(pending.state).filter((action) => action.type === 'chooseEntryColors');

    expect(choices.map((choice) => choice.colors.join(''))).toEqual([
      'WU',
      'WB',
      'WR',
      'WG',
      'UB',
      'UR',
      'UG',
      'BR',
      'BG',
      'RG',
    ]);
    expect(getObject(pending.state, oid).zone).toBe('hand');
  });

  it('suppresses zero overlap and gains one or two life from retained cast colors', () => {
    const black = spell('Black Probe', ['B']);
    const white = spell('White Probe', ['W']);
    const azorius = spell('Azorius Probe', ['W', 'U']);
    expect(castAndResolve(enter(['W', 'U'], black).run, black).state.players[0].life).toBe(20);
    expect(castAndResolve(enter(['W', 'U'], white).run, white).state.players[0].life).toBe(21);
    expect(castAndResolve(enter(['W', 'U'], azorius).run, azorius).state.players[0].life).toBe(22);
  });

  it("does not trigger for an opponent's cast", () => {
    const probe = spell('Enemy Rakdos Probe', ['B', 'R']);
    const result = castAndResolve(enter(['B', 'R'], probe, 1).run, probe, 1);
    expect(result.state.players.map((player) => player.life)).toEqual([20, 20]);
  });

  it('clears the retained choice on departure and requires a fresh choice on reentry', () => {
    const first = enter(['W', 'U']);
    expect(getObject(first.run.state, first.tablet).chosenColors).toEqual(['W', 'U']);
    const gone = moveObject(beginTrace(first.run.state), first.tablet, 'hand');
    expect(getObject(gone.state, first.tablet).chosenColors).toBeUndefined();
    const returning = moveObject(gone, first.tablet, 'battlefield');
    expect(returning.state.turn.awaiting).toBe('entryColors');
  });
});

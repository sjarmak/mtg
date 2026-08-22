/** CR 604.3 / 613.4a: intrinsic characteristic values in every relevant zone. */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { GameState, ObjectId } from '@mtg/kernel';
import { characteristicsOf, powerOf, scenario, toughnessOf } from '@mtg/kernel';
import { creature } from './cards';
import { handOidOf, oidOf } from './helpers';
import { copies, onlyObject, pump, withContinuous } from './continuous-helpers';

function variableCreature(name: string, definition: 'creaturesYouControl' | 'controllerLifeTotal'): Card {
  return parseCard({
    kind: 'creature',
    id: `tst-${name.toLowerCase().replaceAll(' ', '-')}`,
    name,
    rarity: 'rare',
    set: { code: 'TST', collectorNumber: definition === 'creaturesYouControl' ? 1 : 2 },
    manaCost: { generic: 3 },
    colors: [],
    power: 0,
    toughness: 0,
    characteristicPowerToughness: { kind: definition },
  } satisfies CardInput);
}

const CRUSADER = variableCreature('Counting Crusader', 'creaturesYouControl');
const AVATAR = variableCreature('Living Avatar', 'controllerLifeTotal');
const BEAR = creature('CDA Bear', 2, 2);

function battlefield(): { readonly state: GameState; readonly crusader: ObjectId } {
  const start = scenario({
    battlefield: [
      { card: CRUSADER, controller: 0 },
      { card: BEAR, controller: 0 },
      { card: BEAR, controller: 1 },
    ],
  });
  return { state: start.state, crusader: oidOf(start.state, CRUSADER.name) };
}

describe('intrinsic layer-7a values', () => {
  it('counts itself and the other creatures its current controller controls', () => {
    const { state, crusader } = battlefield();
    expect([powerOf(state, crusader), toughnessOf(state, crusader)]).toEqual([2, 2]);
  });

  it('is modified by a later layer-7c effect', () => {
    const { state, crusader } = battlefield();
    const modified = withContinuous(state, [pump(onlyObject(crusader), 2, -1)]);
    expect([powerOf(modified, crusader), toughnessOf(modified, crusader)]).toEqual([4, 1]);
  });

  it('copies the definition, then evaluates it for the copy controller, including a token copy', () => {
    const tokenBear = { ...BEAR, id: 'tst-token-copy', name: 'CDA Token Bear' };
    const start = scenario({
      battlefield: [
        { card: CRUSADER, controller: 1 },
        { card: BEAR, controller: 0 },
        { card: tokenBear, controller: 0, token: true },
      ],
    });
    const source = oidOf(start.state, CRUSADER.name);
    const bear = oidOf(start.state, BEAR.name);
    const token = oidOf(start.state, tokenBear.name);
    const copied = withContinuous(start.state, [
      copies(onlyObject(bear), source, { id: 'copy-card', ts: 1 }),
      copies(onlyObject(token), source, { id: 'copy-token', ts: 2 }),
    ]);
    expect([powerOf(copied, bear), toughnessOf(copied, bear)]).toEqual([2, 2]);
    expect([powerOf(copied, token), toughnessOf(copied, token)]).toEqual([2, 2]);
  });
});

describe('zone-sensitive controller-or-owner semantics', () => {
  it('evaluates a hand card for its owner against the live battlefield', () => {
    const start = scenario({
      battlefield: [
        { card: BEAR, controller: 0 },
        { card: BEAR, controller: 0 },
        { card: BEAR, controller: 1 },
      ],
      hands: [[CRUSADER], []],
    });
    const oid = handOidOf(start.state, 0, CRUSADER.name);
    const current = characteristicsOf(start.state, oid);
    expect([current.power, current.toughness]).toEqual([2, 2]);
  });

  it('uses the owner outside the battlefield and current controller on it for life-total values', () => {
    const hand = scenario({ hands: [[AVATAR], []] });
    const handOid = handOidOf(hand.state, 0, AVATAR.name);
    const wounded: GameState = {
      ...hand.state,
      players: [
        { ...hand.state.players[0], life: 7 },
        { ...hand.state.players[1], life: 13 },
      ],
      objects: {
        ...hand.state.objects,
        [handOid]: { ...hand.state.objects[handOid]!, controller: 1 },
      },
    };
    expect(characteristicsOf(wounded, handOid).power).toBe(7);

    const field = scenario({ battlefield: [{ card: AVATAR, controller: 1 }] });
    const oid = oidOf(field.state, AVATAR.name);
    const life: GameState = {
      ...field.state,
      players: [
        { ...field.state.players[0], life: 7 },
        { ...field.state.players[1], life: 13 },
      ],
    };
    expect(powerOf(life, oid)).toBe(13);
  });
});

/**
 * `abilitiesOf` skips the characteristics derivation when nothing can change
 * an ability list (`mtg-qx35`). A short circuit must answer the same question
 * the walk would, so each case compares it with `characteristicsOf`, the walk's
 * own answer, and one case grants an ability to prove the walk is still taken.
 */
import { describe, expect, it } from 'vitest';
import type { Ability } from '@mtg/dsl';
import { abilitiesOf, characteristicsOf, scenario } from '@mtg/kernel';
import { creature } from './cards';
import { abilities, onlyObject, withContinuous } from './continuous-helpers';

const drawer = creature('Fast Path Drawer', 2, 2, {
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { U: 1 }, tapSelf: true },
      effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
    },
  ],
});

describe('abilitiesOf without a layer walk', () => {
  it('answers what the characteristics derivation answers, on the battlefield and off it', () => {
    const start = scenario({
      battlefield: [{ card: drawer, controller: 0 }],
      graveyards: [[drawer], []],
    }).state;
    const graveyardOid = start.players[0].graveyard[0] ?? '';
    const battlefieldOid = start.battlefield[0] ?? '';
    expect(start.continuous).toHaveLength(0);
    for (const oid of [battlefieldOid, graveyardOid]) {
      expect(abilitiesOf(start, oid)).toEqual(characteristicsOf(start, oid).abilities);
      expect(abilitiesOf(start, oid)).toHaveLength(1);
    }
  });

  it('still sees an ability a continuous effect grants', () => {
    const start = scenario({ battlefield: [{ card: drawer, controller: 0 }] }).state;
    const oid = start.battlefield[0] ?? '';
    const granted: Ability = {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
    } as Ability;
    const state = withContinuous(start, [abilities(onlyObject(oid), { addAbilities: [granted] }, { ts: 1 })]);
    expect(abilitiesOf(state, oid)).toHaveLength(2);
    expect(abilitiesOf(state, oid)).toEqual(characteristicsOf(state, oid).abilities);
  });
});

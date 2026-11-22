/** Live global life-gain and damage-prevention prohibitions. */
import { parseCard } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  eventsOfType,
  gainLife,
  getObject,
  moveObject,
  onlyObject,
  scenario,
  setLife,
  type DamageInstance,
  type GameState,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import {
  abilities,
  controlledBy,
  copies,
  damageToPermanent,
  replacement,
  withContinuous,
  withReplacements,
} from './continuous-helpers';
import { creature } from './cards';
import { oidOf } from './helpers';

const LEYLINE = parseCard({
  kind: 'enchantment',
  id: 'm11-148-leyline-of-punishment-kernel',
  name: 'Leyline of Punishment',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 148 },
  manaCost: { generic: 2, R: 2 },
  colors: ['R'],
  openingHandAction: { kind: 'beginOnBattlefield' },
  abilities: [
    { kind: 'staticGameRule', rule: 'playersCantGainLife' },
    { kind: 'staticGameRule', rule: 'damageCantBePrevented' },
  ],
});

const BLANK = creature('Punishment Blank', 1, 1);
const SOURCE = parseCard({
  kind: 'creature',
  id: 'punishment-red-source',
  name: 'Punishment Red Source',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  manaCost: { R: 1 },
  colors: ['R'],
  power: 2,
  toughness: 2,
});
const PROTECTED = parseCard({
  kind: 'creature',
  id: 'punishment-protected-target',
  name: 'Punishment Protected Target',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 2 },
  manaCost: { W: 1 },
  colors: ['W'],
  power: 0,
  toughness: 12,
  keywordAbilities: [{ kind: 'protection', quality: { kind: 'color', color: 'R' } }],
});

function board(): GameState {
  return scenario({
    battlefield: [
      { card: LEYLINE, controller: 0 },
      { card: SOURCE, controller: 0 },
      { card: PROTECTED, controller: 1 },
      { card: BLANK, controller: 1 },
    ],
  }).state;
}

function damage(state: GameState, target: string, changes: Partial<DamageInstance> = {}) {
  const source = oidOf(state, SOURCE.name);
  return applyDamage(beginTrace(state), [
    {
      sourceOid: source,
      sourceCard: SOURCE,
      controller: 0,
      recipient: { kind: 'permanent', oid: target },
      amount: 3,
      deathtouch: false,
      lifelink: false,
      combat: false,
      preventable: true,
      ...changes,
    },
  ]);
}

describe('Leyline of Punishment in the kernel', () => {
  it('stops both players from gaining life before replacements or triggers', () => {
    const state = withReplacements(board(), [
      replacement({ kind: 'lifeGain', player: 0 }, { kind: 'multiplyLifeGain', factor: 2 }, { id: 'double' }),
    ]);
    const first = gainLife(beginTrace(state), 0, 3, false);
    const second = gainLife(first, 1, 4, true);

    expect(second.state.players.map((player) => player.life)).toEqual([20, 20]);
    expect(eventsOfType(second.events, 'lifeChanged')).toEqual([]);
    expect(eventsOfType(second.events, 'replacementApplied')).toEqual([]);
    expect(second.state.replacements.map((effect) => effect.id)).toContain('double');
  });

  it('blocks an upward set-life but still permits life loss', () => {
    const raised = setLife(beginTrace(board()), 0, 25);
    const lowered = setLife(raised, 0, 15);

    expect(raised.state.players[0].life).toBe(20);
    expect(lowered.state.players[0].life).toBe(15);
    expect(eventsOfType(lowered.events, 'lifeChanged')).toEqual([
      expect.objectContaining({ player: 0, delta: -5, reason: 'lifeLoss' }),
    ]);
  });

  it('skips prevention and protection but retains non-prevention replacements', () => {
    const state = board();
    const target = oidOf(state, PROTECTED.name);
    const replaced = withReplacements(state, [
      replacement(damageToPermanent(target), { kind: 'preventDamage', amount: 'all' }, { id: 'shield' }),
      replacement(damageToPermanent(target), { kind: 'multiplyDamage', factor: 2 }, { id: 'double' }),
    ]);
    const done = damage(replaced, target);

    expect(getObject(done.state, target).damage).toBe(6);
    expect(eventsOfType(done.events, 'replacementApplied').map((event) => event.id)).toEqual(['double']);
    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([]);
    expect(done.state.replacements.map((effect) => effect.id)).toContain('shield');
  });

  it('also prohibits prevention for combat damage while leaving lifelink prohibited', () => {
    const state = board();
    const target = oidOf(state, PROTECTED.name);
    const done = damage(state, target, { combat: true, lifelink: true });

    expect(getObject(done.state, target).damage).toBe(3);
    expect(done.state.players[0].life).toBe(20);
    expect(eventsOfType(done.events, 'damagePrevented')).toEqual([]);
    expect(eventsOfType(done.events, 'lifeChanged')).toEqual([]);
  });

  it('recomputes both rules through control, copy, ability loss, and departure', () => {
    const state = board();
    const leyline = oidOf(state, LEYLINE.name);
    const blank = oidOf(state, BLANK.name);
    const stolen = withContinuous(state, [controlledBy(onlyObject(leyline), 1)]);
    expect(gainLife(beginTrace(stolen), 0, 1, false).state.players[0].life).toBe(20);

    const copied = withContinuous(state, [
      copies(onlyObject(blank), leyline),
      abilities(onlyObject(leyline), { removeAll: true }),
    ]);
    expect(gainLife(beginTrace(copied), 0, 1, false).state.players[0].life).toBe(20);

    const stripped = withContinuous(copied, [abilities(onlyObject(blank), { removeAll: true })]);
    expect(gainLife(beginTrace(stripped), 0, 1, false).state.players[0].life).toBe(21);

    const gone = moveObject(beginTrace(state), leyline, 'graveyard');
    expect(gainLife(gone, 1, 1, false).state.players[1].life).toBe(21);
    expect(
      getObject(
        damage(gone.state, oidOf(gone.state, PROTECTED.name)).state,
        oidOf(gone.state, PROTECTED.name),
      ).damage,
    ).toBe(0);
  });
});

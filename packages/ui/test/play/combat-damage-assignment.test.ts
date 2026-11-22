import { describe, expect, it } from 'vitest';
import type { PlayCombatDamageAssignment } from '@mtg/engine';
import {
  combatDamageAmountsAfterChange,
  combatDamageAssignmentState,
  combatDamageSubmission,
} from '../../src/routes/play/combat-damage-assignment';

const ordinary: PlayCombatDamageAssignment = {
  inputId: 'combat-damage-assignment:17',
  source: { oid: 'forge-card-17', name: 'Charging Rhino', power: 5 },
  total: 5,
  canDefer: false,
  overrideOrder: false,
  recipients: [
    { oid: 'forge-card-20', name: 'Bear Cub', kind: 'blocker', toughness: 2, damage: 0, lethal: 2 },
    { oid: 'forge-card-21', name: 'Horned Turtle', kind: 'blocker', toughness: 3, damage: 0, lethal: 3 },
    { oid: 'forge-player-1', name: 'South', kind: 'defender', toughness: null, damage: 0, lethal: 0 },
  ],
  defaultAmounts: [2, 3, 0],
};

describe('combat damage assignment', () => {
  it('preserves minimum-lethal-then-spill defaults for two blockers', () => {
    expect(combatDamageAssignmentState(ordinary, ordinary.defaultAmounts)).toEqual({
      valid: true,
      locked: [false, false, false],
      remaining: 0,
    });
    expect(JSON.parse(combatDamageSubmission(ordinary, ordinary.defaultAmounts))).toMatchObject({
      version: 1,
      source: ordinary.source,
      amounts: [2, 3, 0],
      defer: false,
    });
  });

  it('unlocks later recipients only after every earlier blocker has lethal damage', () => {
    expect(combatDamageAssignmentState(ordinary, [1, 4, 0])).toEqual({
      valid: false,
      locked: [false, true, true],
      remaining: 0,
    });
    expect(combatDamageAssignmentState(ordinary, [2, 2, 1])).toEqual({
      valid: false,
      locked: [false, false, true],
      remaining: 0,
    });
  });

  it('clears values that become illegal when an earlier blocker falls below lethal', () => {
    expect(combatDamageAmountsAfterChange(ordinary, [2, 2, 1], 0, 1)).toEqual([1, 0, 0]);
  });

  it('honors Forge assignments that override blocker order while still gating the defender', () => {
    const overridden = { ...ordinary, overrideOrder: true };
    expect(combatDamageAssignmentState(overridden, [0, 5, 0])).toMatchObject({
      valid: true,
      locked: [false, false, true],
    });
    expect(combatDamageAssignmentState(overridden, [2, 2, 1])).toMatchObject({
      valid: false,
      locked: [false, false, true],
    });
    expect(combatDamageAssignmentState(overridden, [2, 3, 0]).valid).toBe(true);
  });

  it('uses the lethal values proved by Forge for deathtouch and marked damage', () => {
    const proved: PlayCombatDamageAssignment = {
      ...ordinary,
      recipients: [
        { ...ordinary.recipients[0]!, lethal: 1 },
        { ...ordinary.recipients[1]!, damage: 2, lethal: 1 },
        ordinary.recipients[2]!,
      ],
      defaultAmounts: [1, 1, 3],
    };
    expect(combatDamageAssignmentState(proved, proved.defaultAmounts)).toEqual({
      valid: true,
      locked: [false, false, false],
      remaining: 0,
    });
  });

  it('refuses negative, fractional, oversized, and wrong-total assignments', () => {
    expect(combatDamageAssignmentState(ordinary, [-1, 6, 0]).valid).toBe(false);
    expect(combatDamageAssignmentState(ordinary, [2, 2.5, 0.5]).valid).toBe(false);
    expect(combatDamageAssignmentState(ordinary, [2, 3, 1]).valid).toBe(false);
    expect(combatDamageAssignmentState(ordinary, [2, 2, 0]).valid).toBe(false);
  });

  it('matches total-and-order legality over the finite assignment domain', () => {
    const values = Array.from({ length: ordinary.total + 1 }, (_, value) => value);
    for (const first of values) {
      for (const second of values) {
        for (const defender of values) {
          const amounts = [first, second, defender];
          const expected =
            first + second + defender === ordinary.total &&
            (second === 0 || first >= 2) &&
            (defender === 0 || (first >= 2 && second >= 3));
          expect(combatDamageAssignmentState(ordinary, amounts).valid).toBe(expected);
        }
      }
    }
  });

  it('unlocks recipients monotonically as earlier blocker assignments increase', () => {
    for (let first = 0; first < ordinary.total; first++) {
      const before = combatDamageAssignmentState(ordinary, [first, 0, 0]).locked;
      const after = combatDamageAssignmentState(ordinary, [first + 1, 0, 0]).locked;
      expect(after.every((locked, index) => !locked || before[index])).toBe(true);
    }
  });
});

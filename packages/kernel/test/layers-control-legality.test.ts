/**
 * Audit: layer 2 (control change) versus the legality checker.
 *
 * `legalActions` enumerates mana abilities through `landsControlledBy`, which
 * is layer-aware. `validateAction` re-checks them against the raw
 * `GameObject.controller` field. If those two disagree the kernel offers an
 * action it then rejects.
 */
import { describe, expect, it } from 'vitest';
import { controllerOf, landsControlledBy, scenario, validateAction } from '@mtg/kernel';
import { FOREST } from './cards';
import { oidOf } from './helpers';
import { controlledBy as controlChange, onlyObject, withContinuous } from './continuous-helpers';

describe('audit: a control-changed land', () => {
  it('is enumerated for its new controller and accepted by validateAction', () => {
    const start = scenario({ battlefield: [{ card: FOREST, controller: 0 }] });
    const forestOid = oidOf(start.state, 'Forest');
    const state = withContinuous(start.state, [controlChange(onlyObject(forestOid), 1, { ts: 1 })]);

    expect(controllerOf(state, forestOid)).toBe(1);
    // The enumerator is layer-aware: it lists the land under its new controller.
    expect(landsControlledBy(state, 1).map((o) => o.oid)).toEqual([forestOid]);
    expect(landsControlledBy(state, 0)).toEqual([]);

    // The validator must agree with the enumerator.
    expect(
      validateAction(state, { type: 'activateManaAbility', player: 1, oid: forestOid, color: 'G' }),
    ).not.toBe('you do not control that source');
  });

  it('is no longer usable by its previous controller', () => {
    const start = scenario({ battlefield: [{ card: FOREST, controller: 0 }] });
    const forestOid = oidOf(start.state, 'Forest');
    const state = withContinuous(start.state, [controlChange(onlyObject(forestOid), 1, { ts: 1 })]);

    expect(
      validateAction(state, {
        type: 'activateManaAbility',
        player: 0,
        oid: forestOid,
        color: 'G',
      }),
    ).not.toBeNull();
  });
});

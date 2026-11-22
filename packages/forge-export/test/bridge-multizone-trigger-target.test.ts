/**
 * Static locks for the two source-scoped trigger-target exceptions whose actual
 * board outcomes are exercised by observed-multizone-trigger-target.integration.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const bridge = readFileSync(fileURLToPath(new URL('../bridge/ForgeBridge.java', import.meta.url)), 'utf8');

describe('reviewed mixed-zone and multiple trigger targeting', () => {
  it('owns only Venser mixed battlefield/stack ChangeZone targeting', () => {
    expect(bridge).toContain('isReviewedVenserTarget');
    expect(bridge).toContain('"Venser, Shaper Savant".equals(source.getName())');
    expect(bridge).toContain('"Permanent,Card.inZoneStack".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('"Battlefield,Stack".equals(ability.getParam("Origin"))');
    expect(bridge).toContain('"Hand".equals(ability.getParam("Destination"))');
    // Venser is the only exemption from the stack-target refusal today; a later card that
    // may also name a stack object adds its own && !reviewedX before or after his.
    expect(bridge).toMatch(
      /\(containsStack && !stackTarget\s*(?:&&\s*!\w+\s*)*&&\s*!reviewedVenserTarget\s*(?:&&\s*!\w+\s*)*\)/u,
    );
  });

  it('keeps Ulamog, Plow Under, Garruk, and Hope Tender at two targets while Reveillark and Authority permit zero to two', () => {
    expect(bridge).toContain('"Ulamog, the Ceaseless Hunger".equals(source.getName())');
    expect(bridge).toContain('"Permanent".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('int minimum = ability.getMinTargets()');
    expect(bridge).toContain('int maximum = ability.getMaxTargets()');
    // This test owns Reveillark and Authority's zero-to-two exception, not the rest of the
    // default-two-target negation; a later card added to that exception inserts its own
    // && !reviewedX between or after the two names, so tolerate intervening terms.
    expect(bridge).toMatch(
      /!reviewedReveillark\s*(?:&&\s*!\w+\s*)*&&\s*!reviewedAuthority\s*(?:&&\s*!\w+\s*)*&&\s*\(minimum != 2 \|\| maximum != 2\)/u,
    );
    expect(bridge).toMatch(
      /\(reviewedReveillark\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedAuthority\s*(?:\|\|\s*\w+\s*)*\)\s*\n\s*&& \(minimum != 0 \|\| maximum != 2\)\)/u,
    );
    // This test owns Plow Under, Garruk, and Hope Tender in the two-target cancel-choice
    // disjunction; Authority is pinned by name because it sits at the end of this expression
    // today, but a later card can add its own reviewed guard anywhere in it, tail included.
    expect(bridge).toMatch(
      /if \(\(reviewedPlowUnder\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedGarruk\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedHopeTender\s*(?:\|\|\s*\w+\s*)*\|\|\s*reviewedAuthority\s*(?:\|\|\s*\w+\s*)*\)/u,
    );
    expect(bridge).toContain('&& chosen.isEmpty() && !restrictions.getMandatory())');
    expect(bridge).toContain('isReviewedHopeTenderDoubleUntap(ability)');
    expect(bridge).toContain('minimum != 2 || maximum != 2');
  });
});

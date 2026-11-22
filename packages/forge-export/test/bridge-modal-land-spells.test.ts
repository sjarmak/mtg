import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact modal land spell boundary', () => {
  it('pins the shared pay-three-life land replacement to three exact faces', () => {
    expect(bridge).toContain('payReviewedModalLandEntryLife');
    expect(bridge).toContain('REVIEWED_PAY_THREE_LIFE_MODAL_LANDS');
    expect(bridge).toContain('"Emeria, Shattered Skyclave"');
    expect(bridge).toContain('"Turntimber, Serpentine Wood"');
    expect(bridge).toContain('"PayLife<3>".equals(ability.getParam("UnlessCost"))');
    expect(bridge).toContain('PaymentDecision.number(3)');
    expect(bridge).toContain('outside reviewed-pay-three-life-modal-land-entry-v1');
  });

  it('pins Turntimber to an optional creature among exactly its top seven cards', () => {
    expect(bridge).toContain('isReviewedTurntimberSymbiosisDigAbility');
    expect(bridge).toContain('chooseTurntimberSymbiosisCreature');
    expect(bridge).toContain('"Turntimber Symbiosis".equals(source.getName())');
    expect(bridge).toContain('"7".equals(ability.getParam("DigNum"))');
    expect(bridge).toContain('"Creature".equals(ability.getParam("ChangeValid"))');
    expect(bridge).toContain('"True".equals(ability.getParam("RestRandomOrder"))');
    expect(bridge).toContain('outside reviewed-turntimber-symbiosis-dig-v1');
  });
});

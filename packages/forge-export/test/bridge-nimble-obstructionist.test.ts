/** Static lock for the exact AKH/HOU triggered stack-target exception. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Nimble Obstructionist stack targeting', () => {
  it('admits only its exact cycle trigger through the stack-target route', () => {
    expect(bridge).toContain('isReviewedNimbleObstructionistCounter');
    expect(bridge).toContain('"Nimble Obstructionist".equals(source.getName())');
    expect(bridge).toContain('"Activated.YouDontCtrl,Triggered.YouDontCtrl".equals(');
    expect(bridge).toContain('"Card,Emblem".equals(ability.getParam("ValidTgts"))');
    expect(bridge).toContain('reviewedNimbleObstructionistCounter');
  });
});

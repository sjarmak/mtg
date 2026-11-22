import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact Engineered Explosives boundary', () => {
  it('pins the source, root topology, Sunburst counter source, and destruction filter', () => {
    expect(
      [
        'isReviewedEngineeredExplosivesAbility',
        '"Engineered Explosives".equals(source.getName())',
        'ability.getApi() == ApiType.DestroyAll',
        '"2 Sac<1/CARDNAME>".equals(ability.getParam("Cost"))',
        '"Permanent.nonLand+cmcEQY".equals(ability.getParam("ValidCards"))',
        '"Count$CardCounters.CHARGE".equals(source.getSVar("Y"))',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('keeps every other Engineered Explosives route on the fail-closed path', () => {
    expect(bridge).toContain('if (source != null && "Engineered Explosives".equals(source.getName()))');
    expect(bridge).toContain('outside its exact reviewed route');
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns the exact Dissension discard contracts', () => {
  it('pins Rakdos Augermage to its mutual revealed-hand discard chain', () => {
    expect(bridge).toContain('isReviewedRakdosAugermageDiscard');
    expect(bridge).toContain('"Rakdos Augermage".equals(source.getName())');
    expect(bridge).toContain('"RevealTgtChoose".equals(parent.getParam("Mode"))');
    expect(bridge).toContain('"ParentTarget".equals(ability.getParam("Defined"))');
  });

  it('pins Rix Maadi to its sorcery-speed each-player discard activation', () => {
    expect(bridge).toContain('isReviewedRixMaadiDiscard');
    expect(bridge).toContain('"Rix Maadi, Dungeon Palace".equals(source.getName())');
    expect(bridge).toContain('"Player".equals(ability.getParam("Defined"))');
    expect(bridge).toContain('"{1}{B}{R}".equals(mana.getMana().getSimpleString())');
  });

  it('versions the widened callback boundary', () => {
    expect(bridge).toContain('outside reviewed-singleton-discard-v4');
    expect(bridge).not.toContain('outside reviewed-singleton-discard-v3');
  });
});

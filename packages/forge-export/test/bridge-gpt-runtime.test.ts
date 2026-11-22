import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge owns the exact Guildpact runtime gaps', () => {
  it('admits Lore Broker as an activated draw followed by each player discarding one', () => {
    expect(bridge).toContain('boolean reviewedLoreBroker = source != null');
    expect(bridge).toContain('"Lore Broker".equals(source.getName())');
    expect(bridge).toContain('"Player".equals(parent.getParam("Defined"))');
    expect(bridge).toContain('"DB$ Discard | Mode$ TgtChoose | Defined$ Player"');
  });

  it('admits Three Dreams as an optional three-Aura distinct-name library search', () => {
    expect(bridge).toContain('isReviewedThreeDreamsSearch(');
    expect(bridge).toContain('"Three Dreams".equals(source.getName())');
    expect(bridge).toContain('"Aura".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"3".equals(ability.getParam("ChangeNum"))');
    expect(bridge).toContain('"True".equals(ability.getParam("DifferentNames"))');
    expect(bridge).toContain('"Select a card from your library \\\\([2-3] / 3\\\\)"');
    expect(bridge).toContain('card.isAura()');
  });
});

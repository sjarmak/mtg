import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge proves Golos search before calling its trigger beneficial', () => {
  it('pins the complete intrinsic trigger and search ability', () => {
    expect(bridge).toContain('isReviewedGolosSearchTrigger');
    expect(bridge).toContain('"Golos, Tireless Pilgrim".equals(source.getName())');
    expect(bridge).toContain('trigger.getMode() == TriggerType.ChangesZone');
    expect(bridge).toContain('"Land".equals(ability.getParam("ChangeType"))');
    expect(bridge).toContain('"True".equals(ability.getParam("Tapped"))');
    expect(bridge).toContain('"True".equals(ability.getParam("ShuffleNonMandatory"))');
  });

  it('emits a distinct decision kind and rejects a changed Golos trigger', () => {
    expect(bridge).toContain('"confirm-beneficial-trigger"');
    expect(bridge).toContain('outside reviewed-golos-search-trigger-v1');
  });
});

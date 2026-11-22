import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('the Forge bridge classifies optional self-draw effects structurally', () => {
  it('requires a controlled battlefield source and the exact optional draw shape', () => {
    expect(bridge).toContain('optionalSelfDrawCount');
    expect(bridge).toContain('ability.getApi() == ApiType.Draw');
    expect(bridge).toContain('"You".equals(ability.getParam("OptionalDecider"))');
    expect(bridge).toContain('source.isInZone(ZoneType.Battlefield)');
    expect(bridge).toContain('source.getController() == player');
    expect(bridge).toContain('Set.of("DB", "NumCards", "OptionalDecider")');
  });

  it('carries the proved draw count in the reviewed decision kind', () => {
    expect(bridge).toMatch(/optionalSelfDrawCount[\s\S]*?"confirm-optional-self-draw-"/u);
  });
});

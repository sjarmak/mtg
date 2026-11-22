/** Exact bridge boundary for Karn Liberated's targeted-player hand exile. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Karn Liberated hand exile bridge route', () => {
  it('admits only the exact targeted-player +4 ability', () => {
    expect(bridge).toContain('boolean reviewedKarnHandExile =');
    expect(bridge).toContain('"Karn Liberated".equals(source.getName())');
    expect(bridge).toContain('"ChangeZone".equals(ability.getParam("AB"))');
    expect(bridge).toContain('"AddCounter<4/LOYALTY>".equals(ability.getParam("Cost"))');
    expect(bridge).toContain('ability.getTargets().contains(player)');
    expect(bridge).toContain(
      'ability.getMapParams().keySet().equals(Set.of(\n' +
        '                            "AB", "Cost", "Planeswalker", "ValidTgts", "Origin",\n' +
        '                            "Destination", "ChangeType", "ChangeNum", "Chooser", "Hidden",\n' +
        '                            "IsCurse", "Mandatory", "SpellDescription"))',
    );
  });

  it('exposes and checks only cards in the choosing players own hand', () => {
    expect(
      bridge.match(/reviewedKarnHandExile[^;]*player\.getCardsIn\(ZoneType\.Hand\)\.contains\(card\)/gu),
    ).toHaveLength(2);
    expect(bridge.match(/reviewedKarnHandExile[^;]*card\.getOwner\(\) != player/gu)).toHaveLength(2);
    expect(bridge).toMatch(/reviewedHiddenHandZoneChange =[^;]*reviewedKarnHandExile/u);
  });
});

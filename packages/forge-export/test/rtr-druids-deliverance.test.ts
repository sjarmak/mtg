/** Source-pinned Forge parity for Druid's Deliverance's prevention clause. */
import { describe, expect, it } from 'vitest';
import { spell } from './helpers';
import { transpileCard } from '@mtg/forge-export';

describe("Druid's Deliverance Forge parity", () => {
  it('matches Forge master’s Effect plus combat-only controller replacement', () => {
    const result = transpileCard(
      spell("Druid's Deliverance", [{ kind: 'preventCombatDamageToYou' }, { kind: 'populate' }]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lines = result.script.text.split('\n');
    expect(lines).toContain(
      'A:SP$ Effect | ReplacementEffects$ RPrevent | AILogic$ Fog | SubAbility$ DBEffect1 | SpellDescription$ Prevent all combat damage that would be dealt to you this turn. Populate.',
    );
    expect(lines).toContain('SVar:DBEffect1:DB$ CopyPermanent | Populate$ True');
    expect(lines).toContain(
      'SVar:RPrevent:Event$ DamageDone | Prevent$ True | IsCombat$ True | ActiveZones$ Command | ValidTarget$ You | Description$ Prevent all combat damage that would be dealt to you this turn.',
    );
  });
});

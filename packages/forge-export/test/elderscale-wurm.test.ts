/**
 * Forge parity for Elderscale Wurm's intervening-if trigger and life-floor
 * replacement.
 *
 * The condition's SVar is `YourLife`, which is what makes this card the reason
 * the life-total conditions name theirs that way: `X` is already spoken for by
 * `SVar:X:ReplaceCount$Amount/LimitMax.Difference` below, and a second
 * definition of `X` is the collision `COLLIDING_SVAR_DEFINITION` refuses. Every
 * SVar name here is now the name `elderscale_wurm.txt` uses.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const CARD = parseCard({
  kind: 'creature',
  id: 'm13-elderscale-wurm-forge',
  name: 'Elderscale Wurm',
  rarity: 'mythic',
  set: { code: 'M13', collectorNumber: 167 },
  colors: ['G'],
  manaCost: { generic: 4, G: 3 },
  power: 7,
  toughness: 7,
  subtypes: ['Wurm'],
  keywords: ['trample'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      interveningIf: { kind: 'controllerLifeBelow', fewerThan: 7 },
      effects: [{ kind: 'setLife', amount: 7 }],
    },
    {
      kind: 'static',
      scope: 'self',
      subtype: null,
      modification: { kind: 'damageCannotReduceControllerLifeBelow', minimum: 7 },
    },
  ],
});

describe('Elderscale Wurm Forge parity', () => {
  it('emits Forge master life-total condition and LifeReduced replacement grammar', () => {
    const result = transpileCard(CARD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.script.text.split('\n');

    expect(lines).toContainEqual(
      expect.stringMatching(
        /^T:Mode\$ ChangesZone .* CheckSVar\$ YourLife \| SVarCompare\$ LT7 .* Execute\$ Trig1Effect1/u,
      ),
    );
    expect(lines).toContain('SVar:YourLife:Count$YourLifeTotal');
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^R:Event\$ LifeReduced \| ActiveZones\$ Battlefield \| ValidPlayer\$ You\.lifeGE7 \| Result\$ LT7 \| IsDamage\$ True/u,
      ),
    );
    expect(lines).toContain('SVar:ReduceLoss:DB$ ReplaceEffect | VarName$ Amount | VarValue$ X');
    expect(lines).toContain('SVar:X:ReplaceCount$Amount/LimitMax.Difference');
    expect(lines).toContain('SVar:Difference:Count$YourLifeTotal/Minus.7');
  });
});

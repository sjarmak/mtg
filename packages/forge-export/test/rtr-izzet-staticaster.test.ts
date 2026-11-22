/** Izzet Staticaster against Forge's installed card script. */
import { parseCard, renderOracleText } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const STATICASTER = parseCard({
  kind: 'creature',
  id: 'rtr-173-izzet-staticaster',
  name: 'Izzet Staticaster',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 173 },
  manaCost: { generic: 1, U: 1, R: 1 },
  colors: ['U', 'R'],
  subtypes: ['Human', 'Wizard'],
  power: 0,
  toughness: 3,
  keywords: ['haste'],
  keywordAbilities: [{ kind: 'flash' }],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      printedSourceReference: 'thisCreature',
      effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreature' } }],
      damageTargetAndCreaturesWithSameName: true,
    },
  ],
});

describe('Izzet Staticaster in Forge', () => {
  const script = mustTranspile(STATICASTER);

  it('exports the installed mapped-damage chain exactly', () => {
    expect(script).toContain('K:Flash');
    expect(script).toContain('K:Haste');
    expect(script).toContain(
      'A:AB$ DealDamage | Cost$ T | ValidTgts$ Creature | NumDmg$ 1 | DamageMap$ True | SubAbility$ DamageSame',
    );
    expect(script).toContain(
      'SVar:DamageSame:DB$ DamageAll | ValidCards$ Targeted.sameName+Other | ValidDescription$ each other creature with the same name as that creature. | NumDmg$ 1 | SubAbility$ DBDamageResolve',
    );
    expect(script).toContain('SVar:DBDamageResolve:DB$ DamageResolve');
  });

  it('keeps the exact Oracle text in the exported card', () => {
    expect(renderOracleText(STATICASTER)).toContain('{T}: This creature deals 1 damage');
    expect(script).toContain(
      'Oracle:Flash (You may cast this spell any time you could cast an instant.)\\nHaste\\n{T}: This creature deals 1 damage to target creature and each other creature with the same name as that creature.',
    );
  });
});

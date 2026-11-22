import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');
const livingWeaponAttach = bridge.slice(
  bridge.indexOf('private boolean isReviewedLivingWeaponAttach('),
  bridge.indexOf('private boolean isReviewedSwordOfFireAndIceEquip('),
);

describe('Forge bridge exact Living Weapon Equipment boundary', () => {
  it('guards the generated Germ attachment before the singleton shortcut', () => {
    expect(bridge).toContain('isReviewedLivingWeaponAttach');
    expect(livingWeaponAttach).toContain('"b_0_0_phyrexian_germ".equals(root.getParam("TokenScript"))');
    expect(livingWeaponAttach).toContain('"Remembered".equals(ability.getParam("Defined"))');
    expect(livingWeaponAttach).toContain('|| !ability.isTrigger()');
    expect(bridge).toContain('outside reviewed-living-weapon-attach-v1');
    expect(bridge).toContain('if (!session.isReviewedLivingWeaponEquip(ability))');
  });

  it('pins ordinary Equip to the two exact sources and their distinct mana-only costs', () => {
    expect(bridge).toContain('isReviewedLivingWeaponEquip');
    expect(bridge).toContain('"Kaldra Compleat".equals(source.getName())');
    expect(bridge).toContain('"Batterskull".equals(source.getName())');
    expect(bridge).toContain('"{7}".equals(mana)');
    expect(bridge).toContain('"{5}".equals(mana)');
    expect(bridge).toContain('cost.getCostParts().size() != 1');
    expect(bridge).toContain('cost.getCostParts().get(0).getClass() != CostPartMana.class');
  });
});

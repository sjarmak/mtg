import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bridge = readFileSync(new URL('../bridge/ForgeBridge.java', import.meta.url), 'utf8');

describe('Forge bridge exact residual generated-token boundary', () => {
  it('owns only structurally exact fixed-mana self-sacrifice Echo payments', () => {
    expect(
      [
        'isReviewedEchoSelfSacrificePayment',
        'ability.getApi() == ApiType.Sacrifice',
        '"Self".equals(ability.getParam("SacValid"))',
        'Set.of("DB", "SacValid", "Echo")',
        'echoMana.countX() == 0',
        'expectedMana.equals(mana)',
        'outside reviewed-echo-self-sacrifice-payment-v1',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
    expect(bridge).not.toContain('isReviewedDerangedHermitEcho');
    expect(bridge).not.toContain('outside reviewed-deranged-hermit-echo-v1');
  });

  it('pins Xenagos mixed mana to the exact loyalty ability, colors, and live creature count', () => {
    expect(
      [
        'isReviewedXenagosManaAbility',
        '"Xenagos, the Reveler".equals(source.getName())',
        'ability.getApi() == ApiType.Mana',
        '"Combo R G".equals(ability.getParam("Produced"))',
        '"Count$Valid Creature.YouCtrl".equals(source.getSVar("X"))',
        'colors.getColor() != (MagicColor.RED | MagicColor.GREEN)',
        'manaAmount != creatures',
        'outside reviewed-xenagos-mana-combo-v1',
        'outside reviewed-xenagos-single-mana-color-v1',
        'creatures != 1',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });

  it('pins the ultimate selection to eligible cards remembered by the exact seven-card Dig chain', () => {
    expect(
      [
        'isReviewedXenagosUltimateSelection',
        '"7".equals(root.getParam("DigNum"))',
        '"All".equals(root.getParam("ChangeNum"))',
        '"Creature.IsRemembered,Land.IsRemembered".equals(ability.getParam("ChangeType"))',
        '"Count$ValidExile Creature.IsRemembered,Land.IsRemembered".equals(source.getSVar("Y"))',
        'remembered == card',
        'card.isInZone(ZoneType.Exile)',
        'chooseXenagosUltimateCards',
        'outside reviewed-xenagos-ultimate-selection-v1',
      ].every((needle) => bridge.includes(needle)),
    ).toBe(true);
  });
});

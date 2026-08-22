/**
 * Enchantments compile: the blanket ones through the `S:` grammar a static
 * already uses, the Auras through `K:Enchant:` plus the clause they apply.
 *
 * Every expectation here is the shipped script for the card it names, read out
 * of Forge 2.0.14's `res/cardsfolder`. That is deliberate: this transpiler has
 * no booted Forge to check against (`mtg-17a`), so the corpus is the only
 * authority available, and a test that asserted our own output back at us
 * would prove nothing about whether Forge can read it.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

function scriptOf(card: Card): readonly string[] {
  const result = transpileCardScript(card);
  if (!result.ok) throw new Error(`expected a script, got ${JSON.stringify(result.rejections)}`);
  return result.value.lines;
}

function aura(id: string, name: string, input: Partial<CardInput> & { aura: unknown }): Card {
  return parseCard({
    kind: 'enchantment',
    id,
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 1 },
    subtypes: ['Aura'],
    ...input,
  } as CardInput);
}

describe('blanket enchantments', () => {
  it('writes Fervor as the anthem line Forge ships', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'm13-fervor',
      name: 'Fervor',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 129 },
      manaCost: { generic: 2, R: 1 },
      colors: ['R'],
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'grantKeyword', keyword: 'haste' },
        },
      ],
    });
    // Forge's own fervor.txt, minus the three `SVar:` AI hints it carries.
    expect(scriptOf(card)).toEqual([
      'Name:Fervor',
      'ManaCost:2 R',
      'Types:Enchantment',
      'S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddKeyword$ Haste | Description$ Creatures you control have haste.',
      'Oracle:Creatures you control have haste.',
    ]);
  });

  it('carries no Enchant keyword and no attachment hint', () => {
    const card = parseCard({
      kind: 'enchantment',
      id: 'tst-blanket',
      name: 'Blanket',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 2 },
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'statBonus', power: 1, toughness: 1 },
        },
      ],
    });
    const lines = scriptOf(card);
    expect(lines.some((line) => line.startsWith('K:Enchant'))).toBe(false);
    expect(lines.some((line) => line.includes('AttachAILogic'))).toBe(false);
    expect(lines).toContain(
      'S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ +1 | AddToughness$ +1 | Description$ Creatures you control get +1/+1.',
    );
  });
});

describe('creature Auras', () => {
  it('writes Pacifism as one line under a mode list, not two half-sentences', () => {
    const card = aura('m11-pacifism', 'Pacifism', {
      set: { code: 'M11', collectorNumber: 23 },
      manaCost: { generic: 1, W: 1 },
      colors: ['W'],
      aura: { enchant: 'creature', modifications: [{ kind: 'cantAttack' }, { kind: 'cantBlock' }] },
    });
    expect(scriptOf(card)).toEqual([
      'Name:Pacifism',
      'ManaCost:1 W',
      'Types:Enchantment Aura',
      'K:Enchant:Creature',
      'SVar:AttachAILogic:Curse',
      "S:Mode$ CantAttack,CantBlock | ValidCard$ Creature.EnchantedBy | Description$ Enchanted creature can't attack or block.",
      "Oracle:Enchant creature\\nEnchanted creature can't attack or block.",
    ]);
  });

  it('writes Holy Strength as one Continuous line carrying both stat params', () => {
    const card = aura('m11-holy-strength', 'Holy Strength', {
      set: { code: 'M11', collectorNumber: 24 },
      manaCost: { W: 1 },
      colors: ['W'],
      aura: { enchant: 'creature', modifications: [{ kind: 'statBonus', power: 1, toughness: 2 }] },
    });
    expect(scriptOf(card)).toEqual([
      'Name:Holy Strength',
      'ManaCost:W',
      'Types:Enchantment Aura',
      'K:Enchant:Creature',
      'SVar:AttachAILogic:Pump',
      'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ +1 | AddToughness$ +2 | Description$ Enchanted creature gets +1/+2.',
      'Oracle:Enchant creature\\nEnchanted creature gets +1/+2.',
    ]);
  });

  it("grants landwalk as Forge's colon form rather than the one-word printed keyword", () => {
    const card = aura('m11-dryads-favor', "Dryad's Favor", {
      set: { code: 'M11', collectorNumber: 169 },
      manaCost: { G: 1 },
      colors: ['G'],
      aura: { enchant: 'creature', modifications: [{ kind: 'grantLandwalk', landType: 'Forest' }] },
    });
    expect(scriptOf(card)).toContain(
      "S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddKeyword$ Landwalk:Forest | Description$ Enchanted creature has forestwalk. (It can't be blocked as long as defending player controls a Forest.)",
    );
  });

  it('writes an unblockable clause from the attacker’s side', () => {
    // `Aqueous Form`: `CantBlockBy` is the only mode in this subset that names
    // `ValidAttacker$`, and pairing it with `ValidCard$` would parse and then
    // do nothing.
    const card = aura('tst-aqueous', 'Aqueous Form', {
      manaCost: { U: 1 },
      colors: ['U'],
      aura: { enchant: 'creature', modifications: [{ kind: 'cantBeBlocked' }] },
    });
    expect(scriptOf(card)).toContain(
      "S:Mode$ CantBlockBy | ValidAttacker$ Creature.EnchantedBy | Description$ Enchanted creature can't be blocked.",
    );
  });

  it('splits a mixed clause across two lines and marks the second Secondary', () => {
    // `Cast into Darkness` ships exactly this shape: one printed sentence, two
    // modes, the whole sentence on both lines and `Secondary$ True` on the one
    // that must not print it again.
    //
    // The corpus line reads `-2/-0`, and this test read `-2/+0` until mtg-76qq:
    // a zero in a P/T change takes the sign of the number beside it, and the
    // renderer could not see the pair. The corpus also drops `AddToughness$`
    // entirely when the delta is zero where this writes `+0`; the two are the
    // same continuous effect and the divergence is left alone here rather than
    // widened into every other expectation on this page.
    const card = aura('tst-cast-into-darkness', 'Cast into Darkness', {
      manaCost: { generic: 1, B: 1 },
      colors: ['B'],
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'statBonus', power: -2, toughness: 0 }, { kind: 'cantBlock' }],
      },
    });
    const statics = scriptOf(card).filter((line) => line.startsWith('S:'));
    expect(statics).toEqual([
      "S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ -2 | AddToughness$ +0 | Description$ Enchanted creature gets -2/-0 and can't block.",
      "S:Mode$ CantBlock | ValidCard$ Creature.EnchantedBy | Secondary$ True | Description$ Enchanted creature gets -2/-0 and can't block.",
    ]);
  });

  it('writes Mind Control as the corpus writes it, and never merges the control param', () => {
    // Read off Forge 2.0.14: 42 shipped `S:` lines carry `GainControl$` and not
    // one of them carries a second body parameter beside it. `Corrupted
    // Conscience` is the shipped Aura that both takes control and grants a
    // keyword, and it writes two `Mode$ Continuous` lines rather than merging
    // them, so the merge that would fold a stat bonus into this line is a
    // combination Forge has never been handed.
    const mind = aura('m11-mind-control', 'Mind Control', {
      set: { code: 'M11', collectorNumber: 58 },
      manaCost: { generic: 3, U: 2 },
      colors: ['U'],
      aura: { enchant: 'creature', modifications: [{ kind: 'gainControl' }] },
    });
    expect(scriptOf(mind)).toEqual([
      'Name:Mind Control',
      'ManaCost:3 U U',
      'Types:Enchantment Aura',
      'K:Enchant:Creature',
      'SVar:AttachAILogic:GainControl',
      'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | GainControl$ You | Description$ You control enchanted creature.',
      'Oracle:Enchant creature\\nYou control enchanted creature.',
    ]);

    const conscience = aura('nph-corrupted-conscience', 'Corrupted Conscience', {
      manaCost: { generic: 3, U: 2 },
      colors: ['U'],
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'gainControl' }, { kind: 'statBonus', power: 1, toughness: 1 }],
      },
    });
    const statics = scriptOf(conscience).filter((line) => line.startsWith('S:'));
    expect(statics).toEqual([
      'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | GainControl$ You | Description$ You control enchanted creature. Enchanted creature gets +1/+1.',
      'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ +1 | AddToughness$ +1 | Secondary$ True | Description$ You control enchanted creature. Enchanted creature gets +1/+1.',
    ]);
    // The clause is a gift and the hint still has to say control: the AI needs
    // to know it is buying a creature, not pumping one it already has.
    expect(scriptOf(conscience)).toContain('SVar:AttachAILogic:GainControl');
  });

  /**
   * The one clause in the subset that is not an `S:` line. Forge writes
   * "doesn't untap" as a replacement on the untap event, and the two cases
   * below are the two shapes the corpus ships: the rule alone, which writes no
   * static line at all (Claustrophobia, Bitter Chill), and the rule beside a
   * stat change, which writes both and lets each line carry only its own
   * sentence (Sinking Feeling, Immobilizing Ink).
   */
  it('writes the untap hold as a CantHappen replacement rather than a static', () => {
    const chill = aura('khm-bitter-chill', 'Bitter Chill', {
      set: { code: 'KHM', collectorNumber: 51 },
      manaCost: { generic: 1, U: 1 },
      colors: ['U'],
      aura: { enchant: 'creature', modifications: [{ kind: 'doesNotUntap' }] },
    });
    expect(scriptOf(chill)).toEqual([
      'Name:Bitter Chill',
      'ManaCost:1 U',
      'Types:Enchantment Aura',
      'K:Enchant:Creature',
      'SVar:AttachAILogic:Curse',
      "R:Event$ Untap | ActiveZones$ Battlefield | ValidCard$ Creature.EnchantedBy | ValidStepTurnToController$ You | Layer$ CantHappen | Description$ Enchanted creature doesn't untap during its controller's untap step.",
      "Oracle:Enchant creature\\nEnchanted creature doesn't untap during its controller's untap step.",
    ]);
    expect(scriptOf(chill).some((line) => line.startsWith('S:'))).toBe(false);
  });

  it('keeps the untap sentence out of the static line beside it', () => {
    const feeling = aura('mid-sinking-feeling', 'Sinking Feeling', {
      set: { code: 'MID', collectorNumber: 66 },
      manaCost: { U: 1 },
      colors: ['U'],
      aura: {
        enchant: 'creature',
        modifications: [{ kind: 'statBonus', power: -1, toughness: -1 }, { kind: 'doesNotUntap' }],
      },
    });
    const lines = scriptOf(feeling);
    expect(lines.filter((line) => line.startsWith('S:'))).toEqual([
      'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ -1 | AddToughness$ -1 | Description$ Enchanted creature gets -1/-1.',
    ]);
    // The replacement carries its own sentence and no `Secondary$ True`: the
    // convention that repeats the whole paragraph on every line is an `S:`
    // convention and stops at the `R:` line.
    expect(lines.at(-2)).toBe(
      "R:Event$ Untap | ActiveZones$ Battlefield | ValidCard$ Creature.EnchantedBy | ValidStepTurnToController$ You | Layer$ CantHappen | Description$ Enchanted creature doesn't untap during its controller's untap step.",
    );
    expect(lines.some((line) => line.includes('Secondary$ True'))).toBe(false);
  });

  it('hints Curse for a clause that stops the creature and Pump for one that helps it', () => {
    // Not cosmetic: without `Curse` Forge's AI reads a Pacifism as a gift and
    // enchants its own creature with it, which moves every parity number the
    // Forge oracle produces.
    const shrink = aura('tst-shrink', 'Shrink', {
      aura: { enchant: 'creature', modifications: [{ kind: 'statBonus', power: -3, toughness: -1 }] },
    });
    const grow = aura('tst-grow', 'Grow', {
      aura: { enchant: 'creature', modifications: [{ kind: 'statBonus', power: 3, toughness: 1 }] },
    });
    const unblockable = aura('tst-slip', 'Slip Past', {
      aura: { enchant: 'creature', modifications: [{ kind: 'cantBeBlocked' }] },
    });
    expect(scriptOf(shrink)).toContain('SVar:AttachAILogic:Curse');
    expect(scriptOf(grow)).toContain('SVar:AttachAILogic:Pump');
    expect(scriptOf(unblockable)).toContain('SVar:AttachAILogic:Pump');
  });
});

describe('an Aura clause Forge cannot be handed', () => {
  /**
   * Quag Sickness (M11 111) is the refusal, and its shape is why. Forge writes
   * a scaled continuous bonus as a counting `SVar` plus `AddPower$ X` reading
   * it, which is a second grammar `modificationLine` does not emit -- it writes
   * fixed numbers. An exported script that dropped the clause would boot as an
   * Aura that does nothing, which is the divergence a rejection exists to stop.
   */
  it('refuses a rate bonus by name rather than writing a fixed number', () => {
    const sickness = aura('m11-quag-sickness', 'Quag Sickness', {
      set: { code: 'M11', collectorNumber: 111 },
      manaCost: { generic: 2, B: 1 },
      colors: ['B'],
      aura: {
        enchant: 'creature',
        modifications: [
          {
            kind: 'statBonusPer',
            power: -1,
            toughness: -1,
            each: { kind: 'landsWithSubtype', subtype: 'Swamp', whose: 'you' },
          },
        ],
      },
    });
    const result = transpileCardScript(sickness);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Quag Sickness transpiled');
    expect(result.rejections.map((entry) => entry.code)).toEqual(['UNMAPPED_EFFECT_KIND']);
    expect(result.rejections[0]?.message).toContain('statBonusPer');
  });
});

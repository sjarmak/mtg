import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedAnimateDeadRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const EXACT = [
  'Name:Animate Dead',
  'ManaCost:1 B',
  'Types:Enchantment Aura',
  'K:Enchant:Creature.inZoneGraveyard:creature card in a graveyard',
  'SVar:AttachAILogic:Reanimate',
  'SVar:AttachAITgts:Creature.!namedWorldgorger Dragon',
  'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | IsPresent$ Card.StrictlySelf | Execute$ TrigReanimate | TriggerDescription$ When CARDNAME enters, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with CARDNAME." Return enchanted creature card to the battlefield under your control and attach CARDNAME to it. When CARDNAME leaves the battlefield, that creature\'s controller sacrifices it.',
  'SVar:TrigReanimate:DB$ ChangeZone | Origin$ Graveyard | Destination$ Battlefield | Defined$ Enchanted | RememberChanged$ True | GainControl$ True | SubAbility$ DBAnimate',
  'SVar:DBAnimate:DB$ Animate | Defined$ Self | Keywords$ Enchant:Creature.IsRemembered:creature put onto the battlefield with CARDNAME | RemoveKeywords$ Enchant:Creature.inZoneGraveyard:creature card in a graveyard | Duration$ Permanent | SubAbility$ DBAttach',
  'SVar:DBAttach:DB$ Attach | Defined$ Remembered | SubAbility$ DBDelay',
  "SVar:DBDelay:DB$ DelayedTrigger | Mode$ ChangesZone | ValidCard$ Card.Self | Origin$ Battlefield | Execute$ TrigSacrifice | RememberObjects$ RememberedLKI | TriggerDescription$ When CARDNAME leaves the battlefield, that creature's controller sacrifices it.",
  'SVar:TrigSacrifice:DB$ SacrificeAll | Defined$ DelayTriggerRememberedLKI',
  'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ DBCleanup | Static$ True',
  'SVar:DBCleanup:DB$ Cleanup | ClearRemembered$ True',
  'S:Mode$ Continuous | Affected$ Creature.EnchantedBy | AddPower$ -1 | Description$ Enchanted creature gets -1/-0.',
  'DeckHas:Ability$Graveyard',
  'DeckHints:Ability$Mill|Discard & Keyword$Dredge',
  'Oracle:Enchant creature card in a graveyard\\nWhen Animate Dead enters, if it\'s on the battlefield, it loses "enchant creature card in a graveyard" and gains "enchant creature put onto the battlefield with Animate Dead." Return enchanted creature card to the battlefield under your control and attach Animate Dead to it. When Animate Dead leaves the battlefield, that creature\'s controller sacrifices it.\\nEnchanted creature gets -1/-0.',
] as const;

const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedAnimateDeadRefusals(
    new TextEncoder().encode(`${lines.join('\n')}\n`),
    loadLegacyCubeSyntaxReview(),
  );

describe('Legacy Cube reviewed Animate Dead boundary', () => {
  it('lifts exactly the installed graveyard Aura and reanimation lifecycle', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace('Name:Animate Dead', 'Name:Nearly Dead'))],
    ['mana cost', EXACT.map((line) => line.replace('ManaCost:1 B', 'ManaCost:B'))],
    ['card type', EXACT.map((line) => line.replace('Types:Enchantment Aura', 'Types:Enchantment'))],
    ['graveyard enchant domain', EXACT.map((line) => line.replace('Creature.inZoneGraveyard', 'Creature'))],
    ['attachment logic', EXACT.map((line) => line.replace('AttachAILogic:Reanimate', 'AttachAILogic:Pump'))],
    [
      'attachment candidate filter',
      EXACT.map((line) => line.replace('Creature.!namedWorldgorger Dragon', 'Creature')),
    ],
    ['entry origin', EXACT.map((line) => line.replace('Origin$ Any', 'Origin$ Stack'))],
    [
      'entry presence guard',
      EXACT.map((line) => line.replace('IsPresent$ Card.StrictlySelf', 'IsPresent$ Card.Self')),
    ],
    ['reanimation origin', EXACT.map((line) => line.replace('Origin$ Graveyard', 'Origin$ Exile'))],
    ['controller transfer', EXACT.map((line) => line.replace('GainControl$ True', 'GainControl$ False'))],
    [
      'remembered object',
      EXACT.map((line) => line.replace('RememberChanged$ True', 'RememberChanged$ False')),
    ],
    ['animate API', EXACT.map((line) => line.replace('DB$ Animate', 'DB$ Pump'))],
    ['new enchant domain', EXACT.map((line) => line.replace('Creature.IsRemembered', 'Creature'))],
    [
      'old enchant removal',
      EXACT.map((line) => line.replace('RemoveKeywords$ Enchant:', 'RemoveKeywords$ Flying:')),
    ],
    ['attachment referent', EXACT.map((line) => line.replace('Defined$ Remembered', 'Defined$ Self'))],
    ['delayed trigger origin', EXACT.map((line) => line.replace('Origin$ Battlefield', 'Origin$ Graveyard'))],
    [
      'delayed remembered LKI',
      EXACT.map((line) => line.replace('RememberObjects$ RememberedLKI', 'RememberObjects$ Remembered')),
    ],
    [
      'sacrifice referent',
      EXACT.map((line) => line.replace('Defined$ DelayTriggerRememberedLKI', 'Defined$ You')),
    ],
    ['cleanup action', EXACT.map((line) => line.replace('ClearRemembered$ True', 'ClearRemembered$ False'))],
    ['power modifier', EXACT.map((line) => line.replace('AddPower$ -1', 'AddPower$ -2'))],
    [
      'Oracle text',
      EXACT.map((line) => line.replace('Enchanted creature gets -1/-0.', 'Enchanted creature gets -2/-0.')),
    ],
    ['missing line', EXACT.filter((line) => !line.startsWith('SVar:DBAttach:'))],
    ['line order', [EXACT[0], EXACT[1], EXACT[2], EXACT[4], EXACT[3], ...EXACT.slice(5)]],
    ['additional line', [...EXACT, 'SVar:Unreviewed:DB$ Attach | Defined$ Remembered']],
  ] as const)('keeps a hostile %s mutation closed', (_label, mutation) => {
    expect(refusal(mutation)).toContain('exact reviewed Animate Dead composition');
  });
});

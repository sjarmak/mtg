import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedUmezawasJitteRefusals, loadLegacyCubeSyntaxReview } from '@mtg/data';

const EXACT = [
  "Name:Umezawa's Jitte",
  'ManaCost:2',
  'Types:Legendary Artifact Equipment',
  'K:Equip:2',
  'T:Mode$ DamageDealtOnce | CombatDamage$ True | ValidSource$ Creature.EquippedBy | Execute$ TrigPutCounter | TriggerZones$ Battlefield | TriggerDescription$ Whenever equipped creature deals combat damage, put two charge counters on CARDNAME.',
  'A:AB$ Charm | Cost$ SubCounter<1/CHARGE> | Choices$ JittePump,JitteCurse,JitteLife | Defined$ You',
  'SVar:JittePump:DB$ Pump | Defined$ Equipped | NumAtt$ +2 | NumDef$ +2 | SpellDescription$ Equipped creature gets +2/+2 until end of turn.',
  'SVar:JitteCurse:DB$ Pump | ValidTgts$ Creature | NumAtt$ -1 | NumDef$ -1 | IsCurse$ True | SpellDescription$ Target creature gets -1/-1 until end of turn.',
  'SVar:JitteLife:DB$ GainLife | LifeAmount$ 2 | SpellDescription$ You gain 2 life.',
  'SVar:TrigPutCounter:DB$ PutCounter | CounterType$ CHARGE | CounterNum$ 2',
  'DeckHas:Ability$Counters|LifeGain',
  "Oracle:Whenever equipped creature deals combat damage, put two charge counters on Umezawa's Jitte.\\nRemove a charge counter from Umezawa's Jitte: Choose one —\\n• Equipped creature gets +2/+2 until end of turn.\\n• Target creature gets -1/-1 until end of turn.\\n• You gain 2 life.\\nEquip {2}",
] as const;

const syntax = loadLegacyCubeSyntaxReview();
const refusal = (lines: readonly string[]): readonly string[] =>
  legacyCubeReviewedUmezawasJitteRefusals(Buffer.from(lines.join('\n')), syntax);

describe("Legacy Cube reviewed Umezawa's Jitte boundary", () => {
  it('admits only the exact complete installed script', () => {
    expect(refusal(EXACT)).toEqual([]);
  });

  it.each([
    ['identity', EXACT.map((line) => line.replace("Name:Umezawa's Jitte", 'Name:Near Jitte'))],
    ['Equip cost', EXACT.map((line) => line.replace('K:Equip:2', 'K:Equip:3'))],
    ['trigger mode', EXACT.map((line) => line.replace('Mode$ DamageDealtOnce', 'Mode$ DamageDone'))],
    ['combat condition', EXACT.map((line) => line.replace('CombatDamage$ True', 'CombatDamage$ False'))],
    ['trigger source', EXACT.map((line) => line.replace('Creature.EquippedBy', 'Creature.YouCtrl'))],
    ['counter type', EXACT.map((line) => line.replace('CounterType$ CHARGE', 'CounterType$ +1/+1'))],
    ['counter amount', EXACT.map((line) => line.replace('CounterNum$ 2', 'CounterNum$ 3'))],
    ['activation cost', EXACT.map((line) => line.replace('SubCounter<1/CHARGE>', 'SubCounter<2/CHARGE>'))],
    [
      'mode membership',
      EXACT.map((line) => line.replace('JittePump,JitteCurse,JitteLife', 'JittePump,JitteLife')),
    ],
    ['pump amount', EXACT.map((line) => line.replace('NumAtt$ +2', 'NumAtt$ +3'))],
    ['curse target', EXACT.map((line) => line.replace('ValidTgts$ Creature', 'ValidTgts$ Player'))],
    ['curse amount', EXACT.map((line) => line.replace('NumAtt$ -1', 'NumAtt$ -2'))],
    ['life amount', EXACT.map((line) => line.replace('LifeAmount$ 2', 'LifeAmount$ 3'))],
    ['line order', [EXACT[1], EXACT[0], ...EXACT.slice(2)]],
    ['extra mechanic', [...EXACT, 'A:AB$ Draw | Cost$ 0 | NumCards$ 1']],
  ])('refuses %s drift as an exact-composition failure', (_label, mutation) => {
    expect(refusal(mutation)).toContain("exact reviewed Umezawa's Jitte composition");
  });
});

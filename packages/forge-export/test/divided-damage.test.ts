/** Exact M11 scripts normalized against Card-Forge/forge at the pinned revision below. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const PINNED_FORGE_REVISION = '6764fa00270f5eb5da4570b57a782b7231362ad1';

function scriptOf(input: CardInput): string {
  const result = transpileCard(parseCard(input));
  if (!result.ok) throw new Error(`unexpected rejection: ${JSON.stringify(result.rejections)}`);
  return result.script.text;
}

function normalizePinnedForgeScript(script: string): string {
  return script.replace(
    'SpellDescription$ CARDNAME gets +1/+0 until end of turn.',
    'SpellDescription$ This creature gets +1/+0 until end of turn.',
  );
}

describe('M11 divided damage in Forge', () => {
  it('pins the upstream evidence revision used by these normalized fixtures', () => {
    expect(PINNED_FORGE_REVISION).toMatch(/^[0-9a-f]{40}$/u);
  });
  it('refuses unproven target-cost arithmetic instead of inventing Forge syntax', () => {
    const result = transpileCard(
      parseCard({
        kind: 'sorcery',
        id: 'target-cost-two',
        name: 'Costly Volley',
        rarity: 'rare',
        set: { code: 'TST', collectorNumber: 1 },
        manaCost: { R: 1 },
        colors: ['R'],
        targetCostIncrease: { genericPerTargetBeyondFirst: 2 },
        effects: [
          {
            kind: 'dealDamage',
            amount: 1,
            target: { kind: 'anyTarget', anyNumber: true },
            division: { kind: 'evenlyRoundedDown' },
          },
        ],
      } as CardInput),
    );

    expect(result).toEqual({
      ok: false,
      rejections: [
        {
          code: 'UNMAPPED_TARGET_COST_INCREASE',
          cardId: 'target-cost-two',
          path: 'targetCostIncrease.genericPerTargetBeyondFirst',
          message:
            "only Fireball's source-proven one-generic relative increase is mapped; exporting a larger multiplier would guess at Forge arithmetic syntax",
        },
      ],
    });
  });

  it('keeps supporting-variable names distinct across authored divided-damage triggers', () => {
    const script = scriptOf({
      kind: 'creature',
      id: 'two-distributions',
      name: 'Twin Distributor',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: { generic: 4, R: 2 },
      colors: ['R'],
      power: 6,
      toughness: 6,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            {
              kind: 'dealDamage',
              amount: 2,
              target: { kind: 'anyTarget', count: 2, minimum: 1 },
              division: { kind: 'asYouChoose' },
            },
          ],
        },
        {
          kind: 'triggered',
          condition: 'selfAttacks',
          effects: [
            {
              kind: 'dealDamage',
              amount: 3,
              target: { kind: 'anyTarget', count: 3, minimum: 1 },
              division: { kind: 'asYouChoose' },
            },
          ],
        },
      ],
    } as CardInput);

    expect(script).toContain('Execute$ Trig1Effect1');
    expect(script).toContain('SVar:Trig1Effect1:DB$ DealDamage');
    expect(script).toContain('Execute$ Trig2Effect1');
    expect(script).toContain('SVar:Trig2Effect1:DB$ DealDamage');
    expect(script.match(/SVar:DmgDistro:/g)).toBeNull();
  });

  it('matches Forge Fireball line for line', () => {
    expect(
      scriptOf({
        kind: 'sorcery',
        id: 'm11-138-fireball-forge',
        name: 'Fireball',
        rarity: 'uncommon',
        set: { code: 'M11', collectorNumber: 138 },
        manaCost: { R: 1, hasX: true },
        colors: ['R'],
        targetCostIncrease: { genericPerTargetBeyondFirst: 1 },
        effects: [
          {
            kind: 'dealDamage',
            amount: { kind: 'chosenX' },
            target: { kind: 'anyTarget', anyNumber: true },
            division: { kind: 'evenlyRoundedDown' },
          },
        ],
      } as CardInput),
    ).toBe(
      [
        'Name:Fireball',
        'ManaCost:X R',
        'Types:Sorcery',
        'S:Mode$ RaiseCost | ValidCard$ Card.Self | Type$ Spell | Amount$ IncreaseCost | Relative$ True | EffectZone$ All | Description$ This spell costs {1} more to cast for each target beyond the first.',
        'A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ X | TargetMin$ 0 | TargetMax$ MaxTargets | DivideEvenly$ RoundedDown | SpellDescription$ CARDNAME deals X damage divided evenly, rounded down, among any number of targets.',
        'SVar:X:Count$xPaid',
        'SVar:MaxTargets:SVar$MaxPlayers/Plus.MaxPermanents',
        'SVar:MaxPlayers:PlayerCountPlayers$Amount',
        'SVar:MaxPermanents:Count$Valid Any',
        'SVar:IncreaseCost:TargetedObjects$Amount/Minus.1',
        'Oracle:This spell costs {1} more to cast for each target beyond the first.\\nFireball deals X damage divided evenly, rounded down, among any number of targets.',
        '',
      ].join('\n'),
    );
  });

  it('matches Forge Inferno Titan line for line', () => {
    expect(
      scriptOf({
        kind: 'creature',
        id: 'm11-146-inferno-titan-forge',
        name: 'Inferno Titan',
        rarity: 'mythic',
        set: { code: 'M11', collectorNumber: 146 },
        manaCost: { generic: 4, R: 2 },
        colors: ['R'],
        subtypes: ['Giant'],
        power: 6,
        toughness: 6,
        abilities: [
          {
            kind: 'activated',
            cost: { mana: { R: 1 } },
            effects: [
              {
                kind: 'pumpUntilEndOfTurn',
                power: 1,
                toughness: 0,
                target: { kind: 'selfCreature' },
              },
            ],
          },
          {
            kind: 'triggered',
            condition: 'selfEntersOrAttacks',
            effects: [
              {
                kind: 'dealDamage',
                amount: 3,
                target: { kind: 'anyTarget', count: 3, minimum: 1 },
                division: { kind: 'asYouChoose' },
              },
            ],
          },
        ],
      } as CardInput),
    ).toBe(
      normalizePinnedForgeScript(
        [
          'Name:Inferno Titan',
          'ManaCost:4 R R',
          'Types:Creature Giant',
          'PT:6/6',
          'A:AB$ Pump | Cost$ R | Defined$ Self | NumAtt$ +1 | SpellDescription$ CARDNAME gets +1/+0 until end of turn.',
          'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ DmgDistro | TriggerDescription$ Whenever CARDNAME enters or attacks, it deals 3 damage divided as you choose among one, two, or three targets.',
          'T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ DmgDistro | Secondary$ True | TriggerDescription$ Whenever CARDNAME enters or attacks, it deals 3 damage divided as you choose among one, two, or three targets.',
          'SVar:DmgDistro:DB$ DealDamage | ValidTgts$ Any | TgtPrompt$ Select any target to distribute damage to | NumDmg$ 3 | TargetMin$ 1 | TargetMax$ 3 | DividedAsYouChoose$ 3',
          'SVar:HasAttackEffect:TRUE',
          'Oracle:{R}: This creature gets +1/+0 until end of turn.\\nWhenever Inferno Titan enters or attacks, it deals 3 damage divided as you choose among one, two, or three targets.',
          '',
        ].join('\n'),
      ),
    );
  });
});

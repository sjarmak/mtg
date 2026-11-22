/** Vraska the Unseen against Forge's installed card and token scripts. */
import { parseCard, type CardInput } from '@mtg/dsl';
import { forgeTokenScriptName, transpileTokenScript } from '@mtg/forge-export';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const VRASKA = parseCard({
  kind: 'planeswalker',
  id: 'rtr-208-vraska-the-unseen-forge',
  name: 'Vraska the Unseen',
  rarity: 'mythic',
  set: { code: 'RTR', collectorNumber: 208 },
  manaCost: { generic: 3, B: 1, G: 1 },
  colors: ['B', 'G'],
  supertypes: ['legendary'],
  subtypes: ['Vraska'],
  startingLoyalty: 5,
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: 1,
      effects: [],
      retaliateForCombatDamageUntilYourNextTurn: true,
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -3,
      effects: [
        {
          kind: 'destroyPermanent',
          target: { kind: 'targetPermanent', filter: { excludeCardTypes: ['land'] } },
        },
      ],
    },
    {
      kind: 'activated',
      cost: { mana: {} },
      loyaltyCost: -7,
      effects: [
        {
          kind: 'createToken',
          count: 3,
          token: {
            quoteAbilities: true,
            inlineQuotedAbilities: true,
            name: 'Assassin',
            colors: ['B'],
            subtypes: ['Assassin'],
            power: 1,
            toughness: 1,
            keywords: [],
            abilities: [
              {
                kind: 'triggered',
                condition: 'selfDealsCombatDamageToPlayer',
                effects: [{ kind: 'loseGame', target: { kind: 'triggeringPlayer' } }],
              },
            ],
          },
        },
      ],
    },
  ],
} as CardInput);

describe('Vraska the Unseen in Forge', () => {
  const script = mustTranspile(VRASKA);
  const description =
    'Until your next turn, whenever a creature deals combat damage to CARDNAME, destroy that creature.';

  it('exports the installed temporary Animate and retaliation chain exactly', () => {
    expect(script).toContain(
      `A:AB$ Animate | Cost$ AddCounter<1/LOYALTY> | Planeswalker$ True | Defined$ Self | Triggers$ TrigVraska | Duration$ UntilYourNextTurn | AILogic$ EOT | SpellDescription$ ${description} | StackDescription$ ${description}`,
    );
    expect(script).toContain(
      `SVar:TrigVraska:Mode$ DamageDone | ValidSource$ Creature | ValidTarget$ Card.Self | TriggerZones$ Battlefield | CombatDamage$ True | Execute$ VraskaGaze | TriggerDescription$ ${description}`,
    );
    expect(script).toContain('SVar:VraskaGaze:DB$ Destroy | Defined$ TriggeredSourceLKICopy');
  });

  it('exports the nonland destroy and three Assassin tokens with an executable loss trigger', () => {
    expect(script).toContain(
      'A:AB$ Destroy | Cost$ SubCounter<3/LOYALTY> | ValidTgts$ Permanent.nonLand | Planeswalker$ True',
    );
    expect(script).toContain(
      'A:AB$ Token | Cost$ SubCounter<7/LOYALTY> | TokenAmount$ 3 | TokenScript$ b_1_1_assassin_lose_con',
    );
    const token = VRASKA.abilities[2]?.kind === 'activated' ? VRASKA.abilities[2].effects[0] : undefined;
    if (token?.kind !== 'createToken') throw new Error('Vraska Assassin token disappeared');
    expect(forgeTokenScriptName(token.token)).toBe('b_1_1_assassin_lose_con');
    expect(transpileTokenScript(token.token)).toContain('DB$ LosesGame');
  });
});

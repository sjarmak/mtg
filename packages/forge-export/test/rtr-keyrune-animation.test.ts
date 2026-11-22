/** Forge 2.0.14's checked-in AB$ Animate form for RTR Keyrunes. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput, type Color, type Keyword } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

function keyrune(input: {
  readonly id: string;
  readonly name: string;
  readonly collectorNumber: number;
  readonly mana: readonly [Color, Color];
  readonly power: number;
  readonly toughness: number;
  readonly colors: readonly [Color, Color];
  readonly subtype: string;
  readonly keywords?: readonly Keyword[];
  readonly printedDurationFirst?: true;
  readonly loot?: true;
}): CardInput {
  return {
    kind: 'artifact',
    id: input.id,
    name: input.name,
    rarity: 'uncommon',
    set: { code: 'RTR', collectorNumber: input.collectorNumber },
    manaCost: { generic: 3 },
    colors: [],
    subtypes: [],
    abilities: [
      {
        kind: 'activated',
        cost: { mana: {}, tapSelf: true },
        effects: [{ kind: 'addMana', produces: [...input.mana], amount: 1 }],
      },
      {
        kind: 'activated',
        printedSourceReference: 'thisArtifact',
        cost: { mana: { [input.mana[0]]: 1, [input.mana[1]]: 1 }, tapSelf: false },
        effects: [
          {
            kind: 'animateSourceUntilEndOfTurn',
            power: input.power,
            toughness: input.toughness,
            colors: [...input.colors],
            subtypes: [input.subtype],
            keywords: [...(input.keywords ?? [])],
            ...(input.printedDurationFirst === true ? { printedDurationFirst: true as const } : {}),
            target: { kind: 'selfPermanent' },
          },
        ],
      },
      ...(input.loot === true
        ? [
            {
              kind: 'triggered' as const,
              condition: 'selfDealsCombatDamageToPlayer' as const,
              printedSourceReference: 'thisArtifact' as const,
              optional: true as const,
              effects: [
                { kind: 'drawCards' as const, count: 1, target: { kind: 'noTarget' as const } },
                { kind: 'discardCards' as const, count: 1, target: { kind: 'noTarget' as const } },
              ],
            },
          ]
        : []),
    ],
  };
}

function lines(input: CardInput): readonly string[] {
  const result = transpileCardScript(parseCard(input));
  if (!result.ok) throw new Error(JSON.stringify(result.rejections));
  return result.value.lines;
}

describe('Keyrune Forge export', () => {
  it('writes Azorius Keyrune exactly as Forge 2.0.14 does', () => {
    expect(
      lines(
        keyrune({
          id: 'rtr-225',
          name: 'Azorius Keyrune',
          collectorNumber: 225,
          mana: ['W', 'U'],
          power: 2,
          toughness: 2,
          colors: ['W', 'U'],
          subtype: 'Bird',
          keywords: ['flying'],
        }),
      ),
    ).toContain(
      'A:AB$ Animate | Cost$ W U | Defined$ Self | Power$ 2 | Toughness$ 2 | Types$ Artifact,Creature,Bird | RemoveCreatureTypes$ True | Colors$ White,Blue | OverwriteColors$ True | Keywords$ Flying | SpellDescription$ CARDNAME becomes a 2/2 white and blue Bird artifact creature with flying until end of turn.',
    );
  });

  it('keeps Izzet Keyrune duration-first wording without a Keywords parameter', () => {
    expect(
      lines(
        keyrune({
          id: 'rtr-230',
          name: 'Izzet Keyrune',
          collectorNumber: 230,
          mana: ['U', 'R'],
          power: 2,
          toughness: 1,
          colors: ['U', 'R'],
          subtype: 'Elemental',
          printedDurationFirst: true,
          loot: true,
        }),
      ),
    ).toContain(
      'A:AB$ Animate | Cost$ U R | Defined$ Self | Power$ 2 | Toughness$ 1 | Types$ Artifact,Creature,Elemental | RemoveCreatureTypes$ True | Colors$ Blue,Red | OverwriteColors$ True | SpellDescription$ Until end of turn, CARDNAME becomes a 2/1 blue and red Elemental artifact creature.',
    );
    expect(
      lines(
        keyrune({
          id: 'rtr-230',
          name: 'Izzet Keyrune',
          collectorNumber: 230,
          mana: ['U', 'R'],
          power: 2,
          toughness: 1,
          colors: ['U', 'R'],
          subtype: 'Elemental',
          printedDurationFirst: true,
          loot: true,
        }),
      ),
    ).toEqual(
      expect.arrayContaining([
        'T:Mode$ DamageDone | ValidSource$ Card.Self | ValidTarget$ Player | CombatDamage$ True | Execute$ TrigLoot | TriggerDescription$ Whenever CARDNAME deals combat damage to a player, you may draw a card. If you do, discard a card.',
        'SVar:TrigLoot:AB$ Discard | Defined$ You | Mode$ TgtChoose | NumCards$ 1 | Cost$ Draw<1/You>',
      ]),
    );
  });
});

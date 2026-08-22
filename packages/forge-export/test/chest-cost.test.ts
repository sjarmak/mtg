/**
 * A Chest crosses into Forge charging the Keys it prints.
 *
 * `ActivationCost.sacrificeOther` is Forge's `Sac<2/Key>` and nothing exotic:
 * 2.0.14 ships Goblin-, Saproling- and Food-eating costs in exactly that form.
 * What was missing was the other half. `@mtg/dsl`'s renderer printed no clause
 * for it, so `renderAbility` returned a line whose cost read `{1}:` while
 * `transpileAbility` built a `Cost$` charging two Keys beside it, and the card
 * was refused rather than exported costing more than it says. The renderer
 * prints the clause now (`packages/dsl/test/sacrifice-other-cost.test.ts`), so
 * the two halves of the script agree and the refusal is gone with the reason
 * for it.
 *
 * What no test in this checkout settles is whether Forge resolves a subtype our
 * set invented: `Key` reaches the script the same way it reaches the card's
 * `Types:` line, which is the standing "read off `res/cardsfolder`, never off a
 * game we ran" gap the whole package carries.
 */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const CHEST = parseCard({
  kind: 'artifact',
  id: 'xmp-small-chest',
  name: 'Small Chest',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 40 },
  manaCost: { generic: 2 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 }, sacrificeOther: { count: 2, subtype: 'Key' } },
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    },
  ],
});

describe('an activation that sacrifices permanents the cost names', () => {
  it('exports the cost Forge charges and the line the card prints, and they agree', () => {
    const result = transpileCard(CHEST);
    if (!result.ok) throw new Error(JSON.stringify(result.rejections));
    expect(result.script.text).toContain(
      'A:AB$ GainLife | Cost$ 1 Sac<2/Key> | Defined$ You | LifeAmount$ 2 | SpellDescription$ {1}, Sacrifice two Keys: You gain 2 life.',
    );
    // The `SpellDescription$` is the DSL's own printed line, so the assertion
    // above is only worth something while the two are actually the same string.
    expect(renderOracleText(CHEST)).toBe('{1}, Sacrifice two Keys: You gain 2 life.');
  });

  it('charges the source and the named permanents as two costs', () => {
    const both = parseCard({
      ...CHEST,
      id: 'xmp-small-chest-both',
      abilities: [
        {
          kind: 'activated',
          cost: {
            mana: { generic: 1 },
            sacrificeSelf: true,
            sacrificeOther: { count: 1, subtype: 'Key' },
          },
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const result = transpileCard(both);
    if (!result.ok) throw new Error(JSON.stringify(result.rejections));
    expect(result.script.text).toContain('Cost$ 1 Sac<1/CARDNAME> Sac<1/Key>');
  });

  it('still exports the same card once the clause is gone', () => {
    const plain = parseCard({
      ...CHEST,
      id: 'xmp-small-chest-plain',
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 }, sacrificeSelf: true },
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const result = transpileCard(plain);
    if (!result.ok) throw new Error(JSON.stringify(result.rejections));
    expect(result.script.text).toContain('Cost$ 1 Sac<1/CARDNAME>');
  });
});

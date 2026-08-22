/**
 * `targetArtifactOrEnchantment` as Forge writes it.
 *
 * The kind is a union of two card types rather than a restriction on one, so it
 * exports as a comma-separated selector and not as a dotted qualifier. That is
 * read off 2.0.14's own `res/cardsfolder` rather than guessed: 177 cards write
 * `ValidTgts$ Artifact,Enchantment`, two write the reverse order, and the two
 * whose printed text is verbatim what this kind prints are
 *
 *   Disenchant     A:SP$ Destroy    | ValidTgts$ Artifact,Enchantment
 *   Altar's Light  A:SP$ ChangeZone | ValidTgts$ Artifact,Enchantment | Destination$ Exile
 *
 * so the destroy arm and the exile arm take the same selector and differ only
 * in the API they already differed in. What is asserted here is the selector on
 * all three rows the kind is legal on, because a kind added to a target list
 * and forgotten in `FORGE_VALID_TARGETS` is a transpile that silently exports
 * the wrong card rather than a build that fails.
 *
 * Everything here is read off `res/cardsfolder` rather than off a booted Forge,
 * which is the standing limit on the whole package (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, EffectInput } from '@mtg/dsl';
import { mustTranspile, spell } from './helpers';

function abilityLine(card: Card): string {
  const line = mustTranspile(card)
    .split('\n')
    .find((text) => text.startsWith('A:'));
  if (line === undefined) throw new Error('no A: line');
  return line;
}

function lineFor(name: string, effect: EffectInput): string {
  return abilityLine(spell(name, [effect]));
}

const AIM = { kind: 'targetArtifactOrEnchantment' } as const;

describe('a spell that names an artifact or an enchantment', () => {
  it('destroys one as Disenchant does', () => {
    const line = lineFor('Sundering Light', { kind: 'destroyPermanent', target: AIM });
    expect(line).toContain('SP$ Destroy');
    expect(line).toContain('ValidTgts$ Artifact,Enchantment');
  });

  /**
   * Blue's answer to a permanent it cannot destroy, and the reason the kind
   * sits on three rows rather than one: a color with no destroy would otherwise
   * have no answer to an artifact at all.
   */
  it('bounces one on the same ChangeZone row a creature bounce takes', () => {
    const line = lineFor('Tideglass Recall', { kind: 'returnToHand', target: AIM });
    expect(line).toContain('SP$ ChangeZone');
    expect(line).toContain('ValidTgts$ Artifact,Enchantment');
    expect(line).toContain('Destination$ Hand');
  });

  it("exiles one as Altar's Light does", () => {
    const line = lineFor('Hallowed Erasure', { kind: 'exileTarget', target: AIM });
    expect(line).toContain('SP$ ChangeZone');
    expect(line).toContain('ValidTgts$ Artifact,Enchantment');
    expect(line).toContain('Destination$ Exile');
  });

  /**
   * The negative control, on the row that made this kind necessary: a creature
   * answer and a permanent answer are different selectors, and a mapping that
   * had reused the creature one would pass every assertion above.
   */
  it('is a different selector from the creature the same API takes', () => {
    const line = lineFor('Sundering Blade', { kind: 'destroyPermanent', target: { kind: 'targetCreature' } });
    expect(line).toContain('ValidTgts$ Creature');
    expect(line).not.toContain('Artifact');
  });
});

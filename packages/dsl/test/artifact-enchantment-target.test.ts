/**
 * The targeting mode that names an artifact or an enchantment.
 *
 * `TARGET_KINDS` gained `targetArtifactOrEnchantment` because a board answer
 * this vocabulary could not print is a board answer nobody in a generated set
 * had: every color's answer to a permanent was destroy, bounce or tap aimed at
 * a creature, so a set whose board held an artifact held it forever. Two role
 * profiles in `@mtg/setgen` carried a `substitution:` note saying exactly that
 * (`removalArtifactEnchantment` printed a tap, `artifactDestructionModal`
 * collapsed to direct damage).
 *
 * One kind rather than two, because the printed card is one card: Disenchant
 * and Naturalize both read "target artifact or enchantment", and Forge writes
 * it as the single selector `ValidTgts$ Artifact,Enchantment`.
 *
 * The freeze is the same one `opponent-target.test.ts` and
 * `controller-target.test.ts` state for the members before it:
 * `MODEL_TARGET_KINDS` is still the first four, so the JSON Schema every fill
 * batch is shown is byte-identical and every recorded fixture still replays.
 * The kind is hand-authored on two rows for that reason alone, and generatable
 * on the third only because `exileTarget` is unpriced and no slot can offer it.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect, TargetKind } from '../src/index';
import {
  HAND_AUTHORED_TARGETS,
  legalTargetsFor,
  MODEL_TARGET_KINDS,
  renderOracleText,
  TARGET_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';
import { restrictionFitsTargetKind, targetKindsCanCollide } from '../src/targets';

const PERMANENT_TARGET: TargetKind = 'targetArtifactOrEnchantment';

function instantInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'xmp-disenchant-probe',
    name: 'Sundering Light',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 1 },
    manaCost: { generic: 1, W: 1 },
    colors: ['W'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

function card(effects: readonly Effect[]): Card {
  return parseCard(instantInput(effects) as CardInput);
}

/** `parseCard` throws on a violation, so a refusal is asserted off the record. */
function unparsed(effects: readonly Effect[]): Card {
  return instantInput(effects) as unknown as Card;
}

describe('the targeting mode that names an artifact or an enchantment', () => {
  it('is a kind the engine knows and the generator may not choose', () => {
    expect(TARGET_KINDS).toContain(PERMANENT_TARGET);
    const chooseable: readonly TargetKind[] = MODEL_TARGET_KINDS;
    expect(chooseable).not.toContain(PERMANENT_TARGET);
    expect([...MODEL_TARGET_KINDS]).toEqual(['anyTarget', 'targetCreature', 'targetPlayer', 'noTarget']);
  });

  /**
   * Three rows and no more. Destroy is Disenchant, bounce is the answer a color
   * with no destroy still needs, and exile is Altar's Light. Damage is
   * deliberately not among them: an artifact has no toughness for damage to
   * measure against, and CR has no rule that would make "deal 3 damage to
   * target artifact" mean anything.
   */
  it('is legal on the three rows that answer a permanent, and no others', () => {
    const allowed = (
      ['destroyPermanent', 'returnToHand', 'exileTarget', 'dealDamage', 'tapPermanent'] as const
    ).filter((kind) => legalTargetsFor(kind).includes(PERMANENT_TARGET));
    expect(allowed).toEqual(['destroyPermanent', 'returnToHand', 'exileTarget']);
  });

  /**
   * All three rows keep it out of the generator's reach by hand, and the third
   * only joined them when it had to. `exileTarget` used to carry no color-pie
   * row, so no slot could offer it and the prompt never printed its target
   * list; `mtg-q5yg` priced it, and a priced kind's generatable list is printed
   * verbatim into the fill prompt. Leaving it where it was would have offered
   * the model a target `MODEL_TARGET_KINDS` has no word for.
   */
  it('is hand-authored on every row that answers a permanent', () => {
    expect(HAND_AUTHORED_TARGETS['destroyPermanent']).toContain(PERMANENT_TARGET);
    expect(HAND_AUTHORED_TARGETS['returnToHand']).toContain(PERMANENT_TARGET);
    expect(HAND_AUTHORED_TARGETS['exileTarget']).toContain(PERMANENT_TARGET);
  });

  it('prints Disenchant, its bounce and its exile in the printed wording', () => {
    const destroy = card([{ kind: 'destroyPermanent', target: { kind: PERMANENT_TARGET } }]);
    expect(validateCard(destroy)).toEqual([]);
    expect(renderOracleText(destroy)).toBe('Destroy target artifact or enchantment.');

    const bounce = card([{ kind: 'returnToHand', target: { kind: PERMANENT_TARGET } }]);
    expect(renderOracleText(bounce)).toBe("Return target artifact or enchantment to its owner's hand.");

    const exile = card([{ kind: 'exileTarget', target: { kind: PERMANENT_TARGET } }]);
    expect(renderOracleText(exile)).toBe('Exile target artifact or enchantment.');
  });

  it('is refused on an effect the table does not offer it to', () => {
    const damage = unparsed([{ kind: 'dealDamage', amount: 3, target: { kind: PERMANENT_TARGET } }]);
    expect(validateCard(damage).map((found) => found.code)).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  /**
   * This assertion said `false` for the creature space until `mtg-6y4g`, on the
   * argument that no printed card kind here is both an artifact and a creature.
   * The argument was wrong the whole time — `CreatureCardSchema` carries an
   * `artifact` flag, and a generated set fills its colorless slot with it — and
   * what made it look right was a kernel bug: `printedCharacteristics` reported
   * one card type, so Disenchant could not name an artifact creature and the
   * two spaces were disjoint by accident. Smelt and Torch Fiend made the kernel
   * report both types, and this is the assertion that had to change.
   *
   * The collision table over-states the overlap: it now says an *ordinary*
   * creature could collide with this slot too, which is false. Over is the
   * direction to be wrong in, because the one reader is `checkDistinctTargets`
   * and over-stating permits an "another target" that a careful card did not
   * strictly need, while under-stating refuses one a real board makes
   * meaningful.
   */
  it('overlaps the creature space, because an artifact creature is both', () => {
    expect(targetKindsCanCollide(PERMANENT_TARGET, 'targetCreature')).toBe(true);
    expect(targetKindsCanCollide(PERMANENT_TARGET, 'targetPlayer')).toBe(false);
    expect(targetKindsCanCollide(PERMANENT_TARGET, PERMANENT_TARGET)).toBe(true);
  });

  /**
   * Every restriction this vocabulary prints reads a power or a keyword off a
   * creature, and an artifact has neither, so the pairing is refused rather
   * than silently answered about a permanent with no power.
   */
  it('carries no target restriction, because every restriction reads a creature', () => {
    expect(restrictionFitsTargetKind(PERMANENT_TARGET)).toBe(false);
    expect(restrictionFitsTargetKind('targetCreature')).toBe(true);
  });
});

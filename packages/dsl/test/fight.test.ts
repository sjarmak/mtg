/**
 * The one effect primitive whose other half is the card it is printed on.
 *
 * Every other effect in the vocabulary is a sentence about its target. `fight`
 * is a sentence about two creatures (CR 701.12a), and the DSL only carries one
 * `TargetSpec` per effect — `targetChoicesForEffects` returns one slot per
 * printed effect and the kernel, the bots and the UI all read that shape — so
 * the second fighter cannot be a second target. It is the source, which is why
 * the printed template is Affectionate Indrik's and not Prey Upon's: "When this
 * enters the battlefield, it fights target creature you don't control."
 *
 * That makes `fight` legal in exactly one placement, and most of this file is
 * the four refusals around it. A spell has no body to fight with; an activated
 * ability's "it" has no antecedent in the printed sentence; an attack trigger
 * and a death trigger are creature triggers this slice has not argued for.
 * Each is refused by the validator rather than left for the kernel to discover
 * at resolution, which is the same rule `defending-player-target.test.ts`
 * states for the kind that can only appear on an attack trigger.
 *
 * The freeze is the property every target-kind file in this directory restates:
 * `MODEL_TARGET_KINDS` is still the four and `ModelEffectSchema` still has no
 * `fight` member, so the JSON Schema every fill batch is shown is byte-
 * identical and every recorded fixture still replays.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, CardInput, Effect, TargetKind } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  EFFECT_KINDS,
  isSourceBodyEffect,
  legalTargetsFor,
  MODEL_EFFECT_KINDS,
  MODEL_TARGET_KINDS,
  renderOracleText,
  SOURCE_BODY_EFFECT_KINDS,
  TARGET_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';
import { targetKindsCanCollide } from '../src/targets';

const FOE: TargetKind = 'targetCreatureYouDontControl';

const FIGHT: Effect = { kind: 'fight', target: { kind: FOE } };

function creatureInput(abilities: readonly AbilityInput[]): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'xmp-fight-probe',
    name: 'Grasping Bramble',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 9 },
    manaCost: { generic: 2, G: 1 },
    colors: ['G'],
    subtypes: ['Plant'],
    supertypes: [],
    keywords: [],
    abilities: [...abilities],
    power: 3,
    toughness: 3,
  };
}

function sorceryInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'sorcery',
    id: 'xmp-fight-spell-probe',
    name: 'Set Upon',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 10 },
    manaCost: { generic: 1, G: 1 },
    colors: ['G'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

/** `parseCard` throws on a violation, so a refusal is asserted off the record. */
function codesFor(input: Record<string, unknown>): readonly string[] {
  return validateCard(input as unknown as Card).map((found) => found.code);
}

function enters(effects: readonly Effect[], optional?: true): AbilityInput {
  const ability = { kind: 'triggered', condition: 'selfEnters', effects: [...effects] };
  return (optional === undefined ? ability : { ...ability, optional }) as AbilityInput;
}

describe('the fight primitive', () => {
  it('is a kind the engine runs and the generator cannot name', () => {
    expect(ALL_EFFECT_KINDS).toContain('fight');
    const priced: readonly string[] = EFFECT_KINDS;
    const chooseable: readonly string[] = MODEL_EFFECT_KINDS;
    expect(priced).not.toContain('fight');
    expect(chooseable).not.toContain('fight');
  });

  /**
   * Read out of the table rather than listed here, so a second primitive that
   * fights with its own body fails this sentence and has to say why.
   */
  it('is the whole of the source-body group', () => {
    expect([...SOURCE_BODY_EFFECT_KINDS]).toEqual(['fight']);
    expect(isSourceBodyEffect('fight')).toBe(true);
    expect(isSourceBodyEffect('dealDamage')).toBe(false);
  });

  it('takes the one target kind and no other', () => {
    expect([...legalTargetsFor('fight')]).toEqual([FOE]);
  });

  it('appends its target kind rather than inserting it, so the frozen four stay put', () => {
    expect([...MODEL_TARGET_KINDS]).toEqual(['anyTarget', 'targetCreature', 'targetPlayer', 'noTarget']);
    expect([...TARGET_KINDS].slice(0, MODEL_TARGET_KINDS.length)).toEqual([...MODEL_TARGET_KINDS]);
    // Past the frozen prefix, not at the end: this kind was the last one
    // appended until `mtg-6y4g` appended two more behind it, and pinning it to
    // the final position asserted the order of every later lane's work rather
    // than the one thing that matters here — that nothing was inserted into the
    // four kinds the model's schema hashes.
    expect(TARGET_KINDS.indexOf(FOE)).toBeGreaterThanOrEqual(MODEL_TARGET_KINDS.length);
    expect(MODEL_TARGET_KINDS).not.toContain(FOE);
  });

  /**
   * The printed sentence, and it is the whole reason the target kind exists:
   * "target creature" would let the fight be aimed at the controller's own
   * board, which is a different card and a worse one.
   */
  it('prints the enters trigger the way the printed card prints it', () => {
    const card = parseCard(creatureInput([enters([FIGHT])]) as CardInput);
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain(
      "When Grasping Bramble enters the battlefield, it fights target creature you don't control.",
    );
  });

  /**
   * `mayClause` rewrites the printed sentence rather than printing a second
   * one, so the optional form has to be checked against the string a player
   * reads. "you may it fights" is what a naive prefix would produce, and
   * `oracle.test.ts`'s own guard cannot see it: that guard looks for
   * "you may <card name> ", and this sentence names no card.
   */
  it('rewrites the sentence for the optional form instead of prefixing it', () => {
    const card = parseCard(creatureInput([enters([FIGHT], true)]) as CardInput);
    expect(validateCard(card)).toEqual([]);
    const text = renderOracleText(card);
    expect(text).toContain(
      "When Grasping Bramble enters the battlefield, you may have it fight target creature you don't control.",
    );
    expect(text).not.toContain('you may it fights');
  });

  it('is refused on a spell, which has no body to fight with', () => {
    expect(codesFor(sorceryInput([FIGHT]))).toContain('EFFECT_ILLEGAL_ON_CARD_TYPE');
  });

  it('is refused on an activated ability, where "it" has no antecedent', () => {
    expect(
      codesFor(
        creatureInput([
          { kind: 'activated', cost: { mana: { generic: 1 }, tapSelf: true }, effects: [FIGHT] },
        ] as readonly AbilityInput[]),
      ),
    ).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
  });

  it('is refused on the other trigger conditions this slice did not argue for', () => {
    for (const condition of ['selfAttacks', 'selfDies'] as const) {
      expect(
        codesFor(creatureInput([{ kind: 'triggered', condition, effects: [FIGHT] } as AbilityInput])),
        condition,
      ).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
    }
  });

  it('is refused on a non-creature card, whose enters trigger has no power to fight with', () => {
    const artifact = {
      ...creatureInput([enters([FIGHT])]),
      kind: 'artifact',
      colors: [],
      subtypes: [],
      power: undefined,
      toughness: undefined,
    };
    expect(codesFor(artifact)).toContain('ABILITY_ILLEGAL_ON_CARD_TYPE');
  });

  /**
   * `distinct` asks whether two slots could name one body, and it asks it of the
   * *space* rather than of the controller — so this kind collides with its own
   * complement, which in a two-player game it can never actually meet. That
   * coarseness errs the harmless way: a collision reported is a `distinct` flag
   * the validator permits, and `ILLEGAL_DISTINCT_TARGET` only fires when no
   * earlier slot could repeat. The answer that would be a bug is the missing
   * one, and the assertion against `targetPlayer` is what pins it.
   */
  it('draws from the same bodies the wider creature mode draws from', () => {
    expect(targetKindsCanCollide(FOE, 'targetCreature')).toBe(true);
    expect(targetKindsCanCollide(FOE, 'targetCreatureYouControl')).toBe(true);
    expect(targetKindsCanCollide(FOE, 'targetPlayer')).toBe(false);
  });
});

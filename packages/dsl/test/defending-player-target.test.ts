/**
 * The targeting mode that names the defending player's side of the table.
 *
 * `TARGET_KINDS` gained `targetCreatureDefendingPlayerControls` for one card: an
 * attack trigger that shrinks a blocker-to-be. "Target creature" is the wider
 * phrase and it is the wrong one — it lets the attacking player point the
 * shrink at their own board, which is a different card and a worse one.
 *
 * The member carries a restriction none of the other seven do, and it is what
 * this file mostly checks. CR 506.2 names a defending player only relative to
 * an attack, so the phrase has a referent only on a triggered ability whose
 * condition is `selfAttacks`; every other placement is refused by the
 * validator rather than left for the kernel to discover at resolution.
 * `ATTACK_TRIGGER_ONLY_TARGETS` is where that rule is stated once, because four
 * readers need it: the two validators that refuse the kind, and the two
 * `@mtg/dsl-coverage` instruments that enumerate "every legal pair" and would
 * otherwise build cards the validator throws out.
 *
 * The freeze is the same property `controller-target.test.ts` and
 * `opponent-target.test.ts` state for the fifth and sixth members:
 * `MODEL_TARGET_KINDS` is still the four, so the JSON Schema every fill batch
 * is shown is byte-identical and every recorded fixture still replays.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityInput, Card, CardInput, Effect, TargetKind } from '@mtg/dsl';
import {
  ATTACK_TRIGGER_ONLY_TARGETS,
  HAND_AUTHORED_TARGETS,
  isAttackTriggerOnlyTarget,
  LEGAL_TARGETS,
  legalTargetsFor,
  MODEL_EFFECT_KINDS,
  MODEL_TARGET_KINDS,
  renderOracleText,
  TARGET_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';
import { targetKindsCanCollide } from '../src/targets';

const DEFENDER_TARGET: TargetKind = 'targetCreatureDefendingPlayerControls';

const SHRINK: Effect = {
  kind: 'pumpUntilEndOfTurn',
  power: -2,
  toughness: -2,
  target: { kind: DEFENDER_TARGET },
};

function creatureInput(abilities: readonly AbilityInput[]): Record<string, unknown> {
  return {
    kind: 'creature',
    id: 'xmp-defender-probe',
    name: 'Withering Reach',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 2 },
    manaCost: { generic: 2, B: 1 },
    colors: ['B'],
    subtypes: ['Horror'],
    supertypes: [],
    keywords: [],
    abilities: [...abilities],
    power: 2,
    toughness: 2,
  };
}

function sorceryInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'sorcery',
    id: 'xmp-defender-spell-probe',
    name: 'Withering Word',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 3 },
    manaCost: { generic: 1, B: 1 },
    colors: ['B'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

/** `parseCard` throws on a violation, so a refusal is asserted off the record. */
function unparsed(input: Record<string, unknown>): Card {
  return input as unknown as Card;
}

function codesFor(input: Record<string, unknown>): readonly string[] {
  return validateCard(unparsed(input)).map((found) => found.code);
}

describe('the targeting mode that names the defending player', () => {
  it('leaves the four kinds the generator chooses from where they were, in order', () => {
    expect([...MODEL_TARGET_KINDS]).toEqual(['anyTarget', 'targetCreature', 'targetPlayer', 'noTarget']);
    expect([...TARGET_KINDS].slice(0, MODEL_TARGET_KINDS.length)).toEqual([...MODEL_TARGET_KINDS]);
    expect(MODEL_TARGET_KINDS).not.toContain(DEFENDER_TARGET);
  });

  it('is a kind the engine knows and the generator may not choose', () => {
    expect(TARGET_KINDS).toContain(DEFENDER_TARGET);
    const chooseable: readonly TargetKind[] = MODEL_TARGET_KINDS;
    expect(chooseable).not.toContain(DEFENDER_TARGET);
  });

  /**
   * Two effects, read out of the table rather than listed here, so an effect
   * that gains the kind tomorrow fails this sentence and has to say why in the
   * row it changed.
   *
   * `putCounters` is the second and it arrived with `mtg-fz3s`: "Whenever
   * CARDNAME attacks, put a -1/-1 counter on target creature defending player
   * controls" is the same attack trigger the pump prints with the durable half
   * of the vocabulary instead of the until-end-of-turn half, and the set's
   * gloom cards were being written with a bare `targetCreature` because this
   * row did not admit the narrower phrase.
   */
  it('is legal on the pump and the counter effects and on no other', () => {
    const allowed = Object.keys(HAND_AUTHORED_TARGETS).filter((kind) =>
      legalTargetsFor(kind as Effect['kind']).includes(DEFENDER_TARGET),
    );
    expect(allowed).toEqual(['pumpUntilEndOfTurn', 'putCounters']);
  });

  it('is the one kind the restriction table names', () => {
    expect([...ATTACK_TRIGGER_ONLY_TARGETS]).toEqual([DEFENDER_TARGET]);
    expect(isAttackTriggerOnlyTarget(DEFENDER_TARGET)).toBe(true);
    expect(isAttackTriggerOnlyTarget('targetCreature')).toBe(false);
  });

  it('shrinks a defending player creature on an attack trigger, and prints that', () => {
    const card = parseCard(
      creatureInput([{ kind: 'triggered', condition: 'selfAttacks', effects: [SHRINK] }]) as CardInput,
    );
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain(
      'Whenever Withering Reach attacks, target creature defending player controls gets -2/-2 until end of turn.',
    );
  });

  it('is refused on a triggered ability that is not an attack trigger', () => {
    expect(
      codesFor(creatureInput([{ kind: 'triggered', condition: 'selfEnters', effects: [SHRINK] }])),
    ).toContain('ILLEGAL_TARGET_IN_ABILITY');
  });

  it('is refused on an activated ability, which has no attack to read', () => {
    expect(
      codesFor(
        creatureInput([
          { kind: 'activated', cost: { mana: { generic: 1 }, tapSelf: true }, effects: [SHRINK] },
        ]),
      ),
    ).toContain('ILLEGAL_TARGET_IN_ABILITY');
  });

  it('is refused on a spell, where the phrase would print without a referent', () => {
    expect(codesFor(sorceryInput([SHRINK]))).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  /**
   * `distinct` asks whether two slots could name one body, and these two can:
   * every creature the defending player controls is a creature.
   */
  it('draws from the same bodies the wider creature mode draws from', () => {
    expect(targetKindsCanCollide(DEFENDER_TARGET, 'targetCreature')).toBe(true);
    expect(targetKindsCanCollide(DEFENDER_TARGET, 'targetPlayer')).toBe(false);
  });

  /** The invariant the two-table split exists to keep, restated over this member. */
  it('never reaches the rows the fill prompt prints', () => {
    for (const kind of MODEL_EFFECT_KINDS) {
      for (const target of LEGAL_TARGETS[kind]) {
        expect(MODEL_TARGET_KINDS, `${kind}/${target}`).toContain(target);
      }
    }
  });
});

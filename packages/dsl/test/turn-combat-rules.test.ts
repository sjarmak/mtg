/**
 * The two turn-scoped CR 508/509 combat rules at the DSL boundary:
 * `cantBeBlockedThisTurn` and `attacksYouThisTurnIfAble`.
 *
 * The DSL could already say both of these *permanently*, as printed
 * `StaticModification`s (`cantBeBlocked`, `attacksEachCombatIfAble`), and it is
 * worth being precise about why that was not enough, because "a second spelling
 * of a word we have" is the shape this pair looks like from a distance.
 * `hasCombatModification` (`@mtg/kernel`'s `combat.ts`) answers by re-reading
 * the printed ability off whatever is on the battlefield. There is no
 * registration for a duration to hang on, and a printed line does not stop
 * being printed at end of turn. So a turn-scoped rule has to be a resolved
 * effect that writes a record, which is what these two are.
 *
 * This file covers the boundary: the schema, the printed sentence, the target
 * slots each row states, and the containment invariant. The kernel half — that
 * blockers are actually refused, that the requirement actually removes the
 * hold-back option, that both are gone next turn — is `@mtg/kernel`'s file of
 * the same name.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import {
  ALL_EFFECT_KINDS,
  EFFECT_KINDS,
  legalTargetsFor,
  MODEL_EFFECT_KINDS,
  renderOracleText,
  UNPRICED_EFFECT_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';

function instantInput(effects: readonly unknown[]): Record<string, unknown> {
  return {
    kind: 'instant',
    id: 'xmp-turn-combat-probe',
    name: 'Backroad Signal Probe',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 33 },
    manaCost: { generic: 1, U: 1 },
    colors: ['U'],
    subtypes: [],
    supertypes: [],
    keywords: [],
    abilities: [],
    effects: [...effects],
  };
}

function codesFor(input: Record<string, unknown>): readonly string[] {
  return validateCard(input as unknown as Card).map((found) => found.code);
}

function textOf(input: Record<string, unknown>): string {
  return renderOracleText(parseCard(input as CardInput));
}

describe('containment: hand-authored vocabulary the model cannot name', () => {
  it('reaches ALL_EFFECT_KINDS and UNPRICED_EFFECT_KINDS and neither priced list', () => {
    const priced: readonly string[] = EFFECT_KINDS;
    const chooseable: readonly string[] = MODEL_EFFECT_KINDS;
    for (const kind of ['cantBeBlockedThisTurn', 'attacksYouThisTurnIfAble']) {
      expect(ALL_EFFECT_KINDS).toContain(kind);
      expect(UNPRICED_EFFECT_KINDS).toContain(kind);
      expect(priced).not.toContain(kind);
      expect(chooseable).not.toContain(kind);
    }
  });

  it('lands after the member that was last when the pair arrived', () => {
    const kinds: readonly string[] = UNPRICED_EFFECT_KINDS;
    expect(kinds.indexOf('cantBeBlockedThisTurn')).toBe(kinds.indexOf('grantKeywordUntilEndOfTurn') + 1);
    expect(kinds.indexOf('attacksYouThisTurnIfAble')).toBe(kinds.indexOf('cantBeBlockedThisTurn') + 1);
  });
});

describe('the printed sentence', () => {
  it("prints Goblin Tunneler's line, restriction and all", () => {
    expect(
      textOf(
        instantInput([
          {
            kind: 'cantBeBlockedThisTurn',
            target: { kind: 'targetCreature', restriction: { kind: 'maxPower', power: 2 } },
          },
        ]),
      ),
    ).toBe("Target creature with power 2 or less can't be blocked this turn.");
  });

  it('prints the unrestricted line when the card names no restriction', () => {
    expect(
      textOf(instantInput([{ kind: 'cantBeBlockedThisTurn', target: { kind: 'targetCreature' } }])),
    ).toBe("Target creature can't be blocked this turn.");
  });

  /**
   * "you don't control" rather than "an opponent controls", which is the one
   * place this pair's English differs from the M11 card it was added for.
   * `targetCreatureYouDontControl` is the kind the vocabulary has and the two
   * phrases select the same creatures at a two-player table, so the difference
   * is a printed synonym rather than a difference in what the card does. It is
   * asserted rather than papered over so a reader comparing the two sees it
   * here instead of discovering it in a diff.
   */
  it("prints Alluring Siren's line in the vocabulary's own words", () => {
    expect(
      textOf(
        instantInput([
          { kind: 'attacksYouThisTurnIfAble', target: { kind: 'targetCreatureYouDontControl' } },
        ]),
      ),
    ).toBe("Target creature you don't control attacks you this turn if able.");
  });
});

describe('what a card may aim each at', () => {
  it('states one slot each, and they are different slots', () => {
    expect(legalTargetsFor('cantBeBlockedThisTurn')).toStrictEqual(['targetCreature']);
    expect(legalTargetsFor('attacksYouThisTurnIfAble')).toStrictEqual(['targetCreatureYouDontControl']);
  });

  /**
   * The refusal that matters, and it is a rules refusal rather than a typing
   * one: a creature aimed at its own controller is CR 508.1a's unsatisfiable
   * requirement, so the kernel would accept the card and then quietly never
   * enforce the line. A printed sentence nothing enforces is the failure this
   * row exists to make impossible.
   */
  it('refuses a lure aimed at a creature its own controller has', () => {
    expect(
      codesFor(
        instantInput([{ kind: 'attacksYouThisTurnIfAble', target: { kind: 'targetCreatureYouControl' } }]),
      ),
    ).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  it('refuses a permanent slot for the evasion, which has no combat to use it in', () => {
    expect(
      codesFor(instantInput([{ kind: 'cantBeBlockedThisTurn', target: { kind: 'targetPermanent' } }])),
    ).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  it('refuses a player slot for both', () => {
    expect(
      codesFor(instantInput([{ kind: 'cantBeBlockedThisTurn', target: { kind: 'targetPlayer' } }])),
    ).toContain('ILLEGAL_TARGET_FOR_EFFECT');
    expect(
      codesFor(instantInput([{ kind: 'attacksYouThisTurnIfAble', target: { kind: 'targetPlayer' } }])),
    ).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });
});

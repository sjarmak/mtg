/**
 * The targeting mode that names an opponent.
 *
 * `TARGET_KINDS` gained `targetOpponent` because CR 115.4's restriction had no
 * word in this vocabulary: every player-naming row could say *a* player and
 * none could say *which*, so "deals damage to target player" is a sentence the
 * caster can point at themselves.
 *
 * Two properties are worth a file, and neither is about the kernel. The first
 * is the freeze, exactly as `controller-target.test.ts` states it for the fifth
 * member: `MODEL_TARGET_KINDS` is still the four, so the JSON Schema the fill
 * batch is shown is byte-identical and every recorded fixture still replays.
 *
 * The second is new, and it is the reason `HAND_AUTHORED_TARGETS` exists at
 * all. `@mtg/setgen` prints `LEGAL_TARGETS[kind]` verbatim into the fill
 * prompt, and a fixture key hashes the prompt, so a target kind added to a row
 * a slot can offer renames every recorded response behind it — a cost that has
 * nothing to do with whether the kernel can run the card. Splitting the table
 * is what keeps a kernel widening free, and the last assertion here is what
 * stops the split silently closing again.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect, TargetKind } from '../src/index';
import {
  HAND_AUTHORED_TARGETS,
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

const OPPONENT_TARGET: TargetKind = 'targetOpponent';

function sorceryInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'sorcery',
    id: 'xmp-opponent-probe',
    name: 'Opponent Probe',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 1 },
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
function unparsed(effects: readonly Effect[]): Card {
  return sorceryInput(effects) as unknown as Card;
}

describe('the targeting mode that names an opponent', () => {
  it('leaves the four kinds the generator chooses from where they were, in order', () => {
    expect([...MODEL_TARGET_KINDS]).toEqual(['anyTarget', 'targetCreature', 'targetPlayer', 'noTarget']);
    expect([...TARGET_KINDS].slice(0, MODEL_TARGET_KINDS.length)).toEqual([...MODEL_TARGET_KINDS]);
    expect(MODEL_TARGET_KINDS).not.toContain(OPPONENT_TARGET);
  });

  it('is a kind the engine knows and the generator may not choose', () => {
    expect(TARGET_KINDS).toContain(OPPONENT_TARGET);
    const chooseable: readonly TargetKind[] = MODEL_TARGET_KINDS;
    expect(chooseable).not.toContain(OPPONENT_TARGET);
  });

  /**
   * One kind that means it outright and five that mean it only in their scoped
   * form. `dealDamage` at an opponent is a burn spell and the player takes the
   * damage. The others are sweepers, where CR 115.1 makes the player the
   * target and their creatures merely the group; unscoped, each still has to
   * name a permanent, and `checkEffectScope` is what refuses the half-written
   * sentence rather than this table.
   *
   * `returnFromGraveyard` is the sixth and the odd one: it has no unscoped
   * form at all, so naming an opponent is not a widening of it but the whole of
   * what it does to somebody else's graveyard. It sits here rather than in the
   * generatable half because `mtg-q5yg` priced the kind, and a priced kind
   * prints its generatable targets into the fill prompt, where `targetOpponent`
   * is a word the model has no way to say.
   *
   * `discardCards` is the seventh and arrives from the other direction: it is
   * unpriced, so no prompt ever prints its targets, and it is here only because
   * `targetPlayer` is the kind a looting spell aims at itself and
   * `targetOpponent` is the kind an attack on a hand aims elsewhere. Its
   * sibling `chooseDiscard` is absent from this list on purpose — it names an
   * opponent and nothing else, so it has no hand-authored widening to hold, the
   * same shape as `revealHand`.
   *
   * `millCards` is the eighth and repeats `returnFromGraveyard`'s argument on a
   * different zone: it is priced, so the fill prompt prints its generatable
   * targets and `targetOpponent` is not a word the model can say, but Mind
   * Sculpt (M13 61) is "target opponent mills seven cards" and a mill that
   * could only say `targetPlayer` would let a hand-authored card aim its own
   * library at itself by accident. The widening restricts rather than widens
   * at the table, which is why it is worth having: `targetPlayer` is the
   * looting shape and `targetOpponent` is the attack, exactly as on
   * `discardCards` above.
   *
   * `sacrificePermanent` is the ninth and repeats `discardCards`' exact split
   * (CR 701.17a's edict is the split's own reason for existing): `targetPlayer`
   * is the generatable half and `targetOpponent` is hand-authored only. Both
   * are read by no prompt today, because the kind itself is off
   * `generatableEffects` (`mtg-4g77`'s containment cut) — this is the row a
   * future generator lane finds already correct rather than still to write.
   */
  it('is legal on the damage effect and on every scoped sweeper', () => {
    const allowed = Object.keys(HAND_AUTHORED_TARGETS).filter((kind) =>
      legalTargetsFor(kind as Effect['kind']).includes(OPPONENT_TARGET),
    );
    expect(allowed).toEqual([
      'dealDamage',
      'destroyPermanent',
      'pumpUntilEndOfTurn',
      'tapPermanent',
      'millCards',
      'putCounters',
      'exileTarget',
      'returnFromGraveyard',
      'discardCards',
      // `loseLife` reads as an opponent slot here and always did; what put it
      // in this list is that it now hand-authors something (`thatPlayer`, for
      // Sign in Blood's second half), so it has a row in the table this
      // enumeration walks.
      'loseLife',
      'sacrificePermanent',
    ]);
  });

  it('deals damage to an opponent, and prints that', () => {
    const card = parseCard(
      sorceryInput([{ kind: 'dealDamage', amount: 3, target: { kind: OPPONENT_TARGET } }]) as CardInput,
    );
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain('Opponent Probe deals 3 damage to target opponent.');
  });

  it('is refused on an effect the table does not offer it to', () => {
    const card = unparsed([{ kind: 'drawCards', count: 2, target: { kind: OPPONENT_TARGET } }]);
    expect(validateCard(card).map((found) => found.code)).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  /**
   * `distinct` asks whether two slots could name one person, and these two can:
   * every opponent is a player. A kind that answered no would let "another
   * target player" be satisfied by the same seat twice.
   */
  it('draws from the same seats the wider player mode draws from', () => {
    expect(targetKindsCanCollide(OPPONENT_TARGET, 'targetPlayer')).toBe(true);
    expect(targetKindsCanCollide(OPPONENT_TARGET, 'targetCreature')).toBe(false);
  });

  /**
   * The invariant the split exists to keep, stated as the thing that would
   * break if somebody merged the tables back: the prompt may not name a target
   * kind the model's own schema refuses. It holds today for every row, which is
   * also why the split cost no fixture — restricting the printed line to
   * `MODEL_TARGET_KINDS` would produce the same bytes it produces now.
   */
  it('never reaches the rows the fill prompt prints', () => {
    for (const kind of MODEL_EFFECT_KINDS) {
      for (const target of LEGAL_TARGETS[kind]) {
        expect(MODEL_TARGET_KINDS, `${kind}/${target}`).toContain(target);
      }
    }
  });
});

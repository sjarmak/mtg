/**
 * The targeting mode that names a controller.
 *
 * `TARGET_KINDS` gained `targetCreatureYouControl` for one card: the part token
 * whose Fuse reads "Put a <part> counter on target creature you control".
 * the set design document carried that as an owed row for as long
 * as the vocabulary had no word for a controller, because a Fuse that printed
 * the restriction and enforced the wider "target creature" would say one thing
 * and do another.
 *
 * Two properties are worth a file of their own, and neither is about the
 * kernel. The first is the freeze: `MODEL_TARGET_KINDS` is still the four the
 * tuple held before, so the JSON Schema `@mtg/setgen` shows the model is
 * byte-identical and every fixture keyed to it still replays. The second is the
 * narrowness: the kind is legal on `putCounters` and nowhere else, which is how
 * this vocabulary grows — one widening per card that needs it.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput, Effect, TargetKind } from '../src/index';
import {
  LEGAL_TARGETS,
  MODEL_TARGET_KINDS,
  renderOracleText,
  TARGET_KINDS,
  validateCard,
} from '../src/index';
import { parseCard } from '../src/parse';
import { targetKindsCanCollide } from '../src/targets';

const CONTROLLER_TARGET: TargetKind = 'targetCreatureYouControl';

function sorceryInput(effects: readonly Effect[]): Record<string, unknown> {
  return {
    kind: 'sorcery',
    id: 'xmp-fuse-probe',
    name: 'Fuse Probe',
    rarity: 'common',
    set: { code: 'XMP', collectorNumber: 1 },
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
function unparsed(effects: readonly Effect[]): Card {
  return sorceryInput(effects) as unknown as Card;
}

describe('the targeting mode that names a controller', () => {
  /**
   * The whole reason the member was appended rather than inserted, asserted as
   * two sentences rather than as one pinned tuple: a pinned tuple would report
   * every future widening as a break of this property, when the property is
   * only about the first four and their order.
   */
  it('leaves the four kinds the generator chooses from where they were, in order', () => {
    expect([...MODEL_TARGET_KINDS]).toEqual(['anyTarget', 'targetCreature', 'targetPlayer', 'noTarget']);
    expect([...TARGET_KINDS].slice(0, MODEL_TARGET_KINDS.length)).toEqual([...MODEL_TARGET_KINDS]);
    expect(MODEL_TARGET_KINDS).not.toContain(CONTROLLER_TARGET);
  });

  it('is a kind the engine knows and the generator may not choose', () => {
    expect(TARGET_KINDS).toContain(CONTROLLER_TARGET);
    const chooseable: readonly TargetKind[] = MODEL_TARGET_KINDS;
    expect(chooseable).not.toContain(CONTROLLER_TARGET);
  });

  /**
   * Two effects now, and the table says which. Read out of `LEGAL_TARGETS`
   * rather than listed here, so an effect that gains the kind tomorrow fails
   * this sentence and has to say why in the row it changed.
   *
   * `untapPermanent` is the second and it arrived with `mtg-2qyk`. Its own row
   * gives the reason and it is a reason about English rather than about the
   * space: the kind's widest slot is `targetPermanent`, which already contains
   * every creature its controller has, so nothing here was widened. What the
   * narrow kind buys is the sentence — "untap target creature you control" is
   * the clause a printed card uses, and a card that means it should not have to
   * print "untap target permanent" instead.
   *
   * `grantKeywordUntilEndOfTurn` is the third, from the same bead and for the
   * same kind of reason: "target creature you control gains trample until end
   * of turn" is the clause a printed pump-and-grant uses, and the wider
   * `targetCreature` beside it in that row already reaches the same bodies.
   */
  it('is legal on the counter-placing effect, the untap and the keyword grant, and on no other', () => {
    const allowed = Object.entries(LEGAL_TARGETS)
      .filter(([, kinds]) => kinds.includes(CONTROLLER_TARGET))
      .map(([kind]) => kind);
    expect(allowed).toEqual(['putCounters', 'untapPermanent', 'grantKeywordUntilEndOfTurn']);
  });

  it('places a counter on a creature you control, and prints that', () => {
    const card = parseCard(
      sorceryInput([
        { kind: 'putCounters', counter: 'horn', count: 1, target: { kind: CONTROLLER_TARGET } },
      ]) as CardInput,
    );
    expect(validateCard(card)).toEqual([]);
    expect(renderOracleText(card)).toContain('Put a horn counter on target creature you control.');
  });

  it('is refused on an effect the table does not offer it to', () => {
    const card = unparsed([{ kind: 'destroyPermanent', target: { kind: CONTROLLER_TARGET } }]);
    expect(validateCard(card).map((found) => found.code)).toContain('ILLEGAL_TARGET_FOR_EFFECT');
  });

  /**
   * `distinct` asks whether two slots could name one body, and these two can:
   * every creature you control is a creature. A kind that answered no would let
   * "another target creature" be satisfied by the same permanent twice.
   */
  it('draws from the same bodies the wider creature mode draws from', () => {
    expect(targetKindsCanCollide(CONTROLLER_TARGET, 'targetCreature')).toBe(true);
    expect(targetKindsCanCollide(CONTROLLER_TARGET, 'targetPlayer')).toBe(false);
  });
});

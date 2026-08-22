/**
 * Authored cards: the ones a brief hands the pipeline finished.
 *
 * A required card is a *commission* — the brief names a card, the allocator
 * reserves a slot for it, and the model writes it. That is the right shape for
 * a card whose whole design is "a colorless rare Equipment at four", and the
 * wrong shape for a card whose text the generator is deliberately unable to
 * write. Some effect kinds sit in `UNPRICED_EFFECT_KINDS` and some target kinds
 * in `HAND_AUTHORED_TARGETS`, so the cards that use them reach
 * `CardEffectSchema` and never `ModelEffectSchema`. That is the containment
 * `CLAUDE.md` states as an invariant — the generator's output space stays
 * *inside* the engine's enforceable space, strictly inside in places — and it
 * means commissioning such a card either fails schema validation or comes back
 * a different card. A different card is not the card somebody designed.
 *
 * So the brief gets a second, smaller vocabulary: `authoredCards`, a list of
 * finished DSL cards carried through the pipeline untouched. Nothing here is a
 * judgment and nothing here is a prompt. The cards are never shown to a model,
 * never offered to the critique pass, and never given flavor text — they arrive
 * written and leave written.
 *
 * # Why they are appended rather than seated
 *
 * An authored card could have taken a slot: the allocator would build one fewer
 * card for the model and stamp the authored text into the gap. It would also
 * change *which* cards the generator writes, at every size, which means the one
 * 249-card run this project has paid for would no longer be reproducible from
 * the fixed brief, and the 75-card build would stop being byte-identical, and
 * both committed fixtures that replay against it would have to be re-recorded.
 * Appending costs none of that: the generated set is bit-for-bit the set the
 * same brief produced before this file existed, and the authored cards land
 * after it, in the order the brief lists them, at the next collector numbers.
 *
 * That is also what a committed set fixture in this tree already is — a
 * generated build with a handful of cards appended by hand after it — so this
 * file is that hand-edit written down rather than a new arrangement.
 * The price is stated rather than hidden: `targetSize` is what the *generator*
 * is asked to build, and a brief with authored cards prints more cards than its
 * target. The report says so on its own line.
 *
 * # What is derived and what is checked
 *
 * The collector number is derived, because it is a fact about the printing and
 * not about the card: it is the position the card lands at in this run, so the
 * same four cards append cleanly to a 75-card build and a 249-card one. The id
 * is *checked* against `cardIdFor`, the one derivation the rest of the pipeline
 * uses, rather than recomputed and silently written: an id is what the art
 * manifest, the precon lists and the kernel registry all key on, and a brief
 * whose id and name disagree is a brief with a mistake in it, not an input to
 * be repaired.
 */
import { cardFingerprint, validateCard } from '@mtg/dsl';
import type { Card } from '@mtg/dsl';
import { cardIdFor } from './assemble';
import type { SetBrief } from './brief';
import type { SetFinding } from './validate/findings';
import { finding } from './validate/findings';

/**
 * The brief's authored cards, stamped with the printing they land at.
 *
 * `first` is the collector number the first authored card takes, which is one
 * past the last generated card. Nothing else about the card is touched.
 */
export function printAuthoredCards(brief: SetBrief, first: number): readonly Card[] {
  return brief.authoredCards.map((card, index) => ({
    ...card,
    set: { code: brief.setCode, collectorNumber: first + index },
  }));
}

/**
 * What is wrong with the authored half of a finished set.
 *
 * Every finding here carries no slot ids, because no slot is to blame and no
 * regeneration would clear it: an authored card is fixed by editing the brief.
 * That is why this runs beside `validateGeneratedSet` rather than inside it —
 * the retry loop reads `failingSlotIds`, and an authored card must never send
 * the model back out to rewrite somebody else's slot.
 *
 * Uniqueness is measured across the *whole* printed list rather than within the
 * authored half. A duplicate id breaks the kernel's registry and a duplicate
 * name breaks the set whichever half wrote it, so the generated cards are the
 * thing the authored ones are checked against.
 */
export function checkAuthoredCards(
  brief: SetBrief,
  generated: readonly Card[],
  authored: readonly Card[],
): readonly SetFinding[] {
  const found: SetFinding[] = [];

  for (const card of authored) {
    const violations = validateCard(card);
    if (violations.length > 0) {
      found.push(
        finding(
          'AUTHORED_CARD_INVALID',
          'error',
          `the authored card "${card.name}" is not a legal DSL card: ${violations
            .map((item) => `${item.path}: ${item.message}`)
            .join('; ')}`,
        ),
      );
    }
    const expected = cardIdFor(brief.setCode, card.name);
    if (card.id !== expected) {
      found.push(
        finding(
          'AUTHORED_CARD_INVALID',
          'error',
          `the authored card "${card.name}" states id "${card.id}"; the set's own derivation gives "${expected}"`,
        ),
      );
    }
  }

  const ids = new Set(generated.map((card) => card.id));
  const names = new Set(generated.map((card) => card.name));
  const prints = new Set(generated.map(cardFingerprint));
  for (const card of authored) {
    const clash = ids.has(card.id)
      ? `its id "${card.id}"`
      : names.has(card.name)
        ? `its name`
        : prints.has(cardFingerprint(card))
          ? `its printed text`
          : undefined;
    if (clash !== undefined) {
      found.push(
        finding(
          'AUTHORED_CARD_COLLIDES',
          'error',
          `the authored card "${card.name}" shares ${clash} with a card the generator printed`,
        ),
      );
    }
    ids.add(card.id);
    names.add(card.name);
    prints.add(cardFingerprint(card));
  }

  return found;
}

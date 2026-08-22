/**
 * How a surface says a seat: the whole vocabulary, in one module.
 *
 * # The rule
 *
 * **The label decides, not a flag.** `routes/play/deal.ts` calls the near seat
 * `You` when one person is playing a bot and names *both* seats outright when
 * two people share a screen, so which seat is the second person is a fact about
 * the label rather than something a call site has to be told. Reading it off the
 * label is what keeps every sentence right on a hotseat table, where neither
 * seat is `You` and a viewer-relative pronoun has two answers.
 *
 * # Why the whole vocabulary is here rather than spread over the callers
 *
 * Because the same bug has now been found six times, in five files, and every
 * one of them was a call site that built a sentence out of a raw label:
 * `You is attacking with 4 creatures.` (`mtg-1ih`, the rail), `You keeps this
 * hand.` and `You has mulliganed 1 time` and `You chooses its targets now`
 * (`prompt.ts`), `deals 3 combat damage to You.` (the log), `Unblocked attackers
 * deal their damage to You.` (`mtg-crv`, `prompt.ts` again), and a priority bar
 * saying `You have priority` under an ask column saying `Player two may act`
 * (`mtg-1th`).
 *
 * Two of these words already lived in `log/narrate.ts`, exported at the label,
 * and three more stayed private there — which is exactly why `mtg-crv` was filed
 * rather than fixed: the sentence that needed `whom` was in `routes/play`, and
 * exporting a third seat-label helper *from the log viewer* to a route reads as
 * an API decision every time somebody needs the fourth. A module named for what
 * it holds makes the fourth and fifth free, and gives the gate
 * (`test/play/seat-voice.test.ts`) one import to state the complete set of ways
 * a seat may be said.
 *
 * # Both forms are spelled out at the call site
 *
 * `seatVerb` takes both conjugations rather than deriving one from the other. A
 * de-conjugator would be a heuristic over English (`tries` is not `trie` + `s`,
 * `has` is not `have` + `s`) and its failure mode is a sentence that reads wrong
 * on a surface nobody re-checks. Two words in the source is cheaper than being
 * right about the rule.
 */

/**
 * The label a surface uses for the seat the reader is sitting in.
 *
 * The one string this module compares against. Everything else here is a
 * consequence of it: English agrees with `You` differently from how it agrees
 * with a name, in the verb, in the possessive and in the capital.
 */
export const SECOND_PERSON = 'You';

/** True when this label is the second person, which is the whole condition. */
export function isSecondPerson(label: string): boolean {
  return label === SECOND_PERSON;
}

/**
 * A verb that agrees with a seat label: `You draw`, `Bot draws`.
 *
 * Taken at the *label* rather than at the seat id, because the surfaces that
 * need it do not agree on how a seat is looked up — the log carries a `SeatBook`
 * and `routes/play` carries a two-element `SeatNames` — and they do agree on the
 * answer, which is that the word `You` takes a second-person verb and every
 * other word takes a third-person one.
 */
export function seatVerb(label: string, third: string, second: string): string {
  return isSecondPerson(label) ? second : third;
}

/**
 * A possessive that agrees with a seat label: `your hand`, `Bot's hand`.
 *
 * `routes/play/naming.ts` says whose a targeted permanent is (`mtg-cee`) out of
 * this, and the log says whose control a permanent entered under out of the same
 * call.
 */
export function seatPossessive(label: string): string {
  return isSecondPerson(label) ? 'your' : `${label}'s`;
}

/** The same possessive opening a sentence, where only the pronoun shifts. */
export function seatPossessiveLeading(label: string): string {
  return isSecondPerson(label) ? 'Your' : `${label}'s`;
}

/**
 * A seat where a sentence points at it rather than speaks for it: `deals 2
 * damage to you`, `deals 2 damage to Bot`.
 *
 * The pronoun is not a name, so it does not keep the capital a label does. The
 * log printed `deals 3 combat damage to You.` mid-sentence and the blockers
 * prompt printed `Unblocked attackers deal their damage to You.` (`mtg-crv`),
 * and both read as a player called You rather than as the person holding the
 * screen. A seat that *opens* a sentence needs nothing from this function: a
 * label keeps its capital there and so does the pronoun.
 */
export function seatMention(label: string): string {
  return isSecondPerson(label) ? 'you' : label;
}

/**
 * The possessive that refers back to the sentence's own subject: `Bot keeps
 * their opening hand`, not `Bot keeps Bot's opening hand`.
 *
 * A different word from `seatPossessive`, which points at somebody the sentence
 * has not already named — `under Bot's control` is right and `under their
 * control` would be ambiguous with two players on the board.
 */
export function seatOwn(label: string): string {
  return isSecondPerson(label) ? 'your' : 'their';
}

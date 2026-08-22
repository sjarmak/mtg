/**
 * Deterministic English helpers for the text this package prints: the oracle
 * renderer, and the validator messages that quote a card kind back to whoever
 * has to fix the card. Pure string functions only, with no card knowledge, no
 * randomness and no locale dependence.
 */

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
] as const;

/** Card/token counts print as words up to ten, as digits beyond (Magic style). */
export function numberWord(n: number): string {
  const word = Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : undefined;
  return word ?? String(n);
}

/** Numbers whose spoken form starts with a vowel take "an". */
const AN_NUMBERS = new Set([8, 11, 18]);

export function articleForNumber(n: number): string {
  return AN_NUMBERS.has(n) ? 'an' : 'a';
}

/**
 * A word behind its indefinite article: `a creature`, `an instant`.
 *
 * The callers are the validators, whose messages quote a card kind ("so a
 * artifact cannot carry a spell's effect list") and are read back by a person
 * and by a repair loop. Two of the five card kinds open with a vowel, so a
 * bare "a" is wrong two times in five, and the article is written at each call
 * site, so the next message to quote a kind inherits the bug unless the phrase
 * itself is the shared thing.
 *
 * A first-letter rule is narrower than English ("a unicorn", "an hour") and
 * wide enough for the vocabulary it serves, which is five literal words this
 * function is tested against.
 */
export function withArticle(word: string): string {
  return `${articleForWord(word)} ${word}`;
}

/** The article alone, for callers that build the noun phrase themselves. */
export function articleForWord(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/**
 * Nouns whose plural English spells rather than derives, keyed by the lower-
 * cased headword. Every entry is a printed Magic creature subtype.
 *
 * The `-f` to `-ves` class lives here rather than in a rule because it is
 * closed: English admitted `elf`, `wolf`, `calf` and their handful of
 * neighbors centuries ago and has admitted nothing since, so a rule over the
 * spelling would turn Magic's own invented `Lhurgoyf` into `Lhurgoyves` and
 * this set's next monster with it. A made-up word takes `-s`, which is what
 * English does to made-up words.
 *
 * `folk` is the same argument in the other direction. It is a zero plural, and
 * it is a *class*: `Merfolk`, `Treefolk`, `Moonfolk`, `Townsfolk` and
 * `Clamfolk` are five subtypes and one rule, reached through the headword walk
 * below rather than written out five times. Magic prints "Tap four untapped
 * Merfolk you control", which is a count above one in the exact grammatical
 * slot a Chest's cost prints in, and never prints "Merfolks".
 *
 * The rest of the zero plurals are lexical rather than a class, and are here
 * one word at a time on printed evidence: `Kithkin`, `Eldrazi` and `Nephilim`
 * ("Nephilim you control get +1/+1 for each other Nephilim you control").
 * `hero` is the one entry that is neither closed-class nor zero: English is
 * split on `-o`, taking `heroes` but `photos`, so the word that Magic prints
 * 15 times as "Heroes" and never as "Heros" is a table entry and `-o` stays out
 * of the rules.
 */
const IRREGULAR_PLURALS: ReadonlyMap<string, string> = new Map([
  ['elf', 'elves'],
  ['wolf', 'wolves'],
  ['dwarf', 'dwarves'],
  ['mouse', 'mice'],
  ['ox', 'oxen'],
  ['child', 'children'],
  ['hero', 'heroes'],
  ['fish', 'fish'],
  ['sheep', 'sheep'],
  ['deer', 'deer'],
  ['bison', 'bison'],
  ['samurai', 'samurai'],
  ['aurochs', 'aurochs'],
  ['folk', 'folk'],
  ['kithkin', 'kithkin'],
  ['eldrazi', 'eldrazi'],
  ['nephilim', 'nephilim'],
  ['fungus', 'fungi'],
  ['pegasus', 'pegasi'],
  ['homunculus', 'homunculi'],
  ['locus', 'loci'],
  ['cyclops', 'cyclopes'],
]);

/**
 * A compound takes the plural of its head noun, and the head is the tail of the
 * word: Werewolf/Werewolves, Grandchild/Grandchildren, Starfish/Starfish.
 *
 * Three letters is the floor, and it is `ox` that sets it: `Grimlox` ends in the
 * headword `ox` and a Grimlox is not an ox, so a two-letter head may only match
 * the whole word. No headword of three or more is a tail of another subtype it
 * does not head.
 */
const MINIMUM_HEADWORD = 3;

function headwordPlural(word: string): string | undefined {
  const lower = word.toLowerCase();
  for (const [head, plural] of IRREGULAR_PLURALS) {
    const matches = lower === head || (head.length >= MINIMUM_HEADWORD && lower.endsWith(head));
    if (!matches) continue;
    const stem = word.slice(0, word.length - head.length);
    const printed = word.slice(word.length - head.length);
    // The head keeps the case it was printed in, which is upper on `Elf` and
    // `Half-Elf` and lower on the `wolf` inside `Werewolf`.
    return `${stem}${/^[A-Z]/.test(printed) ? capitalize(plural) : plural}`;
  }
  return undefined;
}

/**
 * The English plural of a noun.
 *
 * Written for the one caller whose noun this package did not choose: a
 * `sacrificeOther` cost prints `Sacrifice two <subtype>`, and the subtype is
 * whatever capitalized word the model put on the card. Every other caller
 * passes a fixed regular word and is unaffected.
 *
 * Two productive rules and one table. `-es` after a sibilant and `-ies` after a
 * consonant before `y` are rules because English still applies them to words it
 * has never seen, which is what a generated set is made of: `Grimlox` becomes
 * `Grimloxes` without anybody adding it anywhere. Everything English does not
 * derive from the spelling is a table entry instead of a cleverer rule.
 *
 * `packages/dsl/test/plural.test.ts` runs it over Magic's printed subtypes and
 * pins the words it still gets wrong. That list is a floor, not a census: it is
 * the words somebody has checked, and checking one takes reading printed oracle
 * text, because whether Magic pluralizes a subtype at all is a fact about
 * Wizards rather than about English. An earlier revision of this docblock said
 * the residual was five words and that all five were already plural in Latin.
 * Both halves were wrong. `Hero` printed as `Heros` against 15 printed
 * `Heroes`, and the whole `-folk` class printed an `-s` Magic has never
 * printed; none of those is Latin, and `-folk` is a spelling that separates its
 * members as a group, which the same paragraph denied. The fix was table
 * entries, and the lesson is this sentence: a limit nobody has swept is stated
 * as a floor.
 */
export function englishPlural(word: string): string {
  const headword = headwordPlural(word);
  if (headword !== undefined) return headword;
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

export function pluralize(word: string, count: number): string {
  return count === 1 ? word : englishPlural(word);
}

export function capitalize(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
}

/**
 * A rendered sentence turned into the clause that follows a trigger's comma.
 *
 * `renderEffect` returns a capitalized sentence, and "When X enters the
 * battlefield, You gain 2 life." is not English. The exception is a sentence
 * that opens with the card's own name — "Ember Drake deals 2 damage…" — which
 * is a proper noun and keeps its capital wherever it sits.
 */
export function asClause(sentence: string, cardName: string): string {
  if (sentence.startsWith(cardName)) return sentence;
  return sentence.length === 0 ? sentence : `${sentence[0]?.toLowerCase() ?? ''}${sentence.slice(1)}`;
}

/**
 * The same clause under CR 603.3b's "you may".
 *
 * Magic writes the permission in front of the effect — "you may put a +1/+1
 * counter on target creature" — and switches construction when the sentence's
 * subject is the source rather than the player: "you may *have* Ember Drake
 * *deal* 2 damage", because "you may Ember Drake deals 2 damage" is not English
 * and "you may deal 2 damage" would say the player deals it.
 *
 * Written as a rewrite of the printed sentence rather than as a second
 * `renderEffect`, so a card's optional line and its mandatory line can never
 * come out of two different printers. Two primitives in the vocabulary make the
 * source the subject: `dealDamage` names it outright, and `fight` names it as
 * the pronoun the trigger's own clause has just supplied an antecedent for. Both
 * take the "have … " construction and both need their own arm, because the
 * rewrite has to reach inside the sentence to find the bare verb.
 *
 * `oracle.test.ts` walks every effect kind through this function to make sure a
 * new primitive that names the source as its subject fails there rather than
 * shipping a card that reads "you may CARDNAME does something". That guard
 * looks for the card's *name*, so it cannot see the pronoun form: "you may it
 * fights target creature you don't control" contains no card name and would
 * pass. `fight.test.ts` asserts the optional line directly for that reason.
 */
export function mayClause(sentence: string, cardName: string): string {
  const deals = `${cardName} deals `;
  if (sentence.startsWith(deals)) return `you may have ${cardName} deal ${sentence.slice(deals.length)}`;
  const fights = 'It fights ';
  if (sentence.startsWith(fights)) return `you may have it fight ${sentence.slice(fights.length)}`;
  return `you may ${asClause(sentence, cardName)}`;
}

/** Signed power/toughness delta, e.g. `+2` / `-1` / `+0`. */
export function formatDelta(n: number): string {
  return n < 0 ? String(n) : `+${n}`;
}

/**
 * A power/toughness pair, where a zero takes the sign of the number beside it.
 *
 * Magic prints `-3/-0`, never `-3/+0`: the sign on a P/T line belongs to the
 * *change*, and a change that takes three power away does not add nothing to
 * toughness, it takes nothing away. `formatDelta` cannot see that, because it is
 * handed one number and a zero has no sign of its own — which is how a mass
 * power reduction came out reading `-3/+0` and was dropped rather than printed.
 *
 * Both zero prints `+0/+0`, which no card says; it is here so the function is
 * total rather than because anything reaches it. A mixed pair — One-Hit
 * Obliterator's `+99/-3` — has no zero to place and each half keeps its own
 * sign, which is why this reads the *partner* rather than the pair's direction.
 */
export function formatPtDelta(power: number, toughness: number): string {
  return `${formatDeltaBeside(power, toughness)}/${formatDeltaBeside(toughness, power)}`;
}

/**
 * One half of `formatPtDelta`, for the caller that has only one half in hand.
 *
 * `renderPump` is that caller: either of its two amounts may be a computed
 * letter rather than a number, and a letter prints `+X` with no sign to lend, so
 * it cannot hand the pair over whole.
 */
export function formatDeltaBeside(value: number, partner: number): string {
  return value === 0 && partner < 0 ? '-0' : formatDelta(value);
}

/** Oxford-free English list: `a`, `a and b`, `a, b, and c`. */
export function joinWithAnd(parts: readonly string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0] ?? ''} and ${parts[1] ?? ''}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1] ?? ''}`;
}

/**
 * Oxford-free English list joined with "or": `a`, `a or b`, `a, b, or c`.
 *
 * Protection's reminder is the one caller (`reminder.ts`): a card printed
 * `Protection from black and from red` reminds it as "…anything black *or*
 * red", because the printed keyword line lists qualities the permanent is
 * protected from independently (CR 702.16b is five separate clauses, not one
 * conjunction) while the *keyword line itself* still joins them with "and
 * from" — Sanctifier en-Vec's own two faces disagree on the word for exactly
 * that reason, and both are correct.
 */
export function joinWithOr(parts: readonly string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0] ?? ''} or ${parts[1] ?? ''}`;
  return `${parts.slice(0, -1).join(', ')}, or ${parts[parts.length - 1] ?? ''}`;
}

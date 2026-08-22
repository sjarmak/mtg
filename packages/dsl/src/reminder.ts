/**
 * Reminder text: what a keyword *means*, in the wording a card printed today
 * would carry.
 *
 * # It is not rules text, and it is deliberately not in `renderOracleText`
 *
 * Nothing here is reachable from `renderOracleText`, and three separate things
 * would break if it were.
 *
 * 1. `@mtg/setgen`'s `redFlagsFor` charges a New World Order `longText` red flag
 *    at more than 140 characters of `renderOracleText(card)`, and a common
 *    carrying two red flags is `NWO_MULTI_RED_FLAG`, an error. Real Magic does
 *    not count reminder text against a card's complexity — reminder text is what
 *    a set prints *to reduce* complexity — so a reminder inside the counted
 *    string would fail sets that are fine. This is not hypothetical here:
 *    `mtg-18a` records a counter whose 71-character reminder, which *is* inside
 *    `renderOracleText` because `renderEffect` appends it, priced the flagship's
 *    only part counter out of common by arithmetic alone.
 * 2. `oracleText` on a card record is validated to equal `renderOracleText(card)`
 *    exactly (`ORACLE_TEXT_MISMATCH`), and `@mtg/forge-export` transpiles from
 *    the same string. Reminder text is not something Forge wants restated on a
 *    card whose keyword it already implements.
 * 3. One definition per keyword lives here, rather than the same sentence
 *    repeated on every card that has the keyword and free to be repeated
 *    *differently*. A keyword is already vocabulary the engine enforces; its
 *    reminder is presentation, so it is derived where the card is drawn.
 *
 * # Which keywords get one: every keyword but flying
 *
 * Measured over the 38,623-card store rather than chosen. Reminder text in real
 * Magic is a decision the *set* makes, not the keyword: of the 157 sets that
 * first-printed 15 or more cards carrying one of our nine keywords, 46 gave
 * reminder text to none of them and 97 more to under a quarter, while only three
 * gave it to most. The three are core sets and beginner-facing products — Ninth
 * Edition, Tenth Edition, Magic Origins, the Core Set 2019-2021 run, Foundations
 * — which is the audience rule stated as data.
 *
 * Inside a set that does print reminders, one keyword is skipped and it is
 * always the same one. Foundations (2024, the current beginner-facing premier
 * set) first-printed 62 cards with flying and gave **none** of them reminder
 * text, while giving it to 53 of the 71 cards carrying the other eight: 8/12
 * vigilance, 5/7 haste, 12/16 trample, 8/9 deathtouch, 8/11 lifelink, 3/5
 * menace, 8/10 reach, 6/8 first strike. Core Set 2021 is the same shape (0/13
 * flying). Wind Drake (KLD 070), the reference for this work, prints a bare
 * `Flying` for the same reason.
 *
 * So: **flying is assumed known and every other keyword is explained.** That is
 * one `null` in the table below, and moving a keyword to either side of the line
 * is editing one entry.
 *
 * # A keyword with a reminder is printed on its own line
 *
 * Also measured, and it is why `keywordLines` exists beside `renderOracleText`'s
 * comma-separated one. Real cards keep the unreminded keywords together and give
 * each reminded one a line: Deathgaze Cockatrice prints `Flying` then
 * `Deathtouch (…)`, Kederekt Creeper prints `Menace (…)` then `Deathtouch (…)`,
 * Air Response Unit prints `Flying, vigilance` then its reminded ability.
 *
 * # Where each wording came from
 *
 * The store's Oracle text, taken from the cards that carry each reminder, and
 * every one of the nine is attested on a card reprinted in the newest set the
 * store holds (2026-11-13) except deathtouch, whose single wording is attested
 * to 2026-04-24 and has no competitor at all.
 *
 * Trample is the one that moved and the one worth reading twice. the playtester's
 * request quotes "…to the player or planeswalker it's attacking", which is the
 * wording every card first printed through 2024 carries — all twelve trample
 * reminders in Foundations say it. Every card first printed from 2025 onward
 * says "…to the player it's attacking", with no planeswalker: seven such cards,
 * the newest being Gorn Captain in the store's newest set, plus four more that
 * differ only in the pronoun. One recently reprinted card still shows the older
 * wording (Pelakka Wurm, first printed 2009), which is Oracle keeping a card's
 * own printed reminder rather than resyncing it. The wording below is therefore
 * the one a card printed today gets. Change this one entry if the older wording
 * is wanted.
 */
import type { CardKind, Keyword } from './vocabulary';
import { BASIC_LAND_TYPES, COLOR_WORDS, COLORS, KEYWORD_PRINT_NAMES, sortKeywords } from './vocabulary';
import { capitalize, joinWithOr, withArticle } from './text-util';

/**
 * What each keyword means, or `null` for a keyword this lab prints bare.
 *
 * A total `Record`, the same device `KEYWORD_PRINT_NAMES` and
 * `TRIGGER_PRINT_TEMPLATES` use: a keyword added to `KEYWORDS` without a
 * decision here is a compile error rather than a card that quietly explains
 * nothing. `null` is the decision "this one needs no explanation", which is a
 * different statement from "nobody has looked at it yet" and is why the type is
 * `string | null` rather than an optional key.
 */
export const KEYWORD_REMINDER_TEXT: Readonly<Record<Keyword, string | null>> = {
  flying: null,
  vigilance: "Attacking doesn't cause this creature to tap.",
  haste: 'This creature can attack and {T} as soon as it comes under your control.',
  trample: "This creature can deal excess combat damage to the player it's attacking.",
  deathtouch: 'Any amount of damage this deals to a creature is enough to destroy it.',
  lifelink: 'Damage dealt by this creature also causes you to gain that much life.',
  menace: "This creature can't be blocked except by two or more creatures.",
  reach: 'This creature can block creatures with flying.',
  firstStrike: 'This creature deals combat damage before creatures without first strike.',
};

/**
 * The two runs a reminder line is set in: the keyword, and the gloss on it.
 *
 * A printed card sets the keyword in the roman rules face and only the
 * parenthetical in italics, because the keyword *is* rules text and the
 * parenthetical is an explanation of it. So the line is composed from two named
 * parts rather than from one string a renderer would have to take apart again —
 * a second derivation of where the keyword ends is a second chance to put the
 * italics somewhere else.
 */
export interface KeywordReminder {
  /** The keyword as printed, set roman: `Trample`, `First strike`. */
  readonly keyword: string;
  /** The parenthetical explanation, set italic, parentheses included. */
  readonly gloss: string;
}

/** One keyword's printed reminder, in its two runs, or `null` when it prints bare. */
export function keywordReminder(keyword: Keyword): KeywordReminder | null {
  const reminder = KEYWORD_REMINDER_TEXT[keyword];
  if (reminder === null) return null;
  return { keyword: capitalize(KEYWORD_PRINT_NAMES[keyword]), gloss: `(${reminder})` };
}

/** One keyword's printed reminder line, or `null` when it prints bare. */
export function keywordReminderLine(keyword: Keyword): string | null {
  const runs = keywordReminder(keyword);
  return runs === null ? null : `${runs.keyword} ${runs.gloss}`;
}

/**
 * Reminder text for a printed ability line that carries one but is not itself
 * a flat keyword from `KEYWORDS`.
 *
 * Exalted (CR 702.83) is the one entry today, and it is not in `KEYWORDS`
 * beside vigilance and trample for a reason: its trigger has to notice *how
 * many* creatures attacked, which is real game state a kernel resolves rather
 * than a static grant a layer applies, so `abilities.ts` models it as a
 * `TriggeredAbility` and `renderTriggeredAbility` special-cases it to the one
 * word `'Exalted'`. What a printed card does with that word does not care
 * which structure produced it: it reminds Exalted exactly the way it reminds
 * a flat keyword, name upright and gloss italic in parentheses on its own
 * line, and the wording is unanimous across every Oracle-text printing of the
 * mechanic sampled from Forge's shipped card scripts (19 of the 20 cards whose
 * Oracle text carries the keyword, Qasali Pridemage among them; the one
 * exception, Repartee, is a card whose own ability template omits the
 * parenthetical Forge otherwise reprints verbatim).
 *
 * Keyed by the exact printed line — `renderOracleText` puts a triggered
 * ability alone on its own line by construction, the same fact the keyword
 * line already leans on — rather than by inspecting the ability's structure a
 * second time, which would make this table and `isExaltedAbility` two places
 * that have to agree about what counts as Exalted.
 *
 * Four of the five `KeywordAbility` kinds `card.ts` carried when mtg-josx
 * landed join Exalted here: Defender, Hexproof and Indestructible print one
 * fixed line each,
 * so they are literals the same way Exalted is. Landwalk prints one of five
 * lines depending only on which basic land it names, so those five are
 * generated from `BASIC_LAND_TYPES` below rather than typed out — a sixth
 * basic land type would need a decision no five hand-written strings would
 * ever surface, and the wording is uniform across all five in the store
 * (Adrestia, Anaconda, Canyon Wildcat, Boggart Loggers, Boggart Arsonists):
 * only the land name and its article change. All six wordings are the store's
 * Oracle text, attested on cards reprinted in the newest set the store holds
 * except Indestructible, whose one-clause wording (Darksteel Colossus,
 * Predator Ooze, 2024-11-15) replaced an older one that also stated what
 * happens at 0 toughness (Darksteel Myr, Darksteel Sentinel) — CR 704.5g
 * already covers that case for every creature, reminder or not, so the
 * newer wording is the one a card printed today gets, the same argument
 * `KEYWORD_REMINDER_TEXT`'s trample entry makes above.
 *
 * The fifth kind, Protection, is not here: its printed line names an
 * arbitrary-length list of qualities (`Protection from black and from red`,
 * `Protection from Humans`), so no fixed dictionary entry could name every
 * line it might print. `protectionLineReminder` below computes its reminder
 * instead, and `abilityLineReminder` tries it as a fallback when this table
 * has no exact-line match.
 *
 * Double strike is the sixth kind (`mtg-zd0y`) and prints a fixed line, so it
 * is a literal like the first three. Its wording is the store's rather than
 * invented: M13's Cleaver Riot prints the mass form, "(They deal both
 * first-strike and regular combat damage.)", and the row below is that
 * sentence with the singular subject every other creature-only row here uses.
 * Creature-only for the same reason Defender and landwalk are — a permanent
 * that never deals combat damage has nowhere to put it — so its gloss names
 * "this creature" outright and `selfNamingReminder` leaves it alone.
 */
const LANDWALK_REMINDER: Readonly<Record<string, string>> = Object.fromEntries(
  BASIC_LAND_TYPES.map((landType) => [
    `${landType}walk`,
    `This creature can't be blocked as long as defending player controls ${withArticle(landType)}.`,
  ]),
);

/**
 * The two reminders whose wording depends on what the card *is* (`mtg-rji`).
 *
 * Hexproof and indestructible are static abilities of any permanent (CR
 * 702.11b, CR 702.12a), and `checkKeywords` lets a noncreature permanent print
 * either one, so their reminders cannot say "this creature" the way Defender's
 * and landwalk's can — those two are refused anywhere but a creature, because
 * their rules are about attacking and blocking. The gloss names the card's own
 * type instead — CR 205.1a's five permanent types are the nouns — which is one
 * substitution rather than a second wording, so it is one function per line
 * here and `ABILITY_LINE_REMINDER_TEXT`'s creature rows are built from it. Two
 * literals would be two chances to reword the creature case and leave the
 * artifact case behind.
 *
 * **The creature wording is the store's and the rest is derived from it.** The
 * table's rows are still the measured Oracle text this file's own docblock
 * argues for (Darksteel Colossus for indestructible), because `('creature')`
 * reproduces them byte for byte — `reminder.test.ts` asserts exactly that. What
 * a real noncreature permanent prints has not been measured against the card
 * store, and it is stated here so a later reader knows which half to check
 * rather than assuming both were.
 */
const SELF_NAMING_REMINDER = {
  Hexproof: (self: string) =>
    `This ${self} can't be the target of spells or abilities your opponents control.`,
  Indestructible: (self: string) => `Damage and effects that say "destroy" don't destroy this ${self}.`,
} as const;

export const ABILITY_LINE_REMINDER_TEXT: Readonly<Record<string, string>> = {
  Exalted: 'Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.',
  Defender: "This creature can't attack.",
  'Double strike': 'This creature deals both first-strike and regular combat damage.',
  Hexproof: SELF_NAMING_REMINDER.Hexproof('creature'),
  Indestructible: SELF_NAMING_REMINDER.Indestructible('creature'),
  ...LANDWALK_REMINDER,
};

/**
 * This line's reminder worded for a noncreature permanent, or `null` when the
 * line is not one of the two that can sit on one.
 *
 * The card kind *is* the noun: `artifact`, `enchantment`, `land` and
 * `planeswalker` are the words a card prints for themselves (CR 205.1a), so
 * nothing maps them. An instant or a sorcery never reaches here — the validator
 * refuses a keyword ability on one, and a spell has no face on the battlefield
 * to remind anybody of.
 */
function selfNamingReminder(line: string, kind: CardKind): string | null {
  if (line === 'Hexproof') return SELF_NAMING_REMINDER.Hexproof(kind);
  if (line === 'Indestructible') return SELF_NAMING_REMINDER.Indestructible(kind);
  return null;
}

/**
 * Every color word `protectionQualityPhrase` (`oracle.ts`) can print for a
 * `{ kind: 'color' }` protection quality, mapped back to the word itself —
 * the reverse lookup `protectionLineReminder` needs to tell a color quality
 * apart from a subtype one in an already-printed line, without re-deriving
 * `ProtectionQuality` from English.
 */
const PROTECTION_COLOR_WORDS: ReadonlySet<string> = new Set(COLORS.map((color) => COLOR_WORDS[color]));

/**
 * Protection's reminder, computed from the printed line rather than stored,
 * because the line itself is computed: `keywordAbilityLines` (`oracle.ts`)
 * joins every `protection` ability on the card into one row, `Protection
 * from ${quality} and from ${quality} …`, and the qualities are an arbitrary
 * list the schema does not bound in content.
 *
 * Reminded only when every named quality is a color. Measured, the same way
 * `KEYWORD_REMINDER_TEXT`'s flying entry is measured: no sampled card reminds
 * a subtype- or characteristic-named protection at all — Yawgmoth, Thran
 * Physician prints a bare `Protection from Humans`, Kitsune Riftwalker a bare
 * `Protection from Spirits and from Arcane` — while a color-only list is
 * reminded on sight (Shifting Ceratops, Great Sable Stag, Paladin en-Vec).
 * A quality list this function cannot fully name in the reminder therefore
 * prints bare rather than partially, the same policy `keywordAbilityLines`
 * already applies to the printed line itself: one sentence, naming
 * everything the keyword grants, or nothing.
 *
 * The wording is Shifting Ceratops's (2023-11-17, the newest sampled
 * printing): "blocked, targeted, dealt damage, enchanted, or equipped by"
 * names every zone protection reaches into, one more than the CR 702.16b text
 * older cards like Great Sable Stag print. The qualities join with "or" here
 * even though the printed keyword line above joins them with "and from" —
 * `text-util.ts`'s `joinWithOr` explains why the two do not agree, and
 * should not.
 */
function protectionLineReminder(line: string): KeywordReminder | null {
  const match = /^Protection from (.+)$/.exec(line);
  const qualityList = match?.[1];
  if (qualityList === undefined) return null;
  const qualities = qualityList.split(' and from ');
  if (!qualities.every((quality) => PROTECTION_COLOR_WORDS.has(quality))) return null;
  return {
    keyword: line,
    gloss: `(This creature can't be blocked, targeted, dealt damage, enchanted, or equipped by anything ${joinWithOr(qualities)}.)`,
  };
}

/**
 * Flurry rush's reminder, computed rather than stored, for protection's reason
 * one step milder: the printed line carries a number, so no fixed dictionary
 * entry could name every line the ability word might print. A rank is a small
 * integer and the table could in principle have held ten rows, which is exactly
 * the argument against it — ten rows that differ in one character are ten
 * chances to typo the sentence, and an eleventh rank would print bare with
 * nothing failing.
 *
 * The wording is the mechanic's own definition, in Magic's reminder register:
 * present tense, "this creature" for the source the way `ABILITY_LINE_REMINDER_TEXT`'s
 * Defender and Indestructible rows already say it, and the damage stated in the
 * same breath as the trigger because the ability word has no second sentence.
 *
 * Deliberately not gated on the rank being one the set actually prints: this
 * function answers "what does this line mean", and a line reaches it only from
 * `renderTriggeredAbility`, which only writes it for an ability
 * `flurryRushRank` accepted.
 */
function flurryRushLineReminder(line: string): KeywordReminder | null {
  const match = /^Flurry rush ([1-9][0-9]*)$/.exec(line);
  const rank = match?.[1];
  if (rank === undefined) return null;
  return {
    keyword: line,
    gloss: `(Whenever this creature blocks or becomes blocked by a creature with greater power, this creature deals ${rank} damage to that creature.)`,
  };
}

/**
 * Gloom's reminder, computed for Flurry rush's reason and worded to say the two
 * things a player has to know that the word does not: that the counters land on
 * the creature that was hit, and what a gloom counter does once it is there.
 *
 * The second half is the same parenthetical the set's longhand gloom cards
 * already print, because a gloom counter is a -1/-1 counter with an identity
 * rather than a familiar keyword a player can be assumed to know. Printing the
 * trigger without it would be a line that tells you a counter arrives and never
 * says what it costs the creature.
 */
function gloomLineReminder(line: string): KeywordReminder | null {
  const match = /^Gloom ([1-9][0-9]*)$/.exec(line);
  const rank = match?.[1];
  if (rank === undefined) return null;
  const counters = rank === '1' ? 'a gloom counter' : `${rank} gloom counters`;
  return {
    keyword: line,
    gloss: `(Whenever this creature deals combat damage to a creature, put ${counters} on that creature. A creature with a gloom counter gets -1/-1.)`,
  };
}

/**
 * One ability line's printed reminder, in its two runs, or `null` when the line
 * has none.
 *
 * `kind` is the card the line is printed on, and it defaults to `creature`
 * because every line this table names but two is refused anywhere else. The two
 * are hexproof and indestructible, whose gloss names the card's own type; a
 * caller that has the card should pass its kind, and one that does not gets the
 * wording every card printed before `mtg-rji` carried.
 */
export function abilityLineReminder(line: string, kind: CardKind = 'creature'): KeywordReminder | null {
  const selfNamed = kind === 'creature' ? null : selfNamingReminder(line, kind);
  if (selfNamed !== null) return { keyword: line, gloss: `(${selfNamed})` };
  const reminder = ABILITY_LINE_REMINDER_TEXT[line];
  if (reminder !== undefined) return { keyword: line, gloss: `(${reminder})` };
  return protectionLineReminder(line) ?? flurryRushLineReminder(line) ?? gloomLineReminder(line);
}

/** The keywords of a card that print bare, in canonical order. */
export function bareKeywords(keywords: readonly Keyword[]): readonly Keyword[] {
  return sortKeywords(keywords).filter((keyword) => KEYWORD_REMINDER_TEXT[keyword] === null);
}

/** The keywords of a card that print a reminder, in canonical order. */
export function remindedKeywords(keywords: readonly Keyword[]): readonly Keyword[] {
  return sortKeywords(keywords).filter((keyword) => KEYWORD_REMINDER_TEXT[keyword] !== null);
}

/** One printed keyword line with no reminder on it: `Flying, vigilance`. */
export function bareKeywordLine(keywords: readonly Keyword[]): string | null {
  const bare = bareKeywords(keywords);
  if (bare.length === 0) return null;
  return capitalize(bare.map((keyword) => KEYWORD_PRINT_NAMES[keyword]).join(', '));
}

/**
 * A card's keyword lines as a face prints them: the bare ones on one line, then
 * one line per reminded keyword.
 *
 * `renderOracleText`'s own keyword line is the *rules* statement — every keyword,
 * comma-separated, no reminders — and stays exactly as it is, because that is
 * what the NWO gate counts, what Forge transpiles and what `oracleText` is
 * validated against. This is the same facts laid out the way a card prints them.
 */
export function keywordLines(keywords: readonly Keyword[]): readonly string[] {
  const bare = bareKeywordLine(keywords);
  const reminded = remindedKeywords(keywords).map((keyword) => {
    const line = keywordReminderLine(keyword);
    if (line === null) throw new Error(`reminder: ${keyword} was filtered as reminded and has no reminder`);
    return line;
  });
  return bare === null ? reminded : [bare, ...reminded];
}

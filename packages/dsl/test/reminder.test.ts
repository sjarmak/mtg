/**
 * Reminder text: the rule about which keywords get one, and the wording each
 * one gets.
 *
 * A wrong reminder is worse than no reminder, because it is a rules claim on the
 * face of a card, so the wordings are pinned here character for character. Where
 * they came from is `../src/reminder.ts`: the Oracle text of the cards in the
 * 38,623-card store that carry each reminder, every one of them attested on a
 * card reprinted in the newest set the store holds.
 */
import { describe, expect, it } from 'vitest';
import {
  ABILITY_LINE_REMINDER_TEXT,
  abilityLineReminder,
  bareKeywordLine,
  bareKeywords,
  KEYWORD_PRINT_NAMES,
  KEYWORD_REMINDER_TEXT,
  KEYWORDS,
  keywordLines,
  keywordReminder,
  keywordReminderLine,
  remindedKeywords,
  renderOracleText,
} from '../src/index';
import type { Keyword } from '../src/index';
import { exampleCard } from '../src/examples';

describe('which keywords print a reminder', () => {
  /**
   * The rule, stated as one assertion: flying is assumed known and every other
   * keyword is explained.
   *
   * Measured rather than chosen. Foundations (2024), the current beginner-facing
   * premier set, first-printed 62 cards with flying and gave none of them
   * reminder text, while giving it to 53 of the 71 cards carrying the other
   * eight; Core Set 2021 is the same shape at 0 of 13. Wind Drake (KLD 070),
   * this work's own reference, prints a bare `Flying`.
   */
  it('explains every keyword but flying', () => {
    const bare = KEYWORDS.filter((keyword) => KEYWORD_REMINDER_TEXT[keyword] === null);
    expect(bare).toEqual(['flying']);
  });

  /** A keyword added to the vocabulary without a decision is a compile error, so
   * the only thing left to check at runtime is that no entry is an empty string
   * standing in for one. */
  it('gives every explained keyword a real sentence', () => {
    for (const keyword of KEYWORDS) {
      const reminder = KEYWORD_REMINDER_TEXT[keyword];
      if (reminder === null) continue;
      expect(reminder.length, keyword).toBeGreaterThan(20);
      expect(reminder.endsWith('.'), `${keyword} reminder ends in a full stop`).toBe(true);
      expect(reminder.includes('('), `${keyword} reminder carries its own parentheses`).toBe(false);
    }
  });

  /**
   * The wordings, pinned. Each is the current Oracle text, read off the card
   * store; `../src/reminder.ts` names the newest printing attesting each one.
   *
   * Trample is the one to read twice. the playtester's request quoted "…to the player
   * or planeswalker it's attacking", which is what every card first printed
   * through 2024 carries — all twelve trample reminders in Foundations say it.
   * Every card first printed from 2025 on says "…to the player it's attacking",
   * seven of them, the newest in the store's newest set. This is the wording a
   * card printed today gets.
   */
  it('uses the modern Oracle wording for each', () => {
    expect(KEYWORD_REMINDER_TEXT).toStrictEqual({
      flying: null,
      vigilance: "Attacking doesn't cause this creature to tap.",
      haste: 'This creature can attack and {T} as soon as it comes under your control.',
      trample: "This creature can deal excess combat damage to the player it's attacking.",
      deathtouch: 'Any amount of damage this deals to a creature is enough to destroy it.',
      lifelink: 'Damage dealt by this creature also causes you to gain that much life.',
      menace: "This creature can't be blocked except by two or more creatures.",
      reach: 'This creature can block creatures with flying.',
      firstStrike: 'This creature deals combat damage before creatures without first strike.',
    });
  });

  it('prints the keyword before its reminder, capitalized, in parentheses', () => {
    expect(keywordReminderLine('trample')).toBe(
      "Trample (This creature can deal excess combat damage to the player it's attacking.)",
    );
    expect(keywordReminderLine('firstStrike')).toBe(
      'First strike (This creature deals combat damage before creatures without first strike.)',
    );
    expect(keywordReminderLine('flying')).toBeNull();
  });

  /**
   * The line is composed from two named runs because a printing sets them in two
   * faces: the keyword is rules text and stays roman, the parenthetical is a
   * gloss and is italic (`mtg-vsv`). Both renderers read the boundary off these
   * parts rather than looking for the first `(`, so the assertion that matters
   * is that the parts still spell the line — a keyword that drifted from the
   * line it is supposed to head would put the italics in the wrong place on
   * both faces at once.
   */
  it('gives the reminder its two runs, and they spell the line', () => {
    expect(keywordReminder('trample')).toEqual({
      keyword: 'Trample',
      gloss: "(This creature can deal excess combat damage to the player it's attacking.)",
    });
    expect(keywordReminder('firstStrike')?.keyword).toBe('First strike');
    expect(keywordReminder('flying')).toBeNull();
    for (const keyword of KEYWORDS) {
      const runs = keywordReminder(keyword);
      const line = keywordReminderLine(keyword);
      if (runs === null) {
        expect(line, keyword).toBeNull();
        continue;
      }
      expect(`${runs.keyword} ${runs.gloss}`, keyword).toBe(line);
      expect(runs.gloss.startsWith('('), keyword).toBe(true);
      expect(runs.gloss.endsWith(')'), keyword).toBe(true);
      // No parenthesis in the roman run: it is the whole of what stays upright.
      expect(runs.keyword, keyword).not.toContain('(');
    }
  });
});

describe('an ability line that is not a flat keyword', () => {
  /**
   * Exalted (CR 702.83) prints as the bare word `Exalted`
   * (`renderTriggeredAbility` special-cases it, because its trigger needs the
   * kernel's own count of how many creatures attacked, not a layer-6 grant),
   * so it never enters `KEYWORDS` and never reaches `keywordReminder`. A
   * reader of the printed card does not care which structure produced the
   * word, so it gets the same reminder treatment by the exact printed line
   * rather than by asking the ability object what it is a second time.
   */
  it('reminds Exalted the way it reminds a flat keyword', () => {
    expect(abilityLineReminder('Exalted')).toEqual({
      keyword: 'Exalted',
      gloss: '(Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)',
    });
  });

  it('has no reminder for a line no table entry names', () => {
    expect(abilityLineReminder('Flying')).toBeNull();
    expect(abilityLineReminder('Whenever this creature attacks, draw a card.')).toBeNull();
  });

  /**
   * mtg-josx: Defender, Hexproof and Indestructible are the three fixed-line
   * `KeywordAbility` kinds that printed with no reminder at all before this
   * bead. Each is a single literal in `ABILITY_LINE_REMINDER_TEXT`, reminded
   * the same way Exalted is above. Indestructible's wording is the newer,
   * one-clause Oracle text (Darksteel Colossus, Predator Ooze, 2024-11-15);
   * `../src/reminder.ts` explains why the older wording, which also stated the
   * 0-toughness case, is not the one a card printed today gets.
   */
  it('reminds Defender, Hexproof and Indestructible the way it reminds Exalted', () => {
    expect(abilityLineReminder('Defender')).toEqual({
      keyword: 'Defender',
      gloss: "(This creature can't attack.)",
    });
    expect(abilityLineReminder('Hexproof')).toEqual({
      keyword: 'Hexproof',
      gloss: "(This creature can't be the target of spells or abilities your opponents control.)",
    });
    expect(abilityLineReminder('Indestructible')).toEqual({
      keyword: 'Indestructible',
      gloss: '(Damage and effects that say "destroy" don\'t destroy this creature.)',
    });
  });

  /**
   * `mtg-rji`: the same two lines, on the noncreature permanents that may now
   * carry them. The gloss names the card's own type (CR 205.1a), and the
   * creature wording above is the `('creature')` case of the same substitution
   * rather than a second literal — that is what the last assertion pins, so a
   * reworded artifact gloss cannot silently leave the measured creature gloss
   * behind.
   */
  it("names the card's own type in the two reminders a permanent can carry", () => {
    expect(abilityLineReminder('Indestructible', 'artifact')).toEqual({
      keyword: 'Indestructible',
      gloss: '(Damage and effects that say "destroy" don\'t destroy this artifact.)',
    });
    expect(abilityLineReminder('Hexproof', 'enchantment')?.gloss).toBe(
      "(This enchantment can't be the target of spells or abilities your opponents control.)",
    );
    expect(abilityLineReminder('Hexproof', 'land')?.gloss).toContain('This land');
    expect(abilityLineReminder('Indestructible', 'planeswalker')?.gloss).toContain('this planeswalker');
    for (const line of ['Hexproof', 'Indestructible'] as const) {
      expect(abilityLineReminder(line, 'creature')).toEqual(abilityLineReminder(line));
      expect(abilityLineReminder(line)?.gloss).toBe(`(${ABILITY_LINE_REMINDER_TEXT[line] ?? ''})`);
    }
  });

  /**
   * Defender and landwalk are refused anywhere but a creature, so their gloss
   * has one wording and a card kind cannot move it.
   */
  it('leaves the combat-shaped lines worded for a creature whatever it is asked', () => {
    expect(abilityLineReminder('Defender', 'artifact')?.gloss).toBe("(This creature can't attack.)");
    expect(abilityLineReminder('Swampwalk', 'land')).toEqual(abilityLineReminder('Swampwalk'));
  });

  /**
   * The fourth kind, Landwalk, prints one of five lines depending only on
   * which basic land it names. `../src/reminder.ts` generates these five from
   * `BASIC_LAND_TYPES` rather than typing them out, so this test pins the
   * generated output rather than a hand-maintained table — the wording is
   * uniform across the sampled printings (Adrestia, Anaconda, Canyon Wildcat,
   * Boggart Loggers, Boggart Arsonists) except for the land name and its
   * article, which is exactly what varies between these five assertions.
   */
  it('reminds all five landwalk lines, one basic land apiece', () => {
    expect(abilityLineReminder('Islandwalk')).toEqual({
      keyword: 'Islandwalk',
      gloss: "(This creature can't be blocked as long as defending player controls an Island.)",
    });
    expect(abilityLineReminder('Swampwalk')).toEqual({
      keyword: 'Swampwalk',
      gloss: "(This creature can't be blocked as long as defending player controls a Swamp.)",
    });
    expect(abilityLineReminder('Mountainwalk')).toEqual({
      keyword: 'Mountainwalk',
      gloss: "(This creature can't be blocked as long as defending player controls a Mountain.)",
    });
    expect(abilityLineReminder('Forestwalk')).toEqual({
      keyword: 'Forestwalk',
      gloss: "(This creature can't be blocked as long as defending player controls a Forest.)",
    });
    expect(abilityLineReminder('Plainswalk')).toEqual({
      keyword: 'Plainswalk',
      gloss: "(This creature can't be blocked as long as defending player controls a Plains.)",
    });
  });

  /**
   * The fifth kind, Protection, is not a table entry at all: its printed line
   * names an arbitrary-length list of qualities, so `protectionLineReminder`
   * computes the reminder from the line `keywordAbilityLines` already printed
   * rather than storing one. Pinned by example rather than by a single
   * lookup: a one-color case and a two-color case, the second to prove the
   * printed keyword line still joins qualities with "and from" while the
   * reminder's own gloss joins them with "or" — `joinWithOr`'s docblock in
   * `text-util.ts` argues why the two legitimately disagree.
   */
  it('computes protection\'s reminder from the printed line, joining qualities with "or"', () => {
    expect(abilityLineReminder('Protection from red')).toEqual({
      keyword: 'Protection from red',
      gloss:
        "(This creature can't be blocked, targeted, dealt damage, enchanted, or equipped by anything red.)",
    });
    expect(abilityLineReminder('Protection from black and from red')).toEqual({
      keyword: 'Protection from black and from red',
      gloss:
        "(This creature can't be blocked, targeted, dealt damage, enchanted, or equipped by anything black or red.)",
    });
  });

  /**
   * Measured, the same way `KEYWORD_REMINDER_TEXT`'s flying entry is: no
   * sampled card reminds a subtype- or characteristic-named protection at
   * all (Yawgmoth, Thran Physician prints a bare `Protection from Humans`;
   * Kitsune Riftwalker a bare `Protection from Spirits and from Arcane`), so
   * a quality list this function cannot fully name in the reminder prints
   * bare rather than partially.
   */
  it('prints protection bare when a named quality is not a color', () => {
    expect(abilityLineReminder('Protection from Humans')).toBeNull();
    expect(abilityLineReminder('Protection from Spirits and from Arcane')).toBeNull();
  });

  it("gives every entry a real sentence, matching the flat-keyword table's own shape", () => {
    for (const [line, reminder] of Object.entries(ABILITY_LINE_REMINDER_TEXT)) {
      expect(reminder.length, line).toBeGreaterThan(20);
      expect(reminder.endsWith('.'), `${line} reminder ends in a full stop`).toBe(true);
      expect(reminder.includes('('), `${line} reminder carries its own parentheses`).toBe(false);
    }
  });
});

describe('how a card lays its keywords out', () => {
  /**
   * The unreminded keywords share one comma-separated line and each reminded
   * one takes a line of its own — measured over real printings, not invented.
   * Deathgaze Cockatrice prints `Flying` then `Deathtouch (…)`; Kederekt Creeper
   * prints two reminded keywords, one per line; Air Response Unit prints
   * `Flying, vigilance` and then its reminded ability.
   *
   * The *order* within each half is this vocabulary's own (`sortKeywords`) and
   * not the order any one real card happens to print — Kederekt Creeper prints
   * menace above deathtouch and `KEYWORDS` puts deathtouch first. One order for
   * the whole set beats matching a particular card, and it is already the order
   * `renderOracleText` prints its keyword line in, so the face and the oracle
   * string cannot disagree about which keyword leads.
   */
  it('keeps the bare keywords together and gives each reminded one its own line', () => {
    expect(keywordLines(['flying', 'deathtouch'])).toEqual([
      'Flying',
      'Deathtouch (Any amount of damage this deals to a creature is enough to destroy it.)',
    ]);
    expect(keywordLines(['menace', 'deathtouch'])).toEqual([
      'Deathtouch (Any amount of damage this deals to a creature is enough to destroy it.)',
      "Menace (This creature can't be blocked except by two or more creatures.)",
    ]);
    expect(keywordLines(['flying'])).toEqual(['Flying']);
    expect(keywordLines([])).toEqual([]);
  });

  it('sorts both halves into the vocabulary order the oracle text uses', () => {
    const scrambled: readonly Keyword[] = ['reach', 'flying', 'menace', 'vigilance'];
    expect(bareKeywords(scrambled)).toEqual(['flying']);
    expect(remindedKeywords(scrambled)).toEqual(['vigilance', 'menace', 'reach']);
    expect(bareKeywordLine(scrambled)).toBe('Flying');
  });

  /**
   * The one property that ties this back to the rules text: every keyword the
   * oracle string prints is on exactly one of these lines, and no keyword is on
   * two. Without it a keyword could be silently dropped from the face while the
   * card still claimed to have it.
   */
  it('prints each keyword of a card exactly once', () => {
    const all: readonly Keyword[] = KEYWORDS;
    const lines = keywordLines(all).join('\n');
    for (const keyword of all) {
      const name = KEYWORD_PRINT_NAMES[keyword];
      const pattern = new RegExp(`(^|\\n|, )${name}(,|$|\\n| \\()`, 'gi');
      expect([...lines.matchAll(pattern)].length, name).toBe(1);
    }
  });
});

describe('the oracle text is untouched', () => {
  /**
   * The whole reason reminder text is derived rather than stored. `redFlagsFor`
   * reads `renderOracleText(card)` and charges a `longText` red flag past 140
   * characters, `oracleText` on a record is validated to equal it, and
   * `@mtg/forge-export` transpiles from it. None of them may see a reminder.
   */
  it('keeps every keyword on one comma-separated line with no reminder', () => {
    const drake = exampleCard('slc-skywatch-sentinel');
    expect(drake.keywords.length).toBeGreaterThan(1);
    const oracle = renderOracleText(drake);
    expect(oracle.split('\n')[0]).toBe('Flying, vigilance');
    expect(oracle).not.toContain('(');
  });

  it('carries no reminder for any keyword on any example card', () => {
    for (const keyword of KEYWORDS) {
      const reminder = KEYWORD_REMINDER_TEXT[keyword];
      if (reminder === null) continue;
      const card = { ...exampleCard('slc-skywatch-sentinel'), keywords: [keyword] };
      expect(renderOracleText(card)).not.toContain(reminder);
    }
  });
});

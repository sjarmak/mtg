/**
 * The plural of a word the model chose, which is what a Chest's cost prints.
 *
 * Every other caller of `pluralize` hands it a word this package wrote —
 * `counter`, `token`, `card` — so "add an s" was the whole of English it
 * needed. `sacrificeOther` is the first cost whose noun comes off the card:
 * `Sacrifice two <subtype>`, where the subtype is any capitalized word
 * `SUBTYPE_PATTERN` accepts. Add an s to those and a card face reads
 * `Sacrifice two Elfs`.
 *
 * The words below are Magic's own creature subtypes, taken from the 399 that
 * appear after the dash on a `Creature` type line in `data/store/mtg.sqlite`
 * (38,623 oracle cards), plus the subtypes the flagship set prints. Where a
 * count is quoted it is whole-word occurrences of that plural in the
 * `oracle_text` column of the same store, so the assertion is what Wizards
 * printed rather than what a dictionary allows.
 */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText } from '../src';
import { englishPlural, pluralize } from '../src/text-util';

/** `{1}, Sacrifice two <subtype>: You gain 2 life.` */
function chestPrinting(subtype: string, count: number): string {
  return renderOracleText(
    parseCard({
      kind: 'artifact',
      id: `xmp-chest-${subtype.toLowerCase()}-${count}`,
      name: 'Locked Chest',
      rarity: 'common',
      set: { code: 'XMP', collectorNumber: 1 },
      manaCost: { generic: 2 },
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 1 }, sacrificeOther: { count, subtype } },
          effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
        },
      ],
    }),
  );
}

describe('englishPlural over the subtypes Magic prints', () => {
  it('turns the -f class into -ves rather than -fs', () => {
    // Elves 53, Wolves 17, Werewolves 12, Dwarves 9 in the oracle-text column.
    // Dwarf is the one English itself is split on ("dwarfs"); Magic is not.
    expect(englishPlural('Elf')).toBe('Elves');
    expect(englishPlural('Wolf')).toBe('Wolves');
    expect(englishPlural('Dwarf')).toBe('Dwarves');
    expect(englishPlural('Werewolf')).toBe('Werewolves');
  });

  it('leaves an invented word ending in f alone', () => {
    // The -ves class is closed: English stopped admitting new members to it,
    // and a set of made-up creatures is nothing but new members. Lhurgoyf and
    // Phelddagrif are Magic's own, and the same rule protects a Seraphine one.
    expect(englishPlural('Lhurgoyf')).toBe('Lhurgoyfs');
    expect(englishPlural('Phelddagrif')).toBe('Phelddagrifs');
    expect(englishPlural('Giraffe')).toBe('Giraffes');
    expect(englishPlural('Serf')).toBe('Serfs');
    expect(englishPlural('Chef')).toBe('Chefs');
  });

  it('adds -es after a sibilant', () => {
    expect(englishPlural('Phoenix')).toBe('Phoenixes');
    expect(englishPlural('Sphinx')).toBe('Sphinxes');
    expect(englishPlural('Fox')).toBe('Foxes');
    expect(englishPlural('Leech')).toBe('Leeches');
    // "Crabs, Lobsters, Nautiluses, Starfish, and/or Trilobites you control"
    // is one printed line, and it settles two of these on its own.
    expect(englishPlural('Nautilus')).toBe('Nautiluses');
    expect(englishPlural('Walrus')).toBe('Walruses');
    expect(englishPlural('Octopus')).toBe('Octopuses');
    // the flagship set's own, and the reason `ox` may not match as a suffix.
    expect(englishPlural('Grimlox')).toBe('Grimloxes');
  });

  it('turns a consonant before y into -ies and leaves a vowel alone', () => {
    // Allies 20, Faeries 11, Ponies 1, Armies 1; Monkeys is the vowel case.
    expect(englishPlural('Ally')).toBe('Allies');
    expect(englishPlural('Army')).toBe('Armies');
    expect(englishPlural('Harpy')).toBe('Harpies');
    expect(englishPlural('Pony')).toBe('Ponies');
    expect(englishPlural('Monkey')).toBe('Monkeys');
  });

  it('spells the plurals English does not derive from the spelling', () => {
    // Mice 6, Oxen 3, Pegasi 2 in the oracle-text column. Fish, Samurai and
    // Aurochs are printed unchanged in a plural sentence: "tap any number of
    // Fish you control", "untap it and all Samurai you control", "for each
    // other attacking Aurochs".
    expect(englishPlural('Mouse')).toBe('Mice');
    expect(englishPlural('Ox')).toBe('Oxen');
    expect(englishPlural('Pegasus')).toBe('Pegasi');
    expect(englishPlural('Fish')).toBe('Fish');
    expect(englishPlural('Samurai')).toBe('Samurai');
    expect(englishPlural('Aurochs')).toBe('Aurochs');
    expect(englishPlural('Sheep')).toBe('Sheep');
    expect(englishPlural('Bison')).toBe('Bison');
    expect(englishPlural('Fungus')).toBe('Fungi');
  });

  it('takes the plural of a compound from its head noun', () => {
    // Each of these is a printed subtype, and each is its head plus a prefix.
    expect(englishPlural('Jellyfish')).toBe('Jellyfish');
    expect(englishPlural('Starfish')).toBe('Starfish');
    expect(englishPlural('Grandchild')).toBe('Grandchildren');
  });

  it('leaves the words the flagship set prints regular', () => {
    expect(englishPlural('Key')).toBe('Keys');
    expect(englishPlural('Part')).toBe('Parts');
    expect(englishPlural('Monster')).toBe('Monsters');
    expect(englishPlural('Direhorn')).toBe('Direhorns');
    expect(englishPlural('Wyrmhead')).toBe('Wyrmheads');
    expect(englishPlural('Sylvanok')).toBe('Sylvanoks');
  });

  /**
   * The zero plurals Magic prints, which are two different things.
   *
   * `-folk` is a class and is matched as a headword, so the five subtypes that
   * end in it cost one table entry between them. The evidence is printed: "Tap
   * four untapped Merfolk you control" is a count above one in the same
   * grammatical slot a Chest's cost prints in, and `Merfolks` appears nowhere
   * in 38,623 oracle cards. The other three are lexical and are here one word
   * at a time.
   */
  it('leaves the zero plurals alone, by class and by word', () => {
    expect(englishPlural('Merfolk')).toBe('Merfolk');
    expect(englishPlural('Treefolk')).toBe('Treefolk');
    expect(englishPlural('Moonfolk')).toBe('Moonfolk');
    expect(englishPlural('Townsfolk')).toBe('Townsfolk');
    expect(englishPlural('Clamfolk')).toBe('Clamfolk');
    expect(englishPlural('Kithkin')).toBe('Kithkin');
    expect(englishPlural('Eldrazi')).toBe('Eldrazi');
    expect(englishPlural('Nephilim')).toBe('Nephilim');
  });

  it('spells Hero the way Magic spells it, which is not the way the rule would', () => {
    // Heroes 15, Heros 0 in the oracle-text column. English is split on `-o`
    // (heroes, photos), so this is a table entry and `-o` stays out of the
    // rules: a made-up word ending in o takes `-s`, as Magic's own Atog does.
    expect(englishPlural('Hero')).toBe('Heroes');
    expect(englishPlural('Atog')).toBe('Atogs');
  });

  /**
   * The limit, stated as a floor rather than as a census.
   *
   * These five are wrong, and they are what somebody has checked rather than
   * what exists: four are already plural before anything pluralizes them
   * (`Astartes` and `Custodes` are Latin, `Thalakos` is Magic's own, and
   * `Elves` is a subtype because a card is named Seven Dwarves), and `Primarch`
   * has a `ch` said as a k, so it takes `-s` where `Leech` takes `-es`.
   *
   * The earlier version of this paragraph said five was the whole of it and
   * that no spelling separated any of them from a word the rules get right.
   * Six more were found immediately after it shipped, one of them a spelling
   * class (`-folk`), and `Hero` was not exotic at all. Checking a subtype means
   * reading printed oracle text, because whether Magic pluralizes a word is a
   * fact about Wizards; nothing here sweeps all 321 of them, and the bead that
   * would is filed rather than pretended.
   *
   * They are asserted rather than described because a described limit is a
   * sentence nothing checks: the day somebody teaches the table `Astartes`,
   * this test fails and the paragraph above gets corrected with it.
   */
  it('gets the already-plural subtypes wrong, on purpose', () => {
    expect(englishPlural('Astartes')).toBe('Astarteses');
    expect(englishPlural('Custodes')).toBe('Custodeses');
    expect(englishPlural('Thalakos')).toBe('Thalakoses');
    expect(englishPlural('Elves')).toBe('Elveses');
    expect(englishPlural('Primarch')).toBe('Primarches');
  });

  /**
   * The two sibilant branches no subtype reaches.
   *
   * Nothing in Magic's 321 creature subtypes ends in `z`, and the only ones
   * ending in `sh` are Fish, Jellyfish and Starfish, which the table answers
   * before the rule is consulted. So both branches existed for invented words
   * alone, which is what the rules are for, and dropping either from the
   * pattern left the whole package green. A generated set is made of invented
   * words, so they are pinned with invented words.
   */
  it('applies the sibilant rule to the letters no printed subtype exercises', () => {
    expect(englishPlural('Blitz')).toBe('Blitzes');
    expect(englishPlural('Brigblitz')).toBe('Brigblitzes');
    expect(englishPlural('Sploosh')).toBe('Splooshes');
    expect(englishPlural('Vornish')).toBe('Vornishes');
  });

  it('borrows the Latin plural where English borrowed it', () => {
    // Not a rule: `Octopus` and `Walrus` end the same way and take `-es`, and
    // "Crabs, Lobsters, Nautiluses, Starfish, and/or Trilobites you control" is
    // Magic printing the English one. Which `-us` goes to `-i` is lexical.
    expect(englishPlural('Fungus')).toBe('Fungi');
    expect(englishPlural('Homunculus')).toBe('Homunculi');
    expect(englishPlural('Locus')).toBe('Loci');
    expect(englishPlural('Cyclops')).toBe('Cyclopes');
  });

  it('leaves a count of one alone', () => {
    expect(pluralize('Elf', 1)).toBe('Elf');
    expect(pluralize('Elf', 2)).toBe('Elves');
    expect(pluralize('counter', 3)).toBe('counters');
  });
});

describe("a Chest's printed cost", () => {
  it('prints the plural a card would print', () => {
    expect(chestPrinting('Key', 2)).toBe('{1}, Sacrifice two Keys: You gain 2 life.');
    expect(chestPrinting('Elf', 2)).toBe('{1}, Sacrifice two Elves: You gain 2 life.');
    expect(chestPrinting('Wolf', 2)).toBe('{1}, Sacrifice two Wolves: You gain 2 life.');
    expect(chestPrinting('Dwarf', 3)).toBe('{1}, Sacrifice three Dwarves: You gain 2 life.');
    expect(chestPrinting('Phoenix', 2)).toBe('{1}, Sacrifice two Phoenixes: You gain 2 life.');
  });

  it('keeps the article at a count of one', () => {
    expect(chestPrinting('Key', 1)).toBe('{1}, Sacrifice a Key: You gain 2 life.');
    expect(chestPrinting('Elf', 1)).toBe('{1}, Sacrifice an Elf: You gain 2 life.');
  });
});

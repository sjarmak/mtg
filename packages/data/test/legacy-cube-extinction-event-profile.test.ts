import { describe, expect, it } from 'vitest';
import {
  LEGACY_CUBE_EXTINCTION_EVENT_EXCLUDED_POSITIONS,
  LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION,
  LEGACY_CUBE_EXTINCTION_EVENT_SAFE_POSITIONS,
  legacyCubeExtinctionEventProfileRefusals,
  loadLegacyCubePrintedCatalog,
  verifyLegacyCubeExtinctionEventImplementation,
} from '@mtg/data';

const exact: readonly string[] = [
  'Name:Extinction Event',
  'ManaCost:3 B',
  'Types:Sorcery',
  'A:SP$ ChooseEvenOdd | StackDescription$ SpellDescription | SubAbility$ DBExile | SpellDescription$ Choose odd or even. Exile each creature with mana value of the chosen quality. (Zero is even.)',
  'SVar:DBExile:DB$ ChangeZoneAll | ChangeType$ Creature.cmcChosenEvenOdd | Origin$ Battlefield | Destination$ Exile',
  'Oracle:Choose odd or even. Exile each creature with mana value of the chosen quality. (Zero is even.)',
];

const script = (lines: readonly string[]): Uint8Array => new TextEncoder().encode(`${lines.join('\n')}\n`);

describe('the exact Extinction Event Legacy Cube profile', () => {
  it('binds the one promoted official position to the current printed card', () => {
    expect(LEGACY_CUBE_EXTINCTION_EVENT_SAFE_POSITIONS).toEqual([235]);
    expect(LEGACY_CUBE_EXTINCTION_EVENT_EXCLUDED_POSITIONS).toEqual([]);
    expect(loadLegacyCubePrintedCatalog().cards[234]).toMatchObject({
      position: 235,
      name: 'Extinction Event',
      manaCost: '{3}{B}',
      typeLine: 'Sorcery',
      oracleText:
        'Choose odd or even. Exile each creature with mana value of the chosen quality. (Zero is even.)',
    });
  });

  it('pins the installed effect bytecode and matching upstream source revision', () => {
    expect(LEGACY_CUBE_EXTINCTION_EVENT_IMPLEMENTATION).toEqual({
      classPath: 'forge/game/ability/effects/ChooseEvenOddEffect.class',
      classSha256: '707fe1a0291eb0e54ad1daf12407ec1544ce19e977fdded2a21018105835eb50',
      upstream: {
        repository: 'Card-Forge/forge',
        revision: 'a37a865a53280dd8ad6fad3384d69611e8c5a42f',
        path: 'forge-game/src/main/java/forge/game/ability/effects/ChooseEvenOddEffect.java',
        blobSha1: '8f5e0a8594aa7694154b1c522a2cfe4ad0e912de',
        sourceSha256: '1bb898324cd087b268d9ddec7cf357e32ce896a94eae5f7919c310b5fb7e34ab',
      },
    });
    expect(() =>
      verifyLegacyCubeExtinctionEventImplementation(
        new TextEncoder().encode('stale class'),
        new TextEncoder().encode('stale source'),
      ),
    ).toThrow(/ChooseEvenOddEffect class checksum drift/i);
  });

  it('admits only the exact odd-even whole-board exile script', () => {
    expect(legacyCubeExtinctionEventProfileRefusals(script(exact))).toEqual([]);
    const hostile: readonly (readonly [readonly string[], string])[] = [
      [exact.with(0, 'Name:Extinction Parade'), 'exact identity'],
      [exact.with(1, 'ManaCost:2 B'), 'exact mana cost'],
      [exact.with(2, 'Types:Instant'), 'exact sorcery type'],
      [exact.with(3, exact[3]!.replace('ChooseEvenOdd', 'ChooseNumber')), 'exact odd-even choice'],
      [
        exact.with(3, exact[3]!.replace('SubAbility$ DBExile', 'SubAbility$ DBRemove')),
        'exact odd-even choice',
      ],
      [
        exact.with(4, exact[4]!.replace('Creature.cmcChosenEvenOdd', 'Creature.cmcOdd')),
        'exact parity filter',
      ],
      [exact.with(4, exact[4]!.replace('Origin$ Battlefield', 'Origin$ Graveyard')), 'exact parity exile'],
      [
        exact.with(4, exact[4]!.replace('Destination$ Exile', 'Destination$ Graveyard')),
        'exact parity exile',
      ],
      [exact.with(5, exact[5]!.replace('Zero is even.', 'Zero is odd.')), 'exact installed Oracle text'],
      [exact.with(3, exact[4]!).with(4, exact[3]!), 'exact script order and multiplicity'],
      [[...exact, exact[4]!], 'exact script order and multiplicity'],
      [[...exact, 'A:AB$ Draw | Cost$ 0'], 'additional mechanic'],
    ];
    for (const [lines, expected] of hostile) {
      expect(legacyCubeExtinctionEventProfileRefusals(script(lines))).toContain(expected);
    }
  });
});

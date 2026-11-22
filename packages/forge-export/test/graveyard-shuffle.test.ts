/**
 * Forge parity for CR 701.22 over a whole graveyard, both printed forms.
 *
 * The two cards are the two the DSL primitive was written from, and their
 * shipped scripts are what the mapping was read off: `archangels_light.txt`
 * sweeps a graveyard into a library in one `ChangeZoneAll`, and
 * `elixir_of_immortality.txt` moves a permanent alongside that sweep, which is
 * the whole reason `includeSelf` is a field rather than a second effect.
 *
 * The chain is where a wrong export would still look right. CR 701.22b makes
 * the moves and the shuffle one action, so neither move may shuffle on its own:
 * an export that wrote `Shuffle$ True` on either half would shuffle a library
 * that the other half was about to add cards to, and the card would read as
 * correct while the deck it produced was not.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

function lines(card: unknown): readonly string[] {
  const result = transpileCard(parseCard(card));
  expect(result.ok).toBe(true);
  return result.ok ? result.script.text.split('\n') : [];
}

describe("a spell that shuffles its controller's graveyard back", () => {
  it("writes archangels_light.txt's sweep", () => {
    const script = lines({
      kind: 'sorcery',
      id: 'tst-archangels-light',
      name: "Archangel's Light",
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 1 },
      colors: ['W'],
      manaCost: { W: 1, generic: 7 },
      effects: [{ kind: 'shuffleGraveyardIntoLibrary' }],
    });
    expect(script).toContain(
      "A:SP$ ChangeZoneAll | ChangeType$ Card.YouOwn | Origin$ Graveyard | Destination$ Library | Shuffle$ True | SpellDescription$ Shuffle your graveyard into its owner's library.",
    );
  });
});

describe('a permanent that shuffles itself back with the graveyard', () => {
  const ELIXIR = {
    kind: 'artifact',
    id: 'tst-elixir-of-immortality',
    name: 'Elixir of Immortality',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 2 },
    colors: [],
    manaCost: { generic: 1 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 2 }, tapSelf: true },
        effects: [
          { kind: 'gainLife', amount: 5, target: { kind: 'noTarget' } },
          { kind: 'shuffleGraveyardIntoLibrary', includeSelf: true },
        ],
      },
    ],
  };

  it("writes elixir_of_immortality.txt's four steps in its order", () => {
    const script = lines(ELIXIR);
    const chain = script.filter((line) => line.startsWith('SVar:Act1Effect'));
    expect(chain).toEqual([
      'SVar:Act1Effect2:DB$ ChangeZone | Origin$ Battlefield | Destination$ Library | Shuffle$ False | RememberChanged$ True | Defined$ Self | SubAbility$ Act1Effect3',
      'SVar:Act1Effect3:DB$ ChangeZoneAll | ChangeType$ Card.YouOwn | Origin$ Graveyard | Destination$ Library | Shuffle$ False | RememberChanged$ True | SubAbility$ Act1Effect4',
      'SVar:Act1Effect4:DB$ Shuffle | Defined$ RememberedOwner | SubAbility$ Act1Effect5',
      'SVar:Act1Effect5:DB$ Cleanup | ClearRemembered$ True',
    ]);
  });

  it('shuffles once, after both moves', () => {
    // The assertion CR 701.22b turns into a test: two moves, both declining to
    // shuffle, and exactly one `DB$ Shuffle` after them.
    const script = lines(ELIXIR);
    expect(script.filter((line) => line.includes('Shuffle$ True'))).toEqual([]);
    expect(script.filter((line) => line.includes('DB$ Shuffle |'))).toHaveLength(1);
  });
});

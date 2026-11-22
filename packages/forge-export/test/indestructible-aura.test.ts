/**
 * Forge parity for a targeted prevention, which Forge writes as a replacement
 * effect and not as an effect API.
 *
 * There is no `PreventDamage` spelling in Forge that takes a target and lasts
 * the turn. `indestructible_aura.txt` and `shielded_passage.txt` are the same
 * script twice: an `SP$ Effect` that remembers the target and installs a
 * command-zone `DamageDone` replacement scoped to `Card.IsRemembered`. Read off
 * `forge-gui/res/cardsfolder` at 2.0.15-SNAPSHOT, like the rest of this
 * mapping, and unverified against a booted Forge (`mtg-17a`).
 *
 * `mtg-udc9.1` wrote the row those two scripts describe; before it the kind was
 * refused as unmapped.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const CARD = parseCard({
  kind: 'instant',
  id: 'tst-indestructible-aura',
  name: 'Indestructible Aura',
  rarity: 'common',
  set: { code: 'TST', collectorNumber: 1 },
  colors: ['W'],
  manaCost: { W: 1 },
  effects: [{ kind: 'preventAllDamageToTarget', target: { kind: 'targetCreature' } }],
});

function linesOf(): readonly string[] {
  const result = transpileCard(CARD);
  if (!result.ok) throw new Error(`expected a script, got ${JSON.stringify(result.rejections)}`);
  return result.script.text.split('\n');
}

describe('Indestructible Aura Forge parity', () => {
  it('installs the prevention as an Effect that remembers its target', () => {
    // `indestructible_aura.txt`'s `A:` line to the parameter, in its order. The
    // `SpellDescription$` is the one deviation and it is the DSL's printed text
    // rather than this package's: the card prints "Prevent all damage that
    // would be dealt to target creature this turn.", and `@mtg/dsl`'s oracle
    // renders the kind as "Until end of turn, prevent all damage to ..." while
    // the sibling kind one line below it in the same switch renders the printed
    // templating (`mtg-rji9`). The transpiler passes through whatever the card
    // prints, which is the behavior that keeps the Forge card and the DSL card
    // from drifting.
    expect(linesOf()).toContain(
      'A:SP$ Effect | ValidTgts$ Creature | ReplacementEffects$ RPrevent | RememberObjects$ Targeted | ExileOnMoved$ Battlefield | SpellDescription$ Until end of turn, prevent all damage to target creature.',
    );
  });

  it('scopes the replacement to the remembered object, not to a card name', () => {
    // Byte-identical to the shipped `SVar:RPrevent` in both files. The shield
    // follows the object: `RememberObjects$ Targeted` puts the creature on the
    // command-zone effect and `Card.IsRemembered` is how the replacement finds
    // it, so a creature that changes controller keeps the prevention and a
    // second copy of the same card does not get it.
    expect(linesOf()).toContain(
      'SVar:RPrevent:Event$ DamageDone | Prevent$ True | ValidTarget$ Card.IsRemembered | Description$ Prevent all damage that would be dealt to that creature this turn.',
    );
  });

  it('does not carry the AI:RemoveDeck:All the two shipped instants do', () => {
    // Both instants carry it and `harvestguard_alseids.txt`, which installs the
    // same pair from a creature's trigger, does not. An effect row cannot tell
    // which it is on. Removing a creature from every AI deck because one of its
    // abilities prevents damage is the worse of the two errors, so this row
    // emits no card-level AI directive at all.
    expect(linesOf().some((line) => line.startsWith('AI:'))).toBe(false);
  });
});

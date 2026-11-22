/** Transguild Promenade against Forge's installed card script. */
import { describe, expect, it } from 'vitest';
import { parseCard, renderOracleText } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const PROMENADE = parseCard({
  kind: 'land',
  id: 'rtr-transguild-promenade',
  name: 'Transguild Promenade',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 249 },
  producesMana: ['W', 'U', 'B', 'R', 'G'],
  entryReplacement: { kind: 'entersTapped' },
  printedEntryReference: 'thisLand',
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      effects: [{ kind: 'sacrificeSelf', target: { kind: 'selfPermanent' } }],
      sacrificeSelfUnlessControllerPays: { cost: { generic: 1 } },
    },
  ],
});

describe('Transguild Promenade in Forge', () => {
  const script = mustTranspile(PROMENADE);

  it('exports the exact entry replacement, toll, and five-color mana ability', () => {
    expect(script).toContain(
      'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped',
    );
    expect(script).toContain('SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True');
    expect(script).toContain(
      'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ Trig1Effect1',
    );
    expect(script).toContain('SVar:Trig1Effect1:DB$ Sacrifice | UnlessCost$ 1 | UnlessPayer$ You');
    expect(script).toContain('A:AB$ Mana | Cost$ T | Produced$ Any');
  });

  it('keeps the exact Oracle text in the exported card', () => {
    expect(script).toContain(`Oracle:${renderOracleText(PROMENADE).replaceAll('\n', '\\n')}`);
  });
});

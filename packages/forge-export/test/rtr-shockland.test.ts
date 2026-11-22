/** Forge's source-attested shockland entry replacement. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

const BLOOD_CRYPT = parseCard({
  kind: 'land',
  id: 'rtr-blood-crypt',
  name: 'Blood Crypt',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 238 },
  subtypes: ['Swamp', 'Mountain'],
  producesMana: ['B', 'R'],
  printedEntryReference: 'thisLand',
  entryReplacement: { kind: 'payLifeOrEntersTapped', life: 2 },
});

describe('shockland Forge boundary', () => {
  it('writes the generic movement replacement and exact life cost used by Forge', () => {
    const result = transpileCardScript(BLOOD_CRYPT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.lines).toEqual(
      expect.arrayContaining([
        "R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplaceWith$ DBTap | ReplacementResult$ Updated | Description$ As CARDNAME enters, you may pay 2 life. If you don't, it enters tapped.",
        'SVar:DBTap:DB$ Tap | ETB$ True | Defined$ Self | UnlessCost$ PayLife<2> | UnlessPayer$ You | StackDescription$ enters tapped.',
      ]),
    );
    expect(result.value.lines).not.toContain(
      'A:AB$ Mana | Cost$ T | Produced$ Combo B R | SpellDescription$ Add {B} or {R}.',
    );
  });
});

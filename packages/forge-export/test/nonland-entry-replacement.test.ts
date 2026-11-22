/** Forge's source-attested nonland enters-tapped replacement. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCardScript } from '@mtg/forge-export';

const ROCK = parseCard({
  kind: 'artifact',
  id: 'tst-coldsteel-heart',
  name: 'Coldsteel Heart',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 231 },
  manaCost: { generic: 2 },
  entryReplacement: { kind: 'entersTapped' },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'addMana', produces: ['U'], amount: 1 }],
    },
  ],
});

const PLAIN_ROCK = parseCard({
  kind: 'artifact',
  id: 'tst-warm-heart',
  name: 'Warm Heart',
  rarity: 'uncommon',
  set: { code: 'TST', collectorNumber: 232 },
  manaCost: { generic: 2 },
  abilities: [
    {
      kind: 'activated',
      cost: { mana: {}, tapSelf: true },
      effects: [{ kind: 'addMana', produces: ['U'], amount: 1 }],
    },
  ],
});

describe('a nonland entry replacement at the Forge boundary', () => {
  it('writes the exact replacement rather than dropping the clause', () => {
    const result = transpileCardScript(ROCK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toContain(
      'R:Event$ Moved | ValidCard$ Card.Self | Destination$ Battlefield | ReplacementResult$ Updated | ReplaceWith$ ETBTapped | Description$ CARDNAME enters tapped.',
    );
    expect(result.value.lines).toContain('SVar:ETBTapped:DB$ Tap | Defined$ Self | ETB$ True');
  });

  it('leaves the same rock without the clause alone', () => {
    const result = transpileCardScript(PLAIN_ROCK);
    expect(result.ok).toBe(true);
  });
});

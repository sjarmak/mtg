/** Installed Forge parity for RTR Pithing Needle. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const NEEDLE = parseCard({
  kind: 'artifact',
  id: 'rtr-231-pithing-needle-forge',
  name: 'Pithing Needle',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 231 },
  manaCost: { generic: 1 },
  colors: [],
  entryReplacement: { kind: 'chooseCardName' },
  abilities: [{ kind: 'staticActivationRule', rule: 'chosenNameNonManaAbilitiesCantActivate' }],
});

describe('Pithing Needle Forge export', () => {
  it('emits the installed NameCard replacement and non-mana activation prohibition', () => {
    const script = mustTranspile(NEEDLE);
    expect(script).toContain('K:ETBReplacement:Other:DBNameCard');
    expect(script).toContain(
      'SVar:DBNameCard:DB$ NameCard | Defined$ You | AILogic$ PithingNeedle | SpellDescription$ As CARDNAME enters, choose a card name.',
    );
    expect(script).toContain(
      "S:Mode$ CantBeActivated | ValidCard$ Card.NamedCard | ValidSA$ Activated.!ManaAbility | Description$ Activated abilities of sources with the chosen name can't be activated unless they're mana abilities.",
    );
  });
});

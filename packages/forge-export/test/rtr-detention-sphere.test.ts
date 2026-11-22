/** Source-attested Forge parity for RTR Detention Sphere. */
import { parseCard } from '@mtg/dsl';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

const SPHERE = parseCard({
  kind: 'enchantment',
  id: 'rtr-155-detention-sphere-forge',
  name: 'Detention Sphere',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 155 },
  manaCost: { generic: 1, W: 1, U: 1 },
  colors: ['W', 'U'],
  abilities: [
    {
      kind: 'triggered',
      condition: 'selfEnters',
      printedSourceReference: 'thisEnchantment',
      optional: true,
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetPermanent', filter: { excludeCardTypes: ['land'] } },
          linkToSource: true,
          sameNameCohort: { excludedName: 'Detention Sphere' },
        },
      ],
    },
    {
      kind: 'triggered',
      condition: 'selfLeavesBattlefield',
      printedSourceReference: 'thisEnchantment',
      effects: [{ kind: 'moveSourceLinkedExile', destination: 'battlefieldUnderOwner', plural: true }],
    },
  ],
});

describe('Detention Sphere Forge export', () => {
  /** Installed Card-Forge source: `res/cardsfolder/d/detention_sphere.txt`. */
  it('matches the installed target-cohort and ExiledWith script exactly', () => {
    expect(mustTranspile(SPHERE)).toBe(
      [
        'Name:Detention Sphere',
        'ManaCost:1 W U',
        'Types:Enchantment',
        'T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | OptionalDecider$ You | Execute$ TrigExile | TriggerDescription$ When CARDNAME enters, you may exile target nonland permanent not named Detention Sphere and all other permanents with the same name as that permanent.',
        'SVar:TrigExile:DB$ Pump | ValidTgts$ Permanent.nonLand+!namedDetention Sphere | IsCurse$ True | TgtPrompt$ Choose target nonland permanent not named Detention Sphere | SubAbility$ DBChangeZoneAll',
        'SVar:DBChangeZoneAll:DB$ ChangeZoneAll | ChangeType$ Targeted.Self,Targeted.sameName | Origin$ Battlefield | Destination$ Exile',
        "T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Any | ValidCard$ Card.Self | Execute$ TrigReturn | TriggerDescription$ When CARDNAME leaves the battlefield, return the exiled cards to the battlefield under their owner's control.",
        'SVar:TrigReturn:DB$ ChangeZoneAll | ChangeType$ Card.ExiledWithSource | Origin$ Exile | Destination$ Battlefield',
        'SVar:OblivionRing:TRUE',
        "Oracle:When this enchantment enters, you may exile target nonland permanent not named Detention Sphere and all other permanents with the same name as that permanent.\\nWhen this enchantment leaves the battlefield, return the exiled cards to the battlefield under their owner's control.",
        '',
      ].join('\n'),
    );
  });
});

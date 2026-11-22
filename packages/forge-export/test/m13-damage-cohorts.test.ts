import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile, spell } from './helpers';

const PINNED_MAGMAQUAKE = `Name:Magmaquake
ManaCost:X R R
Types:Instant
A:SP$ DamageAll | ValidCards$ Creature.withoutFlying,Planeswalker | NumDmg$ X | SpellDescription$ CARDNAME deals X damage to each creature without flying and to each planeswalker.
SVar:X:Count$xPaid
Oracle:Magmaquake deals X damage to each creature without flying and each planeswalker.
`;

const GENERATED_MAGMAQUAKE = `Name:Magmaquake
ManaCost:X R R
Types:Instant
A:SP$ DamageAll | ValidCards$ Creature.withoutFlying,Planeswalker | NumDmg$ X | SpellDescription$ CARDNAME deals X damage to each creature without flying and each planeswalker.
SVar:X:Count$xPaid
Oracle:Magmaquake deals X damage to each creature without flying and each planeswalker.
`;

const PINNED_CHANDRAS_FURY = `Name:Chandra's Fury
ManaCost:4 R
Types:Instant
A:SP$ DealDamage | ValidTgts$ Player,Planeswalker | TgtPrompt$ Select a player or planeswalker | NumDmg$ 4 | SubAbility$ DmgAll | DamageMap$ True | SpellDescription$ CARDNAME deals 4 damage to target player or planeswalker and 1 damage to each creature that player or that planeswalker's controller controls.
SVar:DmgAll:DB$ DamageAll | NumDmg$ 1 | ValidCards$ Creature.ControlledBy TargetedOrController | SubAbility$ DBDamageResolve
SVar:DBDamageResolve:DB$ DamageResolve
Oracle:Chandra's Fury deals 4 damage to target player or planeswalker and 1 damage to each creature that player or that planeswalker's controller controls.
`;

const PINNED_THUNDERMAW = `Name:Thundermaw Hellkite
ManaCost:3 R R
Types:Creature Dragon
PT:5/5
K:Flying
K:Haste
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ ThunderDamage | TriggerDescription$ When CARDNAME enters, it deals 1 damage to each creature with flying your opponents control. Tap those creatures.
SVar:ThunderDamage:DB$ DamageAll | NumDmg$ 1 | ValidCards$ Creature.withFlying+OppCtrl | SubAbility$ ThunderTap
SVar:ThunderTap:DB$ TapAll | ValidCards$ Creature.withFlying+OppCtrl
Oracle:Flying\\nHaste (This creature can attack and {T} as soon as it comes under your control.)\\nWhen Thundermaw Hellkite enters, it deals 1 damage to each creature with flying your opponents control. Tap those creatures.
`;

/**
 * Canonicalizes only Forge's non-executable choices: description/Oracle prose,
 * arbitrary SVar labels, and parameter order. The full generated script is
 * still pinned byte-for-byte below, while this comparison proves its mechanics
 * match the source at Forge revision d6465382.
 */
function executableScript(text: string): string {
  const lines = text.trimEnd().split('\n');
  const labels = lines.flatMap((line) => {
    const found = /^SVar:([^:]+):/.exec(line);
    return found?.[1] === undefined ? [] : [found[1]];
  });
  const canonicalLabels = labels.map((label, index) => ({ label, canonical: `V${String(index + 1)}` }));
  const replacements = [...canonicalLabels].sort((left, right) => right.label.length - left.label.length);
  return lines
    .filter((line) => !line.startsWith('Oracle:'))
    .map((line) => {
      let renamed = line;
      for (const { label, canonical } of replacements) {
        renamed = renamed
          .replace(`SVar:${label}:`, `SVar:${canonical}:`)
          .replaceAll(`$ ${label}`, `$ ${canonical}`);
      }
      if (!/^(?:A:|T:|SVar:)/.test(renamed)) return renamed;
      const [head, ...parameters] = renamed.split(' | ');
      const mechanical = parameters
        .filter(
          (parameter) =>
            !parameter.startsWith('SpellDescription$') && !parameter.startsWith('TriggerDescription$'),
        )
        .sort();
      return [head, ...mechanical].join(' | ');
    })
    .join('\n');
}

describe('M13 damage cohort Forge scripts', () => {
  it('exports Magmaquake with the pinned without-flying union and X SVar', () => {
    const text = mustTranspile(
      spell(
        'Magmaquake',
        [
          {
            kind: 'dealDamage',
            amount: { kind: 'chosenX' },
            target: { kind: 'noTarget' },
            scope: 'allPermanents',
            scopeFilter: { cardTypes: ['creature'], excludeKeywords: ['flying'] },
            additionalScopeFilter: { cardTypes: ['planeswalker'] },
          },
        ],
        { manaCost: { R: 2, hasX: true } },
      ),
    );
    expect(text).toBe(GENERATED_MAGMAQUAKE);
    expect(executableScript(text)).toBe(executableScript(PINNED_MAGMAQUAKE));
  });

  it("exports Chandra's Fury as one DamageMap batch with 4 direct and 1 scoped", () => {
    const text = mustTranspile(
      spell(
        "Chandra's Fury",
        [
          {
            kind: 'dealDamage',
            amount: 4,
            scopeAmount: 1,
            target: { kind: 'targetPlayerOrPlaneswalker' },
            scope: 'targetAndPermanentsItsPlayerControls',
            scopeFilter: { cardTypes: ['creature'] },
          },
        ],
        { manaCost: { generic: 4, R: 1 } },
      ),
    );
    expect(text).toBe(PINNED_CHANDRAS_FURY);
  });

  it('exports Thundermaw damage followed by TapAll over the same pinned selector', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-150-thundermaw-hellkite-forge',
      name: 'Thundermaw Hellkite',
      rarity: 'mythic',
      set: { code: 'M13', collectorNumber: 150 },
      manaCost: { generic: 3, R: 2 },
      colors: ['R'],
      subtypes: ['Dragon'],
      keywords: ['flying', 'haste'],
      power: 5,
      toughness: 5,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            {
              kind: 'dealDamage',
              amount: 1,
              target: { kind: 'noTarget' },
              scope: 'permanentsOpponentsControl',
              scopeFilter: { cardTypes: ['creature'], keywords: ['flying'] },
              tapScopeGroup: true,
            },
          ],
        },
      ],
    } as CardInput);
    const text = mustTranspile(card);
    expect(text).toBe(`Name:Thundermaw Hellkite
ManaCost:3 R R
Types:Creature Dragon
PT:5/5
K:Flying
K:Haste
T:Mode$ ChangesZone | Origin$ Any | Destination$ Battlefield | ValidCard$ Card.Self | Execute$ Trig1Effect1 | TriggerDescription$ When CARDNAME enters the battlefield, it deals 1 damage to each creature with flying your opponents control. Tap those creatures.
SVar:Trig1Effect1:DB$ DamageAll | ValidCards$ Creature.withFlying+OppCtrl | NumDmg$ 1 | SubAbility$ Trig1Effect1Hold
SVar:Trig1Effect1Hold:DB$ TapAll | ValidCards$ Creature.withFlying+OppCtrl
Oracle:Flying, haste\\nWhen Thundermaw Hellkite enters the battlefield, it deals 1 damage to each creature with flying your opponents control. Tap those creatures.
`);
    expect(executableScript(text)).toBe(executableScript(PINNED_THUNDERMAW));
  });
});

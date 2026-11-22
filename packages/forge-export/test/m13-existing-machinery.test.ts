/** Source-attested Forge parity for M13 positions built from existing native shapes. */
import { describe, expect, it } from 'vitest';
import { exaltedAbility, parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const PINNED_FORGE_REVISION = '2d5346af81a61efdb0175c6f29f7f35c537a3838';

function scriptOf(input: CardInput): string {
  return mustTranspile(parseCard(input));
}

describe('M13 existing-machinery Forge parity', () => {
  it('pins the upstream Card-Forge revision used for all four scripts', () => {
    expect(PINNED_FORGE_REVISION).toMatch(/^[0-9a-f]{40}$/u);
  });

  it('keeps exalted native while exporting Angelic Benediction’s second attacks-alone trigger', () => {
    const script = scriptOf({
      kind: 'enchantment',
      id: 'm13-4-angelic-benediction',
      name: 'Angelic Benediction',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 4 },
      manaCost: { generic: 3, W: 1 },
      colors: ['W'],
      abilities: [
        exaltedAbility(),
        {
          kind: 'triggered',
          condition: 'controlledCreatureAttacksAlone',
          optional: true,
          effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }],
        },
      ],
    });

    expect(script).toContain('K:Exalted\n');
    expect(script).toContain(
      'T:Mode$ Attacks | ValidCard$ Creature.YouCtrl | Alone$ True | TriggerZones$ Battlefield | Execute$ Trig2Effect1 | OptionalDecider$ You | TriggerDescription$ Whenever a creature you control attacks alone, you may tap target creature.',
    );
    expect(script).toContain('SVar:Trig2Effect1:DB$ Tap | ValidTgts$ Creature');
  });

  it('exports both Captain of the Watch lord layers and its three-token trigger', () => {
    const script = scriptOf({
      kind: 'creature',
      id: 'm13-8-captain-of-the-watch',
      name: 'Captain of the Watch',
      rarity: 'rare',
      set: { code: 'M13', collectorNumber: 8 },
      manaCost: { generic: 4, W: 2 },
      colors: ['W'],
      subtypes: ['Human', 'Soldier'],
      power: 3,
      toughness: 3,
      keywords: ['vigilance'],
      abilities: [
        {
          kind: 'static',
          scope: 'otherCreaturesYouControl',
          subtype: 'Soldier',
          modification: { kind: 'statBonus', power: 1, toughness: 1 },
        },
        {
          kind: 'static',
          scope: 'otherCreaturesYouControl',
          subtype: 'Soldier',
          modification: { kind: 'grantKeyword', keyword: 'vigilance' },
        },
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [
            {
              kind: 'createToken',
              count: 3,
              token: {
                name: 'Soldier',
                colors: ['W'],
                subtypes: ['Soldier'],
                power: 1,
                toughness: 1,
                keywords: [],
              },
            },
          ],
        },
      ],
    });

    expect(script).toContain('Affected$ Creature.Other+YouCtrl+Soldier | AddPower$ 1 | AddToughness$ 1');
    expect(script).toContain('Affected$ Creature.Other+YouCtrl+Soldier | AddKeyword$ Vigilance');
    expect(script).toContain('TokenAmount$ 3 | TokenScript$ w_1_1_soldier | TokenOwner$ You');
  });

  it('exports Flames of the Firebrand as three divided damage over one to three any targets', () => {
    const script = scriptOf({
      kind: 'sorcery',
      id: 'm13-132-flames-of-the-firebrand',
      name: 'Flames of the Firebrand',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 132 },
      manaCost: { generic: 2, R: 1 },
      colors: ['R'],
      effects: [
        {
          kind: 'dealDamage',
          amount: 3,
          target: { kind: 'anyTarget', count: 3, minimum: 1 },
          division: { kind: 'asYouChoose' },
        },
      ],
    });

    expect(script).toContain(
      'A:SP$ DealDamage | ValidTgts$ Any | TgtPrompt$ Select any target to distribute damage to | NumDmg$ 3 | TargetMin$ 1 | TargetMax$ 3 | DividedAsYouChoose$ 3',
    );
  });

  it('exports Clock of Omens with its typed two-artifact tap cost and artifact target', () => {
    const script = scriptOf({
      kind: 'artifact',
      id: 'm13-202-clock-of-omens',
      name: 'Clock of Omens',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 202 },
      manaCost: { generic: 4 },
      colors: [],
      abilities: [
        {
          kind: 'activated',
          cost: {
            mana: {},
            tapMatching: { count: 2, filter: { cardTypes: ['artifact'] } },
          },
          effects: [
            {
              kind: 'untapPermanent',
              target: { kind: 'targetPermanent', filter: { cardTypes: ['artifact'] } },
            },
          ],
        },
      ],
    });

    expect(script).toContain('A:AB$ Untap | Cost$ tapXType<2/Artifact> | ValidTgts$ Artifact');
  });
});

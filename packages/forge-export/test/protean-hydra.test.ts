/** Protean Hydra against Forge's source-attested replacement and delayed-trigger grammar. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';

const PROTEAN_HYDRA = parseCard({
  kind: 'creature',
  id: 'm11-194-protean-hydra-forge',
  name: 'Protean Hydra',
  rarity: 'rare',
  set: { code: 'M11', collectorNumber: 194 },
  manaCost: { hasX: true, G: 1 },
  colors: ['G'],
  subtypes: ['Hydra'],
  power: 0,
  toughness: 0,
  entryReplacement: {
    kind: 'entersWithCounters',
    counter: 'plusOnePlusOne',
    count: { kind: 'chosenX' },
  },
  abilities: [
    {
      kind: 'static',
      scope: 'self',
      modification: {
        kind: 'preventDamageToSelfAndRemoveCounters',
        counter: 'plusOnePlusOne',
      },
    },
    {
      kind: 'triggered',
      condition: 'selfPlusOnePlusOneCounterRemoved',
      effects: [
        {
          kind: 'putCounters',
          counter: 'plusOnePlusOne',
          count: 2,
          target: { kind: 'selfPermanent' },
          timing: 'nextEndStep',
        },
      ],
    },
  ],
});

describe('Protean Hydra Forge export', () => {
  it('emits all source-attested X, prevention, removal, and delayed-LKI clauses', () => {
    const result = transpileCard(PROTEAN_HYDRA);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.script.text.split('\n');

    expect(lines).toContain('K:etbCounter:P1P1:X');
    expect(lines).toContain('SVar:X:Count$xPaid');
    expect(lines).toContain(
      'SVar:Counters:DB$ RemoveCounter | Defined$ ReplacedTarget | CounterType$ P1P1 | CounterNum$ Y',
    );
    expect(lines).toContain('SVar:Y:ReplaceCount$DamageAmount');
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^R:Event\$ DamageDone \| ActiveZones\$ Battlefield \| ValidTarget\$ Card\.Self \| ReplaceWith\$ Counters \| PreventionEffect\$ True \| AlwaysReplace\$ True/u,
      ),
    );
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^T:Mode\$ CounterRemoved \| ValidCard\$ Card\.Self \| TriggerZones\$ Battlefield \| CounterType\$ P1P1 \| Execute\$ Trig2DelayedCounter/u,
      ),
    );
    expect(lines).toContain(
      'SVar:Trig2PutCounter:DB$ PutCounter | Defined$ DelayTriggerRememberedLKI | CounterType$ P1P1 | CounterNum$ 2',
    );
    expect(lines).toContainEqual(
      'SVar:Trig2DelayedCounter:DB$ DelayedTrigger | Mode$ Phase | Phase$ End of Turn | Execute$ Trig2PutCounter | RememberObjects$ TriggeredCardLKICopy | TriggerDescription$ Put two +1/+1 counters on it at the beginning of the next end step.',
    );
  });

  it('uses the same machinery for another card name', () => {
    const result = transpileCard(parseCard({ ...PROTEAN_HYDRA, id: 'tst-other-hydra', name: 'Other Hydra' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.text).toContain('ValidTarget$ Card.Self');
    expect(result.script.text).toContain('RememberObjects$ TriggeredCardLKICopy');
  });

  it('preserves optionality on the supported delayed-trigger envelope', () => {
    const trigger = PROTEAN_HYDRA.abilities[1];
    if (trigger?.kind !== 'triggered') throw new Error('the fixture lost its counter-removal trigger');
    const result = transpileCard(
      parseCard({
        ...PROTEAN_HYDRA,
        id: 'tst-optional-hydra',
        abilities: [PROTEAN_HYDRA.abilities[0]!, { ...trigger, optional: true }],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const triggerLine = result.script.text.split('\n').find((line) => line.startsWith('T:')) ?? '';
    expect(triggerLine).toContain('OptionalDecider$ You');
  });

  it('refuses a delayed placement outside the source-attested trigger envelope', () => {
    const result = transpileCard(
      parseCard({
        ...PROTEAN_HYDRA,
        id: 'tst-other-delayed-hydra',
        name: 'Other Hydra',
        abilities: [
          {
            kind: 'triggered',
            condition: 'beginningOfYourUpkeep',
            effects: [
              {
                kind: 'putCounters',
                counter: 'plusOnePlusOne',
                count: 2,
                target: { kind: 'selfPermanent' },
                timing: 'nextEndStep',
              },
            ],
          },
        ],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections).toContainEqual(
      expect.objectContaining({
        code: 'UNMAPPED_EFFECT_KIND',
        path: 'abilities[0].effects[0].timing',
      }),
    );
  });
});

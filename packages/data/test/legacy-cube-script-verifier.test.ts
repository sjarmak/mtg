/** Synthetic scripts exercise profile boundaries independently of their byte attestations. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  classifyLegacyCubeForgeScript,
  loadLegacyCubeDecisionLedger,
  verifyLegacyCubeDecisionScript,
  type LegacyCubeBridgeCapabilityBundle,
  type LegacyCubeDecisionEntry,
} from '../src/legacy-cube/decision-ledger.js';

const ledger = loadLegacyCubeDecisionLedger();
type Profile = LegacyCubeBridgeCapabilityBundle['topLevel'];

function specimen(body: string, cost = '2'): Uint8Array {
  return new TextEncoder().encode(`Name:Verification specimen\nManaCost:${cost}\nTypes:Instant\n${body}`);
}

function attest(bytes: Uint8Array, profile: Profile, position?: number): LegacyCubeDecisionEntry {
  const reviewed = ledger.auditedCards.find((entry) =>
    position === undefined
      ? entry.bridgeCapabilityProfile?.topLevel === profile
      : entry.position === position,
  );
  if (reviewed === undefined) throw new Error(`Missing reviewed profile ${profile}`);
  const classified = classifyLegacyCubeForgeScript(bytes, ledger.syntaxInventory);
  return {
    ...reviewed,
    families: [...classified.families],
    evidenceMarkers: [...classified.evidenceMarkers],
    unknownDecisionSyntax: [...classified.unknownDecisionSyntax],
    forgeScriptSha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function verify(bytes: Uint8Array, profile: Profile): void {
  verifyLegacyCubeDecisionScript(attest(bytes, profile), bytes, ledger.syntaxInventory);
}

const specimens: readonly {
  readonly profile: Profile;
  readonly body: string;
  readonly mutate: (body: string) => string;
  readonly refusal: RegExp;
}[] = [
  {
    profile: 'optional-trigger-confirm-v1',
    body: 'T:Mode$ Phase | Execute$ Resolve | OptionalDecider$ You\nSVar:Resolve:DB$ Draw | NumCards$ 1',
    mutate: (body) => body.replace('NumCards$ 1', 'NumCards$ 3'),
    refusal: /unreviewed draw count/,
  },
  {
    profile: 'bounded-multi-selection-v1',
    body: 'A:SP$ Discard | NumCards$ 1',
    mutate: (body) => `${body} | DifferentNames$ True`,
    refusal: /distinct-name selection constraint/,
  },
  {
    profile: 'bounded-enumerated-choice-v1',
    body: 'A:SP$ ChooseColor',
    mutate: (body) => body.replace('ChooseColor', 'NameCard'),
    refusal: /unbounded decision token ability-api:NameCard/,
  },
  {
    profile: 'announced-number-v1',
    body: 'A:SP$ DealDamage | ValidTgts$ Creature | NumDmg$ 1',
    mutate: (body) => `${body} | TargetMin$ 0`,
    refusal: /optional target/,
  },
  {
    profile: 'stated-ordering-v1',
    body: 'A:SP$ Scry | ScryNum$ 2',
    mutate: (body) => `${body}\nA:SP$ Token | TokenScript$ verification_specimen`,
    refusal: /unpinned generated-object source/,
  },
  {
    profile: 'stated-distribution-v1',
    body: 'A:SP$ DealDamage | ValidTgts$ Creature | NumDmg$ 2 | DividedAsYouChoose$ 2',
    mutate: (body) => body.replace('NumDmg$ 2', 'NumDmg$ 3'),
    refusal: /distribution over an unstated amount/,
  },
  {
    profile: 'stated-retarget-v1',
    body: 'A:AB$ ChangeTargets | Cost$ UP | ChangeSingleTarget$ True | DefinedMagnet$ Self | TargetType$ Spell',
    mutate: (body) => body.replace(' | ChangeSingleTarget$ True', ''),
    refusal: /unbounded retarget/,
  },
  {
    profile: 'open-card-naming-v1',
    body: 'A:SP$ NameCard | Defined$ You',
    mutate: (body) => body.replace(' | Defined$ You', ''),
    refusal: /card naming by an unstated player/,
  },
];

describe('installed script capability verification', () => {
  it.each([
    {
      position: 472,
      profile: 'bounded-multi-selection-v1' as const,
      body: 'A:AB$ ChangeZone | Cost$ T | ValidTgts$ Player | DefinedPlayer$ Targeted | Origin$ Graveyard | Destination$ Exile | ChangeType$ Card | ChangeNum$ 1 | Hidden$ True | Mandatory$ True | IsCurse$ True | Chooser$ Targeted',
    },
    {
      position: 201,
      profile: 'bounded-multi-selection-v1' as const,
      body: 'K:ETBReplacement:Other:Imprint\nSVar:Imprint:DB$ ChangeZone | Origin$ Graveyard | Destination$ Exile | ChangeType$ Creature.NotDefinedReplacedSimultaneousETB | ChangeNum$ 1 | Hidden$ True | Mandatory$ True | Imprint$ True | Chooser$ You',
    },
    {
      position: 212,
      profile: 'announced-number-v1' as const,
      body: 'A:SP$ ChangeZone | DefinedPlayer$ Player | Origin$ Graveyard | Destination$ Battlefield | ChangeType$ Creature | ChangeNum$ 1 | Hidden$ True | Mandatory$ True',
    },
  ])('checks the public graveyard route at position $position after reattestation', (row) => {
    const bytes = specimen(row.body);
    expect(() =>
      verifyLegacyCubeDecisionScript(attest(bytes, row.profile, row.position), bytes, ledger.syntaxInventory),
    ).not.toThrow();
    const changed = specimen(row.body.replace('ChangeNum$ 1', 'ChangeNum$ 2'));
    expect(() =>
      verifyLegacyCubeDecisionScript(
        attest(changed, row.profile, row.position),
        changed,
        ledger.syntaxInventory,
      ),
    ).toThrow(/public graveyard/);
  });

  it.each(['X R', '2'])('accepts announced payment for printed cost %s', (cost) => {
    const bytes = specimen('A:AB$ Mana | Cost$ T | Produced$ Any | Amount$ 1', cost);
    expect(() => verify(bytes, 'announced-number-v1')).not.toThrow();
  });

  it('continues refusing announcements under ordinary payment', () => {
    const bytes = specimen('A:AB$ Mana | Cost$ T | Produced$ Any | Amount$ 1');
    expect(() => verify(bytes, 'bounded-multi-selection-v1')).toThrow(/any-color announcement/);
  });

  it.each(specimens)('checks the $profile negative boundary after reattestation', (row) => {
    expect(() => verify(specimen(row.body), row.profile)).not.toThrow();
    expect(() => verify(specimen(row.mutate(row.body)), row.profile)).toThrow(row.refusal);
  });

  it.each(['tapXType<1/Creature>', 'Exile<1/CARDNAME>', 'UP'])(
    'rejects unsupported cost %s even after reattestation',
    (cost) => {
      const bytes = specimen(`A:AB$ Draw | Cost$ ${cost} | NumCards$ 1`);
      expect(() => verify(bytes, 'announced-number-v1')).toThrow(/chosen cost payment/);
    },
  );

  it('does not let the Phyrexian payment profile excuse a chosen non-mana cost', () => {
    const retarget = specimens.find((row) => row.profile === 'stated-retarget-v1');
    if (retarget === undefined) throw new Error('Missing retarget specimen');
    const bytes = specimen(retarget.body.replace('Cost$ UP', 'Cost$ UP tapXType<1/Creature>'));
    expect(() => verify(bytes, retarget.profile)).toThrow(/chosen cost payment tapXType/);
  });

  it('rejects a safe entry without its capability bundle', () => {
    const bytes = specimen('A:SP$ Draw | NumCards$ 1');
    const entry = { ...attest(bytes, 'announced-number-v1'), bridgeCapabilityProfile: null };
    expect(() => verifyLegacyCubeDecisionScript(entry, bytes, ledger.syntaxInventory)).toThrow(
      /missing capability profile/,
    );
  });

  it('retains byte, syntax and classification checks before profile validation', () => {
    const bytes = specimen('A:SP$ Draw | NumCards$ 1');
    const entry = attest(bytes, 'announced-number-v1');
    expect(() => verifyLegacyCubeDecisionScript(entry, specimen(''), ledger.syntaxInventory)).toThrow(
      /checksum drift/,
    );
    expect(() => verifyLegacyCubeDecisionScript(entry, bytes)).toThrow(/closed syntax inventory/);
    expect(() =>
      verifyLegacyCubeDecisionScript({ ...entry, families: ['combat'] }, bytes, ledger.syntaxInventory),
    ).toThrow(/classification drift/);
    const unknown = specimen('A:SP$ UnreviewedSpecimenEffect');
    expect(() => verify(unknown, 'announced-number-v1')).toThrow(/unknown Forge decision syntax/);
  });
});

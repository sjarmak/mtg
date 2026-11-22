import { describe, expect, it } from 'vitest';
import {
  LEGACY_CUBE_GENERATED_OBJECT_EXCLUDED_POSITIONS,
  LEGACY_CUBE_GENERATED_OBJECT_SAFE_POSITIONS,
  LEGACY_CUBE_GENERATED_TOKEN_AUDIT,
  LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_SAFE_POSITIONS,
  legacyCubeChosenCostPaymentRefusals,
  legacyCubePinnedGeneratedObjectRefusals,
  loadLegacyCubeSyntaxReview,
} from '@mtg/data';

const inventory = [...loadLegacyCubeSyntaxReview()];
const script = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('Legacy Cube pinned generated-object boundary', () => {
  it.each(['tapXType<3/Kithkin>', 'tapXType<1/Artifact>', 'ExileFromGrave<1/CARDNAME>'])(
    'opens only the reviewed generated-object cost spelling %s',
    (cost) => {
      const bytes = script(
        `Name:Specimen\nTypes:Creature\nA:AB$ Token | Cost$ ${cost} | TokenScript$ g_3_3_beast\n`,
      );
      expect(legacyCubeChosenCostPaymentRefusals(bytes)).not.toEqual([]);
      expect(
        legacyCubeChosenCostPaymentRefusals(bytes, {
          allowReviewedGeneratedObjectCostParts: true,
        }),
      ).toEqual([]);
    },
  );

  it.each([
    'tapXType<2/Kithkin>',
    'tapXType<3/Artifact>',
    'tapXType<1/Creature>',
    'ExileFromGrave<2/CARDNAME>',
    'ExileFromGrave<1/Card>',
    'Exile<1/CARDNAME>',
  ])('keeps the neighboring generated-object cost spelling refused: %s', (cost) => {
    expect(
      legacyCubeChosenCostPaymentRefusals(
        script(`Name:Specimen\nTypes:Creature\nA:AB$ Token | Cost$ ${cost} | TokenScript$ g_3_3_beast\n`),
        { allowReviewedGeneratedObjectCostParts: true },
      ),
    ).not.toEqual([]);
  });

  it('admits an otherwise reviewed script whose exact token root is pinned', () => {
    expect(
      legacyCubePinnedGeneratedObjectRefusals(
        script(
          'Name:Specimen\nManaCost:3 G G\nTypes:Creature Beast\nPT:6/6\n' +
            'A:AB$ Token | TokenScript$ g_3_3_beast | TokenOwner$ You\n',
        ),
        inventory,
      ),
    ).toEqual([]);
  });

  it.each([
    ['missing root', 'Name:Specimen\nTypes:Creature Beast\nPT:6/6\n', 'missing generated-object source'],
    [
      'unreviewed root',
      'Name:Specimen\nTypes:Creature Beast\nPT:6/6\nA:AB$ Token | TokenScript$ invented_beast\n',
      'unreviewed generated-object source invented_beast',
    ],
    [
      'unrelated optional decision',
      'Name:Specimen\nTypes:Creature Beast\nPT:6/6\nA:AB$ Token | TokenScript$ g_3_3_beast | Optional$ True\n',
      'unbounded decision token parameter-key:Optional',
    ],
    [
      'modal target composition',
      'Name:Specimen\nTypes:Instant\nA:SP$ Charm | Choices$ DBToken,DBDamage\n' +
        'SVar:DBToken:DB$ Token | ValidTgts$ Player | TokenScript$ c_a_treasure_sac\n',
      'modal generated-object target composition',
    ],
  ])('refuses %s without weakening the surrounding profile', (_label, body, refusal) => {
    expect(legacyCubePinnedGeneratedObjectRefusals(script(body), inventory)).toContain(refusal);
  });

  it('accounts for the entire reviewed root cohort and its exact dependency inventory', () => {
    expect(LEGACY_CUBE_GENERATED_OBJECT_SAFE_POSITIONS).toEqual([37, 113, 253, 403, 498, 514, 583]);
    expect(LEGACY_CUBE_GENERATED_OBJECT_EXCLUDED_POSITIONS).toHaveLength(10);
    expect(LEGACY_CUBE_REVIEWED_PRISMARI_COMMAND_SAFE_POSITIONS).toEqual([434]);
    expect(LEGACY_CUBE_GENERATED_OBJECT_SAFE_POSITIONS).not.toContain(434);
    expect(LEGACY_CUBE_GENERATED_OBJECT_EXCLUDED_POSITIONS).not.toContain(434);
    expect(LEGACY_CUBE_GENERATED_TOKEN_AUDIT.reviewedPositions).toHaveLength(53);
    expect(LEGACY_CUBE_GENERATED_TOKEN_AUDIT.exactTokenScripts).toHaveLength(34);
  });
});

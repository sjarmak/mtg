/** Cohort admission is narrower than passing one script refusal boundary. */
import { describe, expect, it } from 'vitest';
import { LEGACY_CUBE_CHOSEN_COST_PAYMENT_AUDIT, loadLegacyCubeDecisionLedger } from '../src/index.js';

describe('Legacy Cube admission extension', () => {
  const ledger = loadLegacyCubeDecisionLedger();

  it.each([
    [145, 'Careful Consideration'],
    [167, 'Dark Confidant'],
    [190, 'Phyrexian Obliterator'],
    [212, 'Exhume'],
    [280, 'Bedlam Reveler'],
    [308, 'Koth of the Hammer'],
    [522, 'Tangle Wire'],
    [556, 'Nykthos, Shrine to Nyx'],
  ] as const)('admits reviewed derived-amount position %i, %s', (position, name) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'announced-number-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-fp4l-announced-number',
    });
  });

  it.each([
    [148, 'Opposition', 'mandatory-singleton-nonstack-target-v1'],
    [201, 'Dermotaxi', 'bounded-multi-selection-v1'],
    [443, 'Glare of Subdual', 'mandatory-singleton-nonstack-target-v1'],
    [472, 'Relic of Progenitus', 'bounded-multi-selection-v1'],
  ] as const)('admits reviewed permanent-cost position %i, %s', (position, name, topLevel) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: { topLevel, generatedObjects: 'none' },
    });
  });

  it('records the expanded cost review and admits the exact generated-object compositions', () => {
    expect(ledger.bridgeReview.chosenCostPayment).toMatchObject({
      capability: 'chosen-cost-payment-v22',
      reviewedPositions: [...LEGACY_CUBE_CHOSEN_COST_PAYMENT_AUDIT.reviewedPositions],
      refusedPositions: [...LEGACY_CUBE_CHOSEN_COST_PAYMENT_AUDIT.refusedPositions],
    });
    for (const [position, name] of [
      [37, 'Cloudgoat Ranger'],
      [113, 'Urza, Lord High Artificer'],
      [253, 'Seasoned Pyromancer'],
    ] as const) {
      expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
        correctedName: name,
        cardFamilySafe: true,
        bridgeCapabilityProfile: {
          topLevel: 'stated-ordering-and-pinned-generated-token-v1',
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        },
        runtimeProbeId: 'mtg-z5q4-pinned-generated-object-outcomes',
      });
    }
  });

  it('admits Champion of Wits only through its exact trigger and Eternalize profile', () => {
    expect(ledger.auditedCards.find((card) => card.position === 95)).toMatchObject({
      correctedName: 'Champion of Wits',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-champion-of-wits-v1',
        manaPayment: 'ordinary-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-champion-of-wits-outcomes',
      generatedScriptDependencies: [],
    });
  });

  it('admits only the exact Lingering Souls token-and-Flashback composition', () => {
    expect(ledger.auditedCards.find((card) => card.position === 50)).toMatchObject({
      correctedName: 'Lingering Souls',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-lingering-souls-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'pinned-token-scripts-v1',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-lingering-souls-flashback-outcome',
      generatedScriptDependencies: [
        {
          name: 'w_1_1_spirit_flying',
          sha256: '98b95ca039196dacb75442961ac79f8d6ddc6eda40ae7127a89d28c9271d869e',
        },
      ],
    });
  });

  it.each([
    [
      29,
      'Emeria Angel',
      'w_1_1_bird_flying',
      '0c476da1ffa3f9819db9570167751591e86ecf52bb523b9830d44a6754af5c0f',
    ],
    [
      381,
      'Awakening Zone',
      'c_0_1_eldrazi_spawn_sac',
      '0f82a817834aabc4b637f2991426d60a8aee3c7d907e35928d0585d4e8a9a05b',
    ],
    [
      394,
      'Avenger of Zendikar',
      'g_0_1_plant',
      'f4181d763e2831e46763d72bf5d1efb8c5946664f0d976c1367714b6c7899814',
    ],
  ] as const)(
    'admits exact optional generated-token position %i, %s with its pinned dependency',
    (position, name, tokenName, tokenSha256) => {
      expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
        correctedName: name,
        cardFamilySafe: true,
        bridgeCapabilityProfile: {
          topLevel: 'stated-ordering-and-reviewed-optional-generated-token-v1',
          manaPayment: 'announced-mana-payment-v1',
          generatedObjects: 'pinned-token-scripts-v1',
        },
        runtimeProbeId: 'mtg-z5q4-reviewed-optional-generated-token-outcomes',
        generatedScriptDependencies: [{ name: tokenName, sha256: tokenSha256 }],
      });
    },
  );

  it.each([
    [13, 'Stoneforge Mystic'],
    [41, 'Land Tax'],
    [363, 'Primeval Titan'],
    [488, 'Solemn Simulacrum'],
    [519, 'Golos, Tireless Pilgrim'],
  ] as const)('admits reviewed optional library-search position %i, %s', (position, name) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-optional-library-search-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-optional-library-search-outcomes',
    });
  });

  it('admits the exact reviewed Grim Lavamancer graveyard-exile payment', () => {
    expect(ledger.auditedCards.find((card) => card.position === 246)).toMatchObject({
      correctedName: 'Grim Lavamancer',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-grim-lavamancer-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-grim-lavamancer-graveyard-exile-outcome',
    });
  });

  it('admits the exact reviewed Gifts Ungiven distinct-name search', () => {
    expect(ledger.auditedCards.find((card) => card.position === 158)).toMatchObject({
      correctedName: 'Gifts Ungiven',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-gifts-ungiven-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-gifts-ungiven-distinct-name-outcome',
    });
  });

  it('admits the exact reviewed Liliana of the Veil TwoPiles ultimate', () => {
    expect(ledger.auditedCards.find((card) => card.position === 223)).toMatchObject({
      correctedName: 'Liliana of the Veil',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-liliana-two-piles-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-liliana-two-piles-outcome',
    });
  });

  it.each([
    [42, 'Mana Tithe'],
    [122, 'Pact of Negation'],
    [131, 'Mana Leak'],
    [140, 'Supreme Will'],
  ] as const)('admits reviewed exact counter UnlessCost position %i, %s', (position, name) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-counter-unless-cost-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-counter-unless-cost-outcomes',
    });
  });

  it('admits only the exact reviewed Miscalculation counter-and-Cycling composition', () => {
    expect(ledger.auditedCards.find((card) => card.position === 133)).toMatchObject({
      correctedName: 'Miscalculation',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-miscalculation-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-miscalculation-outcomes',
    });
  });

  it('admits only the exact reviewed Maul trigger-Attach and Equip composition', () => {
    expect(ledger.auditedCards.find((card) => card.position === 81)).toMatchObject({
      correctedName: 'Maul of the Skyclaves',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-maul-of-the-skyclaves-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-maul-of-the-skyclaves-outcomes',
    });
  });

  it('admits only the exact reviewed Embercleave discount, trigger-Attach, and Equip composition', () => {
    expect(ledger.auditedCards.find((card) => card.position === 312)).toMatchObject({
      correctedName: 'Embercleave',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-embercleave-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-embercleave-outcomes',
    });
  });

  it('admits only the exact reviewed Sword of Fire and Ice Equip and combat-trigger composition', () => {
    expect(ledger.auditedCards.find((card) => card.position === 521)).toMatchObject({
      correctedName: 'Sword of Fire and Ice',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-sword-of-fire-and-ice-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-sword-of-fire-and-ice-outcome',
    });
  });

  it.each([
    [444, 'Yorion, Sky Nomad', 'mtg-z5q4-reviewed-yorion-companion-outcome'],
    [455, 'Obosh, the Preypiercer', 'mtg-z5q4-reviewed-obosh-companion-outcome'],
  ] as const)('admits the exact reviewed companion at position %i, %s', (position, name, probe) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-companion-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: probe,
    });
  });

  it.each([
    [169, "Oona's Prowler"],
    [170, 'Pack Rat'],
    [173, 'Dauthi Voidwalker'],
    [249, 'Bomat Courier'],
    [252, 'Goblin Cratermaker'],
    [267, 'Hazoret the Fervent'],
    [291, 'Thrill of Possibility'],
    [296, 'Magmatic Channeler'],
    [333, 'Fauna Shaman'],
    [338, 'Sakura-Tribe Elder'],
    [350, 'Thrashing Brontodon'],
    [355, 'Magus of the Order'],
    [386, 'Natural Order'],
    [454, 'Falkenrath Aristocrat'],
    [464, 'Fiend Artisan'],
    [473, 'Mind Stone'],
    [477, 'Oblivion Stone'],
    [497, 'Hedron Archive'],
    [532, 'Polluted Delta'],
    [539, 'Wooded Foothills'],
    [545, 'Fabled Passage'],
    [546, 'Field of Ruin'],
    [552, 'Marsh Flats'],
    [554, 'Misty Rainforest'],
    [561, 'Horizon Canopy'],
    [563, 'Scalding Tarn'],
    [572, 'Windswept Heath'],
    [576, 'Bloodstained Mire'],
    [579, 'Flooded Strand'],
    [586, 'Arid Mesa'],
    [596, 'Verdant Catacombs'],
    [597, 'Wasteland'],
    [600, 'Prismatic Vista'],
  ] as const)('admits reviewed discard/sacrifice position %i, %s', (position, name) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'discard-or-reviewed-sacrifice-cost-v2',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-discard-and-source-sacrifice-costs',
    });
  });

  it.each([
    [28, 'Restoration Angel'],
    [38, 'Sun Titan'],
    [54, 'Solitude'],
    [57, 'Cast Out'],
    [100, 'Pestermite'],
    [104, 'Vendilion Clique'],
    [110, 'Venser, Shaper Savant'],
    [114, 'Riftwing Cloudskate'],
    [117, 'Frost Titan'],
    [174, 'Bone Shredder'],
    [179, 'Gatekeeper of Malakir'],
    [191, 'Shriekmaw'],
    [266, 'Flametongue Yearling'],
    [305, 'Outpost Siege'],
    [323, 'Avalanche Riders'],
    [346, 'Reclamation Sage'],
    [406, 'Eternal Witness'],
    [407, 'Den Protector'],
    [416, 'Klothys, God of Destiny'],
    [421, 'Tidehollow Sculler'],
    [460, 'Showdown of the Skalds'],
    [484, 'Ulamog, the Ceaseless Hunger'],
    [526, 'Duplicant'],
  ] as const)('admits reviewed sole-blocker trigger target position %i, %s', (position, name) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-trigger-target-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-trigger-target-outcomes',
    });
  });

  it.each([
    [54, 'Solitude', '79fcff57b80a445b5dd6cb2d70558e7222139c98ee1a17ba573c7a66efacc90d'],
    [110, 'Venser, Shaper Savant', 'fb07358dc6735ccade866370e7c9a103e3d037e67053dae50ca903311c37d446'],
    [484, 'Ulamog, the Ceaseless Hunger', '257538847703cfda7568b071b8dd531031c440cebabcdbb6b1380da58502c36d'],
    [487, 'Sword of Light and Shadow', '393281c3a7602822412faf9012d9369c9964407b740cee6e28235601d330448f'],
    [508, 'Sword of Hearth and Home', '047a6958aa38b01bbbcae470def8c00ece54607f5a096526f779b68bb4c1f13c'],
    [509, 'Sword of Body and Mind', '5750a2c1db8eafb61263472cf21cb482b4d35d83ce4722c65f669e89342fd9af'],
    [521, 'Sword of Fire and Ice', '433b9b93045771f5ab717c03b7739d54e8a749bb6489fa80b35e27ccc61ef363'],
  ] as const)('pins the exact exceptional trigger script at position %i, %s', (position, name, sha256) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      forgeScriptSha256: sha256,
    });
  });

  it('admits the exact reviewed Elspeth Conquers Death counter-type choice', () => {
    expect(ledger.auditedCards.find((card) => card.position === 71)).toMatchObject({
      correctedName: 'Elspeth Conquers Death',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-counter-type-choice-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-counter-type-choice-outcome',
    });
  });

  it.each([
    [387, 'Nissa, Who Shakes the World'],
    [445, 'Teferi, Time Raveler'],
  ] as const)('admits reviewed optional-target position %i, %s', (position, name) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-optional-target-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-optional-target-outcomes',
    });
  });

  it.each([
    [474, 'Dismember'],
    [493, 'Porcelain Legionnaire'],
  ] as const)('admits reviewed Phyrexian spell-cost position %i, %s', (position, name) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-phyrexian-spell-cost-v1',
        manaPayment: 'phyrexian-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-phyrexian-spell-cost-outcomes',
    });
  });

  it.each([
    [415, 'Bloodbraid Elf'],
    [427, 'Shardless Agent'],
  ] as const)('admits reviewed Cascade position %i, %s', (position, name) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-cascade-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-cascade-outcomes',
    });
  });

  it.each([
    [151, 'Mystic Confluence'],
    [238, 'Wretched Confluence'],
    [307, 'Fiery Confluence'],
  ] as const)('admits reviewed repeatable-mode position %i, %s', (position, name) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-repeatable-mode-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-repeatable-mode-outcomes',
    });
  });

  it('admits the exact reviewed Plow Under two-land target block', () => {
    expect(ledger.auditedCards.find((card) => card.position === 402)).toMatchObject({
      correctedName: 'Plow Under',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-plow-under-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-plow-under-outcome',
    });
  });

  it('admits the exact reviewed Coalition Relic mana-combo trigger', () => {
    expect(ledger.auditedCards.find((card) => card.position === 507)).toMatchObject({
      correctedName: 'Coalition Relic',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-coalition-relic-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-coalition-relic-outcome',
    });
  });

  it('admits the exact reviewed Cryptic Command modal Stack-target composition', () => {
    expect(ledger.auditedCards.find((card) => card.position === 149)).toMatchObject({
      correctedName: 'Cryptic Command',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-cryptic-command-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-cryptic-command-outcome',
    });
  });

  it('admits the exact reviewed Phantasmal Image optional-copy replacement', () => {
    expect(ledger.auditedCards.find((card) => card.position === 89)).toMatchObject({
      correctedName: 'Phantasmal Image',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-phantasmal-image-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-phantasmal-image-outcomes',
    });
  });

  it.each([
    [82, 'Delver of Secrets'],
    [458, 'Velomachus Lorehold'],
  ] as const)('admits exact reviewed PeekAndReveal position %i, %s', (position, name) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-peek-and-reveal-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-peek-and-reveal-outcomes',
    });
  });

  it.each([
    [97, 'Glasspool Mimic', 'announced-mana-payment-v1'],
    [496, 'Phyrexian Metamorph', 'phyrexian-mana-payment-v1'],
  ] as const)(
    'admits exact reviewed optional-copy replacement position %i, %s',
    (position, name, manaPayment) => {
      expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
        correctedName: name,
        cardFamilySafe: true,
        bridgeCapabilityProfile: {
          topLevel: 'stated-ordering-and-reviewed-optional-copy-replacement-v1',
          manaPayment,
          generatedObjects: 'none',
        },
        runtimeProbeId: 'mtg-z5q4-reviewed-optional-copy-replacement-outcomes',
      });
    },
  );

  it('admits the exact reviewed Karn Liberated restart lifecycle', () => {
    expect(ledger.auditedCards.find((card) => card.position === 481)).toMatchObject({
      correctedName: 'Karn Liberated',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-karn-liberated-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-karn-liberated-restart-outcome',
    });
  });

  it('admits the exact reviewed Rattleclaw Mystic Morph lifecycle', () => {
    expect(ledger.auditedCards.find((card) => card.position === 337)).toMatchObject({
      correctedName: 'Rattleclaw Mystic',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-rattleclaw-mystic-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-rattleclaw-mystic-morph-outcome',
    });
  });

  it('admits the exact reviewed Lightning Phoenix triggered payment', () => {
    expect(ledger.auditedCards.find((card) => card.position === 274)).toMatchObject({
      correctedName: 'Lightning Phoenix',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-lightning-phoenix-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-lightning-phoenix-triggered-payment-outcome',
    });
  });

  it.each([
    [11, 'Esper Sentinel'],
    [461, 'Nahiri, the Harbinger'],
  ] as const)('admits reviewed exact UnlessCost position %i, %s', (position, name) => {
    expect(ledger.auditedCards.find((card) => card.position === position)).toMatchObject({
      correctedName: name,
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-unless-cost-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-unless-cost-outcomes',
    });
  });

  it('admits the exact reviewed Glorybringer exert composition', () => {
    expect(ledger.auditedCards.find((card) => card.position === 273)).toMatchObject({
      correctedName: 'Glorybringer',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-glorybringer-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-glorybringer-exert-outcome',
    });
  });

  it('admits the exact reviewed Baral draw-then-discard composition', () => {
    expect(ledger.auditedCards.find((card) => card.position === 85)).toMatchObject({
      correctedName: 'Baral, Chief of Compliance',
      cardFamilySafe: true,
      bridgeCapabilityProfile: {
        topLevel: 'stated-ordering-and-reviewed-baral-triggered-loot-v1',
        manaPayment: 'announced-mana-payment-v1',
        generatedObjects: 'none',
      },
      runtimeProbeId: 'mtg-z5q4-reviewed-baral-triggered-loot-outcome',
    });
  });
});

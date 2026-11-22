import type { SynergyPackage } from './types';

/** Authored against the pinned 600-card catalog. */
export const SYNERGY_PACKAGES: readonly SynergyPackage[] = [
  {
    id: 'reanimate',
    name: 'Reanimation',
    archetypes: ['reanimator'],
    needs: [
      {
        tag: 'reanimation',
        label: 'reanimation effect',
        min: 2,
        critical: true,
      },
      {
        tag: 'discard-outlet',
        label: 'discard or burial setup',
        min: 2,
        critical: true,
      },
      {
        tag: 'reanimation-target',
        label: 'high-impact targets',
        min: 2,
        critical: true,
      },
    ],
    description:
      'Burial or discard, a suitable target, and a return effect. Shuffle-back Eldrazi are not ordinary targets.',
    examples: ['Reanimate', 'Entomb', 'Griselbrand'],
  },
  {
    id: 'cheat-threat',
    name: 'Cheat a threat',
    archetypes: ['cheat'],
    needs: [
      {
        tag: 'cheat',
        label: 'cheat effect',
        min: 2,
        critical: true,
      },
      {
        tag: 'cheat-target',
        label: 'large targets',
        min: 3,
        critical: true,
      },
    ],
    description:
      'A hand-to-battlefield effect plus powerful targets; cast triggers are not gained by putting a creature onto the battlefield.',
    examples: ['Sneak Attack', 'Show and Tell', 'Emrakul, the Aeons Torn'],
  },
  {
    id: 'blink-etb',
    name: 'Blink value',
    archetypes: ['blink-value'],
    needs: [
      {
        tag: 'blink',
        label: 'blink effects',
        min: 2,
        critical: true,
      },
      {
        tag: 'etb',
        label: 'valuable ETB creatures',
        min: 5,
        critical: true,
      },
    ],
    description:
      'Reuse useful creature ETBs. Individual blink restrictions still matter; Restoration Angel cannot target Angels.',
    examples: ['Restoration Angel', 'Wall of Omens', 'Flickerwisp'],
  },
  {
    id: 'artifact-engine',
    name: 'Artifact density',
    archetypes: ['artifacts'],
    needs: [
      {
        tag: 'artifact',
        label: 'artifacts',
        min: 8,
        critical: true,
      },
      {
        tag: 'artifact-payoff',
        label: 'artifact payoffs',
        min: 2,
        critical: true,
      },
    ],
    description: 'Grow Constructs and support artifact-based engines with real artifact permanents.',
    examples: ['Urza, Lord High Artificer', "Urza's Saga", 'Karn, Scion of Urza'],
  },
  {
    id: 'spells-density',
    name: 'Spells density',
    archetypes: ['spells-tempo'],
    needs: [
      {
        tag: 'cheap-spell',
        label: 'cheap instants and sorceries',
        min: 8,
        critical: true,
      },
      {
        tag: 'spells-payoff',
        label: 'spells payoffs',
        min: 2,
        critical: true,
      },
    ],
    description:
      'Cheap spell density supports prowess, tokens, and delve. Noncreature and instant/sorcery payoffs are related but not identical.',
    examples: ['Ponder', 'Young Pyromancer', 'Murktide Regent'],
  },
  {
    id: 'sacrifice-loop',
    name: 'Sacrifice value',
    archetypes: ['sacrifice'],
    needs: [
      {
        tag: 'sacrifice-outlet',
        label: 'repeatable outlets',
        min: 2,
        critical: true,
      },
      {
        tag: 'fodder',
        label: 'expendable bodies',
        min: 4,
        critical: true,
      },
      {
        tag: 'sacrifice-payoff',
        label: 'payoffs',
        min: 1,
        critical: true,
      },
    ],
    description:
      'Convert expendable bodies into cards, threats, or repeated reanimation; this is a value package, not a claimed infinite loop.',
    examples: ['Yawgmoth, Thran Physician', 'Ophiomancer', 'Recurring Nightmare'],
  },
  {
    id: 'mana-ramp',
    name: 'Ramp into threats',
    archetypes: ['ramp'],
    needs: [
      {
        tag: 'accelerator',
        label: 'acceleration',
        min: 4,
        critical: true,
      },
      {
        tag: 'ramp-payoff',
        label: 'large payoffs',
        min: 3,
        critical: true,
      },
    ],
    description:
      'Early mana plus threats worth accelerating toward. A mana dork does not fill the payoff slot.',
    examples: ['Llanowar Elves', 'Grim Monolith', 'Ulamog, the Ceaseless Hunger'],
  },
  {
    id: 'graveyard-value',
    name: 'Graveyard value',
    archetypes: ['graveyard'],
    needs: [
      {
        tag: 'graveyard-enabler',
        label: 'graveyard setup',
        min: 4,
        critical: true,
      },
      {
        tag: 'graveyard-payoff',
        label: 'graveyard payoffs',
        min: 3,
        critical: true,
      },
    ],
    description:
      'Loot or mill into recursive threats and graveyard resources without requiring a giant reanimation target.',
    examples: ['Satyr Wayfinder', "Uro, Titan of Nature's Wrath", 'Bloodghast'],
  },
  {
    id: 'tokens-wide',
    name: 'Go wide',
    archetypes: ['tokens'],
    needs: [
      {
        tag: 'token-maker',
        label: 'token makers',
        min: 5,
        critical: true,
      },
      {
        tag: 'go-wide-payoff',
        label: 'go-wide payoff',
        min: 2,
        critical: true,
      },
    ],
    description: 'Bodies become a finishing attack through anthems and creature-count payoffs.',
    examples: ['Lingering Souls', 'Gideon, Ally of Zendikar', 'Craterhoof Behemoth'],
  },
  {
    id: 'opposition-tokens',
    name: 'Tap engine',
    archetypes: ['opposition'],
    needs: [
      {
        tag: 'token-maker',
        label: 'token makers',
        min: 4,
        critical: true,
      },
      {
        tag: 'tap-payoff',
        label: 'tap payoff',
        min: 1,
        critical: true,
      },
    ],
    description:
      'Tokens supply repeated taps. Glare cannot tap lands; Opposition can. Neither requires a sacrifice outlet.',
    examples: ['Opposition', 'Glare of Subdual', 'Deranged Hermit'],
  },
  {
    id: 'equipment',
    name: 'Equipment carriers',
    archetypes: ['equipment'],
    needs: [
      {
        tag: 'equipment',
        label: 'equipment',
        min: 2,
        critical: true,
      },
      {
        tag: 'creature',
        label: 'carriers',
        min: 8,
        critical: true,
      },
      {
        tag: 'equipment-tutor',
        label: 'tutor',
        min: 1,
        critical: false,
      },
    ],
    description:
      'Equipment needs bodies and equip mana. Stoneforge is excellent support, not a requirement for every equipment deck.',
    examples: ['Stoneforge Mystic', 'Batterskull', "Umezawa's Jitte"],
  },
  {
    id: 'natural-order',
    name: 'Green sacrifice into target',
    archetypes: ['natural-order'],
    needs: [
      {
        tag: 'natural-order',
        label: 'Natural Order effect',
        min: 1,
        critical: true,
      },
      {
        tag: 'green-fodder',
        label: 'green creatures',
        min: 5,
        critical: true,
      },
      {
        tag: 'natural-order-target',
        label: 'green targets',
        min: 2,
        critical: true,
      },
    ],
    description:
      'Natural Order and Magus need a green body and a green target; generic creature tutors do not bypass the same costs.',
    examples: ['Natural Order', 'Llanowar Elves', 'Craterhoof Behemoth'],
  },
  {
    id: 'creature-toolbox',
    name: 'Creature-density toolbox',
    archetypes: ['natural-order'],
    needs: [
      {
        tag: 'creature-density-payoff',
        label: 'creature payoff',
        min: 1,
        critical: true,
      },
      {
        tag: 'creature',
        label: 'creatures',
        min: 12,
        critical: true,
      },
    ],
    description:
      'Creature tutors and engines need a creature-rich curve; Pod additionally needs adjacent mana values.',
    examples: ['Birthing Pod', "Green Sun's Zenith", 'Eternal Witness'],
  },
  {
    id: 'twin-combo',
    name: 'Splinter Twin pair',
    archetypes: ['twin-combo'],
    needs: [
      {
        tag: 'twin-copy',
        label: 'Splinter Twin',
        min: 1,
        critical: true,
      },
      {
        tag: 'twin-partner',
        label: 'Twin-compatible untapper',
        min: 1,
        critical: true,
      },
    ],
    description:
      'Twin works with Exarch, Pestermite, or Conscripts. Restoration Angel alone is not a Twin combo.',
    examples: ['Splinter Twin', 'Deceiver Exarch', 'Pestermite'],
    alternativeGroup: 'copy-combo',
  },
  {
    id: 'kiki-combo',
    name: 'Kiki-Jiki pair',
    archetypes: ['twin-combo'],
    needs: [
      {
        tag: 'kiki-copy',
        label: 'Kiki-Jiki',
        min: 1,
        critical: true,
      },
      {
        tag: 'kiki-partner',
        label: 'Kiki-compatible partner',
        min: 1,
        critical: true,
      },
    ],
    description:
      'Kiki works with Exarch, Pestermite, Conscripts, or Restoration Angel. Only one complete copy pair is needed.',
    examples: ['Kiki-Jiki, Mirror Breaker', 'Restoration Angel'],
    alternativeGroup: 'copy-combo',
  },
  {
    id: 'land-recursion',
    name: 'Crucible land recursion',
    archetypes: ['graveyard', 'ramp'],
    needs: [
      {
        tag: 'land-recursion',
        label: 'land recursion',
        min: 1,
        critical: true,
      },
      {
        tag: 'sacrificial-land',
        label: 'reusable fetch or utility lands',
        min: 2,
        critical: true,
      },
    ],
    description:
      'Replay fetchlands or sacrificed utility lands. This package does not imply an infinite mana loop.',
    examples: ['Crucible of Worlds', 'Wasteland', 'Flooded Strand'],
  },
  {
    id: 'upheaval-mana',
    name: 'Float mana through Upheaval',
    archetypes: ['ramp', 'control'],
    needs: [
      {
        tag: 'mana-reset',
        label: 'Upheaval',
        min: 1,
        critical: true,
      },
      {
        tag: 'replayable-mana',
        label: 'replayable mana rocks',
        min: 3,
        critical: true,
      },
    ],
    description:
      'Float excess mana before Upheaval, then rebuild faster using cheap rocks. Mana creatures can also help, but must survive to the reset turn.',
    examples: ['Upheaval', 'Grim Monolith', 'Mind Stone'],
  },
];

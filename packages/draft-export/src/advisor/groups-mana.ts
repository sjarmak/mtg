import { lane, members } from './groups';

const fixer = (names: string, fixing: readonly string[]) =>
  members(names, ['fixing'], ['fixing'], [], { fixing });

export const MANA_GROUPS = [
  members('Karakas | Cave of the Frost Dragon | Windbrisk Heights', [], ['land'], [], { sources: ['W'] }),
  members('Shelldock Isle', [], ['land'], [], { sources: ['U'] }),
  members('Den of the Bugbear', [], ['land'], [], { sources: ['R'] }),
  members(
    `Arbor Elf | Avacyn's Pilgrim | Birds of Paradise | Ignoble Hierarch | Elvish Mystic | Fyndhorn Elves | Joraga Treespeaker | Llanowar Elves | Noble Hierarch | Gilded Goose | Lotus Cobra | Overgrown Battlement | Rattleclaw Mystic | Sakura-Tribe Elder | Sylvan Caryatid | Rofellos, Llanowar Emissary | Circle of Dreams Druid | Devoted Druid | Tangled Florahedron | Rift Sower`,
    ['accelerator', 'green-fodder'],
    ['accelerator'],
    [lane('ramp', 3, ['accelerator'], 0.65), lane('natural-order', 1, ['enabler'], 0.2)],
  ),
  members(
    `Utopia Sprawl | Explore | Farseek | Rampant Growth | Cultivate | Search for Tomorrow | Oracle of Mul Daya | Nissa, Vastwood Seer | Garruk Wildspeaker | Nissa, Who Shakes the World | Mirari's Wake | Xenagos, the Reveler | Gaea's Cradle`,
    ['accelerator'],
    ['accelerator'],
    [lane('ramp', 3, ['accelerator'], 0.65)],
  ),
  members(
    `Mind Stone | Grim Monolith | Basalt Monolith | Everflowing Chalice | Chromatic Lantern | Hedron Archive | Coldsteel Heart | Coalition Relic | Thran Dynamo | Gilded Lotus | Worn Powerstone | Solemn Simulacrum | Ancient Tomb`,
    ['accelerator'],
    ['accelerator'],
    [lane('ramp', 2, ['accelerator'], 0.5), lane('artifacts', 1, ['support/glue'], 0.2)],
  ),
  members(`Dark Ritual`, ['burst-mana'], ['accelerator'], [lane('reanimator', 1, ['support/glue'], 0.3)], {
    flexibility: 0.4,
    quality: 2,
  }),
  members(
    `Craterhoof Behemoth | Primeval Titan | Earthshaker Giant | Avenger of Zendikar | Woodfall Primus | Terastodon | Hornet Queen`,
    ['natural-order-target', 'ramp-payoff', 'cheat-target'],
    ['finisher'],
    [lane('natural-order', 3, ['finisher'], 0.7), lane('ramp', 3, ['finisher'], 0.65)],
    { flexibility: 0.4 },
  ),
  members(
    `Natural Order | Magus of the Order`,
    ['natural-order'],
    ['build-around', 'enabler'],
    [lane('natural-order', 3, ['enabler'], 0.95)],
    { flexibility: 0.25, quality: 2 },
  ),
  members(
    `Green Sun's Zenith | Chord of Calling | Birthing Pod | Fiend Artisan | Fauna Shaman | Primal Command | Tooth and Nail | Turntimber Symbiosis | Genesis Wave | Vivien, Monsters' Advocate`,
    ['creature-density-payoff'],
    ['payoff'],
    [lane('natural-order', 2, ['support/glue'], 0.55), lane('ramp', 1, ['support/glue'], 0.3)],
  ),
  members(
    `Wurmcoil Engine | Inferno Titan | Frost Titan | Consecrated Sphinx | Koma, Cosmos Serpent | Hydroid Krasis | Karn Liberated | Ugin, the Spirit Dragon | The Immortal Sun | The Great Henge | Garruk, Primal Hunter | Nissa, Who Shakes the World | Tooth and Nail | Genesis Wave`,
    ['ramp-payoff'],
    ['finisher'],
    [lane('ramp', 2, ['finisher'], 0.55)],
  ),
  members(
    `Satyr Wayfinder | Wall of Blossoms | Reclamation Sage | Eternal Witness | Courser of Kruphix | Tireless Tracker | Jadelight Ranger | Scavenging Ooze | Allosaurus Shepherd | Hexdrinker | Den Protector | Kitchen Finks | Voice of Resurgence | Fauna Shaman`,
    ['green-fodder'],
    ['support/glue'],
    [lane('natural-order', 1, ['enabler'], 0.15)],
  ),
  fixer(
    `Flooded Strand | Tundra | Hallowed Fountain | Seachrome Coast | Glacial Fortress | Celestial Colonnade`,
    ['W', 'U'],
  ),
  fixer(
    `Polluted Delta | Underground Sea | Watery Grave | Darkslick Shores | Drowned Catacomb | Creeping Tar Pit`,
    ['U', 'B'],
  ),
  fixer(
    `Bloodstained Mire | Badlands | Blood Crypt | Blackcleave Cliffs | Dragonskull Summit | Lavaclaw Reaches`,
    ['B', 'R'],
  ),
  fixer(`Wooded Foothills | Taiga | Stomping Ground | Copperline Gorge | Rootbound Crag | Raging Ravine`, [
    'R',
    'G',
  ]),
  fixer(`Windswept Heath | Savannah | Temple Garden | Sunpetal Grove | Stirring Wildwood | Horizon Canopy`, [
    'W',
    'G',
  ]),
  fixer(`Marsh Flats | Scrubland | Godless Shrine | Concealed Courtyard | Isolated Chapel | Shambling Vent`, [
    'W',
    'B',
  ]),
  fixer(
    `Scalding Tarn | Volcanic Island | Steam Vents | Spirebluff Canal | Sulfur Falls | Wandering Fumarole`,
    ['U', 'R'],
  ),
  fixer(
    `Verdant Catacombs | Bayou | Overgrown Tomb | Blooming Marsh | Woodland Cemetery | Hissing Quagmire`,
    ['B', 'G'],
  ),
  fixer(`Arid Mesa | Plateau | Sacred Foundry | Inspiring Vantage | Clifftop Retreat | Needle Spires`, [
    'W',
    'R',
  ]),
  fixer(
    `Misty Rainforest | Tropical Island | Breeding Pool | Botanical Sanctum | Hinterland Harbor | Lumbering Falls`,
    ['U', 'G'],
  ),
  fixer(
    `City of Brass | Mana Confluence | Prismatic Vista | Fabled Passage | Ash Barrens | Birds of Paradise | Gilded Goose | Sylvan Caryatid | Lotus Cobra | Utopia Sprawl | Chromatic Lantern | Coalition Relic | Gilded Lotus | Coldsteel Heart | Solemn Simulacrum | Golos, Tireless Pilgrim | Cultivate | Farseek | Rampant Growth | Sakura-Tribe Elder | Search for Tomorrow | Rift Sower`,
    ['W', 'U', 'B', 'R', 'G'],
  ),
  fixer(`Noble Hierarch`, ['W', 'U', 'G']),
  fixer(`Ignoble Hierarch`, ['B', 'R', 'G']),
  fixer(`Rattleclaw Mystic`, ['U', 'R', 'G']),
  members(
    `Flooded Strand | Polluted Delta | Bloodstained Mire | Wooded Foothills | Windswept Heath | Marsh Flats | Scalding Tarn | Verdant Catacombs | Arid Mesa | Misty Rainforest | Prismatic Vista | Fabled Passage`,
    ['fetch'],
    ['fixing'],
  ),
  members(`Wasteland | Field of Ruin | Karakas`, ['interaction'], ['interaction']),
  members(
    `Cave of the Frost Dragon | Den of the Bugbear | Mishra's Factory | Mutavault`,
    ['threat'],
    ['threat'],
  ),
] as const;

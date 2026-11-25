/** Maps the narrow Forge wire into the backend-neutral observed-session arm. */
import type {
  EngineEvent,
  ObjectView,
  ObservedBackend,
  ObservedSession,
  OpenResult,
  PlayAutomaticMove,
  PlayCombatDamageAssignment,
  PlayDefender,
  PlayInteraction,
  PlayObjectActionCategory,
  SessionError,
  SessionSpec,
  StandardTurnStep,
  SubmitResult,
  TranscriptFrame,
} from '@mtg/engine';
import { matchRulesRefusals, rulesOf, textValueOf } from '@mtg/engine';
import type { Card } from '@mtg/dsl';
import type { ForgeSetExport } from '../transpile';
import { isStockCard, transpileSet } from '../transpile';
import { FORGE_BRIDGE_PROTOCOL_VERSION, FORGE_GAME_TYPES, FORGE_STOCK_AI_FORMATS } from './protocol';
import type { BridgeRequest, BridgeResponse, SnapshotResponse } from './protocol';
import { ForgeBridgeProcess } from './process';
import type { BridgeLaunch } from './process';
import { planForgeManaPayment } from './mana-payment';
import { contractDecision, seatProjection } from './seat-projection';

export interface ForgeObservedBackendOptions extends Omit<BridgeLaunch, 'timeoutMs'> {
  readonly timeoutMs?: number;
  /** Stable backend identity known before open; an installed artifact supplies its pinned version. */
  readonly backendId?: string;
  /** Refuses a companion whose self-reported build is not from this pinned release. */
  readonly expectedForgeVersionPrefix?: string;
  /** Resolves a backend-neutral custom-set reference without putting DSL values in @mtg/engine. */
  readonly resolveCustomSet?: ForgeCustomSetResolver;
  /** Installs an already-complete export immediately before the companion is spawned. */
  readonly beforeSpawn?: (exports: readonly ForgeSetExport[]) => void | Promise<void>;
  /** Acquires exclusive ownership of the profile until the opened session closes. */
  readonly acquireProfile?: () => Promise<() => void>;
  /** Complete printed-card name inventory for the pinned Forge installation. */
  readonly printedCardNames?: ReadonlySet<string>;
  /**
   * `computer` lets Forge's AI answer an unreviewed local-seat choice and log it
   * rather than end the game (#66). It reaches the bridge only on Commander and
   * Momir Basic tables; every other table, and every caller that omits it, stops.
   */
  readonly unreviewedChoices?: 'stop' | 'computer';
}

/** The game variants where an unreviewed choice is answered by the computer when the caller asks (#66). */
const COMPUTER_ANSWERED_VARIANTS: ReadonlySet<string> = new Set(['commander', 'momir']);

export type ForgeCustomSetResolver = (
  setCode: string,
) => readonly Card[] | null | Promise<readonly Card[] | null>;

export type ForgeGeneratedObjectPolicy = 'forge-momir-global-creatures';

const DEFAULT_TIMEOUT_MS = 30_000;
/** Card families whose complete top-level decision shape this vertical slice has audited. */
export const AUDITED_FORGE_CARD_NAMES = [
  'Abbot of Keral Keep',
  'Abrade',
  'Abrupt Decay',
  'Acidic Slime',
  "Agadeem's Awakening",
  'Ajani Vengeant',
  'All Is Dust',
  'Allosaurus Shepherd',
  "Alrund's Epiphany",
  'Anax, Hardened in the Forge',
  'Ancestral Vision',
  'Ancient Grudge',
  'Ancient Tomb',
  'Animate Dead',
  'Anger of the Gods',
  'Arbor Elf',
  'Arcane Artisan',
  'Archangel Avacyn',
  'Archon of Cruelty',
  'Arid Mesa',
  'Armageddon',
  'Ash Barrens',
  'Ashiok, Nightmare Weaver',
  "Avacyn's Pilgrim",
  'Avalanche Riders',
  'Avenger of Zendikar',
  'Augur of Bolas',
  'Awakening Zone',
  'Badlands',
  'Baleful Strix',
  'Banefire',
  'Baneslayer Angel',
  'Banishing Light',
  'Baral, Chief of Compliance',
  'Basalt Monolith',
  'Bayou',
  'Beast Within',
  'Bedevil',
  'Bedlam Reveler',
  'Biogenic Ooze',
  'Birds of Paradise',
  'Birgi, God of Storytelling',
  'Birthing Pod',
  'Bitterblossom',
  'Blackcleave Cliffs',
  'Blessed Alliance',
  'Blade Splicer',
  'Blood Crypt',
  "Bloodchief's Thirst",
  'Bloodbraid Elf',
  'Bloodline Keeper',
  'Bloodghast',
  'Bloodstained Mire',
  'Blooming Marsh',
  'Bomat Courier',
  'Bone Shredder',
  'Bonecrusher Giant',
  'Frost Titan',
  'Flametongue Yearling',
  'Gatekeeper of Malakir',
  'Garruk Wildspeaker',
  'Garruk Relentless',
  'Gideon Blackblade',
  'Den Protector',
  'Stratus Dancer',
  'Vendilion Clique',
  'Torrential Gearhulk',
  'Treachery',
  'Goldspan Dragon',
  'Gonti, Lord of Luxury',
  'Cavalier of Night',
  'Necromancy',
  'Nissa, Vastwood Seer',
  'Chandra, Torch of Defiance',
  'Zareth San, the Trickster',
  'Teferi, Hero of Dominaria',
  'Emrakul, the Promised End',
  'Bonfire of the Damned',
  'Botanical Sanctum',
  'Brainstorm',
  'Brazen Borrower',
  'Breeding Pool',
  'Brightling',
  'Buried Alive',
  'Burst Lightning',
  'Careful Consideration',
  'Casualties of War',
  'Cast Out',
  'Cave of the Frost Dragon',
  'Celestial Colonnade',
  'Chandra, Awakened Inferno',
  'Char',
  'Charming Prince',
  'Chart a Course',
  'Champion of Wits',
  'Chain Lightning',
  'Chandra, Acolyte of Flame',
  'Chord of Calling',
  'Chromatic Lantern',
  'Circle of Dreams Druid',
  'City of Brass',
  'Clifftop Retreat',
  'Cloudgoat Ranger',
  'Coercive Portal',
  'Coldsteel Heart',
  'Coalition Relic',
  'Collective Brutality',
  'Collective Defiance',
  'Compulsive Research',
  'Conclave Tribunal',
  'Concealed Courtyard',
  'Condemn',
  'Consecrated Sphinx',
  'Containment Priest',
  'Control Magic',
  'Copperline Gorge',
  "Council's Judgment",
  'Counterspell',
  'Courser of Kruphix',
  'Court of Bounty',
  'Craterhoof Behemoth',
  'Creeping Tar Pit',
  'Crucible of Worlds',
  'Cryptbreaker',
  'Cryptic Command',
  'Cultivate',
  'Cyclonic Rift',
  'Dack Fayden',
  'Dakkon, Shadow Slayer',
  'Damn',
  'Damnation',
  'Daretti, Ingenious Iconoclast',
  'Dark Confidant',
  'Dark Ritual',
  'Darkslick Shores',
  'Dauthi Voidwalker',
  'Day of Judgment',
  'Daze',
  'Deceiver Exarch',
  'Deep Forest Hermit',
  'Deranged Hermit',
  'Delver of Secrets',
  'Den of the Bugbear',
  'Dermotaxi',
  "Devil's Play",
  'Devoted Druid',
  'Dismember',
  'Doom Blade',
  "Dragon's Rage Channeler",
  'Dragonkin Berserker',
  'Dragonlord Atarka',
  'Dragonlord Silumgar',
  'Dragonskull Summit',
  'Dread Return',
  'Dread Wanderer',
  'Drowned Catacomb',
  'Duplicant',
  'Duress',
  'Earthshaker Giant',
  'Edric, Spymaster of Trest',
  'Elder Gargaroth',
  'Electrolyze',
  'Elesh Norn, Grand Cenobite',
  'Elite Spellbinder',
  'Elspeth Conquers Death',
  'Elspeth, Knight-Errant',
  "Elspeth, Sun's Champion",
  'Emeria Angel',
  "Emeria's Call",
  'Elvish Mystic',
  'Embercleave',
  'Kaldra Compleat',
  'Batterskull',
  'Embereth Shieldbreaker',
  'Engineered Explosives',
  'Emrakul, the Aeons Torn',
  'Entomb',
  'Eternal Witness',
  'Escape to the Wilds',
  'Everflowing Chalice',
  'Exhume',
  'Explore',
  'Expressive Iteration',
  'Exquisite Firecraft',
  'Extinction Event',
  'Fabled Passage',
  'Fact or Fiction',
  "Faith's Fetters",
  'Faithless Looting',
  'Fall from Favor',
  'Fallen Shinobi',
  'Farseek',
  'Fauna Shaman',
  'Falkenrath Aristocrat',
  'Fatal Push',
  'Fblthp, the Lost',
  'Feed the Swarm',
  'Forbid',
  'Force of Negation',
  'Force of Will',
  'Field of Ruin',
  'Fiend Artisan',
  'Fiery Confluence',
  'Figure of Destiny',
  'Fire Prophecy',
  'Firebolt',
  'Firedrinker Satyr',
  'Flame Rift',
  'Flame Slash',
  'Flickerwisp',
  'Flooded Strand',
  'Forest',
  'Fractured Identity',
  'Fyndhorn Elves',
  "Gaea's Cradle",
  'Garruk, Primal Hunter',
  'Magus of the Order',
  'Malicious Affliction',
  'Master of the Wild Hunt',
  'Mystic Confluence',
  'Genesis Wave',
  "Geralf's Messenger",
  'Gideon Jura',
  'Gideon, Ally of Zendikar',
  'Gilded Goose',
  'Gilded Lotus',
  'Gifts Ungiven',
  'Giver of Runes',
  'Glacial Fortress',
  'Glare of Subdual',
  'Glasspool Mimic',
  'Glen Elendra Archmage',
  'Glorybringer',
  'Go for the Throat',
  'Golos, Tireless Pilgrim',
  'Goblin Cratermaker',
  'Goblin Guide',
  'Goblin Rabblemaster',
  'Godless Shrine',
  'Grafted Wargear',
  'Grave Titan',
  'Gravecrawler',
  'Gray Merchant of Asphodel',
  "Green Sun's Zenith",
  'Grim Lavamancer',
  'Grist, the Hunger Tide',
  'Grim Monolith',
  'Griselbrand',
  'Gutterbones',
  'Hallowed Fountain',
  'Hallowed Spiritkeeper',
  'Hangarback Walker',
  'Hard Evidence',
  'Hazoret the Fervent',
  'Heartless Act',
  'Hedron Archive',
  'Hellrider',
  'Hero of Bladehold',
  "Hero's Downfall",
  'Hexdrinker',
  'Hinterland Harbor',
  'Hissing Quagmire',
  'Honor of the Pure',
  'Horizon Canopy',
  'Hornet Queen',
  'Huntmaster of the Fells',
  'Hydroid Krasis',
  'Hymn to Tourach',
  'Hogaak, Arisen Necropolis',
  'Ignoble Hierarch',
  'Ilharg, the Raze-Boar',
  'Imperial Recruiter',
  'Incinerate',
  'Inferno Titan',
  'Inquisition of Kozilek',
  'Inspiring Vantage',
  'Into the Roil',
  'Iona, Shield of Emeria',
  'Island',
  'Isolated Chapel',
  'Jace, the Mind Sculptor',
  "Jace, Vryn's Prodigy",
  'Jadelight Ranger',
  'Joraga Treespeaker',
  'Journey to Nowhere',
  'Karakas',
  'Karn, Scion of Urza',
  'Kiki-Jiki, Mirror Breaker',
  'Kitchen Finks',
  'Kitesail Freebooter',
  'Klothys, God of Destiny',
  'Knight of Autumn',
  'Kytheon, Hero of Akros',
  "Kolaghan's Command",
  'Koma, Cosmos Serpent',
  'Koth of the Hammer',
  'Kozilek, Butcher of Truth',
  "Kroxa, Titan of Death's Hunger",
  'Land Tax',
  'Languish',
  'Lava Coil',
  'Lavaclaw Reaches',
  'Legion Warboss',
  "Legion's Landing",
  'Lightning Bolt',
  'Lightning Greaves',
  'Lightning Helix',
  'Lightning Strike',
  'Liliana of the Veil',
  'Liliana, the Last Hope',
  'Lingering Souls',
  'Living Death',
  'Llanowar Elves',
  'Lolth, Spider Queen',
  'Looter il-Kor',
  'Lotus Cobra',
  'Lumbering Falls',
  'Luminarch Aspirant',
  'Lyra Dawnbringer',
  'Magda, Brazen Outlaw',
  'Magister of Worth',
  'Magmatic Channeler',
  'Makeshift Mannequin',
  "Man-o'-War",
  'Mana Confluence',
  'Mana Leak',
  'Mana Tithe',
  'Marsh Flats',
  'Massacre Wurm',
  'Maul of the Skyclaves',
  'Merfolk Looter',
  'Midnight Reaper',
  'Mimic Vat',
  'Mind Shatter',
  'Mind Stone',
  'Mindslaver',
  "Mirari's Wake",
  'Miscalculation',
  "Mishra's Factory",
  'Misty Rainforest',
  'Monastery Mentor',
  'Monastery Swiftspear',
  'Mother of Runes',
  'Mountain',
  'Mulldrifter',
  'Murderous Rider',
  'Murktide Regent',
  'Murmuring Mystic',
  'Mutavault',
  'Myr Battlesphere',
  'Natural Order',
  'Narset, Parter of Veils',
  'Needle Spires',
  'Negate',
  'Nekrataal',
  'Nicol Bolas, Planeswalker',
  "Night's Whisper",
  'Nighthawk Scavenger',
  'Nissa, Who Shakes the World',
  'Niv-Mizzet Reborn',
  'Niv-Mizzet, Parun',
  'Noble Hierarch',
  'Nykthos, Shrine to Nyx',
  'Ob Nixilis Reignited',
  'Obosh, the Preypiercer',
  'Oblivion Ring',
  'Oblivion Stone',
  'Oko, Thief of Crowns',
  'Omnath, Locus of Creation',
  "Oona's Prowler",
  'Ophiomancer',
  'Opposition',
  'Opt',
  'Oracle of Mul Daya',
  'Oust',
  'Outpost Siege',
  'Overgrown Battlement',
  'Overgrown Tomb',
  'Pack Rat',
  'Paladin Class',
  'Parallax Wave',
  'Pact of Negation',
  'Path to Exile',
  'Pestermite',
  'Phyrexian Arena',
  'Phyrexian Obliterator',
  'Phyrexian Revoker',
  'Phantasmal Image',
  'Phyrexian Metamorph',
  'Karn Liberated',
  'Kalitas, Traitor of Ghet',
  'Rattleclaw Mystic',
  'Satyr Wayfinder',
  'Search for Azcanta',
  "Smuggler's Copter",
  'Lightning Phoenix',
  'Esper Sentinel',
  'Nahiri, the Harbinger',
  'Pia and Kiran Nalaar',
  'Pia Nalaar',
  'Plains',
  'Plateau',
  'Plow Under',
  'Polluted Delta',
  'Polukranos, World Eater',
  'Ponder',
  'Porcelain Legionnaire',
  'Portent',
  'Power Word Kill',
  'Preordain',
  'Primal Command',
  'Primal Might',
  'Primeval Titan',
  'Prismari Command',
  'Prismatic Ending',
  'Prismatic Vista',
  'Pteramander',
  'Pyroclasm',
  'Questing Beast',
  'Raging Ravine',
  'Rampaging Ferocidon',
  'Rampant Growth',
  'Ragavan, Nimble Pilferer',
  'Rankle, Master of Pranks',
  'Ranger Class',
  'Ranger-Captain of Eos',
  'Ravages of War',
  'Ravenous Chupacabra',
  'Read the Bones',
  'Reanimate',
  'Reclamation Sage',
  'Priest of Fell Rites',
  'Recruiter of the Guard',
  'Recurring Nightmare',
  'Rekindling Phoenix',
  'Relic of Progenitus',
  'Remand',
  'Remorseful Cleric',
  'Remove Soul',
  'Repeal',
  'Restoration Angel',
  'Retrofitter Foundry',
  'Reveillark',
  'Rift Bolt',
  'Riftwing Cloudskate',
  'Rift Sower',
  'Rishadan Port',
  'Rofellos, Llanowar Emissary',
  'Roil Eruption',
  'Rootbound Crag',
  'Rotting Regisaur',
  'Runaway Steam-Kin',
  'Sacred Foundry',
  'Saheeli, Sublime Artificer',
  'Sakura-Tribe Elder',
  'Savannah',
  'Scalding Tarn',
  'Scavenging Ooze',
  'Scrubland',
  'Seachrome Coast',
  'Search for Tomorrow',
  'Searing Spear',
  'Shark Typhoon',
  'Sawtusk Demolisher',
  'Seasoned Pyromancer',
  'Selfless Spirit',
  "Serra's Emissary",
  'Serum Visions',
  'Shardless Agent',
  'Shambling Vent',
  'Sheoldred, Whispering One',
  'Shivan Fire',
  'Shriekmaw',
  'Siege-Gang Commander',
  'Show and Tell',
  'Showdown of the Skalds',
  'Skyclave Apparition',
  'Skyclave Shade',
  'Slash the Ranks',
  'Snapcaster Mage',
  'Sneak Attack',
  'Solitude',
  'Solemn Simulacrum',
  'Sower of Temptation',
  'Spear of Heliod',
  'Spectral Procession',
  'Spellseeker',
  'Spellskite',
  "Sphinx's Revelation",
  'Spirebluff Canal',
  'Steam Vents',
  'Stirring Wildwood',
  'Stomping Ground',
  'Stonecoil Serpent',
  'Stoneforge Mystic',
  'Starnheim Unleashed',
  'Stoke the Flames',
  'Student of Warfare',
  'Sublime Archangel',
  'Sudden Edict',
  'Sulfur Falls',
  'Sulfuric Vortex',
  'Sundering Titan',
  'Sun Titan',
  'Sunpetal Grove',
  'Supreme Verdict',
  'Swamp',
  'Sweltering Suns',
  'Splinter Twin',
  'Sword of Body and Mind',
  'Sword of Feast and Famine',
  'Sword of Fire and Ice',
  'Sword of Hearth and Home',
  'Sword of Light and Shadow',
  'Swords to Plowshares',
  'Sylvan Caryatid',
  'Sylvan Library',
  'Taiga',
  'Talrand, Sky Summoner',
  'Tamiyo, the Moon Sage',
  'Tangle Wire',
  'Tasigur, the Golden Fang',
  'Tangled Florahedron',
  'Treasure Map',
  'Turntimber Symbiosis',
  'Teferi, Time Raveler',
  'Temple Garden',
  'Temporal Mastery',
  'Terastodon',
  'Terminus',
  'Thalia, Guardian of Thraben',
  'The Great Henge',
  'The Immortal Sun',
  'The Scarab God',
  'Thing in the Ice',
  'Thirst for Knowledge',
  'Thoughtseize',
  'Thraben Inspector',
  'Thragtusk',
  'Thran Dynamo',
  'Thrill of Possibility',
  'Thrashing Brontodon',
  'Through the Breach',
  'Thrun, the Last Troll',
  'Thundermaw Hellkite',
  'Tidehollow Sculler',
  'Time Warp',
  'Timeless Dragon',
  'Tireless Tracker',
  'Tooth and Nail',
  'Toski, Bearer of Secrets',
  'Toxic Deluge',
  'Tropical Island',
  'Trostani Discordant',
  'Tundra',
  'Supreme Will',
  'Ugin, the Spirit Dragon',
  'Ulamog, the Ceaseless Hunger',
  'Ulamog, the Infinite Gyre',
  "Umezawa's Jitte",
  'Unburial Rites',
  'Underground Sea',
  'Unexpectedly Absent',
  'Unholy Heat',
  'Upheaval',
  'Urza, Lord High Artificer',
  "Urza's Saga",
  'Utopia Sprawl',
  "Uro, Titan of Nature's Wrath",
  'Usher of the Fallen',
  'Valki, God of Lies',
  'Vampire Nighthawk',
  'Vanishing Verse',
  'Venser, Shaper Savant',
  'Velomachus Lorehold',
  'Venerated Loxodon',
  'Verdant Catacombs',
  'Vindicate',
  "Vivien, Monsters' Advocate",
  'Voice of Resurgence',
  'Volcanic Island',
  'Vraska, Relic Seeker',
  'Walking Ballista',
  'Wall of Blossoms',
  'Wall of Omens',
  'Wandering Fumarole',
  'Wasteland',
  'Watery Grave',
  'Whip of Erebos',
  'Whisperwood Elemental',
  'Windbrisk Heights',
  'Windswept Heath',
  'Wooded Foothills',
  'Woodfall Primus',
  'Woodland Cemetery',
  'Worn Powerstone',
  'Wrath of God',
  'Wretched Confluence',
  'Wurmcoil Engine',
  'Xenagos, the Reveler',
  'Yorion, Sky Nomad',
  'Yawgmoth, Thran Physician',
  'Young Pyromancer',
  'Zealous Conscripts',
  'Zurgo Bellstriker',
  'Shelldock Isle',
].sort((left, right) => left.localeCompare(right));
const AUDITED_FORGE_CARDS: ReadonlySet<string> = new Set(AUDITED_FORGE_CARD_NAMES);
/** Independent provisional slice; never inherit the Cube's card approvals. */
const AKH_HOU_PROBE_CARDS: ReadonlySet<string> = new Set([
  'Manalith',
  'Binding Mummy',
  'Decimator Beetle',
  'Trial of Solidarity',
  'Cartouche of Solidarity',
  "Liliana, Death's Majesty",
  'Never // Return',
  'Farm // Market',
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
  'Adorned Pouncer',
  'Censor',
  'Ahn-Crop Crasher',
  'Sacred Cat',
  'Dusk // Dawn',
  'Sweltering Suns',
  'Defiant Khenra',
  'Those Who Serve',
  'Ancient Crab',
  'Dune Beetle',
  'Hyena Pack',
  'Colossapede',
  'Dutiful Servants',
  'Harrier Naga',
  'Khenra Eternal',
  'Shefet Monitor',
  'Desert of the Indomitable',
]);

interface PreparedContent {
  readonly exports: readonly ForgeSetExport[];
  readonly customCardNames: ReadonlySet<string>;
  readonly reasons: readonly string[];
  readonly customNamesKnown: boolean;
}

interface PreparationEntry {
  readonly prepared: Promise<PreparedContent>;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function structuralRefusals(table: SessionSpec): string[] {
  const found: string[] = [];
  if (table.content.kind === 'dsl-set') found.push(`content kind "${table.content.kind}"`);
  const local = table.seats.filter((seat) => seat.controller === 'local').length;
  const engines = table.seats.filter((seat) => seat.controller === 'engine').length;
  if (!((local === 1 && engines === 1) || (local === 2 && engines === 0))) {
    found.push('one local seat and one engine seat, or two local seats');
  }
  // The bridge opens a commander table under Forge's own Commander game, so
  // the only rules refusals left are the ones every backend shares.
  found.push(...matchRulesRefusals(table));
  return found;
}

function cardRefusals(
  table: SessionSpec,
  prepared: PreparedContent,
  scopedCardNames?: ReadonlySet<string>,
  validationPurpose?: 'catalog-discovery' | 'admitted-format',
): string[] {
  if (table.content.kind === 'mixed' && !prepared.customNamesKnown) return [];
  const admitted =
    scopedCardNames ??
    (table.content.kind !== 'dsl-set' && table.content.format === 'akh-hou'
      ? AKH_HOU_PROBE_CARDS
      : AUDITED_FORGE_CARDS);
  const unsupportedCards = new Set(
    table.seats
      .flatMap((seat) => [
        ...seat.deck.cards,
        ...(seat.deck.sideboard ?? []),
        ...(seat.deck.commanders ?? []),
      ])
      .filter(
        (slot) =>
          !admitted.has(slot.name) &&
          !(
            table.content.kind === 'mixed' &&
            slot.origin?.kind === 'custom' &&
            prepared.customCardNames.has(slot.name)
          ),
      )
      .map((slot) => slot.name),
  );
  const found: string[] = [];
  for (const name of [...unsupportedCards].sort((left, right) => left.localeCompare(right))) {
    found.push(
      validationPurpose === undefined
        ? `printed card "${name}" is outside the audited Forge decision-family slice`
        : validationPurpose === 'catalog-discovery'
          ? `printed card "${name}" is outside the diagnostic catalog inventory`
          : `printed card "${name}" is outside the verified format admission`,
    );
  }
  return found;
}

function generatedObjectPolicyRefusals(
  table: SessionSpec,
  validationPurpose?: 'catalog-discovery' | 'admitted-format',
  policy?: ForgeGeneratedObjectPolicy,
): string[] {
  if (validationPurpose !== 'admitted-format') return [];
  const momir = rulesOf(table).variant === 'momir';
  if (momir && policy !== 'forge-momir-global-creatures')
    return ['Momir Basic requires the admitted Forge global-creature policy'];
  if (!momir && policy === 'forge-momir-global-creatures')
    return ['The Forge global-creature policy is restricted to Momir Basic'];
  return [];
}

function sessionPreparationKey(table: SessionSpec): string {
  const content =
    table.content.kind === 'dsl-set'
      ? { kind: table.content.kind, setCode: table.content.setCode }
      : table.content.kind === 'printed'
        ? { kind: table.content.kind, format: table.content.format }
        : {
            kind: table.content.kind,
            format: table.content.format,
            customSetCodes: [...table.content.customSetCodes],
          };
  return JSON.stringify({
    content,
    seats: table.seats.map((seat) => ({
      name: seat.name,
      controller: seat.controller,
      deck: {
        name: seat.deck.name,
        cards: seat.deck.cards.map((slot) => ({
          name: slot.name,
          count: slot.count,
          ...(slot.origin === undefined ? {} : { origin: slot.origin }),
        })),
        sideboard: (seat.deck.sideboard ?? []).map((slot) => ({
          name: slot.name,
          count: slot.count,
          ...(slot.origin === undefined ? {} : { origin: slot.origin }),
        })),
        commanders: (seat.deck.commanders ?? []).map((slot) => ({
          name: slot.name,
          count: slot.count,
          ...(slot.origin === undefined ? {} : { origin: slot.origin }),
        })),
      },
    })),
    rules: rulesOf(table),
    seed: table.seed,
    maximumTurns: table.maximumTurns,
  });
}

function customDecisionRefusal(setCode: string, card: Card): string | null {
  if (isStockCard(card)) return null;
  const subject = `custom set ${JSON.stringify(setCode)} card ${JSON.stringify(card.name)} (${card.id})`;
  let path: string;
  if (card.kind !== 'instant' && card.kind !== 'sorcery') path = 'kind';
  else if (card.alternativeCost !== undefined) path = 'alternativeCost';
  else if (card.castingRestriction !== undefined) path = 'castingRestriction';
  else if (card.additionalCost !== undefined) path = 'additionalCost';
  else if (card.targetCostIncrease !== undefined) path = 'targetCostIncrease';
  else if (card.overload !== undefined) path = 'overload';
  else if (card.modes !== undefined) path = 'modes';
  else if (card.may !== undefined) path = 'may';
  else if (card.unless !== undefined) path = 'unless';
  else if (card.effects.length !== 1) path = 'effects';
  else {
    const effect = card.effects[0]!;
    if ('target' in effect && effect.target !== undefined && effect.target.kind !== 'noTarget') {
      path = 'effects[0].target.kind';
    } else if (effect.kind !== 'loseLife') path = 'effects[0].kind';
    else if (effect.players !== 'eachOpponent') path = 'effects[0].players';
    else if (typeof effect.amount !== 'number') path = 'effects[0].amount';
    else return null;
  }
  return `${subject} rejected bridge decision surface at ${path}: only the audited target-free fixed opponent life-loss spell family is supported`;
}

async function prepareMixedContent(
  table: SessionSpec,
  resolver: ForgeCustomSetResolver | undefined,
  printedCardNames: ReadonlySet<string> | undefined,
): Promise<PreparedContent> {
  if (table.content.kind !== 'mixed') {
    return { exports: [], customCardNames: new Set(), reasons: [], customNamesKnown: true };
  }
  if (table.content.customSetCodes.length === 0) {
    return {
      exports: [],
      customCardNames: new Set(),
      reasons: ['mixed content requires at least one custom set reference'],
      customNamesKnown: true,
    };
  }
  if (resolver === undefined) {
    return {
      exports: [],
      customCardNames: new Set(),
      reasons: ['mixed content requires an injected custom-set resolver'],
      customNamesKnown: false,
    };
  }
  if (printedCardNames === undefined) {
    return {
      exports: [],
      customCardNames: new Set(),
      reasons: ['mixed content requires an authoritative printed-card name inventory'],
      customNamesKnown: false,
    };
  }

  const exports: ForgeSetExport[] = [];
  const customCardNames = new Set<string>();
  const reasons: string[] = [];
  const seenCodes = new Set<string>();
  const resolvedCodes = new Set<string>();
  const customNameOwner = new Map<string, string>();
  const cardsBySet = new Map<string, Map<string, Card[]>>();
  let customNamesKnown = true;
  for (const setCode of table.content.customSetCodes) {
    if (seenCodes.has(setCode)) {
      reasons.push(`custom set ${JSON.stringify(setCode)} is referenced more than once`);
      continue;
    }
    seenCodes.add(setCode);
    let cards: readonly Card[] | null;
    try {
      cards = await resolver(setCode);
    } catch (cause) {
      reasons.push(`custom set ${JSON.stringify(setCode)} resolver failed: ${messageOf(cause)}`);
      customNamesKnown = false;
      continue;
    }
    if (cards === null) {
      reasons.push(`custom set ${JSON.stringify(setCode)} could not be resolved`);
      customNamesKnown = false;
      continue;
    }
    if (cards.length === 0) {
      reasons.push(`custom set ${JSON.stringify(setCode)} resolved with no cards`);
      continue;
    }
    resolvedCodes.add(setCode);
    const byId = new Map<string, Card[]>();
    for (const card of cards) {
      const sameId = byId.get(card.id) ?? [];
      sameId.push(card);
      byId.set(card.id, sameId);
      customCardNames.add(card.name);
      if (printedCardNames.has(card.name) && !isStockCard(card)) {
        reasons.push(
          `custom card ${JSON.stringify(card.name)} (${card.id}) collides with a printed card of the same name`,
        );
      }
      const owner = customNameOwner.get(card.name);
      if (owner !== undefined && owner !== setCode) {
        const owners = [owner, setCode].sort((left, right) => left.localeCompare(right));
        reasons.push(
          `custom card ${JSON.stringify(card.name)} is ambiguous between custom sets ${JSON.stringify(owners[0])} and ${JSON.stringify(owners[1])}`,
        );
      } else {
        customNameOwner.set(card.name, setCode);
      }
    }
    cardsBySet.set(setCode, byId);

    const transpiled = transpileSet(cards, { name: setCode, date: '1970-01-01' });
    if (!transpiled.ok) {
      for (const rejection of transpiled.rejections) {
        const card = cards.find((candidate) => candidate.id === rejection.cardId);
        const subject =
          rejection.cardId.length === 0
            ? `custom set ${JSON.stringify(setCode)}`
            : `custom set ${JSON.stringify(setCode)} card ${JSON.stringify(card?.name ?? rejection.cardId)} (${rejection.cardId})`;
        reasons.push(
          `${subject} rejected ${rejection.code} at ${rejection.path || '<set>'}: ${rejection.message}`,
        );
      }
    }
    if (transpiled.ok && transpiled.value.setCode !== setCode) {
      reasons.push(
        `custom set ${JSON.stringify(setCode)} resolved cards for set ${JSON.stringify(transpiled.value.setCode)}`,
      );
    }
    if (transpiled.ok) {
      for (const card of cards) {
        const refusal = customDecisionRefusal(setCode, card);
        if (refusal !== null) reasons.push(refusal);
      }
    }
    if (transpiled.ok && transpiled.value.setCode === setCode) exports.push(transpiled.value);
  }
  for (const slot of table.seats.flatMap((seat) => [...seat.deck.cards, ...(seat.deck.sideboard ?? [])])) {
    if (slot.origin === undefined) {
      reasons.push(`mixed deck slot ${JSON.stringify(slot.name)} has no explicit printed or custom origin`);
      continue;
    }
    if (slot.origin.kind === 'printed') {
      if (!printedCardNames.has(slot.name)) {
        reasons.push(
          `printed deck slot ${JSON.stringify(slot.name)} is absent from the installed Forge card inventory`,
        );
      }
      continue;
    }
    if (!seenCodes.has(slot.origin.setCode)) {
      reasons.push(
        `custom deck slot ${JSON.stringify(slot.name)} names undeclared set ${JSON.stringify(slot.origin.setCode)}`,
      );
      continue;
    }
    if (!resolvedCodes.has(slot.origin.setCode)) continue;
    const matching = cardsBySet.get(slot.origin.setCode)?.get(slot.origin.cardId) ?? [];
    if (matching.length === 0) {
      reasons.push(
        `custom deck slot ${JSON.stringify(slot.name)} names unknown card id ${JSON.stringify(slot.origin.cardId)} in set ${JSON.stringify(slot.origin.setCode)}`,
      );
      continue;
    }
    if (matching.length > 1) {
      reasons.push(
        `custom deck slot ${JSON.stringify(slot.name)} names duplicate card id ${JSON.stringify(slot.origin.cardId)} in set ${JSON.stringify(slot.origin.setCode)}`,
      );
      continue;
    }
    if (matching[0]!.name !== slot.name) {
      reasons.push(
        `custom deck slot ${JSON.stringify(slot.name)} resolves card id ${JSON.stringify(slot.origin.cardId)} as ${JSON.stringify(matching[0]!.name)}`,
      );
    }
  }
  const scriptOwners = new Map<string, { readonly cardName: string; readonly setCode: string }>();
  for (const exported of exports) {
    for (const script of exported.scripts) {
      if (script.stock) continue;
      const owner = scriptOwners.get(script.fileName);
      if (owner !== undefined && owner.cardName !== script.cardName) {
        reasons.push(
          `Forge custom script ${JSON.stringify(script.fileName)} collides between ${JSON.stringify(owner.cardName)} in ${JSON.stringify(owner.setCode)} and ${JSON.stringify(script.cardName)} in ${JSON.stringify(exported.setCode)}`,
        );
      } else {
        scriptOwners.set(script.fileName, { cardName: script.cardName, setCode: exported.setCode });
      }
    }
  }
  return {
    exports: reasons.length === 0 ? exports : [],
    customCardNames,
    reasons,
    customNamesKnown,
  };
}

function errorFrom(response: Extract<BridgeResponse, { readonly type: 'error' }>): SessionError {
  if (response.kind === 'content-unresolved') {
    return {
      kind: 'content-unresolved',
      message: response.message,
      unresolved: response.unresolved ?? [],
    };
  }
  return { kind: response.kind, message: response.message };
}

function localSeats(table: SessionSpec): readonly (0 | 1)[] {
  const result: (0 | 1)[] = [];
  if (table.seats[0].controller === 'local') result.push(0);
  if (table.seats[1].controller === 'local') result.push(1);
  return result;
}

class SessionOwner {
  readonly process: ForgeBridgeProcess;
  readonly table: SessionSpec;
  readonly backendId: string;
  currentRevision: number;
  transcript: readonly TranscriptFrame[] = [];
  transcriptSequence = 0;
  closePromise: Promise<void> | null = null;
  readonly releaseProfile: () => void;
  readonly transcriptLimit: number;

  constructor(
    process: ForgeBridgeProcess,
    table: SessionSpec,
    backendId: string,
    revision: number,
    releaseProfile: () => void,
    transcriptLimit: number,
  ) {
    this.process = process;
    this.table = table;
    this.backendId = backendId;
    this.currentRevision = revision;
    this.releaseProfile = releaseProfile;
    this.transcriptLimit = transcriptLimit;
  }

  close(sessionId: string): Promise<void> {
    this.closePromise ??= this.#close(sessionId);
    return this.closePromise;
  }

  async #close(sessionId: string): Promise<void> {
    const requestId = this.process.nextRequestId();
    try {
      await this.process.request({
        protocolVersion: FORGE_BRIDGE_PROTOCOL_VERSION,
        type: 'close',
        requestId,
        sessionId,
      });
    } catch {
      // Reaping is the close contract. A child that already died is already reaped.
    } finally {
      this.process.terminate();
      this.releaseProfile();
    }
  }
}

/**
 * Exact Forge 2.0.14 `PhaseType.name()` values, verified against the installed
 * `forge.game.phase.PhaseType` class. An unknown value is unsupported here; it
 * is still preserved verbatim in `TableView.turn.step` for display.
 */
const FORGE_STANDARD_STEP: Readonly<Record<string, StandardTurnStep | undefined>> = {
  UNTAP: 'untap',
  UPKEEP: 'upkeep',
  DRAW: 'draw',
  MAIN1: 'precombatMain',
  COMBAT_BEGIN: 'beginCombat',
  COMBAT_DECLARE_ATTACKERS: 'declareAttackers',
  COMBAT_DECLARE_BLOCKERS: 'declareBlockers',
  COMBAT_FIRST_STRIKE_DAMAGE: 'firstStrikeDamage',
  COMBAT_DAMAGE: 'combatDamage',
  COMBAT_END: 'endCombat',
  MAIN2: 'postcombatMain',
  END_OF_TURN: 'end',
  CLEANUP: 'cleanup',
};

/**
 * The projected host/source object encoded by ForgeBridge itself.
 *
 * These are protocol spellings interpreted at the Forge adapter boundary, not
 * presentation strings interpreted in a browser. Each pattern is anchored to
 * one bridge-owned family whose first numeric component is documented as the
 * source card id. Unknown families return null and stay in the complete move
 * list.
 */
function forgeSourceAction(move: string): {
  readonly oid: string;
  readonly family: 'ability' | 'mana' | 'combat';
  readonly manaOutput?: 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
} | null {
  const mana = /^mana-source-(\d+)-\d+-(W|U|B|R|G|C)$/.exec(move);
  if (mana?.[1] !== undefined && mana[2] !== undefined) {
    return {
      oid: `forge-card-${mana[1]}`,
      family: 'mana',
      manaOutput: mana[2] as 'W' | 'U' | 'B' | 'R' | 'G' | 'C',
    };
  }
  const patterns: readonly [RegExp, 'ability' | 'combat'][] = [
    [/^ability-(\d+)-\d+$/, 'ability'],
    [/^combat-attack-(?:add|remove)-(\d+)(?:-|$)/, 'combat'],
    [/^combat-block-(?:add|remove)-(\d+)-\d+$/, 'combat'],
    [/^combat-damage-(\d+)-(?:card-\d+|defender)$/, 'combat'],
    [/^combat-damage-later-(\d+)$/, 'combat'],
    [/^combat-order-(?:blockers|attackers)-(\d+)-\d+$/, 'combat'],
    [/^combat-order-insert-(\d+)-\d+-\d+$/, 'combat'],
  ];
  for (const [pattern, family] of patterns) {
    const matched = pattern.exec(move);
    if (matched?.[1] !== undefined) return { oid: `forge-card-${matched[1]}`, family };
  }
  return null;
}

/**
 * Who a `combat-attack-add-*` move sends its creature at, read at this adapter
 * boundary so a browser never has to parse the id. The bridge spells a player
 * defender `-player-<seat>` and a planeswalker or battle `-card-<id>`; anything
 * else, including the bare `add` the earlier bridge wrote, names no defender.
 */
function forgeAttackDefender(move: string): PlayDefender | null {
  const player = /^combat-attack-add-\d+-player-([01])$/.exec(move);
  if (player?.[1] !== undefined) return { seat: player[1] === '0' ? 0 : 1 };
  const card = /^combat-attack-add-\d+-card-(\d+)$/.exec(move);
  return card?.[1] === undefined ? null : { oid: `forge-card-${card[1]}` };
}

function forgeAttackerToggle(move: string): { readonly oid: string; readonly staged: boolean } | null {
  const matched = /^combat-attack-(add|remove)-(\d+)(?:-|$)/.exec(move);
  if (matched?.[2] === undefined) return null;
  return { oid: `forge-card-${matched[2]}`, staged: matched[1] === 'remove' };
}

function forgeTargetSeat(move: string): 0 | 1 | null {
  const matched = /^target-player-([01])$/.exec(move);
  return matched?.[1] === '0' ? 0 : matched?.[1] === '1' ? 1 : null;
}

function forgeCardSelection(kind: string | undefined): NonNullable<PlayInteraction['cardSelection']> | null {
  return kind === 'zone-card-selection-hand-to-library' ? { origin: 'hand', destination: 'library' } : null;
}

function forgeCardOrder(kind: string | undefined): NonNullable<PlayInteraction['cardOrder']> | null {
  return kind === 'zone-order-library-top-first' ? { destination: 'library', first: 'top' } : null;
}

function combatDamageDocument(suggestion: string): Record<string, unknown> | null {
  let value: unknown;
  try {
    value = JSON.parse(suggestion);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function combatDamageSource(source: unknown): PlayCombatDamageAssignment['source'] | null {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  const value = source as Record<string, unknown>;
  if (
    typeof value['oid'] !== 'string' ||
    typeof value['name'] !== 'string' ||
    typeof value['power'] !== 'number' ||
    !Number.isSafeInteger(value['power'])
  ) {
    return null;
  }
  return { oid: value['oid'], name: value['name'], power: value['power'] };
}

function combatDamageRecipients(
  recipients: readonly unknown[],
): PlayCombatDamageAssignment['recipients'] | null {
  const proved = recipients.flatMap((recipient) => {
    if (typeof recipient !== 'object' || recipient === null || Array.isArray(recipient)) return [];
    const row = recipient as Record<string, unknown>;
    if (
      typeof row['oid'] !== 'string' ||
      typeof row['name'] !== 'string' ||
      (row['kind'] !== 'blocker' && row['kind'] !== 'defender') ||
      (row['toughness'] !== null &&
        (typeof row['toughness'] !== 'number' || !Number.isSafeInteger(row['toughness']))) ||
      typeof row['damage'] !== 'number' ||
      !Number.isSafeInteger(row['damage']) ||
      typeof row['lethal'] !== 'number' ||
      !Number.isSafeInteger(row['lethal']) ||
      row['damage'] < 0 ||
      row['lethal'] < 0
    ) {
      return [];
    }
    return [
      {
        oid: row['oid'],
        name: row['name'],
        kind: row['kind'] as 'blocker' | 'defender',
        toughness: row['toughness'],
        damage: row['damage'],
        lethal: row['lethal'],
      },
    ];
  });
  return proved.length === recipients.length ? proved : null;
}

function forgeCombatDamage(decision: SnapshotResponse['decision']): PlayCombatDamageAssignment | null {
  const input = decision?.input;
  const suggestion = input?.suggestions[0];
  if (decision?.kind !== 'combat-damage' || input?.kind !== 'text' || suggestion === undefined) return null;
  const document = combatDamageDocument(suggestion);
  if (document === null) return null;
  const rawRecipients = document['recipients'];
  const amounts = document['amounts'];
  const source = combatDamageSource(document['source']);
  if (
    document['version'] !== 1 ||
    typeof document['total'] !== 'number' ||
    !Number.isSafeInteger(document['total']) ||
    document['total'] < 0 ||
    typeof document['canDefer'] !== 'boolean' ||
    typeof document['overrideOrder'] !== 'boolean' ||
    !Array.isArray(rawRecipients) ||
    !Array.isArray(amounts) ||
    rawRecipients.length !== amounts.length ||
    source === null
  )
    return null;
  const recipients = combatDamageRecipients(rawRecipients);
  if (
    recipients === null ||
    !amounts.every((amount) => typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0)
  )
    return null;
  return {
    inputId: input.id,
    source,
    total: document['total'],
    canDefer: document['canDefer'],
    overrideOrder: document['overrideOrder'],
    recipients,
    defaultAmounts: amounts as number[],
  };
}

function contractAutomaticMove(
  snapshot: SnapshotResponse,
  seats: readonly (0 | 1)[],
): PlayAutomaticMove | null {
  const decision = snapshot.decision;
  if (decision === null) return null;
  if (decision.kind === 'starting-player' && seats.length === 1) {
    const move = `pregame-start-seat-${String(seats[0])}`;
    return decision.options.some((option) => option.id === move) ? { move, reason: 'local-starts' } : null;
  }
  if (decision.kind !== 'mana-payment') return null;
  if (decision.manaPayment !== undefined) {
    const paymentOptions = decision.options.flatMap((option) =>
      option.manaPayment === undefined ? [] : [{ id: option.id, payment: option.manaPayment }],
    );
    if (paymentOptions.length === decision.options.length) {
      const offersPhyrexianLife = paymentOptions.some(({ payment }) => payment.kind === 'phyrexian-life');
      const offersAnotherPayment = paymentOptions.some(
        ({ payment }) => payment.kind !== 'phyrexian-life' && payment.kind !== 'cancel',
      );
      if (offersPhyrexianLife && offersAnotherPayment) return null;
      const plan = planForgeManaPayment({
        unpaid: decision.manaPayment.unpaid,
        options: paymentOptions,
      });
      if (plan !== null) {
        return {
          move: plan.move,
          reason: plan.kind === 'cancel' ? 'mana-payment-cancel' : 'mana-payment',
        };
      }
    }
  }
  const ids = new Set(decision.options.map((option) => option.id));
  if (ids.size === 2 && ids.has('mana-payment-phyrexian-life') && ids.has('mana-payment-cancel')) {
    return { move: 'mana-payment-phyrexian-life', reason: 'mana-payment' };
  }
  const option =
    decision.options.find((candidate) => /^mana-pool-\d+$/.test(candidate.id)) ??
    decision.options.find((candidate) => /^mana-source-\d+-\d+-(?:W|U|B|R|G|C)$/.test(candidate.id));
  return option === undefined ? null : { move: option.id, reason: 'mana-payment' };
}

function contractPlay(snapshot: SnapshotResponse, seats: readonly (0 | 1)[]): PlayInteraction {
  const offered = new Set(snapshot.decision?.options.map((option) => option.id) ?? []);
  const openingHand =
    snapshot.decision?.kind === 'mulligan' && offered.has('pregame-keep') && offered.has('pregame-mulligan');
  const hands = new Map(
    snapshot.view.seats.flatMap((seat) => (seat.hand ?? []).map((card) => [card.oid, card] as const)),
  );
  const battlefield = new Set(
    snapshot.view.seats.flatMap((seat) => seat.battlefield.map((card) => card.oid)),
  );
  // A commander in the command zone is castable from it (CR 903.8), and the
  // bridge offers that cast through the same ability family as a hand cast.
  const commandZone = new Set(
    snapshot.view.seats.flatMap((seat) => (seat.commandZone ?? []).map((card) => card.oid)),
  );
  const avatars = new Set(
    snapshot.view.seats.flatMap((seat) => (seat.avatars ?? []).map((card) => card.oid)),
  );
  // A public top card of the library is played or cast from there the way a
  // held card is (Oracle of Mul Daya), through the same ability family, so it
  // is categorized by its printed type exactly as a hand card is.
  const libraryTop = new Map(
    snapshot.view.seats.flatMap((seat) => (seat.libraryTop ?? []).map((card) => [card.oid, card] as const)),
  );
  const fromRevealed = (oid: string): ObjectView | undefined => hands.get(oid) ?? libraryTop.get(oid);
  const visible = new Set([
    ...hands.keys(),
    ...battlefield,
    ...commandZone,
    ...avatars,
    ...libraryTop.keys(),
  ]);
  const objectActions = (snapshot.decision?.options ?? []).flatMap((option) => {
    const source = forgeSourceAction(option.id);
    if (source === null || !visible.has(source.oid)) return [];
    let category: PlayObjectActionCategory | undefined;
    if (source.family === 'mana') category = 'mana';
    if (source.family === 'combat') category = 'combat';
    if (source.family === 'ability' && battlefield.has(source.oid)) category = 'ability';
    if (source.family === 'ability' && avatars.has(source.oid)) category = 'ability';
    // Forge's generic ability family also carries hand plays. The projected
    // zone and exact printed type distinguish a land play from a spell cast;
    // battlefield members of the same family remain activated abilities.
    if (source.family === 'ability' && fromRevealed(source.oid)?.typeLine.includes('Land')) {
      category = 'play';
    } else if (
      source.family === 'ability' &&
      (fromRevealed(source.oid) !== undefined || commandZone.has(source.oid))
    ) {
      category = 'cast';
    }
    const defender = source.family === 'combat' ? forgeAttackDefender(option.id) : null;
    return [
      {
        oid: source.oid,
        move: option.id,
        ...(category === undefined ? {} : { category }),
        ...(source.manaOutput === undefined ? {} : { manaOutput: source.manaOutput }),
        ...(defender === null ? {} : { defender }),
      },
    ];
  });
  const seatActions = (snapshot.decision?.options ?? []).flatMap((option) => {
    const seat = forgeTargetSeat(option.id);
    return seat === null ? [] : [{ seat, move: option.id }];
  });
  const attackerToggles = (snapshot.decision?.options ?? []).flatMap((option) => {
    const toggle = forgeAttackerToggle(option.id);
    return toggle === null ? [] : [{ ...toggle, defender: forgeAttackDefender(option.id) }];
  });
  // One creature may be offered once per defender, and that is a declaration a
  // surface can stage only when every one of those offers names who it sends
  // the creature at. A creature offered twice with no defender to tell the
  // offers apart is the ambiguity this role has always refused.
  const offersByAttacker = new Map<string, (typeof attackerToggles)[number][]>();
  for (const toggle of attackerToggles) {
    offersByAttacker.set(toggle.oid, [...(offersByAttacker.get(toggle.oid) ?? []), toggle]);
  }
  const attackersDistinguishable = [...offersByAttacker.values()].every(
    (offers) => offers.length === 1 || offers.every((offer) => !offer.staged && offer.defender !== null),
  );
  const attackerConfirm = offered.has('combat-attackers-commit') ? 'combat-attackers-commit' : null;
  const attackers =
    snapshot.decision?.kind === 'combat-attackers' && attackerConfirm !== null && attackersDistinguishable
      ? {
          confirm: attackerConfirm,
          staged: attackerToggles.filter((toggle) => toggle.staged).map((toggle) => toggle.oid),
        }
      : null;
  const cardSelection = forgeCardSelection(snapshot.decision?.kind);
  const cardOrder = forgeCardOrder(snapshot.decision?.kind);
  const combatDamage = forgeCombatDamage(snapshot.decision);
  return {
    turnStep: FORGE_STANDARD_STEP[snapshot.view.turn.step] ?? null,
    // These ids are emitted by ForgeBridge's priority controller. Checking the
    // live enumeration keeps a role from surviving into a different decision.
    passPriority: offered.has('pass') ? 'pass' : null,
    concede: offered.has('concede') ? 'concede' : null,
    ...(offered.has('undo-mana') ? { undo: 'undo-mana' } : {}),
    ...(snapshot.manaPools === undefined ? {} : { manaPools: snapshot.manaPools }),
    objectActions,
    seatActions,
    ...(attackers === null ? {} : { attackers }),
    ...(cardSelection === null ? {} : { cardSelection }),
    ...(cardOrder === null ? {} : { cardOrder }),
    ...(combatDamage === null ? {} : { combatDamage }),
    promptRole: openingHand ? 'opening-hand' : null,
    automatic: contractAutomaticMove(snapshot, seats),
  };
}

function observedSession(
  owner: SessionOwner,
  snapshot: SnapshotResponse,
  move: string | null,
): ObservedSession {
  const frame: TranscriptFrame = {
    seq: owner.transcriptSequence,
    view: snapshot.view,
    events: snapshot.events as readonly EngineEvent[],
    move,
  };
  owner.transcriptSequence += 1;
  owner.transcript = [...owner.transcript, frame].slice(-owner.transcriptLimit);
  const transcriptAtSnapshot = owner.transcript;
  const revision = snapshot.revision;

  return {
    backend: owner.backendId,
    determinism: 'observed',
    table: owner.table,
    status: snapshot.status,
    view: snapshot.view,
    events: snapshot.events as readonly EngineEvent[],
    decision: contractDecision(snapshot.decision),
    play: contractPlay(snapshot, localSeats(owner.table)),
    // Both hands arrive on the wire for a two-local table; `seat-projection.ts`
    // is the boundary that removes what a seat may not identify.
    seats: seatProjection(snapshot),
    result: snapshot.result,
    submitted: revision,
    localSeats: localSeats(owner.table),
    transcript: transcriptAtSnapshot,
    submit: (submittedMove): Promise<SubmitResult<ObservedSession>> =>
      submit(owner, snapshot, revision, submittedMove),
    close: (): Promise<void> => owner.close(snapshot.sessionId),
  };
}

async function submit(
  owner: SessionOwner,
  snapshot: SnapshotResponse,
  revision: number,
  moveId: string,
): Promise<SubmitResult<ObservedSession>> {
  if (owner.closePromise !== null || snapshot.status !== 'awaiting' || snapshot.decision === null) {
    return {
      ok: false,
      error: { kind: 'no-decision-pending', message: 'the Forge session is not awaiting a move' },
    };
  }
  if (revision !== owner.currentRevision) {
    return {
      ok: false,
      error: {
        kind: 'backend-failure',
        message: 'stale Forge session snapshot submitted after the process advanced',
      },
    };
  }
  const input = snapshot.decision.input;
  // An open question is answered through its own descriptor, so the id an option
  // decision would carry is a text box's encoded answer instead. Whether the name
  // is a card, and whether it satisfies the question's filter, is Forge's to say:
  // this side owns the encoding and nothing about Magic.
  let text: string | null = null;
  if (input === null) {
    if (!snapshot.decision.options.some((option) => option.id === moveId)) {
      return {
        ok: false,
        error: {
          kind: 'unknown-move',
          message: `"${moveId}" is not one of the moves Forge offered`,
          offered: snapshot.decision.options.length,
        },
      };
    }
  } else {
    text = textValueOf(input, moveId);
    if (text === null) {
      return {
        ok: false,
        error: {
          kind: 'unknown-move',
          message: `"${moveId}" does not decode as an answer to Forge's ${input.label} box`,
          offered: snapshot.decision.options.length,
        },
      };
    }
  }
  const request: BridgeRequest = {
    protocolVersion: FORGE_BRIDGE_PROTOCOL_VERSION,
    type: 'submit',
    requestId: owner.process.nextRequestId(),
    sessionId: snapshot.sessionId,
    revision,
    moveId,
    text,
  };
  try {
    const response = await owner.process.request(request);
    if (response.type === 'error') return { ok: false, error: errorFrom(response) };
    if (response.type !== 'snapshot') {
      return {
        ok: false,
        error: { kind: 'backend-failure', message: `Forge answered submit with ${response.type}` },
      };
    }
    owner.currentRevision = response.revision;
    return { ok: true, session: observedSession(owner, response, moveId) };
  } catch (error) {
    return { ok: false, error: error as SessionError };
  }
}

function createForgeObservedBackend(
  options: ForgeObservedBackendOptions,
  scopedCardNames?: ReadonlySet<string>,
  validationPurpose?: 'catalog-discovery' | 'admitted-format',
  generatedObjectPolicy?: ForgeGeneratedObjectPolicy,
): ObservedBackend {
  const backendId =
    options.backendId ??
    (validationPurpose === 'catalog-discovery'
      ? 'forge-diagnostic'
      : validationPurpose === 'admitted-format'
        ? 'forge-admitted'
        : 'forge');
  const preparations = new Map<string, PreparationEntry>();

  function entryFor(table: SessionSpec): PreparationEntry {
    const key = sessionPreparationKey(table);
    const existing = preparations.get(key);
    if (existing !== undefined) return existing;
    const entry: PreparationEntry = {
      prepared: prepareMixedContent(table, options.resolveCustomSet, options.printedCardNames),
    };
    preparations.set(key, entry);
    return entry;
  }

  async function supportResult(table: SessionSpec): Promise<{
    readonly prepared: PreparedContent;
    readonly reasons: readonly string[];
  }> {
    const entry = entryFor(table);
    const prepared = await entry.prepared;
    return {
      prepared,
      reasons: [
        ...structuralRefusals(table),
        ...prepared.reasons,
        ...cardRefusals(table, prepared, scopedCardNames, validationPurpose),
        ...generatedObjectPolicyRefusals(table, validationPurpose, generatedObjectPolicy),
      ],
    };
  }

  return {
    id: backendId,
    determinism: 'observed',
    capabilities: { undo: false, fork: false, perSeatProjection: true, engineSeats: true },
    supports: async (table): Promise<readonly string[]> => (await supportResult(table)).reasons,
    open: async (table): Promise<OpenResult<ObservedSession>> => {
      const support = await supportResult(table);
      const unsupported = support.reasons;
      if (unsupported.length > 0) {
        return {
          ok: false,
          error: {
            kind: 'unsupported',
            capability: 'printed-human-vs-engine',
            message: `Forge observed backend requires ${unsupported.join('; ')}`,
          },
        };
      }
      let process: ForgeBridgeProcess | null = null;
      let releaseProfile: (() => void) | null = null;
      try {
        releaseProfile = (await options.acquireProfile?.()) ?? (() => undefined);
        await options.beforeSpawn?.(support.prepared.exports);
        process = new ForgeBridgeProcess({
          ...options,
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
        const hello = await process.request({
          protocolVersion: FORGE_BRIDGE_PROTOCOL_VERSION,
          type: 'hello',
          requestId: process.nextRequestId(),
        });
        if (hello.type !== 'hello') throw new Error(`Forge answered hello with ${hello.type}`);
        if (hello.protocolVersion !== FORGE_BRIDGE_PROTOCOL_VERSION) {
          throw new Error(
            `Forge bridge protocol version ${String(hello.protocolVersion)} does not match ${String(FORGE_BRIDGE_PROTOCOL_VERSION)}`,
          );
        }
        if (
          options.expectedForgeVersionPrefix !== undefined &&
          !hello.forgeVersion.startsWith(options.expectedForgeVersionPrefix)
        ) {
          throw new Error(
            `Forge build ${hello.forgeVersion} does not match pinned release ${options.expectedForgeVersionPrefix}`,
          );
        }
        const requestId = process.nextRequestId();
        if (table.content.kind === 'dsl-set') throw new Error('DSL content cannot open a Forge session');
        const format = table.content.format;
        const rules = rulesOf(table);
        const opened = await process.request({
          protocolVersion: FORGE_BRIDGE_PROTOCOL_VERSION,
          type: 'open',
          requestId,
          format,
          forgeGameType: FORGE_GAME_TYPES[rules.variant],
          startingLife: rules.startingLife,
          engineCyclingLookahead: !FORGE_STOCK_AI_FORMATS.has(format),
          seed: table.seed,
          maximumTurns: table.maximumTurns,
          ...(validationPurpose === undefined ? {} : { validationPurpose }),
          ...(options.unreviewedChoices === 'computer' && COMPUTER_ANSWERED_VARIANTS.has(rules.variant)
            ? { unreviewedChoices: 'computer' as const }
            : {}),
          seats: [
            {
              name: table.seats[0].name,
              controller: table.seats[0].controller,
              cards: table.seats[0].deck.cards.map((slot) => ({
                name: slot.name,
                count: slot.count,
              })),
              sideboard: (table.seats[0].deck.sideboard ?? []).map((slot) => ({
                name: slot.name,
                count: slot.count,
              })),
              commanders: (table.seats[0].deck.commanders ?? []).map((slot) => ({
                name: slot.name,
                count: slot.count,
              })),
            },
            {
              name: table.seats[1].name,
              controller: table.seats[1].controller,
              cards: table.seats[1].deck.cards.map((slot) => ({
                name: slot.name,
                count: slot.count,
              })),
              sideboard: (table.seats[1].deck.sideboard ?? []).map((slot) => ({
                name: slot.name,
                count: slot.count,
              })),
              commanders: (table.seats[1].deck.commanders ?? []).map((slot) => ({
                name: slot.name,
                count: slot.count,
              })),
            },
          ],
        });
        if (opened.type === 'error') {
          process.terminate();
          releaseProfile();
          releaseProfile = null;
          return { ok: false, error: errorFrom(opened) };
        }
        if (opened.type !== 'snapshot') throw new Error(`Forge answered open with ${opened.type}`);
        const owner = new SessionOwner(
          process,
          table,
          backendId,
          opened.revision,
          releaseProfile,
          validationPurpose === 'catalog-discovery' ? 1 : Number.POSITIVE_INFINITY,
        );
        releaseProfile = null;
        return { ok: true, session: observedSession(owner, opened, null) };
      } catch (error) {
        process?.terminate();
        releaseProfile?.();
        if (typeof error === 'object' && error !== null && 'kind' in error) {
          return { ok: false, error: error as SessionError };
        }
        return {
          ok: false,
          error: {
            kind: 'backend-failure',
            message: error instanceof Error ? error.message : 'Forge bridge failed during open',
          },
        };
      }
    },
  };
}

/** Ordinary play backend: only independently audited card families may open. */
export function forgeObservedBackend(options: ForgeObservedBackendOptions): ObservedBackend {
  return createForgeObservedBackend(options);
}

/**
 * Offline failure discovery over one exact catalog inventory.
 *
 * This constructor does not admit cards or enable a live format. It exists so
 * batch tooling can discover bridge callbacks before those callbacks have
 * individual evidence. Every deck card must still belong to the supplied
 * inventory and resolve in the pinned Forge installation.
 */
export function forgeObservedDiagnosticBackend(
  options: ForgeObservedBackendOptions,
  diagnosticCardNames: ReadonlySet<string>,
): ObservedBackend {
  if (diagnosticCardNames.size === 0) throw new Error('Diagnostic card inventory must be non-empty');
  return createForgeObservedBackend(options, new Set(diagnosticCardNames), 'catalog-discovery');
}

/**
 * Live-format constructor reached only after a trusted caller verifies a complete admission artifact.
 * Keeping this separate from catalog discovery prevents an offline inventory from enabling play.
 */
export function forgeObservedAdmittedBackend(
  options: ForgeObservedBackendOptions,
  admittedCardNames: ReadonlySet<string>,
  generatedObjectPolicy?: ForgeGeneratedObjectPolicy,
): ObservedBackend {
  if (admittedCardNames.size === 0) throw new Error('Admitted card inventory must be non-empty');
  return createForgeObservedBackend(
    options,
    new Set(admittedCardNames),
    'admitted-format',
    generatedObjectPolicy,
  );
}

import { lane, members } from './groups';

/** Small packages and explicit liabilities that broad role families cannot express. */
export const SPECIAL_GROUPS = [
  members(
    `Crucible of Worlds`,
    ['land-recursion', 'graveyard-payoff'],
    ['build-around'],
    [lane('graveyard', 2, ['payoff'], 0.65), lane('ramp', 1, ['support/glue'], 0.3)],
    { flexibility: 0.25, quality: 2 },
  ),
  members(
    `Wasteland | Field of Ruin | Flooded Strand | Polluted Delta | Bloodstained Mire | Wooded Foothills | Windswept Heath | Marsh Flats | Scalding Tarn | Verdant Catacombs | Arid Mesa | Misty Rainforest | Prismatic Vista | Fabled Passage`,
    ['sacrificial-land'],
    ['support/glue'],
  ),
  members(
    `Upheaval`,
    ['mana-reset'],
    ['build-around'],
    [lane('ramp', 3, ['payoff'], 0.9), lane('control', 2, ['finisher'], 0.6)],
    { flexibility: 0.25, quality: 2 },
  ),
  members(
    `Mind Stone | Grim Monolith | Basalt Monolith | Everflowing Chalice | Chromatic Lantern | Hedron Archive | Coldsteel Heart | Coalition Relic | Thran Dynamo | Gilded Lotus | Worn Powerstone`,
    ['replayable-mana'],
    ['accelerator'],
  ),
  members(
    `Reveillark`,
    ['graveyard-payoff'],
    ['payoff'],
    [lane('graveyard', 2, ['payoff'], 0.5), lane('blink-value', 2, ['payoff'], 0.5)],
  ),
  members(
    `Phantasmal Image | Glasspool Mimic | Phyrexian Metamorph`,
    ['creature-copy'],
    ['support/glue'],
    [lane('blink-value', 1, ['support/glue'], 0.15)],
  ),
  members(`Land Tax`, ['card-advantage'], ['card advantage'], [lane('control', 1, ['support/glue'], 0.2)]),
  members(
    `Tamiyo, the Moon Sage | Ashiok, Nightmare Weaver | Time Warp | Temporal Mastery`,
    ['threat'],
    ['finisher'],
    [lane('control', 2, ['finisher'], 0.3)],
  ),
  members(
    `Plow Under`,
    ['tempo-denial'],
    ['interaction'],
    [lane('ramp', 2, ['payoff'], 0.5), lane('midrange', 1, ['interaction'], 0.2)],
  ),
  members(`Mind Shatter`, ['interaction'], ['interaction'], [lane('control', 1, ['interaction'], 0.1)]),
  members(
    `Birgi, God of Storytelling`,
    ['spells-payoff'],
    ['payoff'],
    [lane('spells-tempo', 2, ['payoff'], 0.6)],
    { flexibility: 0.4, quality: 2 },
  ),
  members(`Obosh, the Preypiercer`, ['odd-payoff'], ['build-around'], [lane('aggro', 2, ['payoff'], 0.65)], {
    flexibility: 0.3,
    quality: 2,
  }),
  members(`Relic of Progenitus`, ['graveyard-hate'], ['interaction']),
  members(`Containment Priest`, ['entry-hate'], ['interaction']),
  members(`Spellskite`, ['protection'], ['support/glue'], [lane('twin-combo', 1, ['support/glue'], 0.2)]),
] as const;

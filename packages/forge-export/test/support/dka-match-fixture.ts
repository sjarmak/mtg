/** Dark Ascension whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const DKA_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'dka',
  title: 'DKA',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'dka-local-pregame-v2',
    localToss: '1514',
    nativePriority: 'dka-native-priority-v1',
  },
};

/** Scars of Mirrodin whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const SOM_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'som',
  title: 'SOM',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'som-local-pregame-v1',
    localToss: '1514',
    nativePriority: 'som-native-priority-v1',
  },
};

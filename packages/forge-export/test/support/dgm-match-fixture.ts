/** Dragon's Maze whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const DGM_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'dgm',
  title: 'DGM',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'dgm-local-pregame-v8',
    localToss: '1514',
    nativePriority: 'dgm-native-priority-v1',
  },
};

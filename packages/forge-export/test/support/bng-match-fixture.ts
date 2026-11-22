/** Born of the Gods whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const BNG_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'bng',
  title: 'BNG',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'bng-local-pregame-v1',
    localToss: '1514',
    nativePriority: 'bng-native-priority-v1',
  },
};

/** kld-aer whole-game probe fixture: one basic, one audited one-drop, the seeds its receipts bind. */
import type { PrintedMatchFixture } from './printed-match-probes';

export const KLD_AER_MATCH_FIXTURE: PrintedMatchFixture = {
  format: 'kld-aer',
  title: 'KLD-AER',
  land: 'Forest',
  creature: "Avacyn's Pilgrim",
  creatureManaValue: 1,
  seeds: {
    engineStarts: 'kld-local-pregame-v2',
    localToss: '1514',
    nativePriority: 'kld-native-priority-v1',
  },
};

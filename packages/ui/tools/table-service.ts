import { randomUUID } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { serveTable } from '@mtg/netplay';
import type { GameplayRecorder, ObservedDealer, RunningServer } from '@mtg/netplay';
import type { ResolvedSet } from './resolve-set';
import { cardsOf } from './set-surfaces';
import type { PreconSearch } from './stage-precons';
import { roomDealer, tableDealer } from './table-dealer';

export interface TableServiceOptions {
  readonly set: ResolvedSet;
  readonly precons: PreconSearch;
  readonly webPort: number;
  readonly port: number;
  readonly recorder?: GameplayRecorder;
  readonly observed?: ObservedDealer;
}

export function startTableService(options: TableServiceOptions): Promise<RunningServer> {
  const set = cardsOf(options.set);
  return serveTable({
    port: options.port,
    host: '127.0.0.1',
    ...(options.recorder === undefined ? {} : { recorder: options.recorder }),
    ...(options.observed === undefined ? {} : { observed: options.observed }),
    dealer: tableDealer({
      set,
      precons: options.precons.chosen?.file ?? null,
      webPort: options.webPort,
      interfaces: networkInterfaces,
      newId: randomUUID,
    }),
    rooms: roomDealer({
      set,
      webPort: options.webPort,
      interfaces: networkInterfaces,
      newId: randomUUID,
    }),
    drafts: roomDealer({
      set,
      webPort: options.webPort,
      interfaces: networkInterfaces,
      newId: randomUUID,
      draft: {},
    }),
  });
}

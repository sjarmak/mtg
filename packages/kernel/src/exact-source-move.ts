/** Zone movement guarded by the exact source incarnation retained on the stack. */
import type { ObjectId } from './ids';
import type { ZoneId } from './state';
import type { Trace } from './trace';
import { moveObject, tryObject, type ArrivalEntry } from './zones';

export function moveExactSourceFromZone(
  trace: Trace,
  sourceOid: ObjectId,
  sourceIncarnation: number | undefined,
  origin: ZoneId,
  destination: ZoneId,
  entry: ArrivalEntry = {},
): Trace {
  const source = tryObject(trace.state, sourceOid);
  if (
    source === undefined ||
    source.zone !== origin ||
    sourceIncarnation === undefined ||
    (source.incarnation ?? 0) !== sourceIncarnation
  ) {
    return trace;
  }
  return moveObject(trace, sourceOid, destination, entry);
}

/** Exact source-incarnation links between a permanent and cards it exiled. */
import type { ObjectId } from './ids';
import type { LinkedExileReference } from './state';
import type { Trace } from './trace';
import { putObject, withState } from './trace';
import { moveObject, tryObject } from './zones';

/** Attach current exile incarnations to one exact battlefield source incarnation. */
export function linkExileToSource(
  trace: Trace,
  sourceOid: ObjectId,
  sourceIncarnation: number | undefined,
  cards: readonly ObjectId[],
): Trace {
  if (cards.length === 0 || sourceIncarnation === undefined) return trace;
  const source = tryObject(trace.state, sourceOid);
  if (
    source === undefined ||
    source.zone !== 'battlefield' ||
    (source.incarnation ?? 0) !== sourceIncarnation
  ) {
    return trace;
  }
  let state = trace.state;
  const linked: LinkedExileReference[] = [];
  for (const oid of cards) {
    const object = tryObject(state, oid);
    if (object?.zone !== 'exile') continue;
    const linkId = state.nextLinkedExileId ?? 0;
    state = {
      ...putObject(state, { ...object, linkedExileId: linkId }),
      nextLinkedExileId: linkId + 1,
    };
    linked.push({ oid, linkId });
  }
  if (linked.length === 0) return withState(trace, state);
  const currentSource = tryObject(state, sourceOid);
  if (
    currentSource === undefined ||
    currentSource.zone !== 'battlefield' ||
    (currentSource.incarnation ?? 0) !== sourceIncarnation
  ) {
    return withState(trace, state);
  }
  return withState(
    trace,
    putObject(state, {
      ...currentSource,
      linkedExile: [...(currentSource.linkedExile ?? []), ...linked],
    }),
  );
}

/** Move only exile incarnations named by the exact retained source links. */
export function moveLinkedExile(
  trace: Trace,
  references: readonly LinkedExileReference[],
  destination: 'hand' | 'battlefieldUnderOwner',
): Trace {
  return references.reduce((current, reference) => {
    const object = tryObject(current.state, reference.oid);
    if (object?.zone !== 'exile' || object.linkedExileId !== reference.linkId || object.token) {
      return current;
    }
    return destination === 'hand'
      ? moveObject(current, reference.oid, 'hand')
      : moveObject(current, reference.oid, 'battlefield', { controller: object.owner });
  }, trace);
}

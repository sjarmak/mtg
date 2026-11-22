/** Live battlefield replacement effects for proposed card zone changes. */
import type { ReplaceableEvent, ReplacementEffect } from './replacement-effects';
import { abilitiesOf } from './layers';
import { staticPlayerRuleInstances } from './player-rules';
import type { GameState } from './state';

type ZoneChangeEvent = Extract<ReplaceableEvent, { readonly kind: 'zoneChange' }>;

/**
 * Derives replacements at the event rather than registering them on entry.
 *
 * That keeps the source controller and its layer-derived abilities live. A
 * control change, copy effect, layer-6 ability removal, or source departure is
 * therefore visible at the same CR 614 choke point as the proposed move.
 */
export function zoneChangeReplacementsFor(
  state: GameState,
  event: ZoneChangeEvent,
): readonly ReplacementEffect[] {
  const object = state.objects[event.oid];
  if (object === undefined) return [];
  const isInstantOrSorceryCard =
    object.token === false && (object.card.kind === 'instant' || object.card.kind === 'sorcery');
  const rules = [
    ...(object.token === false
      ? staticPlayerRuleInstances(state, event.owner, 'cardsToGraveyardAreExiled')
      : []),
    ...staticPlayerRuleInstances(state, event.owner, 'cardsOrTokensToGraveyardAreExiled'),
    ...(isInstantOrSorceryCard
      ? staticPlayerRuleInstances(state, event.owner, 'instantOrSorceryCardsToGraveyardAreExiled')
      : []),
  ];
  const staticReplacements: ReplacementEffect[] = rules.map(
    ({ sourceOid, sourceController, abilityIndex, timestamp }) => {
      const ability = abilitiesOf(state, sourceOid)[abilityIndex];
      const includesTokens =
        ability?.kind === 'staticPlayerRule' && ability.rule === 'cardsOrTokensToGraveyardAreExiled';
      return {
        id: `static:${sourceOid}:${state.objects[sourceOid]?.incarnation ?? 0}:${abilityIndex}:graveyard-exile`,
        sourceOid,
        controller: sourceController,
        timestamp,
        duration: 'whileOnBattlefield',
        selfReplacement: false,
        trigger: {
          kind: 'zoneChange',
          owner: event.owner,
          from: null,
          destination: 'graveyard',
          cardOnly: !includesTokens,
        },
        modification: { kind: 'moveToZone', destination: 'exile' },
      };
    },
  );
  const linked =
    event.from === 'battlefield' && event.destination === 'graveyard'
      ? (state.turn.damageLinkedDeathExileThisTurn ?? []).find(
          (entry) => entry.oid === event.oid && entry.incarnation === (object.incarnation ?? 0),
        )
      : undefined;
  if (linked === undefined) return staticReplacements;
  const linkedReplacement: ReplacementEffect = {
    id: `turn:${linked.sourceOid}:${linked.sourceIncarnation}:${linked.oid}:${linked.incarnation}:graveyard-exile`,
    sourceOid: linked.sourceOid,
    controller: linked.controller,
    timestamp: linked.timestamp,
    duration: 'endOfTurn',
    selfReplacement: false,
    trigger: {
      kind: 'zoneChange',
      owner: event.owner,
      from: 'battlefield',
      destination: 'graveyard',
      cardOnly: false,
    },
    modification: { kind: 'moveToZone', destination: 'exile' },
  };
  return [...staticReplacements, linkedReplacement];
}

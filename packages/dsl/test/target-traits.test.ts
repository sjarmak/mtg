/** The structural target declaration and each projection derived from it. */
import { describe, expect, it } from 'vitest';
import {
  CARD_TYPE_FILTERABLE_TARGETS,
  REFERENT_TARGETS,
  SOURCE_ATTACHMENT_TARGETS,
  SOURCE_ATTACK_TARGETS,
  SOURCE_BODY_ONLY_TARGETS,
  TARGET_KIND_TRAITS,
  TARGET_KINDS,
  TRIGGER_EVENT_TARGETS,
  isAttackTriggerOnlyTarget,
  isSourceAttackTarget,
  isTriggerEventTarget,
  referentSourceSpace,
} from '@mtg/dsl';

describe('TARGET_KIND_TRAITS', () => {
  it('has one row for every target kind in vocabulary order', () => {
    expect(Object.keys(TARGET_KIND_TRAITS)).toEqual([...TARGET_KINDS]);
  });

  it('projects every contextual target list from the declared role', () => {
    expect([...SOURCE_ATTACK_TARGETS]).toEqual(
      TARGET_KINDS.filter((kind) => TARGET_KIND_TRAITS[kind].context === 'sourceAttack'),
    );
    expect([...SOURCE_BODY_ONLY_TARGETS]).toEqual(
      TARGET_KINDS.filter((kind) => TARGET_KIND_TRAITS[kind].context === 'sourceBody'),
    );
    expect([...SOURCE_ATTACHMENT_TARGETS]).toEqual(
      TARGET_KINDS.filter((kind) => TARGET_KIND_TRAITS[kind].context === 'sourceAttachment'),
    );
    expect([...REFERENT_TARGETS]).toEqual(
      TARGET_KINDS.filter((kind) => TARGET_KIND_TRAITS[kind].context === 'priorTarget'),
    );
    expect([...TRIGGER_EVENT_TARGETS]).toEqual(
      TARGET_KINDS.filter((kind) => TARGET_KIND_TRAITS[kind].context === 'triggerEvent'),
    );
    expect([...CARD_TYPE_FILTERABLE_TARGETS]).toEqual(
      TARGET_KINDS.filter((kind) => TARGET_KIND_TRAITS[kind].cardTypeFilterable),
    );
  });

  it('recognizes event-retained referents without exposing ordinary targets', () => {
    expect(TRIGGER_EVENT_TARGETS).toEqual(['triggeringCreature', 'triggeringPlayer', 'chosenPlayer']);
    for (const kind of TARGET_KINDS) {
      expect(isTriggerEventTarget(kind)).toBe(TRIGGER_EVENT_TARGETS.includes(kind));
    }
  });

  it('retains the former attack-only API as an exact compatibility alias', () => {
    for (const kind of TARGET_KINDS) {
      expect(isAttackTriggerOnlyTarget(kind)).toBe(isSourceAttackTarget(kind));
    }
  });

  it('keeps each prior-target referent and its required source space together', () => {
    const sources = REFERENT_TARGETS.map((kind) => [kind, referentSourceSpace(kind)] as const);
    expect(sources).toEqual([
      ['thatCreature', 'creature'],
      ['thatPlayer', 'player'],
      ['thatCreaturesController', 'creature'],
      ['thatPlayerOrPlaneswalkerController', 'playerOrPlaneswalker'],
    ]);
  });
});

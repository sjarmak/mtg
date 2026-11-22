/** Validation shared by every typed modification an Aura applies. */
import type { AuraModification, Card } from '../card';
import { canonicalJson } from '../canonical-json';
import type { Violation } from '../violations';
import { violation } from '../violations';
import { assertNever } from '../vocabulary';
import {
  checkGrantedActivatedAbility,
  checkGrantedCreatureTriggeredAbility,
  checkStaticModificationRecord,
  staticModificationIdentity,
} from './abilities';

function auraModificationIdentity(modification: AuraModification): string {
  switch (modification.kind) {
    case 'statBonus':
    case 'grantKeyword':
    case 'statBonusPer':
      // Defers to the one owner of what a static modification *is* rather than
      // restating the answer here. `statBonusPer`'s identity is keyed by the
      // tally it counts, so an Aura granting a rate per Plains and a rate per
      // Swamp prints two clauses that stack, and one written twice is still one.
      return staticModificationIdentity(modification);
    case 'cantAttack':
    case 'cantBlock':
    case 'cantBeBlocked':
    case 'grantLandwalk':
    case 'gainControl':
    case 'doesNotUntap':
    case 'cantActivateAbilities':
      return modification.kind;
    case 'grantTriggeredAbility':
    case 'grantActivatedAbility':
      return `${modification.kind}:${canonicalJson(modification.ability)}`;
    default:
      return assertNever(modification, 'auraModificationIdentity');
  }
}

/** Applies static ranges and one identity rule across the complete Aura list. */
export function checkAura(card: Card): Violation[] {
  if (card.kind !== 'enchantment' || card.aura === undefined) return [];
  const at = 'aura.modifications';
  const found: Violation[] =
    card.aura.modifications.length === 0 &&
    card.abilities.length === 0 &&
    card.aura.untapsDuringEachOtherPlayersUntapStep !== true
      ? [
          violation(
            'AURA_INVALID',
            at,
            'an Aura with no static modifications must carry at least one ability',
          ),
        ]
      : [];
  if (card.aura.untapsDuringEachOtherPlayersUntapStep === true) {
    if (card.aura.enchant !== 'land') {
      found.push(
        violation(
          'AURA_INVALID',
          'aura.untapsDuringEachOtherPlayersUntapStep',
          'the other-player untap permission is source-attested only for an enchanted land',
        ),
      );
    }
    if (card.aura.modifications.length > 0) {
      found.push(
        violation(
          'AURA_INVALID',
          'aura.modifications',
          'the other-player untap permission has no source-attested Forge composition with another Aura clause',
        ),
      );
    }
  }
  const firstSeen = new Map<string, number>();
  const activatedGrants = card.aura.modifications.filter(
    (modification) => modification.kind === 'grantActivatedAbility',
  );
  if (activatedGrants.length > 1) {
    found.push(
      violation(
        'AURA_INVALID',
        at,
        'an Aura may grant one activated ability; multiple AddAbility grants have no source-proven Forge composition',
      ),
    );
  }

  for (const [index, modification] of card.aura.modifications.entries()) {
    if (card.aura.enchant === 'land' && modification.kind !== 'grantActivatedAbility') {
      found.push(
        violation(
          'AURA_INVALID',
          `${at}[${index}]`,
          'a land Aura currently supports only a granted activated ability; creature characteristics and combat restrictions do not apply to a land host',
        ),
      );
    }
    if (card.aura.enchant === 'artifactOrCreature' && modification.kind === 'grantActivatedAbility') {
      found.push(
        violation(
          'AURA_INVALID',
          `${at}[${index}]`,
          'an activated-ability grant needs one fixed host kind; artifact-or-creature cannot validate source-relative creature effects for both hosts',
        ),
      );
    }
    if (
      modification.kind === 'statBonus' ||
      modification.kind === 'grantKeyword' ||
      modification.kind === 'statBonusPer'
    ) {
      found.push(...checkStaticModificationRecord(modification, `${at}[${index}]`));
    }
    if (modification.kind === 'grantTriggeredAbility') {
      found.push(
        ...checkGrantedCreatureTriggeredAbility(card.colors, modification.ability, `${at}[${index}].ability`),
      );
    }
    if (modification.kind === 'grantActivatedAbility') {
      found.push(...checkGrantedActivatedAbility(card, modification.ability, `${at}[${index}].ability`));
    }
    const key = auraModificationIdentity(modification);
    const earlier = firstSeen.get(key);
    if (earlier === undefined) {
      firstSeen.set(key, index);
      continue;
    }
    found.push(
      violation(
        'DUPLICATE_MODIFICATION',
        `${at}[${index}]`,
        `this ${modification.kind} says what ${at}[${earlier}] already says; express the intent as one modification`,
      ),
    );
  }
  return found;
}

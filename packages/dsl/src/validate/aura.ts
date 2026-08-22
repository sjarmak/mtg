/** Validation shared by every typed modification an Aura applies. */
import type { AuraModification, Card } from '../card';
import type { Violation } from '../violations';
import { violation } from '../violations';
import { assertNever } from '../vocabulary';
import { checkStaticModificationRecord, staticModificationIdentity } from './abilities';

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
      return modification.kind;
    default:
      return assertNever(modification, 'auraModificationIdentity');
  }
}

/** Applies static ranges and one identity rule across the complete Aura list. */
export function checkAura(card: Card): Violation[] {
  if (card.kind !== 'enchantment' || card.aura === undefined) return [];
  const at = 'aura.modifications';
  const found: Violation[] = [];
  const firstSeen = new Map<string, number>();

  for (const [index, modification] of card.aura.modifications.entries()) {
    if (
      modification.kind === 'statBonus' ||
      modification.kind === 'grantKeyword' ||
      modification.kind === 'statBonusPer'
    ) {
      found.push(...checkStaticModificationRecord(modification, `${at}[${index}]`));
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

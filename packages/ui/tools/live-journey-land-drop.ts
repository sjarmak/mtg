/**
 * Recognizing any land drop the legal-moves rail offers, not just a basic's.
 *
 * `mtg-rdtno`: the live journey's Commander precon step "keeps the hand and
 * plays a land" spent all 30 decisions on 27 Pass panels and three
 * hand-size discards without ever playing a land, because `playUntilLand`'s
 * land recognition only matched a hardcoded basic-land name against a legal
 * move labeled `Play <name>` -- a starter Commander deck's mana base is
 * mostly nonbasics (`Choked Estuary`, `Akoum Refuge`, `Blossoming Sands`,
 * ...), so an opening hand holding no basic left the loop with nothing to
 * recognize as a land drop and it fell through to passing priority every
 * turn until forced to discard.
 *
 * `'Play '` is never the prefix of any other legal move's label: casting a
 * spell or a commander is always `Cast <name>` (`../src/routes/play/prompt.ts`'s
 * `labelOf`, `case 'playLand': return \`Play ${nameOf(state, action.oid)}\`;`),
 * so the prefix alone identifies a `playLand` move, basic or not.
 *
 * `oneDecision`'s in-page script in `live-journey.ts` embeds
 * `LAND_DROP_LABEL_PREFIX` by value, so the browser-evaluated check and this
 * tested one never drift apart.
 */

/** The prefix every land-drop legal move's label carries, and no other move's. */
export const LAND_DROP_LABEL_PREFIX = 'Play ';

/** The land's name from a legal move's label, or `null` when it is not a land drop. */
export function landDropName(label: string): string | null {
  return label.startsWith(LAND_DROP_LABEL_PREFIX) ? label.slice(LAND_DROP_LABEL_PREFIX.length) : null;
}

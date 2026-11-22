/**
 * Exhaustive ownership map for the flat DSL keyword vocabulary.
 *
 * Execution stays in the rule modules named by these conceptual subsystems;
 * this table is only the extension contract that makes a newly printable
 * keyword choose an owner before it can compile. A keyword with no rules
 * consequence must use the explicit `mechanicallyInert` branch with a reason,
 * never an empty subsystem list.
 */
import type { Keyword } from '@mtg/dsl';

export type KeywordExecutionSubsystem =
  | 'attack-declaration'
  | 'attack-legality'
  | 'block-legality'
  | 'combat-damage-assignment'
  | 'combat-damage-steps'
  | 'damage-marking'
  | 'damage-resolution'
  | 'state-based-actions'
  | 'tap-cost-legality';

export type KernelKeywordImplementation =
  | {
      readonly kind: 'implemented';
      readonly subsystems: readonly [KeywordExecutionSubsystem, ...KeywordExecutionSubsystem[]];
    }
  | { readonly kind: 'mechanicallyInert'; readonly reason: string };

/** Named guard: `Record<Keyword, ...>` rejects an unclassified DSL keyword. */
export const KERNEL_KEYWORD_IMPLEMENTATIONS: Readonly<Record<Keyword, KernelKeywordImplementation>> = {
  flying: { kind: 'implemented', subsystems: ['block-legality'] },
  vigilance: { kind: 'implemented', subsystems: ['attack-declaration'] },
  haste: { kind: 'implemented', subsystems: ['attack-legality', 'tap-cost-legality'] },
  trample: { kind: 'implemented', subsystems: ['combat-damage-assignment'] },
  deathtouch: { kind: 'implemented', subsystems: ['damage-marking', 'state-based-actions'] },
  lifelink: { kind: 'implemented', subsystems: ['damage-resolution'] },
  menace: { kind: 'implemented', subsystems: ['block-legality'] },
  reach: { kind: 'implemented', subsystems: ['block-legality'] },
  firstStrike: { kind: 'implemented', subsystems: ['combat-damage-steps'] },
};

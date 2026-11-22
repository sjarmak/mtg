/** Plain-data damage records shared by application and paused allocation state. */
import type { Card } from '@mtg/dsl';
import type { ObjectId, PlayerId } from './ids';
import type { DamageRecipient } from './replacement-effects';

export interface DamageInstance {
  readonly sourceOid: ObjectId;
  /**
   * Source incarnation when this damage instruction was created. Optional only
   * for stored positions and untyped callers from before the field existed;
   * every production constructor supplies it.
   */
  readonly sourceIncarnation?: number;
  /** Copiable characteristics for a spell copy, which has no GameObject of its own. */
  readonly sourceCard?: Card;
  readonly controller: PlayerId;
  readonly recipient: DamageRecipient;
  readonly amount: number;
  readonly deathtouch: boolean;
  readonly lifelink: boolean;
  readonly combat: boolean;
  /** CR 615.12: false means prevention effects do not apply to this damage. */
  readonly preventable: boolean;
  /** Marks an actually damaged creature for a same-turn die-to-exile replacement. */
  readonly exileDamagedCreatureIfItWouldDieThisTurn?: true;
}

/** One source's maximum share of a numeric shield in a simultaneous batch. */
export interface DamagePreventionSource {
  readonly sourceOid: ObjectId;
  readonly damage: number;
}

/** One numeric shield that needs its simultaneous-source allocation chosen. */
export interface DamagePreventionPlan {
  readonly effectId: string;
  readonly player: PlayerId;
  readonly amount: number;
  readonly sources: readonly DamagePreventionSource[];
}

/** A replayable allocation already chosen for one numeric shield. */
export interface DamagePreventionAllocation {
  readonly effectId: string;
  readonly sources: readonly {
    readonly sourceOid: ObjectId;
    readonly amount: number;
  }[];
}

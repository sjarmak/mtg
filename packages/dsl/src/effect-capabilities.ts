/**
 * The policy facts downstream readers need when a new effect primitive lands.
 *
 * Execution, validation, Forge export, and pricing keep their own total tables
 * because those rows contain package-owned behavior. These two classifications
 * are different: they were repeated as exhaustive switches whose arms mostly
 * selected an existing policy family. Keeping that selection beside the effect
 * vocabulary makes one new primitive declare its intent once while each reader
 * still owns the implementation of the selected family.
 */
import type { AnyEffectKind } from './effects';

export type EffectHarmfulness = 'beneficial' | 'harmful' | 'counterDelta' | 'pumpDelta' | 'targetedGraveyard';

export type EffectTargetScoring =
  | 'animateLand'
  | 'basePt'
  | 'bounce'
  | 'chooseDiscard'
  | 'chooseFromRevealedHand'
  | 'control'
  | 'counterSpell'
  | 'counters'
  | 'damage'
  | 'destroy'
  | 'discard'
  | 'draw'
  | 'exile'
  | 'fight'
  | 'flipCoin'
  | 'gainLife'
  | 'grantKeyword'
  | 'graveyardExile'
  | 'graveyardPurge'
  | 'loseGame'
  | 'loseLife'
  | 'lure'
  | 'mill'
  | 'preventDamage'
  | 'pump'
  | 'reanimate'
  | 'returnToHand'
  | 'sacrifice'
  | 'setLife'
  | 'sourceControlTransfer'
  | 'tap'
  | 'token'
  | 'unblockable'
  | 'untap'
  | 'zero';

export interface EffectCapability {
  readonly harmfulness: EffectHarmfulness;
  readonly targetScoring: EffectTargetScoring;
  /**
   * Explicit standard landing state for a kernel-complete primitive that has
   * not yet earned either a Forge form or generator promotion.
   *
   * Absence means the existing primitive is integrated at the Forge boundary.
   * The partial branch carries a reason so a partial primitive cannot hide
   * behind an empty policy value. Forge conformance binds this declaration to its
   * refusal row; model-schema tests bind it to the hand-authored-only side.
   */
  readonly implementation?: {
    readonly kind: 'declaredPartial';
    readonly reason: string;
  };
}

/** Named guard: a primitive cannot compile until both policies are declared. */
export const EFFECT_CAPABILITIES = {
  dealDamage: { harmfulness: 'harmful', targetScoring: 'damage' },
  destroyPermanent: { harmfulness: 'harmful', targetScoring: 'destroy' },
  pumpUntilEndOfTurn: { harmfulness: 'pumpDelta', targetScoring: 'pump' },
  drawCards: { harmfulness: 'beneficial', targetScoring: 'draw' },
  gainLife: { harmfulness: 'beneficial', targetScoring: 'gainLife' },
  counterSpell: { harmfulness: 'beneficial', targetScoring: 'counterSpell' },
  createToken: { harmfulness: 'beneficial', targetScoring: 'token' },
  tapPermanent: { harmfulness: 'harmful', targetScoring: 'tap' },
  returnToHand: { harmfulness: 'harmful', targetScoring: 'returnToHand' },
  millCards: { harmfulness: 'harmful', targetScoring: 'mill' },
  putCounters: { harmfulness: 'counterDelta', targetScoring: 'counters' },
  exileTarget: { harmfulness: 'harmful', targetScoring: 'exile' },
  scry: { harmfulness: 'beneficial', targetScoring: 'zero' },
  returnFromGraveyard: { harmfulness: 'beneficial', targetScoring: 'reanimate' },
  populate: { harmfulness: 'beneficial', targetScoring: 'zero' },
  createTokenCopyOfSelf: { harmfulness: 'beneficial', targetScoring: 'zero' },
  revealHand: { harmfulness: 'harmful', targetScoring: 'zero' },
  revealRandomCardFromHand: { harmfulness: 'harmful', targetScoring: 'zero' },
  playRandomHandCardWithoutPayingManaCost: { harmfulness: 'beneficial', targetScoring: 'zero' },
  fight: { harmfulness: 'harmful', targetScoring: 'fight' },
  addMana: { harmfulness: 'beneficial', targetScoring: 'zero' },
  createEmblem: { harmfulness: 'beneficial', targetScoring: 'zero' },
  shuffleLibrary: { harmfulness: 'beneficial', targetScoring: 'zero' },
  revealTopCards: { harmfulness: 'beneficial', targetScoring: 'zero' },
  putOnLibrary: { harmfulness: 'harmful', targetScoring: 'bounce' },
  exileGraveyard: { harmfulness: 'targetedGraveyard', targetScoring: 'graveyardExile' },
  shuffleGraveyardIntoLibrary: { harmfulness: 'beneficial', targetScoring: 'zero' },
  searchLibrary: { harmfulness: 'beneficial', targetScoring: 'zero' },
  discardCards: { harmfulness: 'harmful', targetScoring: 'discard' },
  chooseDiscard: { harmfulness: 'harmful', targetScoring: 'chooseDiscard' },
  loseLife: { harmfulness: 'harmful', targetScoring: 'loseLife' },
  setLife: { harmfulness: 'beneficial', targetScoring: 'setLife' },
  preventCombatDamage: { harmfulness: 'beneficial', targetScoring: 'zero' },
  chooseBlockersThisCombat: { harmfulness: 'beneficial', targetScoring: 'zero' },
  chooseFromGraveyard: { harmfulness: 'beneficial', targetScoring: 'zero' },
  preventAllDamageToTarget: { harmfulness: 'beneficial', targetScoring: 'preventDamage' },
  untapPermanent: { harmfulness: 'beneficial', targetScoring: 'untap' },
  untapPermanents: { harmfulness: 'beneficial', targetScoring: 'zero' },
  skipNextUntap: { harmfulness: 'harmful', targetScoring: 'tap' },
  grantKeywordUntilEndOfTurn: { harmfulness: 'beneficial', targetScoring: 'grantKeyword' },
  cantBeBlockedThisTurn: { harmfulness: 'beneficial', targetScoring: 'unblockable' },
  cantBlockThisTurn: { harmfulness: 'harmful', targetScoring: 'lure' },
  blocksThisTurnIfAble: { harmfulness: 'harmful', targetScoring: 'lure' },
  attacksYouThisTurnIfAble: { harmfulness: 'harmful', targetScoring: 'lure' },
  sacrificeSelf: { harmfulness: 'beneficial', targetScoring: 'zero' },
  sacrificePermanent: { harmfulness: 'harmful', targetScoring: 'sacrifice' },
  setBasePtUntilEndOfTurn: { harmfulness: 'harmful', targetScoring: 'basePt' },
  returnSourceFromGraveyard: { harmfulness: 'beneficial', targetScoring: 'zero' },
  returnDepartedSourceToOwnerHand: { harmfulness: 'beneficial', targetScoring: 'zero' },
  putDepartedSourceOnTopOfOwnerLibrary: { harmfulness: 'beneficial', targetScoring: 'zero' },
  shuffleSourceIntoOwnerLibrary: { harmfulness: 'beneficial', targetScoring: 'zero' },
  setColorsUntilEndOfTurn: { harmfulness: 'beneficial', targetScoring: 'zero' },
  attacksThisTurnIfAble: { harmfulness: 'harmful', targetScoring: 'lure' },
  shuffleHandsAndGraveyardsIntoLibraries: { harmfulness: 'beneficial', targetScoring: 'zero' },
  exileThisSpell: { harmfulness: 'beneficial', targetScoring: 'zero' },
  moveSourceLinkedExile: { harmfulness: 'beneficial', targetScoring: 'zero' },
  exileNonbasicGraveyardAndMatchingLibrary: { harmfulness: 'harmful', targetScoring: 'graveyardPurge' },
  eachPlayerNamesCardThenRevealsTop: { harmfulness: 'beneficial', targetScoring: 'zero' },
  nameNonlandCardAndExileMatchingOpponentZones: {
    harmfulness: 'harmful',
    targetScoring: 'graveyardPurge',
  },
  revealUntilCreatureCards: { harmfulness: 'beneficial', targetScoring: 'zero' },
  gainControlUntilEndOfTurn: { harmfulness: 'harmful', targetScoring: 'control' },
  targetPlayerGainsControlOfSelfPermanent: {
    harmfulness: 'harmful',
    targetScoring: 'sourceControlTransfer',
  },
  preventAllDamageToYouAndCreaturesYouControl: { harmfulness: 'beneficial', targetScoring: 'zero' },
  cantCastSpellsThisTurn: { harmfulness: 'beneficial', targetScoring: 'zero' },
  protectSpellsAndCreaturesFromSpellColorsThisTurn: { harmfulness: 'beneficial', targetScoring: 'zero' },
  changeSpellTargets: { harmfulness: 'beneficial', targetScoring: 'zero' },
  copySpell: { harmfulness: 'beneficial', targetScoring: 'zero' },
  copyNextInstantOrSorceryThisTurn: { harmfulness: 'beneficial', targetScoring: 'zero' },
  flipCoin: { harmfulness: 'beneficial', targetScoring: 'flipCoin' },
  revealTopCardToHand: { harmfulness: 'beneficial', targetScoring: 'zero' },
  preventNextDamageToYouAndRetaliate: { harmfulness: 'harmful', targetScoring: 'damage' },
  animateLandWhileSourceOnBattlefield: { harmfulness: 'beneficial', targetScoring: 'animateLand' },
  animateSourceUntilEndOfTurn: { harmfulness: 'beneficial', targetScoring: 'zero' },
  gainControl: { harmfulness: 'harmful', targetScoring: 'control' },
  addSubtype: { harmfulness: 'beneficial', targetScoring: 'zero' },
  returnSourceAuraAttached: { harmfulness: 'harmful', targetScoring: 'destroy' },
  regeneratePermanent: { harmfulness: 'beneficial', targetScoring: 'zero' },
  loseGame: { harmfulness: 'harmful', targetScoring: 'loseGame' },
  winGame: { harmfulness: 'beneficial', targetScoring: 'zero' },
  doubleSourceCounters: { harmfulness: 'beneficial', targetScoring: 'zero' },
  reorderTopLibrary: { harmfulness: 'beneficial', targetScoring: 'zero' },
  selectFromTopLibrary: { harmfulness: 'beneficial', targetScoring: 'zero' },
  separateTopLibraryIntoPiles: { harmfulness: 'beneficial', targetScoring: 'zero' },
  destroyAttachedPermanents: { harmfulness: 'harmful', targetScoring: 'zero' },
  exchangeControl: { harmfulness: 'beneficial', targetScoring: 'zero' },
  chooseFromBattlefield: { harmfulness: 'beneficial', targetScoring: 'zero' },
  putSourceAndTargetOnOwnersLibrariesThenShuffle: { harmfulness: 'harmful', targetScoring: 'bounce' },
  exileHandsAndGraveyards: { harmfulness: 'beneficial', targetScoring: 'zero' },
  chooseFromRevealedHand: { harmfulness: 'harmful', targetScoring: 'chooseFromRevealedHand' },
  petrifyCreature: { harmfulness: 'harmful', targetScoring: 'destroy' },
  castCopiesOfCardsExiledThisResolutionWithoutPayingManaCosts: {
    harmfulness: 'beneficial',
    targetScoring: 'zero',
  },
  preventCombatDamageToYou: { harmfulness: 'beneficial', targetScoring: 'zero' },
  detainPermanent: { harmfulness: 'harmful', targetScoring: 'tap' },
} satisfies Readonly<Record<AnyEffectKind, EffectCapability>>;

/** The literal key union carried by partial rows in the capability declaration. */
export type DeclaredPartialEffectKind = {
  [K in keyof typeof EFFECT_CAPABILITIES]: (typeof EFFECT_CAPABILITIES)[K] extends {
    readonly implementation: { readonly kind: 'declaredPartial' };
  }
    ? K
    : never;
}[keyof typeof EFFECT_CAPABILITIES];

/** Kernel-complete primitives intentionally stopped at the partial tier. */
export const DECLARED_PARTIAL_EFFECT_KINDS: readonly DeclaredPartialEffectKind[] = (
  Object.keys(EFFECT_CAPABILITIES) as (keyof typeof EFFECT_CAPABILITIES)[]
).filter((kind): kind is DeclaredPartialEffectKind => {
  const capability: EffectCapability = EFFECT_CAPABILITIES[kind];
  return capability.implementation?.kind === 'declaredPartial';
});
